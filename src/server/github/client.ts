/** GitHub HTTP 客户端基础层：API base、User-Agent、超时、错误映射与 fetch 封装。
 *
 *  ⚠ UA 有讲究：GitHub 的 WAF 对**产品名 token 含 "svn" 的 UA 一律 403**（实测 "svn-git/1.0"、
 *  "svngit/1.0" 全被拦——历史遗留规则，疑为早年 SVN 客户端滥用后遗症；URL 部分含 svn-git 无碍）。
 *  故用中性产品名 + 来源 URL 的形式（GitHub 官方推荐的 UA 格式，见 shared/github.ts）。
 */
import type { RepoInfo, Vcs } from '../../vcs/index.js';
import { GITHUB_UA } from '../../shared/github.js';
import { t } from '../../shared/i18n/index.js';

export const GITHUB_API = 'https://api.github.com';
/** 单次请求超时（元信息与语言构成两接口并发；网络差时尽快降级） */
export const FETCH_TIMEOUT_MS = 8_000;
/** 写请求超时（建/删仓库；比元信息读取宽松些。建仓库超时时 GitHub 侧可能已建好，前端重试会提示重名） */
export const GITHUB_WRITE_TIMEOUT_MS = 15_000;

/** 服务层统一返回：状态码 + JSON 响应体，由薄路由原样发送（端点状态码语义不变）。 */
export interface ServiceResult<T = unknown> {
  status: number;
  body: T;
}

/** 当前仓库上下文（服务层入参）。 */
export interface GithubContext {
  vcs: Vcs;
  repo: RepoInfo;
}

/** 401：Token 无效/过期/被撤销。带上标记，调用方据此在界面上给"重新生成 Token"的入口 */
export function badTokenError(): Error {
  const e = new Error(t('srv.githubBadToken')) as Error & { auth?: boolean };
  e.auth = true;
  return e;
}

/** 取 origin URL；未配置/读取失败 → 空串（调用方统一按"不是 GitHub"处理）。 */
export async function remoteOf(vcs: Vcs): Promise<string> {
  try {
    return (await vcs.remote?.()) ?? '';
  } catch {
    return '';
  }
}

/** 调 GitHub 接口（读；Accept 用当前推荐的 vnd.github+json）。
 *  token 可选：有凭据就带 Authorization（私有仓库也能读）；404/限流的文案按匿名/带凭据区分。 */
export async function githubFetch(pathname: string, signal: AbortSignal, token = ''): Promise<unknown> {
  const res = await fetch(`${GITHUB_API}${pathname}`, {
    signal,
    headers: {
      'User-Agent': GITHUB_UA,
      Accept: 'application/vnd.github+json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!res.ok) {
    // 401：凭据无效/过期（GitHub 明确的 Bad credentials）
    if (res.status === 401) throw badTokenError();
    // 404：仓库不存在（带凭据）或私有不可见（匿名）；403/429：多为限流（两种身份文案不同）
    if (res.status === 404) throw new Error(token ? t('srv.githubNotFound') : t('srv.githubNotFoundAnon'));
    if (res.status === 403 || res.status === 429) throw new Error(token ? t('srv.githubRateLimitedAuth') : t('srv.githubRateLimited'));
    throw new Error(`HTTP ${res.status}`);
  }
  return res.json();
}

/** 调 GitHub 读接口，**保留失败原因**（顶栏徽标要区分"404 无法访问"与"断网/限流/Token 无效"：
 *  前者显示徽标，后者静默降级）。与 githubFetch 分开是因为那边把错误转成了给弹窗看的文案，
 *  这边要的是可判定的结构；token 必传（调用点已确认配了凭据）。 */
export async function githubFetchOutcome(
  pathname: string,
  signal: AbortSignal,
  token: string,
): Promise<{ ok: true; data: unknown } | { ok: false; notFound: boolean }> {
  try {
    const res = await fetch(`${GITHUB_API}${pathname}`, {
      signal,
      headers: { 'User-Agent': GITHUB_UA, Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}` },
    });
    if (res.ok) return { ok: true, data: await res.json() };
    return { ok: false, notFound: res.status === 404 };
  } catch {
    // 断网 / 超时 / 前端断开导致的中止
    return { ok: false, notFound: false };
  }
}

/** 需要读取状态码/响应头或发写请求时的底层封装（统一 API base 与请求头）。
 *  返回值与原生 fetch 一致，由调用方自行判状态、取 body。 */
export async function githubFetchRaw(
  pathname: string,
  init: {
    signal: AbortSignal;
    token?: string;
    method?: string;
    body?: string;
    contentType?: string;
  },
): Promise<Response> {
  const headers: Record<string, string> = {
    'User-Agent': GITHUB_UA,
    Accept: 'application/vnd.github+json',
  };
  if (init.token) headers.Authorization = `Bearer ${init.token}`;
  if (init.contentType) headers['Content-Type'] = init.contentType;
  return fetch(`${GITHUB_API}${pathname}`, {
    method: init.method,
    signal: init.signal,
    headers,
    ...(init.body !== undefined ? { body: init.body } : {}),
  });
}
