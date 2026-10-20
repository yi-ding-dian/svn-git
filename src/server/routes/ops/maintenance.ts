/** 维护类端点：svn cleanup / resolve / propset-ignore、git 未跟踪文件清理、svn 锁定/解锁。
 *
 *  这类操作不提交业务改动，只修复或整理工作副本状态。 */
import path from 'node:path';
import { sendJson, readBody, vcsOf, inRepoRoot, authErrorOf, invalidateStatusCache, runVcs, MSG_PATH_OUT_OF_BOUNDS } from '../util.js';
import type { Ctx } from '../util.js';
import { t } from '../../../shared/i18n/index.js';

export async function handle(ctx: Ctx): Promise<boolean> {
  const { req, res, url } = ctx;
  const p = url.pathname;

  if (p === '/api/svn-extra' && req.method === 'POST') {
    const { vcs, repo } = vcsOf();
    const body = await readBody(req);
    const action = String(body.action ?? '');
    if (action === 'cleanup') {
      // 取消/转后台：客户端断开（任务面板「取消」）→ 杀掉 svn cleanup 子进程（同 update 手法）
      const ac = new AbortController();
      res.on('close', () => {
        if (!res.writableEnded) ac.abort();
      });
      const r = (await vcs.cleanup?.(ac.signal)) ?? { ok: false, message: t('srv.unknownAction') };
      invalidateStatusCache(repo.root);
      sendJson(res, 200, { ...r, authError: authErrorOf(r) });
      return true;
    }
    if (action === 'resolve' || action === 'propset-ignore') {
      // 路径越界校验：resolve/propset-ignore 的 path 是相对仓库根路径
      const rel = String(body.path ?? '');
      if (!inRepoRoot(repo.root, path.resolve(repo.root, rel))) {
        sendJson(res, 400, { error: MSG_PATH_OUT_OF_BOUNDS() });
        return true;
      }
      // resolve/propset-ignore 改变状态码（C→干净、?→I），缓存失效由 runVcs 统一
      return runVcs(ctx, () =>
        action === 'resolve'
          ? vcs.resolve?.(rel, String(body.accept ?? 'working'))
          : vcs.propSetIgnore?.(rel, String(body.pattern ?? ''))
      );
    }
    // 未知操作
    sendJson(res, 400, { error: t('srv.unknownAction') });
    return true;
  }

  if (p === '/api/git-clean') {
    const { repo, vcs } = vcsOf();
    if (repo.type !== 'git') {
      // 仅 Git 仓库支持
      sendJson(res, 400, { error: t('srv.gitOnly') });
      return true;
    }
    if (req.method === 'GET') {
      const files = (await vcs.cleanList?.()) ?? [];
      sendJson(res, 200, { files });
      return true;
    }
    const body = await readBody(req);
    const paths = Array.isArray(body.paths) ? body.paths.map(String).filter(Boolean) : undefined;
    // clean 为纯本地操作（无网络认证），authErrorOf 恒 false——与原固定 authError:false 等价
    return runVcs(ctx, () => vcs.clean?.(paths?.length ? paths : undefined));
  }

  if (p === '/api/svn-lock' && req.method === 'POST') {
    const { repo, vcs } = vcsOf();
    if (repo.type !== 'svn') {
      // 仅 SVN 仓库支持
      sendJson(res, 400, { error: t('srv.svnOnly') });
      return true;
    }
    const body = await readBody(req);
    const action = String(body.action ?? '');
    const pathRel = String(body.path ?? '');
    if (!inRepoRoot(repo.root, path.resolve(repo.root, pathRel))) {
      sendJson(res, 400, { error: MSG_PATH_OUT_OF_BOUNDS() });
      return true;
    }
    const force = Boolean(body.force);
    // 锁定/解锁影响状态展示（锁标），缓存失效由 runVcs 统一
    return runVcs(ctx, () => (action === 'lock' ? vcs.lock?.(pathRel, force) : vcs.unlock?.(pathRel, force)));
  }

  return false;
}
