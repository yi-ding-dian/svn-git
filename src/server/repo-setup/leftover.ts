/** 获取仓库（git 克隆 / svn 检出）的半截目标目录：登记、重试清理、残骸识别。
 *  清理原语在 vcs/leftover.ts（vcs 层不能反向依赖 server）；本模块持有「获取仓库」这条入口的
 *  登记表，与仓库浏览检出的登记表互不干扰。 */
import fs from 'node:fs';
import { createLeftoverCleaner } from '../../vcs/leftover.js';

const cleaner = createLeftoverCleaner();

/** 上次对同一目标的清理没删干净（服务重启会丢这份登记，残骸识别是兜底） */
export function hasLeftoverTarget(target: string): boolean {
  return cleaner.has(target);
}

/** 删掉本次获取留下的半截目录，返回是否清干净。
 *  **必须带重试**：Windows 上 git/svn 刚被 SIGKILL，文件句柄可能还没释放，立刻 rmSync 会
 *  EBUSY/EPERM——这是时序竞争（实测同一个取消场景，一次清干净、另一次就残留一个 `.git`）。
 *  rmSync 的 maxRetries/retryDelay 对 EBUSY/EPERM/ENOTEMPTY 有效；清不掉就记进登记表，下次对
 *  同一目标发起获取时再试，并且绝不把"清不掉"当成获取失败。 */
export function removeLeftoverTarget(target: string): boolean {
  return cleaner.remove(target);
}

/** 目标目录里**只有** `.git` / `.svn` 一个条目 = 上次获取中断留下的残骸
 *  （服务重启后就丢了登记，靠这一手兜底）。这种目录克隆/检出必失败，而用户要的正是
 *  "克隆到这里"——清掉继续，并在结果里说明。
 *  **只在"仅此一个条目"时才敢删**：多出任何文件都可能是用户自己的东西，一个字节都不碰。 */
export function cleanRemnantIfVcsMetaOnly(target: string): boolean {
  if (!fs.existsSync(target)) return false;
  try {
    const entries = fs.readdirSync(target);
    if (entries.length === 1 && (entries[0] === '.git' || entries[0] === '.svn')) {
      return removeLeftoverTarget(target);
    }
  } catch {
    /* 读不到就按原样交给 git/svn，让它们报自己的错 */
  }
  return false;
}
