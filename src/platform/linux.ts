/** Linux 平台实现：扫描 .desktop 程序、系统图标主题、xdg-open 启动、发行版安装引导/自动安装 */

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { run } from '../vcs/exec.js';
import { t } from '../shared/i18n/index.js';
import { parseAppCommand, launchDetached, shq } from './util.js';
import type { InstallTool, Platform } from './types.js';

/** 内置（可能是第三方改写过的 .desktop）的本地化名选择：Name[zh_CN] > 系统 locale > 短码 > en > 默认名 */
function pickLocaleName(names: Record<string, string>, baseName: string): string {
  const loc = (process.env.LC_ALL ?? process.env.LANG ?? '').split('.')[0] ?? '';
  const lang = loc.split('_')[0] ?? '';
  return names.zh_CN || names[loc] || (lang && names[lang]) || names.en || baseName;
}

/** 扫描系统 .desktop 程序（/usr/share/applications + ~/.local/share/applications），按 MimeType 匹配返回可选择的打开方式 */
function scanDesktopApps(): { name: string; exec: string; mimes: Set<string>; icon: string; desktopId: string }[] {
  const dirs = [
    '/usr/share/applications',
    '/usr/local/share/applications',
    path.join(os.homedir(), '.local', 'share', 'applications'),
  ];
  const apps: { name: string; exec: string; mimes: Set<string>; noDisplay: boolean; icon: string; desktopId: string }[] = [];
  for (const dir of dirs) {
    let files: string[];
    try {
      files = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const f of files) {
      if (!f.endsWith('.desktop')) continue;
      try {
        const text = fs.readFileSync(path.join(dir, f), 'utf8');
        let baseName = '';
        let nameCount = 0; // >1 说明 .desktop 被第三方改写（如 deepin 商店包合并出 Name=New Empty Window）,本地化名不可信
        const names: Record<string, string> = {};
        let exec = '';
        let icon = '';
        let mimes = new Set<string>();
        let noDisplay = false;
        let type = '';
        let hidden = false;
        /** 只解析 [Desktop Entry] 组：后面的 [Desktop Action ...] 也有 Name/Exec，
         *  不区分会把主 Exec 覆盖成「新建窗口」之类的动作（如 Deepin Browser 被改成 --incognito） */
        let inMain = true;
        for (const raw of text.split('\n')) {
          const line = raw.trim();
          if (line.startsWith('[')) {
            inMain = line === '[Desktop Entry]';
            continue;
          }
          if (!inMain || !line.includes('=')) continue;
          const [k, v] = [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)];
          if (k === 'Name') {
            nameCount++;
            if (!baseName) baseName = v; // Name 唯一,取首次出现的正名
          } else if (k.startsWith('Name[') && k.endsWith(']')) names[k.slice(5, -1)] = v;
          else if (k === 'Icon') icon = v;
          else if (k === 'Exec') exec = v;
          else if (k === 'MimeType') mimes = new Set(v.split(';').filter(Boolean));
          else if (k === 'NoDisplay') noDisplay = v === 'true';
          else if (k === 'Type') type = v;
          else if (k === 'Hidden') hidden = v === 'true';
        }
        if (!baseName || !exec || noDisplay || hidden || (type && type !== 'Application')) continue;
        apps.push({
          name: nameCount > 1 ? baseName : pickLocaleName(names, baseName),
          exec,
          mimes,
          noDisplay,
          icon,
          desktopId: f.replace(/\.desktop$/i, ''),
        });
      } catch {
        /* 单个文件损坏跳过 */
      }
    }
  }
  // 去重（优先本地程序）：Exec+Name 同视为重复;本地目录优先级已由遍历顺序保证
  const seen = new Set<string>();
  const out: { name: string; exec: string; mimes: Set<string>; icon: string; desktopId: string }[] = [];
  for (const a of apps) {
    const key = `${a.exec}|${a.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name: a.name, exec: a.exec, mimes: a.mimes, icon: a.icon, desktopId: a.desktopId });
  }
  return out;
}

/** 系统默认浏览器的 .desktop id（xdg-settings 优先，回退 xdg-mime；缓存，避免每次开菜单都 spawn） */
let defaultBrowserIdCache: string | null | undefined;
function defaultBrowserDesktopId(): string {
  if (defaultBrowserIdCache !== undefined) return defaultBrowserIdCache ?? '';
  const probes: [string, string[]][] = [
    ['xdg-settings', ['get', 'default-web-browser']],
    ['xdg-mime', ['query', 'default', 'text/html']],
  ];
  for (const [cmd, args] of probes) {
    try {
      const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: 5000 });
      const id = (r.stdout ?? '').trim().split('\n')[0] ?? '';
      if (r.status === 0 && id) {
        defaultBrowserIdCache = id;
        return id;
      }
    } catch {
      /* 换下一个探测命令 */
    }
  }
  defaultBrowserIdCache = null;
  return '';
}

/** 发行版包管理器探测（/etc/os-release）：返回安装命令**前缀**（sudo -n 免密路径用）与手动命令前缀；
 *  软件包清单由调用方按所选工具拼接（用户可能只缺 git 或只缺 svn，不能一律全装）;
 *  未知回退 apt(Debian 系默认)。 */
function detectDistro(): { name: string; manager: string; install: string[]; manual: string } {
  let id = '';
  try {
    const osr = fs.readFileSync('/etc/os-release', 'utf8');
    const m = osr.match(/^ID=([\w.-]+)/m);
    if (m) id = m[1]!.toLowerCase();
  } catch {
    /* 读失败按未知处理 */
  }
  switch (id) {
    case 'fedora':
      return { name: 'Fedora', manager: 'dnf', install: ['sudo', '-n', 'dnf', 'install', '-y'], manual: 'sudo dnf install -y' };
    case 'rhel':
    case 'centos':
      return { name: 'CentOS/RHEL', manager: 'yum', install: ['sudo', '-n', 'yum', 'install', '-y'], manual: 'sudo yum install -y' };
    case 'opensuse':
    case 'opensuse-leap':
    case 'opensuse-tumbleweed':
      return { name: 'openSUSE', manager: 'zypper', install: ['sudo', '-n', 'zypper', '--non-interactive', 'install'], manual: 'sudo zypper --non-interactive install -y' };
    case 'arch':
      return { name: 'Arch', manager: 'pacman', install: ['sudo', '-n', 'pacman', '-S', '--noconfirm'], manual: 'sudo pacman -S --noconfirm' };
    default:
      // 未知发行版
      return { name: id || t('plat.distroUnknown'), manager: 'apt', install: ['sudo', '-n', 'apt-get', 'install', '-y'], manual: 'sudo apt-get install -y' };
  }
}

/** 需要 sudo 密码时：写临时脚本并拉起系统终端执行（终端里 sudo 自行提示输密码，免去用户复制命令）。
 *  成功返回 true（终端已打开）；无图形环境（SSH 等）/ 找不到终端模拟器 → false（调用方回退手动命令文案）。 */
async function openInstallTerminal(manualPrefix: string, pkgs: string[], send: (d: Record<string, unknown>) => void): Promise<boolean> {
  // 无图形环境：终端窗口无处可开（SSH 会话等），直接回退文字命令
  if (!process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) return false;
  const script = path.join(os.tmpdir(), `svngit-env-install-${Date.now()}.sh`);
  const content = [
    '#!/bin/bash',
    'rm -f -- "$0"', // 临时脚本自删，不在 /tmp 留痕
    `${manualPrefix} ${pkgs.join(' ')}`,
    'echo',
    `echo ${shq(t('plat.sudoTermDone'))}`,
    'exec bash', // 窗口留着让用户看到输出（与 runScript 行为一致）
  ].join('\n') + '\n';
  try {
    fs.writeFileSync(script, content, { mode: 0o755 });
  } catch {
    return false;
  }
  const term = findTerminal(`bash ${shq(script)}`);
  if (!term) return false;
  const r = await launchDetached([term.bin, ...term.argv], t('plat.sudoTermOpened'));
  if (!r.ok) return false;
  // 已在系统终端打开安装命令，请在终端中输入密码完成安装
  send({ line: t('plat.sudoTermOpened') });
  // 执行的命令: {cmd}（让用户在输密码前看到具体命令）
  send({ line: t('plat.sudoTermCmd', { cmd: `${manualPrefix} ${pkgs.join(' ')}` }) });
  return true;
}

/** 按 .desktop Icon= 名在系统图标目录找图片（theme 未解析,按 hicolor 常规尺寸/可缩放目录查找） */
function findLinuxIcon(key: string): { data: Buffer; contentType: string } | null {
  if (key.includes('..')) return null; // 防路径穿越
  const dirs = [48, 64, 128, 256, 512].map((s) => `/usr/share/icons/hicolor/${s}x${s}/apps`).concat([
    '/usr/share/icons/hicolor/scalable/apps', '/usr/share/icons/hicolor/96x96/apps',
    '/usr/share/pixmaps', '/usr/share/icons/HighContrast/48x48/apps',
  ]);
  const cands: string[] = [];
  if (key.startsWith('/')) {
    // 绝对路径 .desktop Icon（如 /opt/apps/xxx/.../icon.svg）:限系统安装区
    const roots = ['/usr/share/', '/usr/local/share/', '/opt/apps/', path.join(os.homedir(), '.local', 'share/')];
    if (roots.some((r) => key.startsWith(r))) cands.push(key.trim());
  } else {
    for (const d of dirs) for (const ext2 of ['.svg', '.png', '.xpm', '.gif']) cands.push(`${d}/${key}${ext2}`);
  }
  for (const c of cands) {
    let st: fs.Stats | null = null;
    try {
      st = fs.statSync(c);
    } catch {
      continue;
    }
    if (!st?.isFile() || st.size > 2 * 1024 * 1024) continue;
    const contentType = c.endsWith('.svg') ? 'image/svg+xml' : c.endsWith('.png') ? 'image/png' : c.endsWith('.gif') ? 'image/gif' : 'image/x-xpixmap';
    return { data: fs.readFileSync(c), contentType };
  }
  return null;
}

/** 终端模拟器探测表（按优先级）：各终端「怎么让它运行一条命令」的参数约定不同，逐个适配——
 *  gnome-terminal / mate-terminal 用 `--`（`-e` 已废弃）；xfce4-terminal 用 `-x`；kitty 直接跟命令；
 *  其余（x-terminal-emulator / konsole / alacritty / xterm）用 `-e`。 */
const TERMINALS: { bin: string; run: (cmd: string) => string[] }[] = [
  { bin: 'x-terminal-emulator', run: (c) => ['-e', 'bash', '-c', c] },
  { bin: 'gnome-terminal', run: (c) => ['--', 'bash', '-c', c] },
  { bin: 'konsole', run: (c) => ['-e', 'bash', '-c', c] },
  { bin: 'xfce4-terminal', run: (c) => ['-x', 'bash', '-c', c] },
  { bin: 'mate-terminal', run: (c) => ['--', 'bash', '-c', c] },
  { bin: 'alacritty', run: (c) => ['-e', 'bash', '-c', c] },
  { bin: 'kitty', run: (c) => ['bash', '-c', c] },
  { bin: 'xterm', run: (c) => ['-e', 'bash', '-c', c] },
];

/** PATH 目录里找可执行文件（不依赖 which —— 极简发行版上可能没有该命令） */
function inPath(bin: string): boolean {
  return (process.env.PATH ?? '').split(':').some((d) => d !== '' && fs.existsSync(path.join(d, bin)));
}

/** 找系统终端模拟器并定好启动参数：$TERMINAL（用户显式指定，最高优先）→ 探测表按优先级。
 *  $TERMINAL 认得出来的按它自己的约定，认不出的按最通用的 `-e`；指定的不可用则继续往下探。 */
function findTerminal(cmd: string): { bin: string; argv: string[] } | null {
  const custom = process.env.TERMINAL?.trim();
  if (custom && (custom.includes('/') ? fs.existsSync(custom) : inPath(custom))) {
    const known = TERMINALS.find((x) => x.bin === path.basename(custom));
    return { bin: custom, argv: (known?.run ?? ((c: string) => ['-e', 'bash', '-c', c]))(cmd) };
  }
  for (const x of TERMINALS) if (inPath(x.bin)) return { bin: x.bin, argv: x.run(cmd) };
  return null;
}

export const linux: Platform = {
  isWindows: false,
  // Linux 侧 svn 恒在 PATH（apt 等装到 /usr/bin），无需路径兜底
  svnFallbacks: [],
  chooseOpenCmd: null,

  listOpenWithApps(ext, mimes) {
    if (!mimes.size) return [];
    // desktopId 去掉了 .desktop 后缀，默认浏览器返回值也按同样规则归一化后比较
    const def = defaultBrowserDesktopId().replace(/\.desktop$/i, '');
    return scanDesktopApps()
      .filter((a) => [...mimes].some((m) => a.mimes.has(m)))
      .map((a) => ({
        name: a.name,
        exec: a.exec,
        icon: a.icon,
        isDefaultBrowser: Boolean(def && a.desktopId === def),
      }));
  },

  async openInBrowser(abs, rel) {
    try {
      return await launchDetached(['sensible-browser', abs], t('plat.openedInBrowser', { rel }));
    } catch {
      // 没有 sensible-browser 时回退 xdg-open（按系统 MIME 关联打开）
      return this.openDefault(abs, rel);
    }
  },

  openDefault(abs, rel) {
    // 已用系统默认程序打开: {rel}
    return launchDetached(['xdg-open', abs], t('plat.openedDefault', { rel }));
  },

  async openWithApp(abs, exec, rel) {
    if (!exec) return this.openDefault(abs, rel);
    try {
      const cmd = parseAppCommand(exec, abs);
      // Exec 为空
      if (!cmd.length) throw new Error(t('plat.execEmpty'));
      // 已用 {app} 打开: {rel}
      return await launchDetached(cmd, t('plat.openedWith', { app: cmd[0]!, rel }));
    } catch (e) {
      return { ok: false, message: (e as Error).message };
    }
  },

  async runScript(abs, rel) {
    // Linux 只有 .sh 有执行途径；.bat/.cmd 是 Windows 专属（前端菜单仍会显示菜单项，
    // 因为前端不知道平台——这里给明确错误，好过静默失败。不提「仅 .bat/.cmd/.sh」：
    // 用户点的就是这三种之一，那样说自相矛盾）
    if (path.extname(abs).toLowerCase() !== '.sh') return { ok: false, message: t('plat.winOnlyScript') };
    // `; exec bash` 让脚本跑完窗口留着（输出看得见，与 Windows 侧 cmd /k 行为对齐）
    const term = findTerminal(`cd ${shq(path.dirname(abs))} && bash ${shq(abs)}; exec bash`);
    // 未找到可用的终端模拟器（可设置 $TERMINAL 环境变量）
    if (!term) return { ok: false, message: t('plat.noTerminal') };
    // 已在系统终端中运行: {rel}
    return launchDetached([term.bin, ...term.argv], t('plat.ranScript', { rel }));
  },

  resolveAppIcon(key) {
    return findLinuxIcon(key);
  },

  async revealPath(abs) {
    // 目录直接打开本身；文件才打开所在文件夹（否则右键目录会定位到上一级）
    const target = fs.statSync(abs).isDirectory() ? abs : path.dirname(abs);
    await run('xdg-open', [target], { timeoutMs: 10_000 });
  },

  async openTerminal(abs) {
    // 在当前目录打开交互式终端（复用 runScript 的终端探测表 / $TERMINAL）。
    // `; exec bash`：cd 失败时窗口也留着，不会一闪就关
    const term = findTerminal(`cd ${shq(abs)}; exec bash`);
    // 未找到可用的终端模拟器（可设置 $TERMINAL 环境变量）
    if (!term) return { ok: false, message: t('plat.noTerminal') };
    // 已打开终端
    return launchDetached([term.bin, ...term.argv], t('plat.terminalOpened'));
  },

  async trashPath(abs) {
    // 优先 gio（GLib 自带，桌面发行版必有）；回退 trash-put（trash-cli）；都失败则 throw（调用方交前端二次确认是否直接删）
    const attempts: { cmd: string; args: string[] }[] = [
      { cmd: 'gio', args: ['trash', abs] },
      { cmd: 'trash-put', args: [abs] },
    ];
    const errs: string[] = [];
    for (const a of attempts) {
      try {
        const r = await run(a.cmd, a.args, { timeoutMs: 30_000 });
        if (r.code === 0) return;
        // stderr 常自带程序名前缀（gio 的报错就是 "gio: ..."），不再叠一层，避免 "gio: gio: ..."
        const se = r.stderr.trim();
        errs.push(se ? (se.startsWith(`${a.cmd}:`) ? se : `${a.cmd}: ${se}`) : `${a.cmd}: exit ${r.code}`);
      } catch (e) {
        errs.push(`${a.cmd}: ${(e as Error).message}`);
      }
    }
    // 移到回收站失败（gio / trash-put 均不可用）: {msg}
    throw new Error(t('plat.trashFailed', { msg: errs.join('; ') }));
  },

  openUrl(url) {
    const p = spawn('xdg-open', [url], { stdio: 'ignore', detached: true });
    // [svngit] 打开浏览器失败({cmd}): {msg}
    p.on('error', (e) => console.error(t('plat.openUrlFail', { cmd: 'xdg-open', msg: e.message })));
    p.unref();
  },

  listFontFamilies() {
    // fc-list 的 %{family} 对 TTC 会输出多个 family（逗号分隔），逐个拆分去重
    try {
      const res = spawnSync('fc-list', ['--format=%{family}\n'], { encoding: 'utf8', timeout: 30_000 });
      if (res.status !== 0) return [];
      const set = new Set<string>();
      for (const line of res.stdout.split('\n')) {
        for (const fam of line.split(',')) {
          const t = fam.trim();
          if (t) set.add(t);
        }
      }
      return [...set];
    } catch {
      return [];
    }
  },

  installAppMenu(exePath) {
    // 应用内"安装到系统应用菜单"（AppImage 运行方式）：~/.local/share/applications/svngit.desktop + hicolor 图标
    try {
      const appsDir = path.join(os.homedir(), '.local', 'share', 'applications');
      fs.mkdirSync(appsDir, { recursive: true });
      // 图标：运行时资源（dist/client/icon.png 打包在 asar 内，electron fs 兼容读取）拷入 hicolor；
      // 本文件编译后位于 dist/platform/ → 图标候选：dist/client/icon.png、项目根/build/icon.png
      const iconRel = path.join(os.homedir(), '.local', 'share', 'icons', 'hicolor', '512x512', 'apps', 'svngit.png');
      let iconOk = false;
      const here = import.meta.dirname ?? '.';
      for (const cand of [
        path.resolve(here, '..', 'client', 'icon.png'),
        path.resolve(here, '..', '..', 'build', 'icon.png'),
      ]) {
        try {
          fs.mkdirSync(path.dirname(iconRel), { recursive: true });
          fs.copyFileSync(cand, iconRel);
          iconOk = true;
          break;
        } catch {
          /* 尝试下一候选 */
        }
      }
      // Icon 用绝对路径（部分桌面环境按主题名查找不稳定；绝对路径各环境通用）
      // Name/Comment 是系统菜单里给用户看的文案（随界面语言）；其余键名/路径/命令是协议字段，不改
      const desktop = [
        '[Desktop Entry]',
        'Type=Application',
        // svn-git文件版本管理
        `Name=${t('plat.desktopName')}`,
        // SVN/Git 状态检测与操作工具
        `Comment=${t('plat.desktopComment')}`,
        `Exec="${exePath}" %U`,
        `Icon=${iconRel}`,
        'Terminal=false',
        'Categories=Development;',
        'StartupWMClass=svngit',
      ].join('\n') + '\n';
      fs.writeFileSync(path.join(appsDir, 'svngit.desktop'), desktop, { mode: 0o644 });
      // 刷新菜单/图标缓存（工具存在则执行，失败忽略——部分发行版无该命令）
      spawnSync('update-desktop-database', [appsDir], { stdio: 'ignore', timeout: 15_000 });
      spawnSync('gtk-update-icon-cache', ['-f', path.join(os.homedir(), '.local', 'share', 'icons', 'hicolor')], { stdio: 'ignore', timeout: 15_000 });
      return { ok: true, message: t(iconOk ? 'plat.installedMenu' : 'plat.installedMenuNoIcon') };
    } catch (e) {
      // 安装失败: {msg}
      return { ok: false, message: t('plat.installFail', { msg: (e as Error).message }) };
    }
  },

  uninstallAppMenu() {
    try {
      const desktop = path.join(os.homedir(), '.local', 'share', 'applications', 'svngit.desktop');
      const icon = path.join(os.homedir(), '.local', 'share', 'icons', 'hicolor', '512x512', 'apps', 'svngit.png');
      if (fs.existsSync(desktop)) fs.rmSync(desktop);
      if (fs.existsSync(icon)) fs.rmSync(icon);
      // 已从系统应用菜单卸载
      return { ok: true, message: t('plat.uninstalledMenu') };
    } catch (e) {
      // 卸载失败: {msg}
      return { ok: false, message: t('plat.uninstallFail', { msg: (e as Error).message }) };
    }
  },

  async envInstall(tool: InstallTool, send, done) {
    const pkgs = tool === 'svn' ? ['subversion'] : tool === 'git' ? ['git'] : ['git', 'subversion'];
    /** 发行版包管理器探测（/etc/os-release）：不同发行版 svn/git 包名与安装命令不同 */
    const distro = detectDistro();
    const install = distro.install; // 命令前缀 ['sudo','-n',<manager>,...]，软件包按所选工具拼
    const manual = `${distro.manual} ${pkgs.join(' ')}`; // 手动命令（只含所选工具，避免"点 SVN 却装 Git"）
    const sudoOk = await run('sudo', ['-n', 'true'], { timeoutMs: 10_000 });
    send({ line: t(sudoOk.code === 0 ? 'plat.sudoOk' : 'plat.sudoNeedPassword') });
    // 发行版: {name}（{manager}）
    send({ line: t('plat.distro', { name: distro.name, manager: distro.manager }) });
    if (sudoOk.code !== 0) {
      // 需要密码：拉起系统终端执行（sudo 在终端里自行提示输密码）；
      // 拉不起终端（无图形环境/无终端模拟器）时前端会显示 manual 命令
      const opened = await openInstallTerminal(distro.manual, pkgs, send);
      send({ done: true, code: 1, manual, ...(opened ? { taskOpened: true } : {}) });
      done();
      return;
    }
    // 开始安装: {pkgs}…
    send({ line: t('plat.installStart', { pkgs: pkgs.join(' ') }) });
    const child = spawn(install[0]!, install.slice(1).concat(pkgs), { stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', (d: Buffer) => send({ line: d.toString() }));
    child.stderr.on('data', (d: Buffer) => send({ line: d.toString() }));
    child.on('error', (e) => {
      // 启动失败: {msg}
      send({ line: t('plat.launchFail', { msg: e.message }) });
      send({ done: true, code: 1, manual });
      done();
    });
    child.on('close', (code) => {
      // ✅ 安装完成 / ❌ 安装失败（退出码 {code}）
      send({ line: code === 0 ? t('plat.installDone') : t('plat.installFailed', { code: String(code) }) });
      send({ done: true, code: code ?? 1 });
      done();
    });
  },

  async portOwnerPids(port: number): Promise<number[]> {
    // ss（iproute2，现代发行版标配）：列 Local-Address:Port 那列必须**以 :port 结尾**才算命中——
    // 整行里搜 ':port' 会连对端地址一起命中，杀错人。
    const ss = await run('ss', ['-ltnp'], { timeoutMs: 8000 });
    if (ss.code === 0 && ss.stdout.trim()) {
      const pids = new Set<number>();
      for (const line of ss.stdout.split('\n')) {
        const cols = line.trim().split(/\s+/);
        // State Recv-Q Send-Q Local-Address:Port Peer-Address:Port Process
        if (cols[0] !== 'LISTEN' || cols.length < 5) continue;
        if (!(cols[3] ?? '').endsWith(`:${port}`)) continue;
        for (const m of line.matchAll(/pid=(\d+)/g)) pids.add(Number(m[1]));
      }
      return [...pids];
    }
    // 兜底 fuser（psmisc，老系统上更常见）：输出就是 PID 列表
    const f = await run('fuser', [`${port}/tcp`], { timeoutMs: 8000 });
    return f.stdout
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map(Number)
      .filter((n) => Number.isInteger(n) && n > 0);
  },

  async killProcesses(pids: number[]): Promise<void> {
    for (const pid of pids) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        /* 已退出 / 无权限：忽略 */
      }
    }
  },
};
