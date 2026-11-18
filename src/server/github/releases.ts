/** Releases / CI 状态 / 产物：发布历史、批量清理预览与执行。
 *
 *  - GET  /api/github-releases：origin 仓库的 Release + 未发布 tag + 每个 tag 的 Actions 运行状态。
 *  - GET  /api/github-release-cleanup：保留最近 keep 个 Release，列出更早版本里可删除的产物。
 *  - POST /api/github-release-cleanup：删除旧 Release 的 assets（Release 说明与 tag 保留）。
 *  缓存与失效逻辑见 cache.ts；HTTP 层只负责传 signal（超时/断开）。 */
import { loadConfig } from '../../config.js';
import { parseGithub } from '../../shared/github.js';
import { t } from '../../shared/i18n/index.js';
import { readReleaseArtifacts, resolveDockerImages, type ReleaseDockerImage } from '../release-artifacts.js';
import {
  FETCH_TIMEOUT_MS,
  githubFetch,
  githubFetchRaw,
  remoteOf,
  type GithubContext,
  type ServiceResult,
} from './client.js';
import {
  RELEASES_CACHE_TTL_MS,
  clearGithubReleasesCache,
  getReleasesCache,
  setReleasesCache,
} from './cache.js';

/** 发布历史（/api/github-releases）：只挑界面用到的字段 */
export interface GitHubReleaseAsset {
  /** 资产 ID：批量清理时按它删除 */
  id: number;
  name: string;
  size: number;
  downloadCount: number;
  /** GitHub 的 browser_download_url：点「下载」用系统浏览器打开 */
  downloadUrl: string;
  createdAt: string | null;
}

export interface GitHubRelease {
  tagName: string;
  name: string;
  publishedAt: string | null;
  /** Release 页面地址（点版本标题打开） */
  htmlUrl: string;
  /** 更新说明（Markdown 原文，前端按纯文本折叠显示） */
  body: string;
  prerelease: boolean;
  draft: boolean;
  assets: GitHubReleaseAsset[];
  zipballUrl: string;
  tarballUrl: string;
  /** 该 tag 的 CI 状态（Docker 镜像没有 Release assets，靠它显示进度） */
  ci?: GitHubTagCi;
}

export interface GitHubReleasesResult {
  ok: boolean;
  error?: string;
  /** 认证类失败（401：Token 无效/过期）：界面给出「重新生成 Token」入口 */
  authError?: boolean;
  remote?: string;
  /** 仓库的 Releases 页面（「在 GitHub 打开」用） */
  releasesUrl?: string;
  /** origin 的 owner/repo（前端拼 GHCR 包地址用） */
  owner?: string;
  repo?: string;
  releases?: GitHubRelease[];
  /** 没有对应 Release 的 tag（早期版本只打了 tag、没写发布说明）：补在列表后面，历史版本不丢 */
  tags?: GitHubTag[];
  /** 项目声明为 Docker 发布时的镜像清单；空数组/undefined 表示安装包型项目 */
  dockerImages?: ReleaseDockerImage[];
}

export interface GitHubTag {
  name: string;
  sha: string;
  /** 打开该提交的 GitHub 页面 */
  commitUrl: string;
  zipballUrl: string;
  tarballUrl: string;
  /** 该 tag 的 CI 状态：没有 Release 时用来区分「构建中 / 构建失败 / 仅标签」 */
  ci?: GitHubTagCi;
}

export interface GitHubTagCi {
  /** queued | in_progress | completed */
  status: string;
  /** completed 时：success / failure / cancelled … */
  conclusion: string | null;
  htmlUrl: string;
  createdAt: string;
  /** Actions run id：失败时用来查失败步骤名 */
  runId?: number;
  /** 失败步骤名（如「安装依赖」）；日志正文需要登录，API 只能拿到步骤名 */
  failedStep?: string;
}

/** 批量清理预览：按发布时间倒序取 Release（含资产 id），供前端展示与删除使用 */
async function releasesWithAssets(
  owner: string,
  repoName: string,
  token: string,
  signal: AbortSignal,
): Promise<{ tagName: string; publishedAt: string; assets: { id: number; name: string; size: number }[] }[]> {
  const raw = await githubFetch(`/repos/${owner}/${repoName}/releases?per_page=100`, signal, token);
  const list = Array.isArray(raw) ? (raw as Record<string, unknown>[]) : [];
  return list
    .map((o) => ({
      tagName: String(o.tag_name ?? ''),
      publishedAt: String(o.published_at ?? ''),
      assets: (Array.isArray(o.assets) ? (o.assets as Record<string, unknown>[]) : []).map((a) => ({
        id: Number(a.id ?? 0),
        name: String(a.name ?? ''),
        size: Number(a.size ?? 0),
      })),
    }))
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
}

/** 发布历史 + CI 状态（GET /api/github-releases）。
 *  有构建中的 tag 时不缓存：否则刷新后还会拿 5 分钟前的"构建中/仅标签"状态。 */
export async function getReleases(
  ctx: GithubContext & { force: boolean; signal: AbortSignal },
): Promise<ServiceResult> {
  const { vcs, repo, force, signal } = ctx;
  if (repo.type !== 'git') {
    return { status: 400, body: { error: t('srv.githubGitOnly') } };
  }
  const remoteUrl = await remoteOf(vcs);
  const github = parseGithub(remoteUrl);
  if (!github) {
    return { status: 200, body: { ok: false, error: t('srv.githubNotGithub'), remote: remoteUrl } };
  }
  const token = loadConfig().git?.password ?? '';
  // key 带 auth 标记：换 Token 后可见性可能变化，不和匿名结果混用
  const key = `${github.owner}/${github.repo}`.toLowerCase() + (token ? '::auth' : '::anon');
  if (!force) {
    const hit = getReleasesCache(key);
    if (hit && Date.now() - hit.at < RELEASES_CACHE_TTL_MS) {
      return { status: 200, body: hit.data };
    }
  }
  let data: GitHubReleasesResult;
  try {
    // tags / releases / Actions 运行记录并行：后两者失败不影响主列表
    const [raw, tagsRaw, runsRaw] = await Promise.all([
      githubFetch(`/repos/${github.owner}/${github.repo}/releases?per_page=10`, signal, token),
      githubFetch(`/repos/${github.owner}/${github.repo}/tags?per_page=30`, signal, token).catch(() => []),
      githubFetch(`/repos/${github.owner}/${github.repo}/actions/runs?per_page=30`, signal, token).catch(() => []),
    ]);
    const list = Array.isArray(raw) ? (raw as Record<string, unknown>[]) : [];
    const releasedTags = new Set(list.map((o) => String(o.tag_name ?? '')));
    const tagList = Array.isArray(tagsRaw) ? (tagsRaw as Record<string, unknown>[]) : [];
    // tag → 最近一次 CI 运行（同一 tag 重跑时保留 createdAt 最新的那条）
    const ciByTag = new Map<string, GitHubTagCi>();
    const runList = Array.isArray(runsRaw)
      ? []
      : (((runsRaw as Record<string, unknown>)?.workflow_runs as Record<string, unknown>[] | undefined) ?? []);
    for (const r of runList) {
      const tag = String(r.head_branch ?? '');
      const status = String(r.status ?? '');
      if (!tag || !status) continue;
      const createdAt = String(r.created_at ?? '');
      const prev = ciByTag.get(tag);
      if (!prev || createdAt > prev.createdAt) {
        ciByTag.set(tag, {
          status,
          conclusion: (r.conclusion as string | null) ?? null,
          htmlUrl: String(r.html_url ?? ''),
          createdAt,
          runId: Number(r.id ?? 0) || undefined,
        });
      }
    }
    // 失败运行补查失败步骤名：/jobs 匿名可读；具体报错正文要登录才能看，这里只拿步骤名。
    // 只查最新的几个失败运行，避免多打 GitHub API（每个 run 一次请求）。
    const failed = [...ciByTag.values()]
      .filter((c) => c.runId && c.conclusion && c.conclusion !== 'success')
      .slice(0, 5);
    await Promise.all(
      failed.map(async (c) => {
        try {
          const jobs = (await githubFetch(
            `/repos/${github.owner}/${github.repo}/actions/runs/${c.runId}/jobs`,
            signal,
            token,
          )) as Record<string, unknown>;
          const jobList = Array.isArray(jobs?.jobs) ? (jobs.jobs as Record<string, unknown>[]) : [];
          for (const j of jobList) {
            const steps = Array.isArray(j.steps) ? (j.steps as Record<string, unknown>[]) : [];
            const bad = steps.find((s) => {
              const concl = String(s.conclusion ?? '');
              return concl !== '' && concl !== 'success' && concl !== 'skipped';
            });
            if (bad) {
              c.failedStep = String(bad.name ?? '');
              break;
            }
          }
        } catch {
          /* 查询失败：只显示「构建失败」，不影响发布历史 */
        }
      }),
    );
    const artifacts = readReleaseArtifacts(repo.root);
    data = {
      ok: true,
      remote: remoteUrl,
      releasesUrl: `https://github.com/${github.owner}/${github.repo}/releases`,
      owner: github.owner,
      repo: github.repo,
      // Docker 项目：发布历史里直接列出该版本的镜像地址（版本号由前端拼）
      dockerImages:
        artifacts.kind === 'docker'
          ? resolveDockerImages(artifacts.images, github.owner, github.repo)
          : [],
      tags: tagList
        .filter((t) => !releasedTags.has(String(t.name ?? '')))
        .map((t) => {
          const sha = String((t.commit as Record<string, unknown> | undefined)?.sha ?? '');
          return {
            name: String(t.name ?? ''),
            sha,
            commitUrl: `https://github.com/${github.owner}/${github.repo}/commit/${sha}`,
            zipballUrl: String(t.zipball_url ?? ''),
            tarballUrl: String(t.tarball_url ?? ''),
            ci: ciByTag.get(String(t.name ?? '')),
          };
        }),
      releases: list.map((o) => {
        const assets = Array.isArray(o.assets) ? (o.assets as Record<string, unknown>[]) : [];
        return {
          tagName: String(o.tag_name ?? ''),
          name: String(o.name ?? o.tag_name ?? ''),
          publishedAt: (o.published_at as string | null) ?? null,
          htmlUrl: String(o.html_url ?? ''),
          body: String(o.body ?? ''),
          prerelease: o.prerelease === true,
          draft: o.draft === true,
          assets: assets.map((a) => ({
            id: Number(a.id ?? 0),
            name: String(a.name ?? ''),
            size: Number(a.size ?? 0),
            downloadCount: Number(a.download_count ?? 0),
            downloadUrl: String(a.browser_download_url ?? ''),
            createdAt: (a.created_at as string | null) ?? null,
          })),
          zipballUrl: String(o.zipball_url ?? ''),
          tarballUrl: String(o.tarball_url ?? ''),
          ci: ciByTag.get(String(o.tag_name ?? '')),
        };
      }),
    };
  } catch (e) {
    // 超时/断网/404/限流：githubFetch 已把常见状态转成中文文案
    const err = (e as Error).name === 'AbortError' ? t('srv.githubTimeout', { sec: FETCH_TIMEOUT_MS / 1000 }) : (e as Error).message;
    const auth = (e as Error & { auth?: boolean }).auth === true;
    data = { ok: false, error: err, remote: remoteUrl, ...(auth ? { authError: true } : {}) };
  }
  // 有构建中的 tag 时不缓存：否则刷新后还会拿 5 分钟前的"构建中/仅标签"状态
  const hasActiveCi =
    data.ok &&
    (data.tags ?? []).some((x) => x.ci && (x.ci.status === 'queued' || x.ci.status === 'in_progress'));
  if (!signal.aborted && data.ok && !hasActiveCi) setReleasesCache(key, data);
  return { status: 200, body: data };
}

/** 批量清理预览（GET /api/github-release-cleanup）：需要 Token（匿名读不到写权限）。 */
export async function previewReleaseCleanup(
  ctx: GithubContext & { keep: number; signal: AbortSignal },
): Promise<ServiceResult> {
  const { vcs, repo, keep: rawKeep, signal } = ctx;
  if (repo.type !== 'git') {
    return { status: 400, body: { error: t('srv.githubGitOnly') } };
  }
  const remoteUrl = await remoteOf(vcs);
  const github = parseGithub(remoteUrl);
  if (!github) {
    return { status: 200, body: { ok: false, error: t('srv.githubNotGithub') } };
  }
  const token = loadConfig().git?.password ?? '';
  if (!token) {
    // 批量清理需要写权限，匿名读不到
    return { status: 400, body: { error: t('srv.githubCleanupNeedToken') } };
  }
  const keep = Math.min(Math.max(rawKeep || 3, 1), 50);
  try {
    const list = await releasesWithAssets(github.owner, github.repo, token, signal);
    const toClean = list.slice(keep).filter((r) => r.assets.length > 0);
    const totalAssets = toClean.reduce((n, r) => n + r.assets.length, 0);
    const totalSize = toClean.reduce((n, r) => n + r.assets.reduce((s, a) => s + a.size, 0), 0);
    return { status: 200, body: { ok: true, keep, releases: toClean, totalAssets, totalSize } };
  } catch (e) {
    const err = (e as Error).name === 'AbortError' ? t('srv.githubTimeout', { sec: FETCH_TIMEOUT_MS / 1000 }) : (e as Error).message;
    return { status: 200, body: { ok: false, error: err } };
  }
}

/** 执行批量清理（POST /api/github-release-cleanup）：只删旧 Release 的 assets，说明和 tag 保留。 */
export async function cleanupReleaseAssets(
  ctx: GithubContext & { keep: number; signal: AbortSignal },
): Promise<ServiceResult> {
  const { vcs, repo, keep: rawKeep, signal } = ctx;
  if (repo.type !== 'git') {
    return { status: 400, body: { error: t('srv.githubGitOnly') } };
  }
  const remoteUrl = await remoteOf(vcs);
  const github = parseGithub(remoteUrl);
  if (!github) {
    return { status: 200, body: { ok: false, error: t('srv.githubNotGithub') } };
  }
  const token = loadConfig().git?.password ?? '';
  if (!token) {
    return { status: 400, body: { error: t('srv.githubCleanupNeedToken') } };
  }
  const keep = Math.min(Math.max(rawKeep || 3, 1), 50);
  try {
    const list = await releasesWithAssets(github.owner, github.repo, token, signal);
    const toClean = list.slice(keep).filter((r) => r.assets.length > 0);
    let deleted = 0;
    const failed: { name: string; error: string }[] = [];
    for (const rel of toClean) {
      for (const a of rel.assets) {
        try {
          const res = await githubFetchRaw(`/repos/${github.owner}/${github.repo}/releases/assets/${a.id}`, {
            method: 'DELETE',
            token,
            signal,
          });
          if (res.ok || res.status === 204) deleted++;
          else failed.push({ name: `${rel.tagName}/${a.name}`, error: `HTTP ${res.status}` });
        } catch (e) {
          failed.push({ name: `${rel.tagName}/${a.name}`, error: (e as Error).message });
        }
      }
    }
    clearGithubReleasesCache();
    return { status: 200, body: { ok: failed.length === 0, deleted, failed } };
  } catch (e) {
    const err = (e as Error).name === 'AbortError' ? t('srv.githubTimeout', { sec: 120 }) : (e as Error).message;
    return { status: 200, body: { ok: false, error: err, deleted: 0, failed: [] } };
  }
}
