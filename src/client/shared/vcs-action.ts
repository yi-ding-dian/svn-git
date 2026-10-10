/** 版本操作动作的通用执行封装（被 ops 和 repo 两个域共用）。 */
import type { VcsResult } from './api.js';

/** 执行并刷新列表的通用逻辑
 *  onFailOk=true 时失败（ok=false）也执行 afterOk：merge 冲突这类"返回失败但工作区已变"的操作（MERGE_HEAD/C 状态）
 *  不刷新的话「解决冲突」入口不会出现，用户看到提示却找不到地方 */
export async function runAction<T extends VcsResult = VcsResult>(
  fn: () => Promise<T>,
  onMsg: (msg: string, err?: boolean) => void,
  afterOk?: (r: T) => void,
  onFailOk = false
) {
  try {
    const r = await fn();
    onMsg(r.message, !r.ok);
    if (r.ok) afterOk?.(r);
    else if (onFailOk) afterOk?.(r);
  } catch (e) {
    onMsg((e as Error).message, true);
  }
}
