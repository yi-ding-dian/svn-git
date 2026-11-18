/** GitHub 集成路由（薄层）：只做 HTTP 协议转换与分派，实现见 ../../github/*。
 *
 *  端点（路径/方法/响应字段与拆分前完全一致）：
 *  - GET  /api/github-repo              仓库元信息 + 语言构成（失败降级本地统计）
 *  - GET  /api/github-releases          发布历史 / tag / CI 状态
 *  - GET  /api/github-release-cleanup   批量清理预览
 *  - POST /api/github-release-cleanup   执行批量清理
 *  - POST /api/github-create-repo       新建仓库并设为 origin
 *  - POST /api/github-delete-repo       删除 origin 仓库
 *  - GET  /api/github-permissions       仓库访问权限（Fork 引导用，实时）
 *  - GET  /api/github-identity          顶栏身份徽标（带缓存）
 *  - GET  /api/github-my-repos          本人仓库列表（不缓存）
 *  - POST /api/github-fork              Fork 到自己账号 */
import type http from 'node:http';
import { sendJson, readBody, type Ctx } from '../../http/response.js';
import { vcsOf } from '../../repo-context.js';
import { FETCH_TIMEOUT_MS, GITHUB_WRITE_TIMEOUT_MS, type ServiceResult } from '../../github/client.js';
import { getRepoInfo } from '../../github/repo-info.js';
import { getReleases, previewReleaseCleanup, cleanupReleaseAssets } from '../../github/releases.js';
import { createRepo, deleteRepo, forkRepo } from '../../github/lifecycle.js';
import { getPermissions, getIdentity, getMyRepos } from '../../github/identity.js';

/** 发送服务层结果；前端已断开时静默丢弃（与原实现各端点的守卫一致）。 */
function sendResult(res: http.ServerResponse, result: ServiceResult): void {
  if (!res.destroyed && !res.writableEnded) sendJson(res, result.status, result.body);
}

/** 把客户端断开接到 AbortSignal 上（关弹窗/切项目时立即中止 GitHub 请求），并附加超时。 */
async function withClientAbort<T>(
  res: http.ServerResponse,
  timeoutMs: number,
  fn: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const ctl = new AbortController();
  const onClose = () => ctl.abort();
  res.on('close', onClose);
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    return await fn(ctl.signal);
  } finally {
    clearTimeout(timer);
    res.off('close', onClose);
  }
}

/** 只加超时、不跟随客户端断开（批量清理原实现如此）。 */
async function withTimeout<T>(timeoutMs: number, fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    return await fn(ctl.signal);
  } finally {
    clearTimeout(timer);
  }
}

export async function handle(ctx: Ctx): Promise<boolean> {
  const { req, res, url } = ctx;
  const p = url.pathname;

  if (p === '/api/github-repo' && req.method === 'GET') {
    const { vcs, repo } = vcsOf();
    const force = url.searchParams.get('force') === '1';
    const result = await withClientAbort(res, FETCH_TIMEOUT_MS, (signal) =>
      getRepoInfo({ vcs, repo, force, signal }),
    );
    sendResult(res, result);
    return true;
  }

  if (p === '/api/github-releases' && req.method === 'GET') {
    const { vcs, repo } = vcsOf();
    const force = url.searchParams.get('force') === '1';
    const result = await withClientAbort(res, FETCH_TIMEOUT_MS, (signal) =>
      getReleases({ vcs, repo, force, signal }),
    );
    sendResult(res, result);
    return true;
  }

  if (p === '/api/github-release-cleanup' && req.method === 'GET') {
    const { vcs, repo } = vcsOf();
    const keep = Number(url.searchParams.get('keep') ?? 3) || 3;
    const result = await withTimeout(FETCH_TIMEOUT_MS, (signal) =>
      previewReleaseCleanup({ vcs, repo, keep, signal }),
    );
    sendResult(res, result);
    return true;
  }

  if (p === '/api/github-release-cleanup' && req.method === 'POST') {
    const { vcs, repo } = vcsOf();
    const body = await readBody(req);
    const keep = Number(body.keep ?? 3) || 3;
    const result = await withTimeout(120_000, (signal) =>
      cleanupReleaseAssets({ vcs, repo, keep, signal }),
    );
    sendResult(res, result);
    return true;
  }

  if (p === '/api/github-create-repo' && req.method === 'POST') {
    const { vcs, repo } = vcsOf();
    const body = await readBody(req);
    const result = await withClientAbort(res, GITHUB_WRITE_TIMEOUT_MS, (signal) =>
      createRepo({ vcs, repo, body, signal }),
    );
    sendResult(res, result);
    return true;
  }

  if (p === '/api/github-delete-repo' && req.method === 'POST') {
    const { vcs, repo } = vcsOf();
    const body = await readBody(req);
    const result = await withClientAbort(res, GITHUB_WRITE_TIMEOUT_MS, (signal) =>
      deleteRepo({ vcs, repo, body, signal }),
    );
    sendResult(res, result);
    return true;
  }

  if (p === '/api/github-permissions' && req.method === 'GET') {
    const { vcs, repo } = vcsOf();
    const result = await withClientAbort(res, FETCH_TIMEOUT_MS, (signal) =>
      getPermissions({ vcs, repo, signal }),
    );
    sendResult(res, result);
    return true;
  }

  if (p === '/api/github-identity' && req.method === 'GET') {
    const { vcs, repo } = vcsOf();
    const result = await withClientAbort(res, FETCH_TIMEOUT_MS, (signal) =>
      getIdentity({ vcs, repo, signal }),
    );
    sendResult(res, result);
    return true;
  }

  if (p === '/api/github-my-repos' && req.method === 'GET') {
    const page = Math.max(1, Number(url.searchParams.get('page') ?? '1') || 1);
    const result = await withClientAbort(res, FETCH_TIMEOUT_MS, (signal) => getMyRepos({ page, signal }));
    sendResult(res, result);
    return true;
  }

  if (p === '/api/github-fork' && req.method === 'POST') {
    const { vcs, repo } = vcsOf();
    const result = await withClientAbort(res, GITHUB_WRITE_TIMEOUT_MS, (signal) =>
      forkRepo({ vcs, repo, signal }),
    );
    sendResult(res, result);
    return true;
  }

  return false;
}
