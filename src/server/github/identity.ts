/** GitHub 身份与权限：
 *  - GET /api/github-permissions：查 origin 仓库的访问权限（permissions.push、owner===login），
 *    推送失败后判定「无写权限」用（纯读，必须实时，前端据此决定是否引导 Fork）。
 *  - GET /api/github-identity：顶栏「GitHub 身份」徽标（自己的仓库 / 协作者 / 只读 / 无法访问）。
 *    与 permissions 数据同源但**刻意分成两条路由**：本条是常驻显示，**带 30 分钟缓存**。
 *  - GET /api/github-my-repos：本人名下（含私有）仓库列表，供"选中即克隆"；**不缓存**。 */
import { loadConfig } from '../../config.js';
import { parseGithub } from '../../shared/github.js';
import { t } from '../../shared/i18n/index.js';
import {
  FETCH_TIMEOUT_MS,
  githubFetch,
  githubFetchOutcome,
  githubFetchRaw,
  remoteOf,
  type GithubContext,
  type ServiceResult,
} from './client.js';
import { CACHE_TTL_MS, getIdentityCache, setIdentityCache } from './cache.js';
import { localRepoPaths } from './local-repos.js';

/** 顶栏 GitHub 身份（/api/github-identity；只挑徽标用到的字段） */
export interface GitHubIdentityResult {
  /** 查到了仓库数据（false 时看 blocked：404 = 不存在或凭据对它没有权限） */
  ok: boolean;
  /** origin 是否指向 github.com（false 时其余字段无意义，前端不显示任何标识） */
  isGithub: boolean;
  /** 是否配置了 GitHub 凭据；false = 服务端**没有发请求**（匿名读不到 permissions，发了白烧配额） */
  hasAuth: boolean;
  owner?: string;
  repo?: string;
  fullName?: string;
  /** 凭据对应的 GitHub 登录名（ok 时有值） */
  login?: string;
  /** 本人账号下的仓库（login === owner） */
  isOwn?: boolean;
  /** 有无推送（写）权限；null = GitHub 未返回 permissions */
  canPush?: boolean | null;
  private?: boolean;
  defaultBranch?: string;
  /** ok=false 且 hasAuth=true 时：仓库 404（不存在或凭据无权限——GitHub 有意不区分这两者） */
  blocked?: boolean;
  /** 失败原因（非 Git 仓库等 HTTP 400 场景） */
  message?: string;
}

/** 查 origin 仓库的访问权限（GET /api/github-permissions；纯读，不缓存）。
 *  不用正则猜 git 报错文本（不可靠），直接用带凭据的 API：permissions.push + owner===login。 */
export async function getPermissions(ctx: GithubContext & { signal: AbortSignal }): Promise<ServiceResult> {
  const { vcs, repo, signal } = ctx;
  if (repo.type !== 'git') {
    return { status: 400, body: { ok: false, message: t('srv.githubGitOnly') } };
  }
  const remoteUrl = await remoteOf(vcs);
  const github = parseGithub(remoteUrl);
  if (!github) {
    return { status: 200, body: { ok: true, isGithub: false } };
  }
  const base = { isGithub: true, owner: github.owner, repo: github.repo, fullName: `${github.owner}/${github.repo}` };
  const token = loadConfig().git?.password ?? '';
  if (!token) {
    // 没凭据：查不了权限（canPush=null），前端按"不引导 Fork"处理
    return { status: 200, body: { ok: true, ...base, canPush: null, login: '', isOwn: false, defaultBranch: '' } };
  }
  try {
    const [meRaw, repoRaw] = await Promise.all([
      githubFetch('/user', signal, token),
      githubFetch(`/repos/${github.owner}/${github.repo}`, signal, token),
    ]);
    const login = String((meRaw as Record<string, unknown>).login ?? '');
    const rj = repoRaw as Record<string, unknown>;
    const perms = rj.permissions as Record<string, unknown> | undefined;
    return {
      status: 200,
      body: {
        ok: true,
        ...base,
        canPush: typeof perms?.push === 'boolean' ? perms.push : null,
        login,
        isOwn: login !== '' && login.toLowerCase() === github.owner.toLowerCase(),
        defaultBranch: String(rj.default_branch ?? ''),
      },
    };
  } catch (e) {
    const err = (e as Error).name === 'AbortError' ? t('srv.githubTimeout', { sec: FETCH_TIMEOUT_MS / 1000 }) : (e as Error).message;
    // 查询失败：canPush 未知（前端按"不引导"处理），原因随响应回传
    return { status: 200, body: { ok: false, ...base, message: err } };
  }
}

/** 顶栏「GitHub 身份」徽标（GET /api/github-identity；只读，带 30 分钟缓存）。
 *  没配凭据**直接返回、不发请求**：匿名拿不到 permissions，只会白烧 60 次/小时的匿名配额。 */
export async function getIdentity(ctx: GithubContext & { signal: AbortSignal }): Promise<ServiceResult<GitHubIdentityResult>> {
  const { vcs, repo, signal } = ctx;
  if (repo.type !== 'git') {
    return { status: 400, body: { ok: false, isGithub: false, hasAuth: false, message: t('srv.githubGitOnly') } };
  }
  const remoteUrl = await remoteOf(vcs);
  const github = parseGithub(remoteUrl);
  if (!github) {
    return { status: 200, body: { ok: false, isGithub: false, hasAuth: false } };
  }
  const fullName = `${github.owner}/${github.repo}`;
  const base = { isGithub: true, owner: github.owner, repo: github.repo, fullName };
  const cfg = loadConfig();
  const token = cfg.git?.password ?? '';
  if (!token) {
    return { status: 200, body: { ok: false, ...base, hasAuth: false } };
  }
  const cacheKey = `${fullName.toLowerCase()}::${cfg.git?.username ?? ''}`;
  const hit = getIdentityCache(cacheKey);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return { status: 200, body: hit.data };
  }
  const [me, repoRes] = await Promise.all([
    githubFetchOutcome('/user', signal, token),
    githubFetchOutcome(`/repos/${github.owner}/${github.repo}`, signal, token),
  ]);
  if (!repoRes.ok) {
    // 只有「仓库 404」当"无法访问"回给前端；断网/限流/Token 无效一律 blocked=false（顶栏静默不显示）
    return { status: 200, body: { ok: false, ...base, hasAuth: true, blocked: repoRes.notFound } };
  }
  if (!me.ok) {
    return { status: 200, body: { ok: false, ...base, hasAuth: true, blocked: false } };
  }
  const rj = repoRes.data as Record<string, unknown>;
  const perms = rj.permissions as Record<string, unknown> | undefined;
  const login = String((me.data as Record<string, unknown>).login ?? '');
  const data: GitHubIdentityResult = {
    ok: true,
    ...base,
    hasAuth: true,
    login,
    isOwn: login !== '' && login.toLowerCase() === github.owner.toLowerCase(),
    canPush: typeof perms?.push === 'boolean' ? perms.push : null,
    private: rj.private === true,
    defaultBranch: String(rj.default_branch ?? ''),
  };
  // 前端已断开（signal 被 close 中止）时不写缓存，与原实现一致
  if (!signal.aborted) setIdentityCache(cacheKey, data);
  return { status: 200, body: data };
}

/** 「我的 GitHub 仓库」列表（GET /api/github-my-repos）：只取**我名下的**（含私有库）。
 *  **刻意不缓存**：这是"选中即克隆"的入口，刚在本工具里新建/删除的仓库必须立刻反映。
 *  顺带标出"本地已有"（localRepoPaths）——只读最近项目，不扫全盘。 */
export async function getMyRepos(ctx: { page: number; signal: AbortSignal }): Promise<ServiceResult> {
  const { page, signal } = ctx;
  const token = loadConfig().git?.password ?? '';
  if (!token) {
    return { status: 200, body: { ok: false, hasAuth: false, message: t('srv.githubMyReposNoAuth') } };
  }
  try {
    const [ghRes, localPaths] = await Promise.all([
      githubFetchRaw(`/user/repos?affiliation=owner&sort=pushed&direction=desc&per_page=100&page=${page}`, {
        signal,
        token,
      }),
      localRepoPaths(),
    ]);
    if (!ghRes.ok) {
      // 401 凭据无效；403/429 限流（文案与其它 GitHub 功能一致）；其余带 GitHub 原文兜底
      let detail = '';
      try {
        detail = String(((await ghRes.json()) as Record<string, unknown>).message ?? '');
      } catch {
        /* 非 JSON 响应体：走兜底文案 */
      }
      const message =
        ghRes.status === 401
          ? t('srv.githubMyReposBadToken')
          : ghRes.status === 403 || ghRes.status === 429
            ? /rate limit/i.test(detail) ? t('srv.githubRateLimitedAuth') : t('srv.githubMyReposFailed', { msg: detail || `HTTP ${ghRes.status}` })
            : t('srv.githubMyReposFailed', { msg: `HTTP ${ghRes.status}${detail ? ` — ${detail}` : ''}` });
      return { status: 200, body: { ok: false, hasAuth: true, message } };
    }
    const raw = (await ghRes.json()) as Record<string, unknown>[];
    // 分页信号用 Link 头里的 rel="next"（GitHub 标准做法），比"本页满 100 条"准
    const hasMore = /rel="next"/.test(ghRes.headers.get('link') ?? '');
    const repos = raw.map((r) => {
      const fullName = String(r.full_name ?? '');
      return {
        fullName,
        name: String(r.name ?? ''),
        private: r.private === true,
        description: (r.description as string | null) ?? null,
        language: (r.language as string | null) ?? null,
        stars: Number(r.stargazers_count ?? 0),
        // 空仓库没有 pushed_at：退回 updated_at，界面按同一个"最近变动"显示
        pushedAt: (r.pushed_at as string | null) ?? (r.updated_at as string | null) ?? null,
        fork: r.fork === true,
        archived: r.archived === true,
        cloneUrl: String(r.clone_url ?? '') || `https://github.com/${fullName}.git`,
        htmlUrl: String(r.html_url ?? '') || `https://github.com/${fullName}`,
        defaultBranch: String(r.default_branch ?? ''),
        /** 最近项目里已有本地副本时的本地路径；空 = 本地没有 */
        localPath: localPaths.get(fullName.toLowerCase()) ?? '',
      };
    });
    return { status: 200, body: { ok: true, hasAuth: true, repos, hasMore, page } };
  } catch (e) {
    const err = (e as Error).name === 'AbortError' ? t('srv.githubTimeout', { sec: FETCH_TIMEOUT_MS / 1000 }) : (e as Error).message;
    return { status: 200, body: { ok: false, hasAuth: true, message: t('srv.githubMyReposFailed', { msg: err }) } };
  }
}
