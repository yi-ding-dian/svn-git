/** 仓库生命周期：新建 / 删除 / Fork，以及成功后对本地 remote 的改写。
 *
 *  - POST /api/github-create-repo：用已存凭据建**空仓库**（auto_init=false），成功后 origin 指向它。
 *  - POST /api/github-delete-repo：删除 origin 指向的远程仓库（不可恢复；confirm 必须完整 owner/repo）。
 *  - POST /api/github-fork：fork 到本人账号，origin 改指 fork、原仓库记入 upstream。 */
import { run } from '../../vcs/exec.js';
import { loadConfig } from '../../config.js';
import { normalizeGhRepoName, parseGithub } from '../../shared/github.js';
import { t } from '../../shared/i18n/index.js';
import {
  GITHUB_WRITE_TIMEOUT_MS,
  githubFetch,
  githubFetchRaw,
  remoteOf,
  type GithubContext,
  type ServiceResult,
} from './client.js';

/** 新建 GitHub 仓库并设为 origin（POST /api/github-create-repo）。
 *  凭据从 config.git 读（弹窗内联填写时前端会先存到 git-auth 再调这里）；
 *  仓库名**必须本地先规范化**：GitHub 对非法名不报错、会把「测试 仓库!!」静默建成名为 '-' 的仓库（实测），
 *  其余交给 GitHub 判（422 的 message/errors 映射成准确文案）。 */
export async function createRepo(
  ctx: GithubContext & { body: Record<string, unknown>; signal: AbortSignal },
): Promise<ServiceResult> {
  const { vcs, repo, body, signal } = ctx;
  if (repo.type !== 'git') {
    return { status: 400, body: { ok: false, message: t('srv.githubGitOnly') } };
  }
  const raw = String(body.name ?? '').trim();
  if (!raw) {
    return { status: 200, body: { ok: false, message: t('srv.githubCreateNoName') } };
  }
  const name = normalizeGhRepoName(raw);
  if (!name) {
    return { status: 200, body: { ok: false, message: t('srv.githubCreateNameInvalid') } };
  }
  const token = loadConfig().git?.password ?? '';
  if (!token) {
    return { status: 200, body: { ok: false, message: t('srv.githubCreateNoAuth') } };
  }
  try {
    const githubRes = await githubFetchRaw('/user/repos', {
      method: 'POST',
      signal,
      token,
      contentType: 'application/json',
      body: JSON.stringify({
        name,
        description: String(body.description ?? '').trim() || undefined,
        private: body.private !== false,
        auto_init: false,
      }),
    });
    if (!githubRes.ok) {
      // 错误映射：401 凭据无效；403/404 权限不足（限流单独区分）；422 名字问题（重名/不合法）
      let detail = '';
      let codes: string[] = [];
      /** errors[].message 汇总：GitHub 重名返回 code='custom' + message='name already exists on this account'，
       *  单看 code 认不出重名，必须连 message 一起判（实测） */
      let subMessages = '';
      try {
        const ej = (await githubRes.json()) as Record<string, unknown>;
        detail = String(ej.message ?? '');
        if (Array.isArray(ej.errors)) {
          const errs = ej.errors as Record<string, unknown>[];
          codes = errs.map((x) => String(x?.code ?? ''));
          subMessages = errs.map((x) => String(x?.message ?? '')).filter(Boolean).join('; ');
        }
      } catch {
        /* 非 JSON 响应体：detail/codes/subMessages 留空，走兜底文案 */
      }
      const message =
        githubRes.status === 401
          ? t('srv.githubCreateBadToken')
          : githubRes.status === 403 || githubRes.status === 404
            ? /rate limit/i.test(detail) ? t('srv.githubCreateRateLimited') : t('srv.githubCreateForbidden')
            : githubRes.status === 422
              ? codes.includes('already_exists') || /already exists/i.test(subMessages)
                ? t('srv.githubCreateExists', { name })
                : t('srv.githubCreateBadName', { msg: subMessages || detail })
              : t('srv.githubCreateFailed', { msg: `HTTP ${githubRes.status}${detail ? ` — ${detail}` : ''}` });
      return { status: 200, body: { ok: false, message } };
    }
    const j = (await githubRes.json()) as Record<string, unknown>;
    const fullName = String(j.full_name ?? name);
    const cloneUrl = String(j.clone_url ?? '') || `https://github.com/${fullName}.git`;
    // 仓库已建成，origin 设置失败不回滚（如实返回 remoteSet=false + 原因，前端提示用户手动处理）
    const sr = await vcs.setRemote?.(cloneUrl);
    const remoteSet = sr?.ok === true;
    // 本地当前分支是否已有提交（HEAD 不存在 = 空仓库；前端决定创建后要不要立即推送）
    const hasCommit = (await run('git', ['rev-parse', '--verify', 'HEAD'], { cwd: repo.root })).code === 0;
    return {
      status: 200,
      body: {
        ok: true,
        fullName,
        htmlUrl: String(j.html_url ?? `https://github.com/${fullName}`),
        cloneUrl,
        hasCommit,
        remoteSet,
        remoteMsg: remoteSet ? '' : (sr?.message ?? ''),
      },
    };
  } catch (e) {
    const err = (e as Error).name === 'AbortError' ? t('srv.githubTimeout', { sec: GITHUB_WRITE_TIMEOUT_MS / 1000 }) : (e as Error).message;
    return { status: 200, body: { ok: false, message: t('srv.githubCreateFailed', { msg: err }) } };
  }
}

/** 删除 origin 指向的 GitHub 仓库（POST /api/github-delete-repo；不可恢复）。
 *  confirm 必须是完整的 owner/repo（前端已让用户手动输入，服务端再校验一次防绕过——confirm 不匹配时**连 GitHub 都不请求**）；
 *  本地 origin 不自动改动（删完顶栏如实显示仓库已不存在，用户按需自行调整远程）。 */
export async function deleteRepo(
  ctx: GithubContext & { body: Record<string, unknown>; signal: AbortSignal },
): Promise<ServiceResult> {
  const { vcs, repo, body, signal } = ctx;
  if (repo.type !== 'git') {
    return { status: 400, body: { ok: false, message: t('srv.githubGitOnly') } };
  }
  const remoteUrl = await remoteOf(vcs);
  const github = parseGithub(remoteUrl);
  if (!github) {
    return { status: 200, body: { ok: false, message: t('srv.githubNotGithub') } };
  }
  const fullName = `${github.owner}/${github.repo}`;
  if (String(body.confirm ?? '').trim() !== fullName) {
    return { status: 200, body: { ok: false, message: t('srv.githubDeleteConfirmMismatch', { name: fullName }) } };
  }
  const token = String(body.token ?? '').trim();
  if (!token) {
    // 删除必须**当场提供 Token**（不复用已保存凭据——防"随便就删"，用户定稿）：
    // 有 delete_repo 权限的任意 Token 均可，权限校验由 GitHub 的响应自然完成
    return { status: 200, body: { ok: false, message: t('srv.githubDeleteNeedToken') } };
  }
  try {
    const githubRes = await githubFetchRaw(`/repos/${github.owner}/${github.repo}`, {
      method: 'DELETE',
      signal,
      token,
    });
    if (!githubRes.ok) {
      // 403：Token 无 delete_repo / 对仓库无管理权（限流单独区分）；404：不存在或无权访问（可能已删）
      let detail = '';
      try {
        detail = String(((await githubRes.json()) as Record<string, unknown>).message ?? '');
      } catch {
        /* 非 JSON 响应体：走兜底文案 */
      }
      const message =
        githubRes.status === 403
          ? /rate limit/i.test(detail) ? t('srv.githubRateLimitedAuth') : t('srv.githubDeleteForbidden')
          : githubRes.status === 404
            ? t('srv.githubDeleteNotFound')
            : t('srv.githubDeleteFailed', { msg: `HTTP ${githubRes.status}${detail ? ` — ${detail}` : ''}` });
      return { status: 200, body: { ok: false, message } };
    }
    // DELETE 成功返回 204（无响应体）
    return { status: 200, body: { ok: true, fullName } };
  } catch (e) {
    const err = (e as Error).name === 'AbortError' ? t('srv.githubTimeout', { sec: GITHUB_WRITE_TIMEOUT_MS / 1000 }) : (e as Error).message;
    return { status: 200, body: { ok: false, message: t('srv.githubDeleteFailed', { msg: err }) } };
  }
}

/** Fork origin 仓库到本人账号（POST /api/github-fork）。
 *  成功后 origin 改指 fork（贡献场景常规姿势，推送/拉取链路全部复用）、原仓库记入 upstream（失败不阻断，仅备注）。
 *  fork 接口幂等：已 fork 过会返回既有的 fork。 */
export async function forkRepo(ctx: GithubContext & { signal: AbortSignal }): Promise<ServiceResult> {
  const { vcs, repo, signal } = ctx;
  if (repo.type !== 'git') {
    return { status: 400, body: { ok: false, message: t('srv.githubGitOnly') } };
  }
  const remoteUrl = await remoteOf(vcs);
  const github = parseGithub(remoteUrl);
  if (!github) {
    return { status: 200, body: { ok: false, message: t('srv.githubNotGithub') } };
  }
  const token = loadConfig().git?.password ?? '';
  if (!token) {
    return { status: 200, body: { ok: false, message: t('srv.githubForkNeedAuth') } };
  }
  try {
    // 先拿登录名：判「自己的仓库」（fork 自己的仓库无意义）并回显
    const meRaw = await githubFetch('/user', signal, token);
    const login = String((meRaw as Record<string, unknown>).login ?? '');
    if (login && login.toLowerCase() === github.owner.toLowerCase()) {
      return { status: 200, body: { ok: false, isOwn: true, message: t('srv.githubForkIsOwn') } };
    }
    const fr = await githubFetchRaw(`/repos/${github.owner}/${github.repo}/forks`, {
      method: 'POST',
      signal,
      token,
      contentType: 'application/json',
      body: '{}',
    });
    if (!fr.ok) {
      // 401 凭据无效；403/404 权限不足/不可访问；其余带 GitHub 原文
      let detail = '';
      try {
        detail = String(((await fr.json()) as Record<string, unknown>).message ?? '');
      } catch {
        /* 非 JSON 响应体：走兜底文案 */
      }
      const message =
        fr.status === 401
          ? t('srv.githubForkBadToken')
          : fr.status === 403 || fr.status === 404
            ? t('srv.githubForkForbidden')
            : t('srv.githubForkFailed', { msg: `HTTP ${fr.status}${detail ? ` — ${detail}` : ''}` });
      return { status: 200, body: { ok: false, message } };
    }
    const fj = (await fr.json()) as Record<string, unknown>;
    const forkFullName = String(fj.full_name ?? `${login}/${github.repo}`);
    const forkUrl = String(fj.clone_url ?? '') || `https://github.com/${forkFullName}.git`;
    // origin 改指 fork（复用现有 setRemote）；原仓库记入 upstream（已存在则 set-url，失败忽略——只是备注）
    const sr = await vcs.setRemote?.(forkUrl);
    const addUp = await run('git', ['-C', repo.root, 'remote', 'add', 'upstream', remoteUrl], { timeoutMs: 10_000 });
    if (addUp.code !== 0) {
      await run('git', ['-C', repo.root, 'remote', 'set-url', 'upstream', remoteUrl], { timeoutMs: 10_000 });
    }
    return {
      status: 200,
      body: {
        ok: true,
        forkFullName,
        forkUrl,
        login,
        defaultBranch: String(fj.default_branch ?? ''),
        upstreamUrl: remoteUrl,
        remoteSet: sr?.ok === true,
        remoteMsg: sr?.ok === true ? '' : (sr?.message ?? ''),
      },
    };
  } catch (e) {
    const err = (e as Error).name === 'AbortError' ? t('srv.githubTimeout', { sec: GITHUB_WRITE_TIMEOUT_MS / 1000 }) : (e as Error).message;
    return { status: 200, body: { ok: false, message: t('srv.githubForkFailed', { msg: err }) } };
  }
}
