/** 仓库元信息与语言统计：
 *  - GET /api/github-repo 的实现：GitHub 官方元信息（描述/star/fork/issues/license/推送时间/topics）
 *    + 语言构成；失败降级为本地 `git ls-files` 统计（失败原因随响应回传）。
 *  - githubRepoBytes：克隆进度条的分母（server/index.ts 用），失败一律 0，绝不挡克隆。
 *  - localLanguages：降级路径的本地字节统计。 */
import fs from 'node:fs';
import path from 'node:path';
import { run } from '../../vcs/exec.js';
import { loadConfig } from '../../config.js';
import { parseGithub } from '../../shared/github.js';
import { t } from '../../shared/i18n/index.js';
import {
  FETCH_TIMEOUT_MS,
  githubFetch,
  githubFetchRaw,
  remoteOf,
  type GithubContext,
  type ServiceResult,
} from './client.js';
import { CACHE_TTL_MS, getRepoCache, setRepoCache } from './cache.js';

/** GitHub 元信息（只挑界面用到的字段） */
export interface GitHubMeta {
  fullName: string;
  description: string | null;
  homepage: string | null;
  stars: number;
  forks: number;
  watchers: number;
  issues: number;
  license: string | null;
  pushedAt: string | null;
  topics: string[];
  defaultBranch: string;
  archived: boolean;
  private: boolean;
  htmlUrl: string;
}

export interface GitHubResult {
  ok: boolean;
  /** api = GitHub 官方数据；local = 降级本地统计（此时 error 带原因） */
  source?: 'api' | 'local';
  error?: string;
  remote?: string;
  /** 语言名 → 字节数（api 为 GitHub 官方统计——Linguist 已排除三方库/生成文件；local 为本地统计） */
  languages?: Record<string, number> | null;
  repo?: GitHubMeta;
}

/** 扩展名 → 语言（降级统计的子集映射；GitHub 官方统计更全更准，这只是离线兜底） */
const EXT_LANG: Record<string, string> = {
  ts: 'TypeScript', tsx: 'TypeScript', mts: 'TypeScript', cts: 'TypeScript',
  js: 'JavaScript', mjs: 'JavaScript', cjs: 'JavaScript', jsx: 'JavaScript',
  java: 'Java', kt: 'Kotlin', kts: 'Kotlin', groovy: 'Groovy', scala: 'Scala',
  cs: 'C#', c: 'C', h: 'C', cpp: 'C++', cc: 'C++', cxx: 'C++', hpp: 'C++', hh: 'C++',
  go: 'Go', rs: 'Rust', swift: 'Swift', m: 'Objective-C', mm: 'Objective-C',
  py: 'Python', rb: 'Ruby', php: 'PHP', pl: 'Perl', lua: 'Lua', r: 'R', dart: 'Dart',
  vue: 'Vue', svelte: 'Svelte',
  sh: 'Shell', bash: 'Shell', zsh: 'Shell', fish: 'Shell',
  bat: 'Batchfile', cmd: 'Batchfile', ps1: 'PowerShell',
  html: 'HTML', htm: 'HTML', css: 'CSS', scss: 'SCSS', sass: 'Sass', less: 'Less',
  md: 'Markdown', markdown: 'Markdown', rst: 'reStructuredText', tex: 'TeX',
  json: 'JSON', jsonc: 'JSON', xml: 'XML', xsl: 'XSLT', yml: 'YAML', yaml: 'YAML',
  toml: 'TOML', ini: 'INI', sql: 'SQL', graphql: 'GraphQL', proto: 'Protocol Buffer',
  ex: 'Elixir', exs: 'Elixir', erl: 'Erlang', hs: 'Haskell', clj: 'Clojure', cljs: 'Clojure',
  jl: 'Julia', nim: 'Nim', zig: 'Zig', asm: 'Assembly', s: 'Assembly',
  ipynb: 'Jupyter Notebook',
};
/** 无扩展名/特殊文件名 → 语言 */
const NAME_LANG: Record<string, string> = {
  dockerfile: 'Dockerfile', makefile: 'Makefile', 'cmakelists.txt': 'CMake',
};
/** 不计入统计的锁定文件（体积大且非源码，会让 JSON/YAML 占比虚高） */
const SKIP_FILES = new Set(['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'composer.lock', 'cargo.lock', 'poetry.lock', 'gemfile.lock']);

/** 本地语言统计（降级路径）：枚举已跟踪文件，按扩展名映射语言、累加字节数。
 *  上万文件毫秒级~秒级（statSync 逐个取大小），只在 GitHub 接口不可用时跑。 */
async function localLanguages(root: string): Promise<Record<string, number> | null> {
  const r = await run('git', ['ls-files', '-z'], { cwd: root, timeoutMs: 20_000 });
  if (r.code !== 0) return null;
  const out: Record<string, number> = {};
  for (const rel of r.stdout.split('\0')) {
    if (!rel) continue;
    const base = rel.slice(rel.lastIndexOf('/') + 1).toLowerCase();
    if (SKIP_FILES.has(base)) continue;
    const dot = base.lastIndexOf('.');
    const lang = EXT_LANG[dot > 0 ? base.slice(dot + 1) : ''] ?? NAME_LANG[base];
    if (!lang) continue;
    try {
      out[lang] = (out[lang] ?? 0) + fs.statSync(path.join(root, rel)).size;
    } catch {
      /* 文件缺失（如未拉取的 LFS 大文件）：跳过 */
    }
  }
  return out;
}

/** 仓库元信息 + 语言构成（GET /api/github-repo）。成功结果缓存 30 分钟；失败降级本地统计。
 *  signal 由路由接入客户端断开与超时（超时后走 catch 降级，不挡响应）。 */
export async function getRepoInfo(
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
  const key = `${github.owner}/${github.repo}`.toLowerCase();
  if (!force) {
    const hit = getRepoCache(key);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
      return { status: 200, body: hit.data };
    }
  }
  // 有已存凭据就带上：自己账号下的私有仓库也能读（没配凭据保持匿名，仅公开库）
  const token = loadConfig().git?.password ?? '';
  let data: GitHubResult;
  try {
    const [metaRaw, langsRaw] = await Promise.all([
      githubFetch(`/repos/${github.owner}/${github.repo}`, signal, token),
      githubFetch(`/repos/${github.owner}/${github.repo}/languages`, signal, token),
    ]);
    const m = metaRaw as Record<string, unknown>;
    const license = (m.license as Record<string, unknown> | null)?.spdx_id;
    data = {
      ok: true,
      source: 'api',
      remote: remoteUrl,
      repo: {
        fullName: String(m.full_name ?? key),
        description: (m.description as string | null) ?? null,
        homepage: (m.homepage as string | null) || null,
        stars: Number(m.stargazers_count ?? 0),
        forks: Number(m.forks_count ?? 0),
        // watchers：GitHub 语义里 subscribers_count 才是"关注数"（watchers_count 其实是 star 的别名）
        watchers: Number(m.subscribers_count ?? 0),
        issues: Number(m.open_issues_count ?? 0),
        license: typeof license === 'string' && license !== 'NOASSERTION' ? license : null,
        pushedAt: (m.pushed_at as string | null) ?? null,
        topics: Array.isArray(m.topics) ? (m.topics as string[]) : [],
        defaultBranch: String(m.default_branch ?? ''),
        archived: m.archived === true,
        private: m.private === true,
        htmlUrl: String(m.html_url ?? `https://github.com/${key}`),
      },
      languages: (langsRaw ?? {}) as Record<string, number>,
    };
  } catch (e) {
    // 降级：本地统计 + 原因（网络不通 / 限流 / 私有库都走这里）
    const err = (e as Error).name === 'AbortError' ? t('srv.githubTimeout', { sec: FETCH_TIMEOUT_MS / 1000 }) : (e as Error).message;
    const langs = await localLanguages(repo.root);
    data = { ok: true, source: 'local', error: err, remote: remoteUrl, languages: langs };
  }
  // 前端已断开（signal 被 close 中止）时不缓存，与原实现一致；降级结果不缓存
  if (!signal.aborted && data.source === 'api') setRepoCache(key, data);
  return { status: 200, body: data };
}

/** URL 指向的 GitHub 仓库的**总大小（字节）**——获取进度条的分母（server/index.ts 的克隆用）。
 *  失败一律返回 0（没配凭据 / 不是 GitHub / 网络不通），界面降级成"只显示已下载与速度"，
 *  绝不因为它挡住克隆本身：这个请求与克隆并行发，慢/失败都不影响。 */
export async function githubRepoBytes(url: string): Promise<number> {
  const github = parseGithub(url);
  const token = loadConfig().git?.password ?? '';
  if (!github || !token) return 0;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await githubFetchRaw(`/repos/${github.owner}/${github.repo}`, { signal: ctl.signal, token });
    if (!res.ok) return 0;
    const j = (await res.json()) as Record<string, unknown>;
    return Number(j.size ?? 0) * 1024; // GitHub 的 size 单位是 KB
  } catch {
    return 0;
  } finally {
    clearTimeout(timer);
  }
}
