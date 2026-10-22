/** 工作树管理域端点：列出 / 移除 / 清理失效记录（Git 专有）。 */
import { sendJson, readBody, vcsOf, runVcs } from './util.js';
import type { Ctx } from './util.js';
import { t } from '../../shared/i18n/index.js';

export async function handle(ctx: Ctx): Promise<boolean> {
  const { req, res, url } = ctx;
  const p = url.pathname;

  if (p === '/api/worktrees' && req.method === 'GET') {
    // Git 工作树列表（主工作树 + 各副本 + 已失效记录）
    const { vcs } = vcsOf();
    sendJson(res, 200, { worktrees: (await vcs.worktreeList?.()) ?? [] });
    return true;
  }

  if (p === '/api/worktree' && req.method === 'POST') {
    const body = await readBody(req);
    const action = String(body.action ?? '');
    const { vcs } = vcsOf();
    if (action === 'remove') {
      return runVcs(ctx, () => vcs.worktreeRemove?.(String(body.path ?? ''), Boolean(body.force)));
    }
    if (action === 'prune') {
      return runVcs(ctx, () => vcs.worktreePrune?.());
    }
    // 未知操作
    sendJson(res, 400, { error: t('srv.unknownAction') });
    return true;
  }

  return false;
}
