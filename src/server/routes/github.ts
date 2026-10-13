/** GitHub 仓库信息（顶栏 ⋯ 菜单「GitHub 仓库信息」；仅 origin 指向 github.com 的 git 项目会调用）：
 *  服务端代问 api.github.com——仓库元信息（描述/star/fork/issues/license/推送时间/topics）
 *  + 语言构成。**匿名**请求（不带任何推送凭据）；匿名配额 60 次/时/IP，故结果内存缓存 30 分钟
 *  （重开秒出、不浪费配额；?force=1 跳过缓存重新拉）。
 *  拿不到时（网络不通 / 限流 / 私有库 404）**降级**：本地统计语言构成顶上
 *  （git ls-files 按扩展名汇总字节数），失败原因随响应回传，界面如实说明。
 *  只读：不发任何写请求。 */

import fs from 'node:fs';
import path from 'node:path';
import { run } from '../../vcs/exec.js';
import { sendJson, vcsOf, type Ctx } from './util.js';
import { t } from '../../shared/i18n/index.js';

const GH_API = 'https://api.github.com';
/** 单次请求超时（元信息与语言构成两接口并发；网络差时尽快降级） */
const FETCH_TIMEOUT_MS = 8_000;
/** 缓存有效期（防匿名限流；仓库热度这类信息也不常变） */
const CACHE_TTL_MS = 30 * 60_000;

/** remote URL → owner/repo（https:// / git@ / ssh:// 形式都认；非 github 或认不出 → null） */
function parseGithub(url: string): { owner: string; repo: string } | null {
  const clean = url.trim().replace(/\/+$/, '').replace(/\.git$/i, '');
  const m = /github\.com[:/]([^/\s]+)\/([^/\s]+)$/i.exec(clean);
  if (!m) return null;
  return { owner: m[1]!, repo: m[2]! };
}

/** GitHub 元信息（只挑界面用到的字段） */
interface GhMeta {
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

interface GhResult {
  ok: boolean;
  /** api = GitHub 官方数据；local = 降级本地统计（此时 error 带原因） */
  source?: 'api' | 'local';
  error?: string;
  remote?: string;
  /** 语言名 → 字节数（api 为 GitHub 官方统计——Linguist 已排除三方库/生成文件；local 为本地统计） */
  languages?: Record<string, number> | null;
  repo?: GhMeta;
}

/** 成功结果缓存（失败/降级不缓存——网络恢复后重开即可拿到官方数据） */
const ghCache = new Map<string, { data: GhResult; at: number }>();

/** 调 GitHub 接口（Accept 用当前推荐的 vnd.github+json）。
 *  ⚠ UA 有讲究：GitHub 的 WAF 对**产品名 token 含 "svn" 的 UA 一律 403**（实测 "svn-git/1.0"、
 *  "svngit/1.0" 全被拦——历史遗留规则，疑为早年 SVN 客户端滥用后遗症；URL 部分含 svn-git 无碍）。
 *  故用中性产品名 + 来源 URL 的形式（GitHub 官方推荐的 UA 格式）。 */
async function ghFetch(pathname: string, signal: AbortSignal): Promise<unknown> {
  const res = await fetch(`${GH_API}${pathname}`, {
    signal,
    headers: {
      'User-Agent': 'vcs-client/1.0 (+https://github.com/yi-ding-dian/svn-git)',
      Accept: 'application/vnd.github+json',
    },
  });
  if (!res.ok) {
    // 404：仓库不存在或私有（匿名看不见）；403/429：多为匿名限流
    if (res.status === 404) throw new Error(t('srv.ghNotFound'));
    if (res.status === 403 || res.status === 429) throw new Error(t('srv.ghRateLimited'));
    throw new Error(`HTTP ${res.status}`);
  }
  return res.json();
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

export async function handle(ctx: Ctx): Promise<boolean> {
  const { req, res, url } = ctx;
  const p = url.pathname;

  if (p === '/api/gh-repo' && req.method === 'GET') {
    const { repo, vcs } = vcsOf();
    if (repo.type !== 'git') {
      sendJson(res, 400, { error: t('srv.ghGitOnly') });
      return true;
    }
    let remoteUrl = '';
    try {
      remoteUrl = (await vcs.remote?.()) ?? '';
    } catch {
      /* 未配置 origin：remoteUrl 留空 → 按"不是 GitHub"处理 */
    }
    const gh = parseGithub(remoteUrl);
    if (!gh) {
      sendJson(res, 200, { ok: false, error: t('srv.ghNotGithub'), remote: remoteUrl });
      return true;
    }
    const key = `${gh.owner}/${gh.repo}`.toLowerCase();
    const force = url.searchParams.get('force') === '1';
    if (!force) {
      const hit = ghCache.get(key);
      if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
        sendJson(res, 200, hit.data);
        return true;
      }
    }
    // 前端断开（关弹窗/切项目）→ 中止两请求；超时同样兜底（不挡降级）
    const ctl = new AbortController();
    const onClose = () => ctl.abort();
    res.on('close', onClose);
    const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
    let data: GhResult;
    try {
      const [metaRaw, langsRaw] = await Promise.all([
        ghFetch(`/repos/${gh.owner}/${gh.repo}`, ctl.signal),
        ghFetch(`/repos/${gh.owner}/${gh.repo}/languages`, ctl.signal),
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
      const err = (e as Error).name === 'AbortError' ? t('srv.ghTimeout', { sec: FETCH_TIMEOUT_MS / 1000 }) : (e as Error).message;
      const langs = await localLanguages(repo.root);
      data = { ok: true, source: 'local', error: err, remote: remoteUrl, languages: langs };
    } finally {
      clearTimeout(timer);
      res.off('close', onClose);
    }
    if (res.destroyed || res.writableEnded) return true; // 前端已断开：响应没处发
    if (data.source === 'api') ghCache.set(key, { data, at: Date.now() });
    sendJson(res, 200, data);
    return true;
  }

  return false;
}
