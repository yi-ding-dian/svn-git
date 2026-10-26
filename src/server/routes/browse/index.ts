/** 浏览域端点：目录与文件内容的读取（列表/树/搜索/预览/历史版本内容）。
 *  只读，不含写操作（见 ops.ts）与系统集成（见 sys.ts）。 */
import type { Ctx } from '../util.js';
import { handle as handleSearch } from './search.js';
import { handle as handleDirectoryList } from './directory-list.js';
import { handle as handleFileContent } from './file-content.js';
import { handle as handleFileVersions } from './file-versions.js';
import { handle as handleLineScan } from './line-scan.js';
import { handle as handleCodeStats } from './code-stats.js';

/** 按子模块顺序分发；各模块只认领自己的路径，未命中返回 false。 */
export async function handle(ctx: Ctx): Promise<boolean> {
  if (await handleSearch(ctx)) return true;
  if (await handleDirectoryList(ctx)) return true;
  if (await handleFileContent(ctx)) return true;
  if (await handleFileVersions(ctx)) return true;
  if (await handleLineScan(ctx)) return true;
  if (await handleCodeStats(ctx)) return true;
  return false;
}
