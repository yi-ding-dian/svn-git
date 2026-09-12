/** 「经 hunk 弹窗部分暂存」的文件登记表（持久化到磁盘）。
 *
 *  为什么需要它：提交时要知道哪些文件该跳过整文件 `git add`（否则会把用户没勾选的块也提交）。
 *  这个信息**只能显式记录**，不能从 index/工作区状态反推——「普通暂存 + 工作区后续修改」
 *  与「hunk 部分暂存」在 diff 状态上完全同构（实测：撤销提交后继续改再提交，会被误判成部分暂存，
 *  于是跳过 add、提交 index 里的旧内容，静默丢掉新改动）。
 *
 *  为什么要落盘：服务进程重启后内存状态就没了，而 index 里的部分暂存还在——
 *  此时提交会走整文件 add，把用户没勾选的块一并提交（实测过越界 20 块的场景）。
 *  与 config.json 同目录存放（~/.config/svngit/），按仓库根分组，切仓库互不影响。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const FILE = path.join(os.homedir(), '.config', 'svngit', 'hunk-staged.json');

type Store = Record<string, string[]>;

function load(): Store {
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    return raw && typeof raw === 'object' ? (raw as Store) : {};
  } catch {
    return {}; // 文件不存在/损坏：当作空登记，不影响提交
  }
}

function save(data: Store): void {
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true, mode: 0o700 });
    fs.writeFileSync(FILE, JSON.stringify(data), { mode: 0o600 });
  } catch {
    /* 写不进去也不影响当前会话（内存里还有），只是重启后丢登记 */
  }
}

/** 登记：某文件刚经 hunk 弹窗暂存过 */
export function markHunkStaged(repoRoot: string, pathRel: string): void {
  const data = load();
  const list = data[repoRoot] ?? [];
  if (!list.includes(pathRel)) {
    data[repoRoot] = [...list, pathRel];
    save(data);
  }
}

/** 查询：该仓库当前有哪些文件处于「部分暂存」 */
export function hunkStagedOf(repoRoot: string): string[] {
  return load()[repoRoot] ?? [];
}

/** 清除：这些文件已提交（或被 reset/drop 清掉 index），其登记不再代表「部分暂存」 */
export function clearHunkStaged(repoRoot: string, paths?: string[]): void {
  const data = load();
  if (!data[repoRoot]) return;
  if (!paths) {
    delete data[repoRoot];
  } else {
    const rest = data[repoRoot]!.filter((p) => !paths.includes(p));
    if (rest.length) data[repoRoot] = rest;
    else delete data[repoRoot];
  }
  save(data);
}
