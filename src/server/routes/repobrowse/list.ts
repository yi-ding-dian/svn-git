/** GET /api/repo-list：远程目录列表（带修订/作者/时间）。 */
import { sendJson, type Ctx } from '../../http/response.js';
import { t } from '../../../shared/i18n/index.js';
import { URL_OK, listRemote } from '../../../vcs/svn/remote.js';

export async function handle(ctx: Ctx): Promise<boolean> {
  const { req, res, url } = ctx;
  const p = url.pathname;

  if (p === '/api/repo-list' && req.method === 'GET') {
    const target = String(url.searchParams.get('url') ?? '').trim();
    if (!URL_OK.test(target)) {
      // 仓库地址无效（仅支持 svn / http(s) / file）
      sendJson(res, 400, { error: t('srv.badRepoUrl') });
      return true;
    }
    try {
      const r = await listRemote(target);
      if (!r.ok) {
        sendJson(res, 200, { ok: false, error: r.error });
        return true;
      }
      sendJson(res, 200, { ok: true, entries: r.entries });
    } catch (e) {
      sendJson(res, 200, { ok: false, error: (e as Error).message });
    }
    return true;
  }

  return false;
}
