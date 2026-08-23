/** Linux 平台实现：扫描 .desktop 程序、系统图标主题、xdg-open 启动、发行版安装引导/自动安装 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { run } from '../vcs/exec.js';
import { parseAppCommand, launchDetached } from './util.js';
import type { InstallTool, OpenWithApp, Platform } from './types.js';

/** 内置（可能是第三方改写过的 .desktop）的本地化名选择：Name[zh_CN] > 系统 locale > 短码 > en > 默认名 */
function pickLocaleName(names: Record<string, string>, baseName: string): string {
  const loc = (process.env.LC_ALL ?? process.env.LANG ?? '').split('.')[0] ?? '';
  const lang = loc.split('_')[0] ?? '';
  return names.zh_CN || names[loc] || (lang && names[lang]) || names.en || baseName;
}

/** 扫描系统 .desktop 程序（/usr/share/applications + ~/.local/share/applications），按 MimeType 匹配返回可选择的打开方式 */
function scanDesktopApps(): { name: string; exec: string; mimes: Set<string>; icon: string }[] {
  const dirs = [
    '/usr/share/applications',
    '/usr/local/share/applications',
    path.join(os.homedir(), '.local', 'share', 'applications'),
  ];
  const apps: { name: string; exec: string; mimes: Set<string>; noDisplay: boolean; icon: string }[] = [];
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
        for (const raw of text.split('\n')) {
          const line = raw.trim();
          if (line.startsWith('[') || !line.includes('=')) continue;
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
        apps.push({ name: nameCount > 1 ? baseName : pickLocaleName(names, baseName), exec, mimes, noDisplay, icon });
      } catch {
        /* 单个文件损坏跳过 */
      }
    }
  }
  // 去重（优先本地程序）：Exec+Name 同视为重复;本地目录优先级已由遍历顺序保证
  const seen = new Set<string>();
  const out: { name: string; exec: string; mimes: Set<string>; icon: string }[] = [];
  for (const a of apps) {
    const key = `${a.exec}|${a.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name: a.name, exec: a.exec, mimes: a.mimes, icon: a.icon });
  }
  return out;
}

/** 发行版包管理器探测（/etc/os-release）：返回安装命令与手动命令;未知回退 apt(Debian 系默认)。 */
function detectDistro(): { name: string; manager: string; install: string[]; manual: string } {
  let id = '';
  try {
    const osr = fs.readFileSync('/etc/os-release', 'utf8');
    const m = osr.match(/^ID=([\w.-]+)/m);
    if (m) id = m[1]!.toLowerCase();
  } catch {
    /* 读失败按未知处理 */
  }
  const arg = ['git', 'subversion'].join(' ');
  switch (id) {
    case 'fedora':
      return { name: 'Fedora', manager: 'dnf', install: ['sudo', '-n', 'dnf', 'install', '-y', 'git', 'subversion'], manual: `sudo dnf install -y ${arg}` };
    case 'rhel':
    case 'centos':
      return { name: 'CentOS/RHEL', manager: 'yum', install: ['sudo', '-n', 'yum', 'install', '-y', 'git', 'subversion'], manual: `sudo yum install -y ${arg}` };
    case 'opensuse':
    case 'opensuse-leap':
    case 'opensuse-tumbleweed':
      return { name: 'openSUSE', manager: 'zypper', install: ['sudo', '-n', 'zypper', '--non-interactive', 'install', 'git', 'subversion'], manual: `sudo zypper --non-interactive install -y ${arg}` };
    case 'arch':
      return { name: 'Arch', manager: 'pacman', install: ['sudo', '-n', 'pacman', '-S', '--noconfirm', 'git', 'subversion'], manual: `sudo pacman -S --noconfirm ${arg}` };
    default:
      return { name: id || '未知发行版', manager: 'apt', install: ['sudo', '-n', 'apt-get', 'install', '-y', 'git', 'subversion'], manual: `sudo apt-get install -y ${arg}` };
  }
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

export const linux: Platform = {
  isWindows: false,
  chooseOpenCmd: null,

  listOpenWithApps(ext, mimes) {
    if (!mimes.size) return [];
    return scanDesktopApps()
      .filter((a) => [...mimes].some((m) => a.mimes.has(m)))
      .map((a) => ({ name: a.name, exec: a.exec, icon: a.icon }));
  },

  openDefault(abs, rel) {
    return launchDetached(['xdg-open', abs], `已用系统默认程序打开: ${rel}`);
  },

  async openWithApp(abs, exec, rel) {
    if (!exec) return this.openDefault(abs, rel);
    try {
      const cmd = parseAppCommand(exec, abs);
      if (!cmd.length) throw new Error('Exec 为空');
      return await launchDetached(cmd, `已用 ${cmd[0]} 打开: ${rel}`);
    } catch (e) {
      return { ok: false, message: (e as Error).message };
    }
  },

  resolveAppIcon(key) {
    return findLinuxIcon(key);
  },

  async revealPath(abs) {
    // 目录直接打开本身；文件才打开所在文件夹（否则右键目录会定位到上一级）
    const target = fs.statSync(abs).isDirectory() ? abs : path.dirname(abs);
    await run('xdg-open', [target], { timeoutMs: 10_000 });
  },

  openUrl(url) {
    const p = spawn('xdg-open', [url], { stdio: 'ignore', detached: true });
    p.on('error', (e) => console.error(`[svnkit] 打开浏览器失败(xdg-open): ${e.message}`));
    p.unref();
  },

  async envInstall(tool: InstallTool, send, done) {
    const pkgs = tool === 'svn' ? ['subversion'] : tool === 'git' ? ['git'] : ['git', 'subversion'];
    /** 发行版包管理器探测（/etc/os-release）：不同发行版 svn/git 包名与安装命令不同 */
    const distro = detectDistro();
    const install = distro.install; // ['sudo','-n',<manager>,...]
    const manual = distro.manual; // 手动命令全文
    const sudoOk = await run('sudo', ['-n', 'true'], { timeoutMs: 10_000 });
    send({ line: `检测 root 权限… ${sudoOk.code === 0 ? '✓ 可用' : '✗ 需要密码（请用下方手动命令）'}` });
    send({ line: `发行版: ${distro.name}（${distro.manager}）` });
    if (sudoOk.code !== 0) {
      send({ done: true, code: 1, manual });
      done();
      return;
    }
    send({ line: `开始安装: ${pkgs.join(' ')}…` });
    const child = spawn(install[0]!, install.slice(1), { stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', (d: Buffer) => send({ line: d.toString() }));
    child.stderr.on('data', (d: Buffer) => send({ line: d.toString() }));
    child.on('error', (e) => {
      send({ line: `启动失败: ${e.message}` });
      send({ done: true, code: 1, manual: `sudo apt-get install -y ${pkgs.join(' ')}` });
      done();
    });
    child.on('close', (code) => {
      send({ line: code === 0 ? '✅ 安装完成' : `❌ 安装失败（退出码 ${code}）` });
      send({ done: true, code: code ?? 1 });
      done();
    });
  },
};
