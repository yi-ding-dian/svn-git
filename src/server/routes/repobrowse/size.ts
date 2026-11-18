/** GET /api/repo-size：检出大小检测（流式 NDJSON：每 ~400ms 一行累计，最后一行 done）。 */
import { sendJson, type Ctx } from '../../http/response.js';
import { t } from '../../../shared/i18n/index.js';
import { URL_OK, startRemoteSizeScan } from '../../../vcs/svn/remote.js';

export async function handle(ctx: Ctx): Promise<boolean> {
  const { req, res, url } = ctx;
  const p = url.pathname;

  if (p === '/api/repo-size' && req.method === 'GET') {
    const target = String(url.searchParams.get('url') ?? '').trim().replace(/\/+$/, '');
    if (!URL_OK.test(target)) {
      // 仓库地址无效（仅支持 svn / http(s) / file）
      sendJson(res, 400, { error: t('srv.badRepoUrl') });
      return true;
    }
    const include = String(url.searchParams.get('include') ?? '')
      .split(',')
      .map((s) => {
        try {
          return decodeURIComponent(s);
        } catch {
          return s;
        }
      })
      .map((s) => s.replace(/\\/g, '/').replace(/^\/+|\/+$/g, ''))
      .filter((s) => s && s.split('/').every((seg) => seg && seg !== '.' && seg !== '..'));
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store' });
    const ac = new AbortController();
    const onClose = () => ac.abort();
    res.on('close', onClose);
    const scan = startRemoteSizeScan(target, include, ac.signal);
    if (scan.cached) {
      res.off('close', onClose);
      res.end(JSON.stringify({ done: true, cached: true, ...scan.cached }) + '\n');
      return true;
    }
    /** 定时推当前累计（连接断了 ac 会杀子进程，这里的写静默失败即可） */
    const timer = setInterval(() => {
      if (!res.writableEnded) res.write(JSON.stringify({ ...scan.total }) + '\n');
    }, 400);
    const finish = (end: string) => {
      clearInterval(timer);
      res.off('close', onClose);
      if (!res.writableEnded) res.end(end);
    };
    const r = await scan.result;
    if ('aborted' in r) {
      finish('');
      return true;
    }
    if ('error' in r) {
      finish(JSON.stringify({ error: r.error }) + '\n');
      return true;
    }
    finish(
      JSON.stringify({ done: true, partial: r.done.partial, files: r.done.files, dirs: r.done.dirs, bytes: r.done.bytes }) +
        '\n',
    );
    return true;
  }

  return false;
}
