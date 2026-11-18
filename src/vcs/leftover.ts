/** 远程获取（git 克隆 / svn 检出）的半截目标目录登记与清理。
 *
 *  **为什么需要**：目标目录里只剩 `.git` / `.svn` 一个条目 = 上次获取被中断留下的残骸，
 *  下次对同一目标获取会撞「目标已存在且非空」，而用户什么都没拿到（用户实报）。
 *  删掉本次获取留下的半截目录**必须带重试**：Windows 上 git/svn 刚被 SIGKILL，文件句柄可能还没
 *  释放，立刻 rmSync 会 EBUSY/EPERM——这是时序竞争（实测同一个取消场景，一次清干净、另一次就
 *  残留一个 `.git`）。rmSync 的 maxRetries/retryDelay 对 EBUSY/EPERM/ENOTEMPTY 有效；清不掉
 *  就记下来，下次对同一目标发起获取时再试，并且绝不把「清不掉」当成获取失败。
 *
 *  工厂形式：仓库获取（server/repo-setup）与仓库浏览检出（vcs/svn/checkout）各持一份登记表，
 *  互不干扰——某一次检出没清干净的路径，不该影响另一条入口的清理时机。 */
import fs from 'node:fs';

export interface LeftoverCleaner {
  /** 这个目标是否还欠着一次清理（上次没删掉） */
  has(target: string): boolean;
  /** 删掉目标目录，返回是否清干净；清不掉记入登记表，下次再试 */
  remove(target: string): boolean;
}

export function createLeftoverCleaner(): LeftoverCleaner {
  const targets = new Set<string>();
  return {
    has: (target) => targets.has(target),
    remove: (target) => {
      try {
        fs.rmSync(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
        targets.delete(target);
        return true;
      } catch {
        targets.add(target);
        return false;
      }
    },
  };
}
