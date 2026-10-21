/** 练习仓库端点：能力探测 + 创建（创建成功后由前端调用 /api/open 打开） */
import { sendJson, readBody } from './util.js';
import { t } from '../../shared/i18n/index.js';
import { generatePracticeRepo, probePractice } from '../../practice/index.js';
import type { Ctx } from './util.js';

export async function handle(ctx: Ctx): Promise<boolean> {
  const { req, res, url } = ctx;

  if (url.pathname === '/api/practice/probe') {
    sendJson(res, 200, await probePractice());
    return true;
  }

  if (url.pathname === '/api/practice/create' && req.method === 'POST') {
    const body = await readBody(req);
    const type = body.type === 'svn' ? 'svn' : 'git';
    const parentDir = String(body.parentDir ?? '').trim();
    if (!parentDir) {
      // 请选择父目录
      sendJson(res, 400, { ok: false, message: t('srv.practiceParentRequired') });
      return true;
    }
    const sc = (body.scenarios ?? {}) as Record<string, unknown>;
    // 与分支/推送路由一致：客户端断开（任务面板取消/关页）→ abort → 杀子进程
    const ac = new AbortController();
    res.on('close', () => {
      if (!res.writableEnded) ac.abort();
    });
    const r = await generatePracticeRepo(
      { type, parentDir, scenarios: { remote: Boolean(sc.remote), conflict: Boolean(sc.conflict) } },
      ac.signal,
    );
    sendJson(res, 200, r);
    return true;
  }

  return false;
}
