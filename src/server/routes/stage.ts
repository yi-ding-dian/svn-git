/** hunk 级部分提交端点：读取文件的分块差异 + 把选中的块应用到暂存区。
 *  解析与 patch 拼接在 vcs/hunks.ts 的纯函数里（可单测），本模块只做参数校验与转发。
 */
import { sendJson, readBody, vcsOf } from './util.js';
import { t } from '../../shared/i18n/index.js';
import type { Ctx } from './util.js';

export async function handle(ctx: Ctx): Promise<boolean> {
  const { req, res, url, p } = ctx;

  if (p === '/api/diff-hunks') {
    // 读取某文件的逐块差异（供 hunk 勾选弹窗渲染）
    const { vcs, repo } = vcsOf();
    if (repo.type !== 'git') {
      // 仅 Git 仓库支持
      sendJson(res, 400, { error: t('srv.gitOnly') });
      return true;
    }
    const rel = String(url.searchParams.get('path') ?? '').trim();
    if (!rel) {
      // 缺少 path 参数
      sendJson(res, 400, { error: t('srv.missingPathParam') });
      return true;
    }
    try {
      sendJson(res, 200, (await vcs.diffHunks?.(rel)) ?? { fileHeader: '', hunks: [] });
    } catch (e) {
      sendJson(res, 400, { error: (e as Error).message });
    }
    return true;
  }

  if (p === '/api/staged-files') {
    // 已在暂存区（index）里的文件：提交弹窗打开时据此恢复「部分暂存」标记。
    // 不区分「hunk 级部分暂存」与「整文件暂存」——两者都该走 index 优先的提交路径。
    const { vcs, repo } = vcsOf();
    if (repo.type !== 'git') {
      sendJson(res, 200, { files: [] });
      return true;
    }
    try {
      sendJson(res, 200, { files: (await vcs.stagedFiles?.()) ?? [] });
    } catch {
      sendJson(res, 200, { files: [] });
    }
    return true;
  }

  if (p === '/api/stage-hunks' && req.method === 'POST') {
    // 把选中的块应用到暂存区（部分提交的基础）
    const { vcs, repo } = vcsOf();
    if (repo.type !== 'git') {
      // 仅 Git 仓库支持
      sendJson(res, 400, { error: t('srv.gitOnly') });
      return true;
    }
    const body = await readBody(req);
    const rel = String(body.path ?? '').trim();
    const hunks = Array.isArray(body.hunks) ? body.hunks.map(Number).filter((n) => Number.isInteger(n)) : [];
    if (!rel || hunks.length === 0) {
      // 参数不完整
      sendJson(res, 400, { error: t('srv.incompleteParams') });
      return true;
    }
    const expectBlob = typeof body.expectBlob === 'string' ? body.expectBlob : undefined;
    // 当前仓库类型不支持
    sendJson(res, 200, (await vcs.stageHunks?.(rel, hunks, expectBlob)) ?? { ok: false, message: t('srv.repoTypeUnsupported') });
    return true;
  }

  return false;
}
