/** Windows 平台实现：注册表枚举打开方式、提取 .exe 图标、Start-Process/rundll32 启动、winget 安装引导 */

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { run } from '../vcs/exec.js';
import { t } from '../shared/i18n/index.js';
import { parseAppCommand, launchDetached, shq } from './util.js';
import type { InstallTool, LaunchResult, OpenWithApp, Platform } from './types.js';

/** reg query 键下所有命名值(解析 REG_ 类型行,值可能含空格保留余下全部) */
/** reg.exe 输出用系统码页（中文系统=GBK/936），直接按 UTF-8 解会把中文程序名/路径变成乱码。
 *  用 chcp 探测系统码页，再用对应 TextDecoder 正确解码（按码页缓存）。 */
let winRegDecoder: TextDecoder | null = null;
function winRegText(): TextDecoder {
  if (winRegDecoder) return winRegDecoder;
  let label = 'utf-8';
  try {
    const r = spawnSync('chcp', [], { encoding: 'utf8', windowsHide: true });
    const num = r.stdout?.match(/(\d{3,5})/)?.[1];
    if (num && num !== '65001') {
      const map: Record<string, string> = {
        '936': 'gb18030', '932': 'shift_jis', '949': 'euc-kr', '950': 'big5',
        '1250': 'windows-1250', '1251': 'windows-1251', '1252': 'windows-1252',
        '1253': 'windows-1253', '1254': 'windows-1254', '1255': 'windows-1255',
        '1256': 'windows-1256', '1257': 'windows-1257', '1258': 'windows-1258',
      };
      label = map[num] ?? num; // 未知码页直接交给 TextDecoder 尝试，不行再回退 utf-8
    }
  } catch {
    /* chcp 失败保持 utf-8 */
  }
  try {
    winRegDecoder = new TextDecoder(label);
  } catch {
    winRegDecoder = new TextDecoder('utf-8');
  }
  return winRegDecoder;
}

/** 将 reg 输出还原为正确字符串：先拿原始字节，再按系统码页解码 */
function regToString(buf: Buffer): string {
  return winRegText().decode(buf);
}

/** reg 对「空值」输出的占位文案（随系统语言本地化）：英文 (value not set)、中文 (数值未设置) 等。
 *  这些不是真实命令，必须过滤掉，否则会被当成程序名显示成第一项。 */
const REG_NOT_SET = /^\s*\(\s*(?:value\s+not\s+set|not\s+set|数值未设置|值未设置|未设置|未定义|未設定|設定されていません|설정되지 않음|valeur non définie|nicht festgelegt|non definito|no establecido|не задано)\s*\)\s*$/i; // i18n-ignore: 解析 reg.exe 在各国语言系统下输出的「空值」占位文案（不是界面文案；翻了会认不出占位、把空值当程序名）
function isRegPlaceholder(v: string): boolean {
  return v.trim() === '' || REG_NOT_SET.test(v);
}

function regQuery(key: string): Record<string, string> {
  try {
    const r = spawnSync('reg', ['query', key], { encoding: 'buffer', windowsHide: true });
    if (r.status !== 0) return {};
    const out: Record<string, string> = {};
    for (const line of regToString(r.stdout ?? Buffer.alloc(0)).split(/\r?\n/)) {
      const t = line.trim();
      const m = t.match(/^(\S+)\s+REG_[A-Z_]+\s+(.*)$/);
      if (m?.[1] && m[1] !== '') out[m[1]!] = m[2] ?? '';
    }
    return out;
  } catch {
    return {};
  }
}

/** reg query 键的默认值(如 shell\open\command 注册的启动命令) */
function regDefault(key: string): string {
  try {
    const r = spawnSync('reg', ['query', key, '/ve'], { encoding: 'buffer', windowsHide: true });
    if (r.status !== 0) return '';
    const line = regToString(r.stdout ?? Buffer.alloc(0)).split(/\r?\n/).find((l) => /REG_[A-Z_]+\b/.test(l));
    return line?.trim().match(/^\S+\s+REG_[A-Z_]+\s+(.*)$/)?.[1] ?? '';
  } catch {
    return '';
  }
}

/** 按扩展名枚举系统已关联程序(UserChoice + 最近使用 + OpenWithProgids),exec 保留 %1 占位 */
function scanWindowsApps(ext: string): OpenWithApp[] {
  const out: OpenWithApp[] = [];
  const seen = new Set<string>();
  const add = (command: string) => {
    // 展开 %SystemRoot%/%windir% 等核心环境变量(记事本等注册命令常用),其余环境变量命令无法 spawn,跳过
    command = command.replace(/%SystemRoot%|%windir%/gi, (m) => (m.toLowerCase() === '%windir%' ? process.env.windir ?? '' : process.env.SystemRoot ?? ''));
    if (isRegPlaceholder(command)) return; // 空值占位(如 (数值未设置))不是真实命令
    if (!command || /%(?!1)/.test(command)) return;
    if (seen.has(command)) return;
    seen.add(command);
    const exe = /^"([^"]+)"/.exec(command)?.[1] ?? /^(\S+)/.exec(command)?.[1] ?? '';
    const nm = exe.replace(/\\/g, '/').split('/').pop()?.replace(/\.(exe|com|bat|cmd)$/i, '') ?? exe;
    // icon 存 exe 绝对路径：前端 /api/icon 按 Windows exe 提取嵌入图标（缺失时回退通用文件图标）
    out.push({ name: nm, exec: command, icon: exe });
  };
  const base = `HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FileExts\\.${ext}`;
  // 1) 用户选定的默认程序 (UserChoice)
  const progId = regQuery(`${base}\\UserChoice`).ProgId;
  if (progId && !progId.startsWith('{')) add(regDefault(`HKCR\\${progId}\\shell\\open\\command`));
  // 2) 最近使用列表 (OpenWithList MRU1..N, 值为程序名如 Acrobat.exe)
  for (const [, exeName] of Object.entries(regQuery(`${base}\\OpenWithList`)).sort(([a], [b]) => a.localeCompare(b))) {
    if (!/\.(exe|com|bat|cmd)$/i.test(exeName)) continue;
    // 部分程序注册在 Applications\<名> 或 HKCR\<名去扩展名>(如 msedge.exe → HKCR\msedge),逐级回退
    add(
      regDefault(`HKCR\\Applications\\${exeName}\\shell\\open\\command`) ||
        regDefault(`HKCR\\${exeName.replace(/\.exe$/i, '')}\\shell\\open\\command`)
    );
  }
  // 3) 该扩展注册的全部 ProgId
  for (const pid of Object.keys(regQuery(`HKCR\\.${ext}\\OpenWithProgids`))) {
    add(regDefault(`HKCR\\${pid}\\shell\\open\\command`));
  }
  // 4) 扩展名默认关联 (HKCR\.pdf 的默认值→ProgId)
  const defPid = regDefault(`HKCR\\.${ext}`);
  if (defPid && !defPid.startsWith('{')) add(regDefault(`HKCR\\${defPid}\\shell\\open\\command`));
  // 兜底:通用记事本(注册优先,再试系统路径)——任何文本类文件都保证可选,避免列表空空
  if (!out.some((a) => /notepad/i.test(a.exec))) {
    const noteCmd =
      regDefault(`HKCR\\Applications\\notepad.exe\\shell\\open\\command`) ||
      regDefault(`HKCR\\notepad\\shell\\open\\command`);
    if (noteCmd) add(noteCmd);
    else {
      const np = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'system32', 'notepad.exe');
      if (fs.existsSync(np)) add(`"${np}" "%1"`);
    }
  }
  return out;
}

/** 用 System.Drawing 从 .exe/.ico 提取关联图标为 PNG（按 exe 缓存；失败返回 null） */
const winIconCache = new Map<string, Buffer>();
function extractWinIcon(exe: string): Buffer | null {
  const hit = winIconCache.get(exe);
  if (hit) return hit;
  const tmp = path.join(os.tmpdir(), `svngit-icon-${Date.now()}-${Math.random().toString(36).slice(2)}.png`);
  const exeQ = exe.replace(/'/g, "''");
  const tmpQ = tmp.replace(/'/g, "''");
  const script = `Add-Type -AssemblyName System.Drawing; $i=[System.Drawing.Icon]::ExtractAssociatedIcon('${exeQ}'); if($i){$b=$i.ToBitmap(); $b.Save('${tmpQ}',[System.Drawing.Imaging.ImageFormat]::Png); exit 0} exit 1`;
  try {
    const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', windowsHide: true, timeout: 8000 });
    if (r.status === 0 && fs.existsSync(tmp)) {
      const buf = fs.readFileSync(tmp);
      winIconCache.set(exe, buf);
      return buf;
    }
  } catch {
    /* 提取失败回退通用图标 */
  } finally {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* 忽略临时文件清理失败 */
    }
  }
  return null;
}

/** 「终端运行」支持的脚本扩展名（判定在平台侧：Windows 三种都能跑，Linux 只有 .sh 有执行途径） */
const SCRIPT_EXTS = new Set(['.bat', '.cmd', '.sh']);

/** 路径 → 正斜杠形式：传给 bash 的路径必须换掉反斜杠，否则会被 bash 当转义符吃掉
 *  （`C:\Users\...` → `C:Users...`，与 git.ts 给 git 传编辑器路径同一教训——实报过） */
const fwdSlash = (p: string): string => p.replace(/\\/g, '/');

/** PowerShell 单引号字面量：内部 ' 翻倍（与下面 extractWinIcon 的转义同一套写法） */
const psq = (s: string): string => `'${s.replace(/'/g, "''")}'`;

/** WSL 的 bash.exe 占位启动器（System32/SysWOW64 下）：只负责转进 WSL 发行版，
 *  认不了 `D:/...` 这种 Windows 路径。装了 WSL 的机器 where 会先命中它（System32 在 PATH 前列），
 *  拿它跑 .sh 是假成功（接口报 ok、脚本没跑），按「只支持 Git Bash」的取舍过滤掉 */
const isWslStub = (p: string): boolean => /[\\/]windows[\\/](system32|syswow64)[\\/]bash\.exe$/i.test(p);

/** 找 .sh 用的 POSIX shell：① PATH 上的 bash.exe（where 探测）② Git for Windows 常见安装路径。
 *  不探测 WSL：发行版未必装，探测出来跑不了反而更糟（v1 只支持 Git Bash，未找到给明确提示）。
 *  where 输出按系统码页解码（复用 regToString）：中文用户名路径直接按 UTF-8 解会乱码。 */
function findBash(): string | null {
  try {
    const r = spawnSync('where', ['bash.exe'], { encoding: 'buffer', windowsHide: true });
    if (r.status === 0) {
      const p = regToString(r.stdout ?? Buffer.alloc(0))
        .split(/\r?\n/)
        .map((s) => s.trim())
        .find((s) => s !== '' && !isWslStub(s) && fs.existsSync(s));
      if (p) return p;
    }
  } catch {
    /* where 不可用：落到常见安装路径 */
  }
  const cands = [
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Git', 'bin', 'bash.exe'),
    process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'Git', 'bin', 'bash.exe'),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs', 'Git', 'bin', 'bash.exe'),
  ];
  return cands.find((c): c is string => !!c && fs.existsSync(c)) ?? null;
}

/** 经 PowerShell Start-Process 起一个**新窗口**的控制台进程（runScript 专用）：
 *  Start-Process 对控制台程序默认另开新控制台窗口（Win11 默认终端设为 Windows Terminal 时自动落在 WT）；
 *  参数用单引号字面量传递，路径含空格/中文都按整体走，不经过 cmd 的引号解析。
 *  windowsHide 只隐藏中转的 powershell 自身，避免闪一下黑框（目标窗口不受影响）；
 *  detach:false 是必须的——detached 下 powershell 的 -Command 根本不执行（见 launchDetached 注释），
 *  曾因此整条链「假成功」：接口报已在终端运行，实际没跑。 */
function winStartProcess(exe: string, args: string[], cwd: string, okMsg: string): Promise<LaunchResult> {
  const argList = args.length ? ` -ArgumentList ${args.map(psq).join(',')}` : '';
  const script = `Start-Process -FilePath ${psq(exe)}${argList} -WorkingDirectory ${psq(cwd)}`;
  return launchDetached(['powershell.exe', '-NoProfile', '-NonInteractive', '-Command', script], okMsg, { windowsHide: true, detach: false });
}

export const win32: Platform = {
  isWindows: true,
  // PATH 兜底：环境引导自动装完（或用户手动装完）时，系统 PATH 不会刷新到本进程，
  // 直接按常见安装路径找 svn.exe —— SlikSVN（引导安装的）与 TortoiseSVN（需勾命令行组件）
  svnFallbacks: [
    'C:\\Program Files\\SlikSvn\\bin\\svn.exe',
    'C:\\Program Files\\TortoiseSVN\\bin\\svn.exe',
  ],
  chooseOpenCmd: '__CHOOSE__',

  listOpenWithApps(ext, mimes) {
    return mimes.size ? scanWindowsApps(ext) : [];
  },

  openDefault(abs, rel) {
    // 系统默认程序：Start-Process 即 ShellExecute，路径含空格也正确。
    // detach:false + windowsHide：同 winStartProcess——detached 下这条命令不会执行（曾长期静默失效，
    // 「用默认程序打开」报成功却什么都不发生）；不隐藏则会闪一下中转 powershell 的黑框
    return launchDetached(
      ['powershell.exe', '-NoProfile', '-NonInteractive', '-Command', `Start-Process -FilePath ${psq(abs)}`],
      // 已用系统默认程序打开: {rel}
      t('plat.openedDefault', { rel }),
      { windowsHide: true, detach: false }
    );
  },

  async openWithApp(abs, exec, rel) {
    if (exec === '__CHOOSE__') {
      // 系统「打开方式」选择器：rundll32 shell32,OpenAs_RunDLL <文件>（路径含空格也能正确弹窗）
      // 已打开系统「打开方式」选择器: {rel}
      return launchDetached(['rundll32.exe', 'shell32.dll,OpenAs_RunDLL', abs], t('plat.openedChooser', { rel }));
    }
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
    const ext = path.extname(abs).toLowerCase();
    // 不支持的文件类型（仅 .bat / .cmd / .sh）；前端只对这三种显示菜单项，这里是服务端兜底
    if (!SCRIPT_EXTS.has(ext)) return { ok: false, message: t('plat.notScript') };
    const dir = path.dirname(abs);
    // 已在系统终端中运行: {rel}
    const okMsg = t('plat.ranScript', { rel });
    if (ext === '.sh') {
      const bash = findBash();
      // 未找到 bash（Windows 上运行 .sh 需安装 Git for Windows）
      if (!bash) return { ok: false, message: t('plat.noBash') };
      // `-l` 登录 shell（带上 PATH/profile）；`; exec bash` 让脚本跑完窗口留着——输出看得见，
      // 与 .bat 侧 cmd /k 的行为对齐（用 `;` 不用 `&&`：脚本报错退出时窗口同样保留）
      const cmd = `cd ${shq(fwdSlash(dir))} && bash ${shq(fwdSlash(abs))}; exec bash`;
      return winStartProcess(bash, ['-lc', `"${cmd}"`], dir, okMsg);
    }
    // .bat/.cmd：cmd /k —— 新控制台窗口里跑，跑完不关窗（输出看得见）
    return winStartProcess('cmd.exe', ['/k', `"${abs}"`], dir, okMsg);
  },

  resolveAppIcon(key) {
    const exe = key.replace(/"/g, '');
    if (/\.(exe|ico)$/i.test(exe) && /^[a-zA-Z]:[\\/]/.test(exe)) {
      const buf = extractWinIcon(exe);
      return buf ? { data: buf, contentType: 'image/png' } : null;
    }
    return null;
  },

  async revealPath(abs) {
    // 目录 → 直接打开它本身；文件 → /select 在其所在文件夹里选中。
    // 对目录也用 /select 是错的：Explorer 会**在上一层打开**并把它选中——用户实报
    // 「在仓库根空白处右键『打开文件管理器』，开出来的是 D:\ 而不是 D:\svn-git」。
    // （explorer 成功也返回 1，调用方本就不看返回码，这里同样不检查）
    try {
      if (fs.statSync(abs).isDirectory()) {
        await run('explorer', [abs], { timeoutMs: 10_000 });
        return;
      }
    } catch {
      /* stat 失败（刚被删等）：按文件走 /select，保持原行为 */
    }
    // 在资源管理器中定位文件
    await run('explorer', ['/select,', abs], { timeoutMs: 10_000 });
  },

  openUrl(url) {
    // windowsHide：后台常驻模式没有控制台，不隐藏就会先闪一个黑窗再开浏览器
    const p = spawn('cmd', ['/c', 'start', '', url], { stdio: 'ignore', detached: true, windowsHide: true });
    // [svngit] 打开浏览器失败({cmd}): {msg}
    p.on('error', (e) => console.error(t('plat.openUrlFail', { cmd: 'cmd', msg: e.message })));
    p.unref();
  },

  listFontFamilies() {
    // 注册表 Fonts 键的值名即字体名（去掉 " (TrueType)" 等括号后缀），与 CSS font-family 对应
    try {
      const r = spawnSync('reg', ['query', 'HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts'], { encoding: 'buffer', windowsHide: true });
      const text = winRegText().decode(r.stdout ?? Buffer.alloc(0));
      const set = new Set<string>();
      for (const line of text.split('\n')) {
        const m = line.match(/^\s{4}(.+?)\s+REG_[A-Z_]+\s+.+$/);
        if (!m) continue;
        const name = m[1]!.replace(/\s*\(.*\)$/, '').trim();
        if (name) set.add(name);
      }
      return [...set];
    } catch {
      return [];
    }
  },

  installAppMenu() {
    // Windows 用安装包（NSIS）的快捷方式，无桌面文件安装概念
    // Windows 请使用安装包（NSIS 自动创建开始菜单/桌面快捷方式）
    return { ok: false, message: t('plat.winInstallHint') };
  },
  uninstallAppMenu() {
    // Windows 请使用安装包的卸载程序
    return { ok: false, message: t('plat.winUninstallHint') };
  },

  async trashPath(abs) {
    // PowerShell 走 VisualBasic.FileIO 的回收站 API（SendToRecycleBin，可从回收站恢复）。
    // 路径里的单引号按 PS 规则双写转义；文件/目录分用 DeleteFile / DeleteDirectory
    const isDir = fs.statSync(abs).isDirectory();
    const quoted = `'${abs.replace(/'/g, "''")}'`;
    const expr = `[Microsoft.VisualBasic.FileIO.FileSystem]::Delete${isDir ? 'Directory' : 'File'}(${quoted}, 'OnlyErrorDialogs', 'SendToRecycleBin')`;
    const r = await run('powershell', ['-NoProfile', '-NonInteractive', '-Command', `Add-Type -AssemblyName Microsoft.VisualBasic; ${expr}`], { timeoutMs: 60_000 });
    if (r.code !== 0) {
      // 移到回收站失败: {msg}
      throw new Error(t('plat.trashFailed', { msg: r.stderr.trim() || `exit ${r.code}` }));
    }
  },

  async envInstall(tool: InstallTool, send, done) {
    // SVN 引导装 SlikSVN（纯命令行版——本工具即图形界面，不需要再来个 GUI）。
    // 别换回 TortoiseSVN 包：它的 winget 默认清单只装 GUI，装完反而没有 svn.exe 命令行。
    const svnArgs = ['install', '--id=Slik.Subversion', '-e', '--accept-source-agreements', '--accept-package-agreements'];
    const gitArgs = ['install', '--id=Git.Git', '-e', '--accept-source-agreements', '--accept-package-agreements'];
    const targets =
      tool === 'svn'
        ? [{ name: 'SlikSVN', args: svnArgs }]
        : tool === 'git'
          ? [{ name: 'Git for Windows', args: gitArgs }]
          : [
              { name: 'SlikSVN', args: svnArgs },
              { name: 'Git for Windows', args: gitArgs },
            ];
    const manual = targets.map((x) => `winget ${x.args.join(' ')}`).join(' && ');
    // winget 探测（老系统 / 未装「应用安装程序」）：不可用 → 回退手动命令引导
    const ok = await run('winget', ['--version'], { timeoutMs: 10_000 }).then(
      (r) => r.code === 0,
      () => false,
    );
    if (!ok) {
      // Windows 环境：请在终端以管理员身份执行以下命令安装：
      send({ line: t('plat.winEnvHint') });
      for (const x of targets) send({ line: `  winget ${x.args.join(' ')}` });
      send({ done: true, code: 1, manual });
      done();
      return;
    }
    // （安装过程可能弹出 UAC 授权窗口，请点「是」允许）
    send({ line: t('plat.winUacHint') });
    // winget 一次装一个包：串行执行，输出实时流回弹窗日志（与 Linux 侧同一套流程）
    let i = 0;
    const step = () => {
      const cur = targets[i++];
      if (!cur) {
        send({ done: true, code: 0 });
        done();
        return;
      }
      // 开始安装: {pkgs}…
      send({ line: t('plat.installStart', { pkgs: cur.name }) });
      // windowsHide：同上（输出已由管道接进来打给用户，窗口只会挡路）
      const child = spawn('winget', cur.args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
      child.stdout.on('data', (d: Buffer) => send({ line: d.toString() }));
      child.stderr.on('data', (d: Buffer) => send({ line: d.toString() }));
      child.on('error', (e) => {
        // 启动失败: {msg}
        send({ line: t('plat.launchFail', { msg: e.message }) });
        send({ done: true, code: 1, manual });
        done();
      });
      child.on('close', (code) => {
        if (code === 0) {
          // ✅ 安装完成
          send({ line: t('plat.installDone') });
          step();
        } else {
          // ❌ 安装失败（退出码 {code}）
          send({ line: t('plat.installFailed', { code: String(code) }) });
          send({ done: true, code: code ?? 1, manual });
          done();
        }
      });
    };
    step();
  },

  async portOwnerPids(port: number): Promise<number[]> {
    // netstat -ano 末尾一列是 PID；**只认 LISTENING 行**——同一端口还可能挂着一堆 TIME_WAIT
    // 的残留连接（那些是别人的客户端，杀不得）
    const r = await run('netstat', ['-ano', '-p', 'TCP'], { timeoutMs: 8000 });
    if (r.code !== 0) return [];
    const pids = new Set<number>();
    for (const line of r.stdout.split('\n')) {
      const m = /:(\d+)\s+\S+\s+LISTENING\s+(\d+)\s*$/.exec(line.trim());
      if (m && Number(m[1]) === port) pids.add(Number(m[2]));
    }
    return [...pids];
  },

  async killProcesses(pids: number[]): Promise<void> {
    for (const pid of pids) {
      // /T 连子进程一起（服务本身是主进程，但包装器 / 常驻方式下它有子进程）
      await run('taskkill', ['/PID', String(pid), '/T', '/F'], { timeoutMs: 10_000 });
    }
  },
};
