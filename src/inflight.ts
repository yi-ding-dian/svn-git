/** 进行中的远程获取登记 —— 防孤儿进程与半截目录。
 *
 *  **为什么需要**：app 被强杀（关掉跑它的终端窗口、任务管理器结束、崩溃）时，Node 不会连带
 *  杀掉它 spawn 的 git / svn：子进程活下来继续往目标目录写，那个目录就被占住删不掉
 *  （用户实报：D:\gitProjects\Ai-desktop-pet 里只剩一个 .git，删了半天删不掉——托管它的进程
 *  已经不在，没人等它、也没人收尾）。这里把"正在获取到哪个目标"落盘，下次启动据此收尾。
 *
 *  两条防线配合：
 *  - 正常退出：vcs/exec 的 killAllChildren（main 里挂在 exit/SIGINT 上）
 *  - 异常退出：本文件的 recoverInflight（下次启动时先杀残留进程、再删只含 .git/.svn 的残骸）
 *
 *  ⚠ 只认**登记过的目标路径**：命令行里必须含它，且只删"目录里只剩 .git / .svn 或为空"的残骸——
 *  多出任何文件都可能是用户自己的东西，一个字节都不碰（与 repo-create 的残骸清理同一原则）。 */
import fs from 'node:fs';
import path from 'node:path';
import { execFile, execFileSync } from 'node:child_process';
import { CONFIG_DIR } from './config.js';
import { t } from './shared/i18n/index.js';

const INFLIGHT_PATH = path.join(CONFIG_DIR, 'inflight.json');

interface InflightEntry {
  /** 获取目标目录（克隆/检出的落点） */
  target: string;
  at: number;
}

function read(): InflightEntry[] {
  try {
    const list = JSON.parse(fs.readFileSync(INFLIGHT_PATH, 'utf8'));
    return Array.isArray(list) ? (list as InflightEntry[]) : [];
  } catch {
    return []; // 不存在/损坏一律当空
  }
}

function write(list: InflightEntry[]): void {
  try {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    fs.writeFileSync(INFLIGHT_PATH, JSON.stringify(list));
  } catch {
    /* 写不进去不阻断获取本身 */
  }
}

/** 获取开始前登记目标（git 克隆 / svn 检出各调一次） */
export function markInflight(target: string): void {
  const list = read();
  if (!list.some((e) => e.target === target)) list.push({ target, at: Date.now() });
  write(list);
}

/** 获取结束（成功/失败/取消都要调）：把登记撤掉 */
export function clearInflight(target: string): void {
  write(read().filter((e) => e.target !== target));
}

/** 目录是否"像上次中断留下的残骸"：不存在、空、或**只有** .git / .svn 一个条目。
 *  这是删除前的唯一判据——多出任何文件都不是残骸。 */
function isRemnant(target: string): boolean {
  try {
    const entries = fs.readdirSync(target);
    if (entries.length === 0) return true;
    return entries.length === 1 && (entries[0] === '.git' || entries[0] === '.svn');
  } catch {
    return false;
  }
}

/** 删目标目录（只删确认过的残骸）。rmSync 带重试：刚被杀掉的进程可能还占着句柄一两秒。 */
function removeRemnant(target: string): boolean {
  try {
    fs.rmSync(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    return true;
  } catch {
    return false;
  }
}

/** 找命令行里含该目标的 git / svn 进程（只认登记过的绝对路径，不做模糊匹配） */
function pidsFor(target: string): Promise<number[]> {
  const toPids = (out: string) =>
    out
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map(Number)
      .filter((n) => Number.isInteger(n) && n > 0);
  return new Promise((resolve) => {
    if (process.platform === 'win32') {
      // 用 .Contains（字面匹配）而不是 -like：路径里的 [ ] * ? 在 -like 里是通配符
      const esc = target.replace(/'/g, "''");
      const script = `Get-CimInstance Win32_Process -Filter "name='git.exe' or name='svn.exe'" | Where-Object { $_.CommandLine -and $_.CommandLine.Contains('${esc}') } | ForEach-Object { $_.ProcessId }`;
      execFile('powershell', ['-NoProfile', '-Command', script], { timeout: 15_000 }, (err, stdout) => resolve(err ? [] : toPids(String(stdout))));
      return;
    }
    // POSIX：pgrep -f 按整条命令行匹配；目标是绝对路径，够具体
    execFile('pgrep', ['-f', target], { timeout: 10_000 }, (err, stdout) => resolve(err ? [] : toPids(String(stdout))));
  });
}

async function killFor(target: string): Promise<number> {
  const pids = await pidsFor(target);
  for (const pid of pids) {
    try {
      // Windows：taskkill /T 连孙进程一起收（git 克隆会派生 remote-https / index-pack）
      if (process.platform === 'win32') execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
      else process.kill(pid, 'SIGKILL');
    } catch {
      /* 已退出等：忽略 */
    }
  }
  return pids.length;
}

/** 启动时收尾上次异常退出留下的东西。**任何一步失败都静默跳过**，绝不挡启动。 */
export async function recoverInflight(): Promise<void> {
  const list = read();
  if (list.length === 0) return;
  for (const e of list) {
    if (!isRemnant(e.target)) continue; // 不存在，或已是完整仓库（获取其实成功了）：不动
    if (removeRemnant(e.target)) continue; // 没有进程占着，直接删掉
    // 删不掉 = 还有进程（多半是上次的 git/svn 孤儿）占着：杀掉再删
    const killed = await killFor(e.target);
    if (killed > 0 && removeRemnant(e.target)) {
      // 已清理上次退出遗留的获取进程与半截目录：{path}
      console.warn(t('srv.orphanRecovered', { path: e.target }));
    }
  }
  write([]);
}
