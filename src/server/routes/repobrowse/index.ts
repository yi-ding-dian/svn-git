/** SVN 仓库浏览端点分派（不 checkout 直接看远程，Tortoise Repo-Browser 的角色）。
 *  各子模块只做协议转换（参数校验 / 响应封装），远程命令与解析在 src/vcs/svn/remote.ts。 */
import type { Ctx } from '../../http/response.js';
import { handle as handleList } from './list.js';
import { handle as handleSearch } from './search.js';
import { handle as handleCat } from './cat.js';
import { handle as handleRoot } from './root.js';
import { handle as handleSave } from './save.js';
import { handle as handleCheckout } from './checkout.js';
import { handle as handleSize } from './size.js';
import { handle as handleDownload } from './download.js';

export async function handle(ctx: Ctx): Promise<boolean> {
  if (await handleList(ctx)) return true;
  if (await handleSearch(ctx)) return true;
  if (await handleCat(ctx)) return true;
  if (await handleRoot(ctx)) return true;
  if (await handleSave(ctx)) return true;
  if (await handleCheckout(ctx)) return true;
  if (await handleSize(ctx)) return true;
  if (await handleDownload(ctx)) return true;
  return false;
}
