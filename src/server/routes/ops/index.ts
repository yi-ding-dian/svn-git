/** 操作域端点入口：按子职责分发。
 *
 *  域内按"操作对象"分层：仓库级操作 core、文件级操作 file-operations、忽略规则 ignore、
 *  维护类（清理/锁）maintenance。新增端点放对应文件，入口不用改。 */
import type { Ctx } from '../util.js';
import { handle as handleCore } from './core.js';
import { handle as handleFileOperations } from './file-operations.js';
import { handle as handleIgnore } from './ignore.js';
import { handle as handleMaintenance } from './maintenance.js';

export async function handle(ctx: Ctx): Promise<boolean> {
  if (await handleCore(ctx)) return true;
  if (await handleFileOperations(ctx)) return true;
  if (await handleIgnore(ctx)) return true;
  return handleMaintenance(ctx);
}
