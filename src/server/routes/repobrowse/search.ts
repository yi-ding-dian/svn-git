/** GET /api/repo-search：远程递归搜索（svn ls -R 流式逐行过滤，够数早停 / 超时返回已收集）。 */
import { sendJson, type Ctx } from '../../http/response.js';
import { t } from '../../../shared/i18n/index.js';
import { URL_OK, searchRemote } from '../../../vcs/svn/remote.js';

export async function handle(ctx: Ctx): Promise<boolean> {
  const { req, res, url } = ctx;
  const p = url.pathname;

  if (p === '/api/repo-search' && req.method === 'GET') {
    const target = String(url.searchParams.get('url') ?? '').trim().replace(/\/+$/, '');
    const q = String(url.searchParams.get('q') ?? '').trim();
    if (!URL_OK.test(target)) {
      // 仓库地址无效（仅支持 svn / http(s) / file）
      sendJson(res, 400, { error: t('srv.badRepoUrl') });
      return true;
    }
    if (!q) {
      sendJson(res, 200, { ok: true, items: [] });
      return true;
    }
    // 前端断开（清空输入/关弹窗）→ 杀掉 svn（与检出同一套 close→abort 机制）
    const ac = new AbortController();
    const onClose = () => ac.abort();
    res.on('close', onClose);
    const r = await searchRemote(target, q, ac.signal);
    res.off('close', onClose);
    if ('aborted' in r) return true; // 前端已断开：响应没处发（svn 已被杀掉）
    if (r.ok) {
      sendJson(res, 200, { ok: true, items: r.items, ...(r.truncated ? { truncated: r.truncated } : {}) });
    } else {
      sendJson(res, 200, { ok: false, error: r.error });
    }
    return true;
  }

  return false;
}
