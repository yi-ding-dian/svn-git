/** GET /api/repo-download：原始文件全量下载（预览 cat 有 2MB 上限，下载不受限）。 */
import { sendJson, type Ctx } from '../../http/response.js';
import { t } from '../../../shared/i18n/index.js';
import { URL_OK, catRemote } from '../../../vcs/svn/remote.js';

export async function handle(ctx: Ctx): Promise<boolean> {
  const { req, res, url } = ctx;
  const p = url.pathname;

  if (p === '/api/repo-download' && req.method === 'GET') {
    const target = String(url.searchParams.get('url') ?? '').trim();
    if (!URL_OK.test(target)) {
      // 仓库地址无效（仅支持 svn / http(s) / file）
      sendJson(res, 400, { error: t('srv.badRepoUrl') });
      return true;
    }
    try {
      // buffer 上限 1GB（本地工具够用；超大文件会被截断——后续可改流式）
      const r = await catRemote(target, { timeoutMs: 600_000, maxBuffer: 1024 * 1024 * 1024 });
      if (!r.ok) {
        sendJson(res, 500, { error: r.error });
        return true;
      }
      const buf = r.buf;
      const name = decodeURIComponent(target.split('/').filter(Boolean).pop() ?? 'file');
      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        // filename*（RFC5987，支持中文名）供浏览器提示；前端用 saveFilePicker 的 suggestedName 为主
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
        'Content-Length': String(buf.length),
        'Cache-Control': 'no-store',
      });
      res.end(buf);
    } catch (e) {
      sendJson(res, 500, { error: (e as Error).message });
    }
    return true;
  }

  return false;
}
