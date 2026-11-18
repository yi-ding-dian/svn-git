/** GitHub 结果缓存：仓库元信息 / 顶栏身份 / 发布历史。
 *
 *  - 成功结果才缓存（失败/降级不缓存——网络恢复后重开即可拿到官方数据）。
 *  - 身份与发布历史分别用 `clearGithubIdentityCache` / `clearGithubReleasesCache` 主动失效。
 *  - 与 repo-info / releases / identity 只有类型依赖（import type），无运行时循环。 */
import type { GitHubResult } from './repo-info.js';
import type { GitHubReleasesResult } from './releases.js';
import type { GitHubIdentityResult } from './identity.js';

/** 缓存有效期（防匿名限流；仓库热度这类信息也不常变） */
export const CACHE_TTL_MS = 30 * 60_000;
/** 发布历史缓存：发完版要能很快看到，TTL 比仓库元信息短。key 含 auth 标记（换 Token 可能改变可见性）。 */
export const RELEASES_CACHE_TTL_MS = 5 * 60_000;

/** 仓库元信息缓存 */
const githubCache = new Map<string, { data: GitHubResult; at: number }>();

/** 顶栏身份查询缓存：key = `owner/repo::凭据用户名`（同一仓库换账号即失效），TTL 同上。
 *  与 githubCache 分开存：两者响应形状不同，混一个 Map 里类型对不上。 */
const githubIdentityCache = new Map<string, { data: GitHubIdentityResult; at: number }>();

/** 发布历史缓存 */
const githubReleasesCache = new Map<string, { data: GitHubReleasesResult; at: number }>();

export function getRepoCache(key: string): { data: GitHubResult; at: number } | undefined {
  return githubCache.get(key);
}

export function setRepoCache(key: string, data: GitHubResult): void {
  githubCache.set(key, { data, at: Date.now() });
}

export function getIdentityCache(key: string): { data: GitHubIdentityResult; at: number } | undefined {
  return githubIdentityCache.get(key);
}

export function setIdentityCache(key: string, data: GitHubIdentityResult): void {
  githubIdentityCache.set(key, { data, at: Date.now() });
}

export function getReleasesCache(key: string): { data: GitHubReleasesResult; at: number } | undefined {
  return githubReleasesCache.get(key);
}

export function setReleasesCache(key: string, data: GitHubReleasesResult): void {
  githubReleasesCache.set(key, { data, at: Date.now() });
}

/** 清空发布历史缓存——批量清理产物后调用，否则面板还会拿到旧 assets */
export function clearGithubReleasesCache(): void {
  githubReleasesCache.clear();
}

/** 清空身份缓存——凭据保存（/api/git-auth）后调用：**用户名不变只换 Token** 时缓存键不变，
 *  不清会拿旧身份顶最多 30 分钟（典型：换了个权限不同的 Token）。 */
export function clearGithubIdentityCache(): void {
  githubIdentityCache.clear();
}
