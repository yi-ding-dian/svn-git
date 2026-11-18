/** 最近项目历史（history.json）的**唯一读写入口**：加载、写回、去重、排序与权限。
 *
 *  任何模块都不得直接读写 ~/.config/svngit/history.json —— 统一走本模块，
 *  避免多处各自 mkdir/write/chmod 造成权限不一致或写入竞争。 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { START_DIR } from '../repo-context.js';

/** 最近打开的项目历史（服务端持久化：浏览器端口随机，localStorage 不可靠） */
const HISTORY_PATH = path.join(os.homedir(), '.config', 'svngit', 'history.json');
const HISTORY_MAX = 20;

export interface HistoryItem {
  path: string;
  type: 'svn' | 'git' | 'wsl';
  lastOpened: number;
  /** 打开时的操作范围（相对仓库根的子项目路径；空/缺省 = 整个工作副本）。
   *  大仓库里只打开 trunk/src 这类子项目时记住它，重新打开不用再逐级点进去 */
  scope?: string;
  /** 常用项目标记（星号，启动时优先打开） */
  fav?: boolean;
  /** 用户备注（侧边栏右键「备注」设置）：侧边栏显示在时间前，过长由前端 CSS 截断；空/缺省 = 无备注 */
  remark?: string;
}

/** 读最近项目清单（github.ts 的「我的仓库」列表要拿它标出"本地已有"） */
export function loadHistory(): HistoryItem[] {
  try {
    if (fs.existsSync(HISTORY_PATH)) {
      const list = JSON.parse(fs.readFileSync(HISTORY_PATH, 'utf8')) as HistoryItem[];
      if (Array.isArray(list)) return list;
    }
  } catch {
    /* 损坏则重置 */
  }
  return [];
}

/** 历史记录的项目身份键：**按 inode 归一，不能按路径字符串**。
 *  同一个目录可以有多个路径——bind mount（如 /data/home/x 与 /home/x，实测 inode 完全相同）、
 *  软链接、结尾斜杠等，按字符串比会当成两个项目，列表里就出现一模一样的条目（用户实报：
 *  最近项目里两个 svn-git，一个带星一个不带）。realpath 对 bind mount 无效（它只解析软链），
 *  所以必须看 dev:ino。取不到（目录已删/无权限）时退回字面路径，只归并完全相同的字符串。 */
function historyKey(p: string, scope?: string): string {
  try {
    const st = fs.statSync(p);
    // 同一工作副本的不同子项目范围视为不同条目（大仓库可同时把多个子项目放进最近列表）
    return `${st.dev}:${st.ino}\u0000${scope ?? ''}`;
  } catch {
    return `${path.resolve(p)}\u0000${scope ?? ''}`;
  }
}

/** 写回 history.json（唯一落盘点）：建目录 + 落盘 + 仅本人可读写。失败静默返回 false。 */
function saveHistory(list: HistoryItem[]): boolean {
  try {
    fs.mkdirSync(path.dirname(HISTORY_PATH), { recursive: true });
    fs.writeFileSync(HISTORY_PATH, JSON.stringify(list, null, 2));
    fs.chmodSync(HISTORY_PATH, 0o600); // 与 config 一致，仅本人可读写
    return true;
  } catch {
    return false;
  }
}

/** 启动时清理历史里的重复项：同一目录只留最近打开的那条路径，常用标记合并上去
 *  （星号不能因为去重丢了）。返回清理掉的条数，0 = 本来就干净（不写文件）。 */
export function dedupeHistory(): number {
  try {
    const list = loadHistory();
    const byKey = new Map<string, HistoryItem>();
    for (const h of list) {
      const key = historyKey(h.path, h.scope);
      const prev = byKey.get(key);
      if (!prev) {
        byKey.set(key, h);
        continue;
      }
      const [keep, drop] = (h.lastOpened ?? 0) > (prev.lastOpened ?? 0) ? [h, prev] : [prev, h];
      // fav 做「或」合并、备注取先有的那个：同一目录的两条别名记录，用户只在其中一条上设过星号/备注，
      // 归并时必须留下，不能因为"保留的那条恰好没有"就并没了
      byKey.set(key, { ...keep, fav: Boolean(keep.fav || drop.fav), remark: keep.remark ?? drop.remark });
    }
    if (byKey.size === list.length) return 0;
    const out = [...byKey.values()].sort((a, b) => (b.lastOpened ?? 0) - (a.lastOpened ?? 0));
    return saveHistory(out) ? list.length - out.length : 0;
  } catch {
    return 0; // 清理失败不影响启动
  }
}

export function addHistory(entry: { path: string; type: HistoryItem['type']; scope?: string }): void {
  try {
    const key = historyKey(entry.path, entry.scope);
    const existed = loadHistory().find((h) => historyKey(h.path, h.scope) === key);
    const list = loadHistory().filter((h) => historyKey(h.path, h.scope) !== key); // 同一条目的别名路径一并去掉，不留重复
    // 记录被整个重新构造，**用户自己设的两样东西都得显式带过来**，否则打开一次项目就没了：
    // 常用标记（不丢星号）+ 备注（用户实报：「更新时间后就不见了，备注」）
    list.unshift({ ...entry, lastOpened: Date.now(), fav: existed?.fav, remark: existed?.remark });
    saveHistory(list.slice(0, HISTORY_MAX));
  } catch {
    /* 忽略写失败 */
  }
}

/** WSL 包模式启动：把运行目录写进最近项目（type=wsl，侧边栏按文件夹名显示）。
 *  该目录天然不是 SVN/Git 工作副本，前端点击时走目录浏览而不是「打开仓库」，不会报错。
 *  更新后包目录会改成新版本号的名字，旧的 wsl 条目一并清掉，避免列表里留下失效路径。 */
export function rememberRunDir(): void {
  try {
    const dir = path.resolve(START_DIR);
    if (!fs.existsSync(path.join(dir, '.svngit-package.json'))) return;
    const key = historyKey(dir);
    const list = loadHistory().filter((h) => h.type !== 'wsl' && historyKey(h.path) !== key);
    list.unshift({ path: dir, type: 'wsl', lastOpened: Date.now() });
    saveHistory(list.slice(0, HISTORY_MAX));
  } catch {
    /* 写失败不影响启动 */
  }
}

/** 删除整个历史文件（安全清理用）。失败向上抛出，由调用方记录到清理结果。 */
export function clearHistoryFile(): void {
  fs.rmSync(HISTORY_PATH, { force: true });
}

/** 删除一条最近项目记录（按路径 + 操作范围精确匹配），返回删除后的清单。 */
export function removeHistoryItem(p: string, scope: string): HistoryItem[] {
  const list = loadHistory().filter((h) => !(h.path === p && (h.scope ?? '') === scope));
  saveHistory(list);
  return loadHistory();
}

/** 设置/取消常用项目标记（星号），返回更新后的清单。 */
export function setHistoryFav(p: string, scope: string, fav: boolean): HistoryItem[] {
  const list = loadHistory().map((h) => (h.path === p && (h.scope ?? '') === scope ? { ...h, fav } : h));
  saveHistory(list);
  return loadHistory();
}

/** 设置/清除最近项目的备注（空串 = 清除：把字段删掉，不留空串），返回更新后的清单。 */
export function setHistoryRemark(p: string, scope: string, remark: string): HistoryItem[] {
  const list = loadHistory().map((h) => {
    if (h.path !== p || (h.scope ?? '') !== scope) return h;
    const next: HistoryItem = { ...h };
    if (remark) next.remark = remark;
    else delete next.remark;
    return next;
  });
  saveHistory(list);
  return loadHistory();
}
