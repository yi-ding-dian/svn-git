/** GET /api/repo-root：从工作副本路径取仓库根 URL + 工作副本在仓库中的相对路径。 */
import { sendJson, type Ctx } from '../../http/response.js';
import { t } from '../../../shared/i18n/index.js';
import { rootInfoRemote } from '../../../vcs/svn/remote.js';

export async function handle(ctx: Ctx): Promise<boolean> {
  const { req, res, url } = ctx;
  const p = url.pathname;

  if (p === '/api/repo-root' && req.method === 'GET') {
    const wcPath = String(url.searchParams.get('path') ?? '').trim();
    if (!wcPath) {
      // 缺少路径
      sendJson(res, 400, { error: t('srv.missingPath') });
      return true;
    }
    try {
      const r = await rootInfoRemote(wcPath);
      if (!r.ok) {
        sendJson(res, 200, { ok: false, error: r.error });
        return true;
      }
      sendJson(res, 200, { ok: true, root: r.root, rel: r.rel });
    } catch (e) {
      sendJson(res, 200, { ok: false, error: (e as Error).message });
    }
    return true;
  }

  return false;
}
