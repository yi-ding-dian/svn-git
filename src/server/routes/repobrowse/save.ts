/** POST /api/repo-save：远程文件保存到本地目录（「下载到…」）。 */
import { sendJson, readBody, type Ctx } from '../../http/response.js';
import { t } from '../../../shared/i18n/index.js';
import { URL_OK, saveRemoteFile } from '../../../vcs/svn/remote.js';

export async function handle(ctx: Ctx): Promise<boolean> {
  const { req, res, url } = ctx;
  const p = url.pathname;

  if (p === '/api/repo-save' && req.method === 'POST') {
    const body = await readBody(req);
    const target = String(body.url ?? '').trim();
    const dir = String(body.dir ?? '').trim();
    if (!URL_OK.test(target) || !dir) {
      // 仓库地址无效（仅支持 svn / http(s) / file）
      sendJson(res, 400, { error: t('srv.badRepoUrl') });
      return true;
    }
    try {
      sendJson(res, 200, await saveRemoteFile(target, dir));
    } catch (e) {
      sendJson(res, 200, { ok: false, error: (e as Error).message });
    }
    return true;
  }

  return false;
}
