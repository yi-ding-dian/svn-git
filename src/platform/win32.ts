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

/** 本进程是否拥有自己的应用窗口（Electron 打包版默认方式为真；浏览器方式与 `-d` 常驻为假）。
 *  **只影响 revealPath 走哪条路**：Windows 只把"窗口能不能到前台"的资格给**前台进程**启动的
 *  窗口——有自己窗口的宿主（用户就点在那个窗口上，进程自己即前台进程）直接 spawn explorer
 *  即可；没有窗口的宿主（服务只是个后台进程）必须借 shell 开、并确认窗口到了前台。
 *  Linux 没有这条限制（xdg-open 交给桌面环境），所以平台入口那边转发过来是个空操作。 */
let ownsAppWindow = false;
export function setOwnsAppWindow(value: boolean): void {
  ownsAppWindow = value;
}

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
  // 必须等 powershell 真正退出并用退出码判定：launchDetached 在 spawn 事件就返回 ok，
  // Start-Process 失败（Store 版 wt.exe 别名被策略禁用、路径不存在等）会变成"假成功"，
  // 调用方的回退分支（如终端回退 cmd）永远走不到。
  const script =
    `$ErrorActionPreference='Stop'; try { Start-Process -FilePath ${psq(exe)}${argList} -WorkingDirectory ${psq(cwd)} -ErrorAction Stop; exit 0 } ` +
    `catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }`;
  return new Promise((resolve) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      stdio: ['ignore', 'ignore', 'pipe'],
      windowsHide: true,
    });
    let stderr = Buffer.alloc(0);
    child.stderr.on('data', (d: Buffer) => {
      if (stderr.length < 4096) stderr = Buffer.concat([stderr, d]);
    });
    child.once('error', (e) => resolve({ ok: false, message: t('plat.launchFail', { msg: e.message }) }));
    child.once('close', (code) => {
      if (code === 0) {
        resolve({ ok: true, message: okMsg });
        return;
      }
      // powershell 的报错是系统码页（中文系统 GBK），按注册表同一套解码
      const msg = regToString(stderr).trim() || `exit ${code}`;
      resolve({ ok: false, message: t('plat.launchFail', { msg }) });
    });
  });
}

/** WindowsApps 下的执行别名（wt.exe 等）是特殊 reparse point：fs.existsSync 会跟丢目标返回 false，
 *  但 accessSync 正常。判定存在必须用它，否则会把「已装 Windows Terminal」误判成没装。 */
const pathAccessible = (p: string): boolean => {
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
};

/** 找 Windows Terminal（Store 版的 wt.exe 是 WindowsApps 下的执行别名）。
 *  where 的输出按系统码页解码：中文用户名路径直接按 UTF-8 解会乱码（同 findBash）。
 *  找不到返回 null，由调用方回退到经典 cmd 窗口。 */
function findWindowsTerminal(): string | null {
  try {
    const r = spawnSync('where', ['wt.exe'], { encoding: 'buffer', windowsHide: true });
    if (r.status === 0) {
      const p = regToString(r.stdout ?? Buffer.alloc(0))
        .split(/\r?\n/)
        .map((s) => s.trim())
        .find((s) => s !== '' && pathAccessible(s));
      if (p) return p;
    }
  } catch {
    /* where 不可用：落到常见安装路径 */
  }
  const alias = process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Microsoft', 'WindowsApps', 'wt.exe');
  return alias && pathAccessible(alias) ? alias : null;
}

/** 打开资源管理器窗口用的 Win32 声明（revealScript 里 Add-Type 现编译；几百毫秒，
 *  右键菜单的一次性动作，可接受） */
const REVEAL_CS =
  'using System;using System.Runtime.InteropServices;using System.Text;public class Rv{' +
  'public delegate bool EnumProc(IntPtr h,IntPtr l);' +
  '[DllImport("user32.dll")]public static extern bool EnumWindows(EnumProc cb,IntPtr l);' +
  '[DllImport("user32.dll")]public static extern int GetClassName(IntPtr h,StringBuilder s,int n);' +
  '[DllImport("user32.dll")]public static extern IntPtr GetForegroundWindow();' +
  '[DllImport("user32.dll")]public static extern bool SetForegroundWindow(IntPtr h);' +
  '[DllImport("user32.dll")]public static extern bool ShowWindow(IntPtr h,int cmd);' +
  '[DllImport("user32.dll")]public static extern bool FlashWindowEx(ref FLASHWINFO f);' +
  '[DllImport("shell32.dll",CharSet=CharSet.Unicode)]public static extern int SHParseDisplayName(string p,IntPtr b,out IntPtr i,uint a,out uint o);' +
  '[DllImport("shell32.dll")]public static extern int SHOpenFolderAndSelectItems(IntPtr f,uint c,IntPtr[] a,uint g);' +
  '[DllImport("ole32.dll")]public static extern void CoTaskMemFree(IntPtr p);' +
  '[StructLayout(LayoutKind.Sequential)]public struct FLASHWINFO{public uint cbSize;public IntPtr hwnd;public uint dwFlags;public uint uCount;public uint dwTimeout;}}';

/** 「打开文件管理器」的整套动作，全部在**一个** PowerShell 进程里做完：
 *  ① （文件才做）SHOpenFolderAndSelectItems：让 shell 打开父目录并选中该文件；
 *  ② Start-Process 打开/激活目标目录 —— ShellExecute 由资源管理器自己开窗，比我们自己
 *     spawn explorer 强得多（后者在后台常驻服务里根本到不了前台，见 revealPath 注释）；
 *  ③ **确认它真的到了前台**：Windows 的前台锁会在"用户刚操作过别的窗口"时拒绝后台进程
 *     激活（实测同一段代码，用户在电脑前就失败、离开一会儿就成功）。所以先 SetForegroundWindow
 *     试一次；仍不是前台就走「最小化 → 还原 → SetForegroundWindow」——实测这一招在前台锁
 *     生效时依然有效；还不行就闪任务栏按钮（Windows 官方的"看这边"手段）。
 *  只找**新出现的**资源管理器窗口（开窗前的句柄快照做差集）：按标题匹配会误伤用户自己
 *  开着的同目录窗口——实报现场就同时开着 3 个 svn-git 窗口。 */
function revealScript(abs: string, select: boolean): string {
  const folder = select ? path.dirname(abs) : abs;
  const selectPart = select
    ? `$pidl = [IntPtr]::Zero; $attrs = 0; if ([Rv]::SHParseDisplayName(${psq(abs)}, [IntPtr]::Zero, [ref]$pidl, 0, [ref]$attrs) -eq 0) { [Rv]::SHOpenFolderAndSelectItems($pidl, 0, $null, 0) | Out-Null; [Rv]::CoTaskMemFree($pidl) }; `
    : '';
  return (
    `Add-Type -TypeDefinition ${psq(REVEAL_CS)}; ` +
    // ① 开窗前的资源管理器窗口快照（key = 句柄）
    '$seen = @{}; [Rv]::EnumWindows([Rv+EnumProc]{ param($h, $l) $sb = New-Object System.Text.StringBuilder 256; [Rv]::GetClassName($h, $sb, 256) | Out-Null; if ($sb.ToString() -eq "CabinetWClass") { $seen[[int64]$h] = 1 }; return $true }, [IntPtr]::Zero) | Out-Null; ' +
    selectPart +
    // ② 让 shell 打开/激活目录
    `Start-Process -FilePath ${psq(folder)}; ` +
    // ③ 等新窗口出现（最多 6 秒）
    '$win = [IntPtr]::Zero; for ($i = 0; $i -lt 24 -and $win -eq [IntPtr]::Zero; $i++) { Start-Sleep -Milliseconds 250; [Rv]::EnumWindows([Rv+EnumProc]{ param($h, $l) $sb = New-Object System.Text.StringBuilder 256; [Rv]::GetClassName($h, $sb, 256) | Out-Null; if ($sb.ToString() -eq "CabinetWClass" -and -not $seen[[int64]$h]) { $script:win = $h }; return $true }, [IntPtr]::Zero) | Out-Null }; ' +
    // ④ 抢前台：先常规，失败再"最小化→还原"，最后闪任务栏
    'if ($win -ne [IntPtr]::Zero -and [Rv]::GetForegroundWindow() -ne $win) { [Rv]::SetForegroundWindow($win) | Out-Null; Start-Sleep -Milliseconds 200; ' +
    'if ([Rv]::GetForegroundWindow() -ne $win) { [Rv]::ShowWindow($win, 6) | Out-Null; Start-Sleep -Milliseconds 150; [Rv]::ShowWindow($win, 9) | Out-Null; [Rv]::SetForegroundWindow($win) | Out-Null; Start-Sleep -Milliseconds 200 }; ' +
    'if ([Rv]::GetForegroundWindow() -ne $win) { $fi = New-Object Rv+FLASHWINFO; $fi.cbSize = [System.Runtime.InteropServices.Marshal]::SizeOf($fi); $fi.hwnd = $win; $fi.dwFlags = 3; $fi.uCount = 3; [Rv]::FlashWindowEx([ref]$fi) | Out-Null } }'
  );
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
    // 走 winStartProcess 而不是 launchDetached：后者在 spawn 事件就报成功，Start-Process
    // 真失败（关联程序被删/策略拦截）时用户仍会看到"已打开"，且拿不到失败原因。
    return winStartProcess(abs, [], path.dirname(abs), t('plat.openedDefault', { rel }));
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
    // 目录 → 打开它本身；文件 → 打开所在文件夹并选中它。
    // 对目录也用 /select 是错的：Explorer 会**在上一层打开**并把它选中——用户实报
    // 「在仓库根空白处右键『打开文件管理器』，开出来的是 D:\ 而不是 D:\svn-git」。
    //
    // **不能自己 spawn explorer**（原来就是）：常驻服务是无控制台的后台进程，Windows 不给它
    // 开的窗口前台资格，窗口只能停在其他窗口后面（实测 visible=true 但 isForeground=false；
    // 用户实报"开是开了，得点一下任务栏才看得见"）。改成让 shell 开 + 打开后确认前台，
    // 细节见 revealScript。detach:false + windowsHide 的理由同 openDefault。
    let isDir = false;
    try {
      isDir = fs.statSync(abs).isDirectory();
    } catch {
      /* stat 失败（刚被删等）：按文件走「定位」，保持原行为 */
    }

    // 自己有窗口的运行方式（Electron 内嵌窗口版）：用户就点在这个窗口上，本进程即前台进程，
    // 它起的窗口本来就有前台资格 —— 直接 spawn 最快（省掉 powershell 中转那几百毫秒），
    // 也就是这条路径一直以来的做法。**windowsHide 必须显式写 false**：显式写出来是为了
    // 挡住"顺手改用 run()"——run() 默认 windowsHide:true，SW_HIDE 落到 explorer 头上
    // 就是把窗口建成不可见的那个坑（e3017dc 那次回归）。
    if (ownsAppWindow) {
      spawn('explorer', isDir ? [abs] : ['/select,', abs], { stdio: 'ignore', windowsHide: false, detached: true }).unref();
      return;
    }

    await launchDetached(['powershell.exe', '-NoProfile', '-NonInteractive', '-Command', revealScript(abs, !isDir)], '', { windowsHide: true, detach: false });
  },

  async openTerminal(abs) {
    // 已打开终端
    const okMsg = t('plat.terminalOpened');
    const wt = findWindowsTerminal();
    if (wt) {
      // 传绝对路径并自己加双引号：Start-Process 的 -ArgumentList 只做空格拼接、不做引号处理，
      // 含空格的路径必须带着引号进去（打包版 wt 是否继承 WorkingDirectory 不可靠，别依赖 `.`）
      const r = await winStartProcess(wt, ['-d', `"${abs}"`], abs, okMsg);
      if (r.ok) return r;
      // Windows Terminal 启动失败（alias 被禁用等）：继续回退 cmd，别让菜单项点了没反应
    }
    // 未装 Windows Terminal：经典 cmd 窗口；工作目录由 Start-Process 指定
    return winStartProcess('cmd.exe', [], abs, okMsg);
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
