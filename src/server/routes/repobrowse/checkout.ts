/** POST /api/repo-checkout：仓库浏览右键「检出到本地」（URL 直连检出，含稀疏检出）。 */
import { sendJson, readBody, type Ctx } from '../../http/response.js';
import { t } from '../../../shared/i18n/index.js';
import { URL_OK } from '../../../vcs/svn/remote.js';
import { checkoutRemote } from '../../../vcs/svn/checkout.js';

export async function handle(ctx: Ctx): Promise<boolean> {
  const { req, res, url } = ctx;
  const p = url.pathname;

  if (p === '/api/repo-checkout' && req.method === 'POST') {
    const body = await readBody(req);
    const targetUrl = String(body.url ?? '').trim();
    const dir = String(body.dir ?? '').trim();
    const name = String(body.name ?? '').trim();
    if (!URL_OK.test(targetUrl) || !dir || !name) {
      // 仓库地址无效（仅支持 svn / http(s) / file）
      sendJson(res, 400, { error: t('srv.badRepoUrl') });
      return true;
    }
    // **客户端断开要真的停**：用户点「取消」/关弹窗 → 断开请求 → 把 svn 一起杀掉并清半截目录。
    // ⚠ 必须听 **res** 的 close，不能听 req 的：请求体已被 readBody 读完，req 的 'close' 早已触发
    // （挂上去等于空放）——详见 index.ts 克隆段的同款注释。
    const ac = new AbortController();
    const onClose = () => ac.abort();
    res.on('close', onClose);
    const result = await checkoutRemote(
      { url: targetUrl, dir, name, include: body.include, username: body.username, password: body.password },
      ac.signal,
    );
    res.off('close', onClose);
    sendJson(res, 200, result);
    return true;
  }

  return false;
}
