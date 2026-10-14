/** GitHub 集成（顶栏 ⋯ 菜单两条，均只对 git 项目出现）：
 *  - GET /api/gh-repo「GitHub 仓库信息」（origin 指向 github.com 时出现）：服务端**匿名**代问
 *    api.github.com——仓库元信息（描述/star/fork/issues/license/推送时间/topics）+ 语言构成。
 *    匿名配额 60 次/时/IP，故结果内存缓存 30 分钟（重开秒出、不浪费配额；?force=1 跳过缓存重新拉）。
 *    拿不到时（网络不通 / 限流 / 私有库 404）**降级**：本地统计语言构成顶上
 *    （git ls-files 按扩展名汇总字节数），失败原因随响应回传，界面如实说明。
 *  - POST /api/gh-create-repo「GitHub 新建仓库」（origin 尚未指向 github.com 时出现）：用已存的
 *    Git 凭据（config.git 的 GitHub 用户名+Token）调 POST /user/repos 建**空仓库**（auto_init=false，
 *    避免与本地已有提交冲突），成功后自动把 origin 指向它，并回传本地是否已有提交
 *    （前端据此决定创建后要不要立即推送）。 */

import fs from 'node:fs';
import path from 'node:path';
import { run } from '../../vcs/exec.js';
import { sendJson, readBody, vcsOf, type Ctx } from './util.js';
import { t } from '../../shared/i18n/index.js';
import { loadConfig } from '../../config.js';
import { normalizeGhRepoName } from '../../shared/github.js';

const GH_API = 'https://api.github.com';
/** 调用 GitHub API 统一的 User-Agent（读/写共用；⚠ 产品名 token 含 "svn" 会被 WAF 403，见 ghFetch 注释） */
const GH_UA = 'vcs-client/1.0 (+https://github.com/yi-ding-dian/svn-git)';
/** 单次请求超时（元信息与语言构成两接口并发；网络差时尽快降级） */
const FETCH_TIMEOUT_MS = 8_000;
/** 建仓库请求超时（写请求，比元信息读取宽松些；超时后 GitHub 侧可能已建好，前端重试会提示重名） */
const CREATE_TIMEOUT_MS = 15_000;
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
      'User-Agent': GH_UA,
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

  if (p === '/api/gh-create-repo' && req.method === 'POST') {
    // 新建 GitHub 仓库并设为 origin。凭据从 config.git 读（弹窗内联填写时前端会先存到 git-auth 再调这里）；
    // 仓库名**必须本地先规范化**：GitHub 对非法名不报错、会把「测试 仓库!!」静默建成名为 '-' 的仓库（实测），
    // 其余交给 GitHub 判（422 的 message/errors 映射成准确文案）
    const { vcs, repo } = vcsOf();
    if (repo.type !== 'git') {
      sendJson(res, 400, { ok: false, message: t('srv.ghGitOnly') });
      return true;
    }
    // 前端断开（关弹窗）后响应没处发；用 send 统一挡住（fetch 期间断开是常态）
    const send = (data: unknown) => {
      if (!res.destroyed && !res.writableEnded) sendJson(res, 200, data);
    };
    const body = await readBody(req);
    const raw = String(body.name ?? '').trim();
    if (!raw) {
      send({ ok: false, message: t('srv.ghCreateNoName') });
      return true;
    }
    const name = normalizeGhRepoName(raw);
    if (!name) {
      send({ ok: false, message: t('srv.ghCreateNameInvalid') });
      return true;
    }
    const token = loadConfig().git?.password ?? '';
    if (!token) {
      send({ ok: false, message: t('srv.ghCreateNoAuth') });
      return true;
    }
    const ctl = new AbortController();
    const onClose = () => ctl.abort();
    res.on('close', onClose);
    const timer = setTimeout(() => ctl.abort(), CREATE_TIMEOUT_MS);
    try {
      const ghRes = await fetch(`${GH_API}/user/repos`, {
        method: 'POST',
        signal: ctl.signal,
        headers: {
          'User-Agent': GH_UA,
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name,
          description: String(body.description ?? '').trim() || undefined,
          private: body.private !== false,
          auto_init: false,
        }),
      });
      if (!ghRes.ok) {
        // 错误映射：401 凭据无效；403/404 权限不足（限流单独区分）；422 名字问题（重名/不合法）
        let detail = '';
        let codes: string[] = [];
        /** errors[].message 汇总：GitHub 重名返回 code='custom' + message='name already exists on this account'，
         *  单看 code 认不出重名，必须连 message 一起判（实测） */
        let subMessages = '';
        try {
          const ej = (await ghRes.json()) as Record<string, unknown>;
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
          ghRes.status === 401
            ? t('srv.ghCreateBadToken')
            : ghRes.status === 403 || ghRes.status === 404
              ? /rate limit/i.test(detail) ? t('srv.ghCreateRateLimited') : t('srv.ghCreateForbidden')
              : ghRes.status === 422
                ? codes.includes('already_exists') || /already exists/i.test(subMessages)
                  ? t('srv.ghCreateExists', { name })
                  : t('srv.ghCreateBadName', { msg: subMessages || detail })
                : t('srv.ghCreateFailed', { msg: `HTTP ${ghRes.status}${detail ? ` — ${detail}` : ''}` });
        send({ ok: false, message });
        return true;
      }
      const j = (await ghRes.json()) as Record<string, unknown>;
      const fullName = String(j.full_name ?? name);
      const cloneUrl = String(j.clone_url ?? '') || `https://github.com/${fullName}.git`;
      // 仓库已建成，origin 设置失败不回滚（如实返回 remoteSet=false + 原因，前端提示用户手动处理）
      const sr = await vcs.setRemote?.(cloneUrl);
      const remoteSet = sr?.ok === true;
      // 本地当前分支是否已有提交（HEAD 不存在 = 空仓库；前端决定创建后要不要立即推送）
      const hasCommit = (await run('git', ['rev-parse', '--verify', 'HEAD'], { cwd: repo.root })).code === 0;
      send({
        ok: true,
        fullName,
        htmlUrl: String(j.html_url ?? `https://github.com/${fullName}`),
        cloneUrl,
        hasCommit,
        remoteSet,
        remoteMsg: remoteSet ? '' : (sr?.message ?? ''),
      });
    } catch (e) {
      const err = (e as Error).name === 'AbortError' ? t('srv.ghTimeout', { sec: CREATE_TIMEOUT_MS / 1000 }) : (e as Error).message;
      send({ ok: false, message: t('srv.ghCreateFailed', { msg: err }) });
    } finally {
      clearTimeout(timer);
      res.off('close', onClose);
    }
    return true;
  }

  return false;
}
