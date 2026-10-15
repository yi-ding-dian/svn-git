/** GitHub 集成（顶栏 ⋯ 菜单四条 + 内部查询接口，均只对 git 项目出现）：
 *  - GET /api/github-repo「GitHub 仓库信息」（origin 指向 github.com 时出现）：服务端代问
 *    api.github.com——仓库元信息（描述/star/fork/issues/license/推送时间/topics）+ 语言构成。
 *    **有已存凭据就带上**（自己的私有仓库也能读；没配凭据则匿名，仅公开库）。结果内存缓存 30 分钟
 *    （重开秒出、省配额；?force=1 跳过缓存重新拉）。拿不到时（网络不通 / 限流 / 无权限 404）
 *    **降级**：本地统计语言构成顶上（git ls-files 按扩展名汇总字节数），失败原因随响应回传，界面如实说明。
 *  - POST /api/github-create-repo「GitHub 新建仓库」（origin 尚未指向 github.com 时出现）：用已存的
 *    Git 凭据（config.git 的 GitHub 用户名+Token）调 POST /user/repos 建**空仓库**（auto_init=false，
 *    避免与本地已有提交冲突），成功后自动把 origin 指向它，并回传本地是否已有提交
 *    （前端据此决定创建后要不要立即推送）。
 *  - POST /api/github-delete-repo「GitHub 删除仓库」（与「仓库信息」同条件出现）：删除 origin 指向的
 *    远程仓库（DELETE /repos/{owner}/{repo}，不可恢复——前端要求输入完整仓库名二次确认，服务端再校验
 *    一次防绕过）。本地 origin 不自动改动（删完如实显示仓库已不存在，用户按需自行调整）。
 *    classic Token 需要 delete_repo 权限、fine-grained 需要 Administration 写权限。
 *  - GET /api/github-permissions：查 origin 仓库的访问权限（permissions.push、owner===login）——
 *    推送失败后判定「无写权限」用（不猜 git 报错文本，正则不可靠）；纯读，前端据此决定是否引导 Fork。
 *  - GET /api/github-identity：顶栏「GitHub 身份」徽标用（自己的仓库 / 协作者 / 只读 / 无法访问）。
 *    与 github-permissions 数据同源但**刻意分成两条路由**：那条是推送失败后的 Fork 引导、必须实时；
 *    本条是进项目就查一次的常驻显示，**带 30 分钟缓存**（不缓存会把配额烧光）。没配凭据直接返回、不发请求。
 *  - GET /api/github-my-repos「我的 GitHub 仓库」：只取本人名下（含私有），供顶栏 GitHub 图标打开的列表
 *    选用（选中即克隆）。**不缓存**——刚在本工具里新建/删除的仓库必须立刻反映；顺带标出"本地已有"
 *    （读最近项目的 origin，见 localRepoPaths）。
 *  - POST /api/github-fork「Fork 到自己账号」：把 origin 仓库 fork 到本人账号，origin 改指 fork、
 *    原仓库记入 upstream（贡献开源的主流程，推送/拉取链路全部复用；前端随后按需自动推送）。 */

import fs from 'node:fs';
import path from 'node:path';
import { run } from '../../vcs/exec.js';
import { sendJson, readBody, vcsOf, type Ctx } from './util.js';
import { loadHistory } from './recent.js';
import { t } from '../../shared/i18n/index.js';
import { loadConfig } from '../../config.js';
import { normalizeGhRepoName, parseGithub } from '../../shared/github.js';

const GITHUB_API = 'https://api.github.com';
/** 调用 GitHub API 统一的 User-Agent（读/写共用；⚠ 产品名 token 含 "svn" 会被 WAF 403，见 githubFetch 注释） */
const GITHUB_UA = 'vcs-client/1.0 (+https://github.com/yi-ding-dian/svn-git)';
/** 单次请求超时（元信息与语言构成两接口并发；网络差时尽快降级） */
const FETCH_TIMEOUT_MS = 8_000;
/** 写请求超时（建/删仓库；比元信息读取宽松些。建仓库超时时 GitHub 侧可能已建好，前端重试会提示重名） */
const GITHUB_WRITE_TIMEOUT_MS = 15_000;
/** 缓存有效期（防匿名限流；仓库热度这类信息也不常变） */
const CACHE_TTL_MS = 30 * 60_000;

/** GitHub 元信息（只挑界面用到的字段） */
interface GitHubMeta {
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

interface GitHubResult {
  ok: boolean;
  /** api = GitHub 官方数据；local = 降级本地统计（此时 error 带原因） */
  source?: 'api' | 'local';
  error?: string;
  remote?: string;
  /** 语言名 → 字节数（api 为 GitHub 官方统计——Linguist 已排除三方库/生成文件；local 为本地统计） */
  languages?: Record<string, number> | null;
  repo?: GitHubMeta;
}

/** 顶栏 GitHub 身份（/api/github-identity；只挑徽标用到的字段） */
interface GitHubIdentityResult {
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
}

/** 成功结果缓存（失败/降级不缓存——网络恢复后重开即可拿到官方数据） */
const githubCache = new Map<string, { data: GitHubResult; at: number }>();

/** 顶栏身份查询缓存：key = `owner/repo::凭据用户名`（同一仓库换账号即失效），TTL 同上。
 *  与 githubCache 分开存：两者响应形状不同，混一个 Map 里类型对不上。 */
const githubIdentityCache = new Map<string, { data: GitHubIdentityResult; at: number }>();

/** 清空身份缓存——凭据保存（/api/git-auth）后调用：**用户名不变只换 Token** 时缓存键不变，
 *  不清会拿旧身份顶最多 30 分钟（典型：换了个权限不同的 Token）。 */
export function clearGithubIdentityCache(): void {
  githubIdentityCache.clear();
}

/** 调 GitHub 接口（读；Accept 用当前推荐的 vnd.github+json）。
 *  ⚠ UA 有讲究：GitHub 的 WAF 对**产品名 token 含 "svn" 的 UA 一律 403**（实测 "svn-git/1.0"、
 *  "svngit/1.0" 全被拦——历史遗留规则，疑为早年 SVN 客户端滥用后遗症；URL 部分含 svn-git 无碍）。
 *  故用中性产品名 + 来源 URL 的形式（GitHub 官方推荐的 UA 格式）。
 *  token 可选：有凭据就带 Authorization（私有仓库也能读）；404/限流的文案按匿名/带凭据区分。 */
async function githubFetch(pathname: string, signal: AbortSignal, token = ''): Promise<unknown> {
  const res = await fetch(`${GITHUB_API}${pathname}`, {
    signal,
    headers: {
      'User-Agent': GITHUB_UA,
      Accept: 'application/vnd.github+json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!res.ok) {
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
async function githubFetchOutcome(
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

/** 本地已有的仓库：最近项目（≤20 条）各问一次 origin → `owner/repo`（小写）→ 本地路径。
 *  并行问（每条一个独立 git 进程，串行会明显拖慢弹窗）；目录已删 / 不是 git 都算"没有"，静默跳过。
 *  同一仓库有多个本地副本时取**最近打开的那个**（按 lastOpened 排序后取首个命中——不依赖 history 文件本身的顺序）。
 *  为什么用 `git remote get-url` 而不是直接读 .git/config：config 有 worktree / includeIf / 引号值等花样，
 *  交给 git 自己解析最稳（实测 200 个仓库也就毫秒级，这里最多 20 个）。 */
async function localRepoPaths(): Promise<Map<string, string>> {
  const items = [...loadHistory()].sort((a, b) => (b.lastOpened ?? 0) - (a.lastOpened ?? 0));
  const urls = await Promise.all(
    items.map((h) =>
      run('git', ['-C', h.path, 'remote', 'get-url', 'origin'], { timeoutMs: 5_000 }).then((r) => (r.code === 0 ? r.stdout.trim() : '')),
    ),
  );
  const out = new Map<string, string>();
  items.forEach((h, i) => {
    const github = parseGithub(urls[i] ?? '');
    if (!github) return;
    const key = `${github.owner}/${github.repo}`.toLowerCase();
    if (!out.has(key)) out.set(key, h.path);
  });
  return out;
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
    const res = await fetch(`${GITHUB_API}/repos/${github.owner}/${github.repo}`, {
      signal: ctl.signal,
      headers: { 'User-Agent': GITHUB_UA, Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return 0;
    const j = (await res.json()) as Record<string, unknown>;
    return Number(j.size ?? 0) * 1024; // GitHub 的 size 单位是 KB
  } catch {
    return 0;
  } finally {
    clearTimeout(timer);
  }
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

  if (p === '/api/github-repo' && req.method === 'GET') {
    const { repo, vcs } = vcsOf();
    if (repo.type !== 'git') {
      sendJson(res, 400, { error: t('srv.githubGitOnly') });
      return true;
    }
    let remoteUrl = '';
    try {
      remoteUrl = (await vcs.remote?.()) ?? '';
    } catch {
      /* 未配置 origin：remoteUrl 留空 → 按"不是 GitHub"处理 */
    }
    const github = parseGithub(remoteUrl);
    if (!github) {
      sendJson(res, 200, { ok: false, error: t('srv.githubNotGithub'), remote: remoteUrl });
      return true;
    }
    const key = `${github.owner}/${github.repo}`.toLowerCase();
    const force = url.searchParams.get('force') === '1';
    if (!force) {
      const hit = githubCache.get(key);
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
    // 有已存凭据就带上：自己账号下的私有仓库也能读（没配凭据保持匿名，仅公开库）
    const token = loadConfig().git?.password ?? '';
    let data: GitHubResult;
    try {
      const [metaRaw, langsRaw] = await Promise.all([
        githubFetch(`/repos/${github.owner}/${github.repo}`, ctl.signal, token),
        githubFetch(`/repos/${github.owner}/${github.repo}/languages`, ctl.signal, token),
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
    } finally {
      clearTimeout(timer);
      res.off('close', onClose);
    }
    if (res.destroyed || res.writableEnded) return true; // 前端已断开：响应没处发
    if (data.source === 'api') githubCache.set(key, { data, at: Date.now() });
    sendJson(res, 200, data);
    return true;
  }

  if (p === '/api/github-create-repo' && req.method === 'POST') {
    // 新建 GitHub 仓库并设为 origin。凭据从 config.git 读（弹窗内联填写时前端会先存到 git-auth 再调这里）；
    // 仓库名**必须本地先规范化**：GitHub 对非法名不报错、会把「测试 仓库!!」静默建成名为 '-' 的仓库（实测），
    // 其余交给 GitHub 判（422 的 message/errors 映射成准确文案）
    const { vcs, repo } = vcsOf();
    if (repo.type !== 'git') {
      sendJson(res, 400, { ok: false, message: t('srv.githubGitOnly') });
      return true;
    }
    // 前端断开（关弹窗）后响应没处发；用 send 统一挡住（fetch 期间断开是常态）
    const send = (data: unknown) => {
      if (!res.destroyed && !res.writableEnded) sendJson(res, 200, data);
    };
    const body = await readBody(req);
    const raw = String(body.name ?? '').trim();
    if (!raw) {
      send({ ok: false, message: t('srv.githubCreateNoName') });
      return true;
    }
    const name = normalizeGhRepoName(raw);
    if (!name) {
      send({ ok: false, message: t('srv.githubCreateNameInvalid') });
      return true;
    }
    const token = loadConfig().git?.password ?? '';
    if (!token) {
      send({ ok: false, message: t('srv.githubCreateNoAuth') });
      return true;
    }
    const ctl = new AbortController();
    const onClose = () => ctl.abort();
    res.on('close', onClose);
    const timer = setTimeout(() => ctl.abort(), GITHUB_WRITE_TIMEOUT_MS);
    try {
      const githubRes = await fetch(`${GITHUB_API}/user/repos`, {
        method: 'POST',
        signal: ctl.signal,
        headers: {
          'User-Agent': GITHUB_UA,
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
        send({ ok: false, message });
        return true;
      }
      const j = (await githubRes.json()) as Record<string, unknown>;
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
      const err = (e as Error).name === 'AbortError' ? t('srv.githubTimeout', { sec: GITHUB_WRITE_TIMEOUT_MS / 1000 }) : (e as Error).message;
      send({ ok: false, message: t('srv.githubCreateFailed', { msg: err }) });
    } finally {
      clearTimeout(timer);
      res.off('close', onClose);
    }
    return true;
  }

  if (p === '/api/github-delete-repo' && req.method === 'POST') {
    // 删除 origin 指向的 GitHub 仓库（不可恢复）。confirm 必须是完整的 owner/repo（前端已让用户手动输入，
    // 服务端再校验一次防绕过——confirm 不匹配时**连 GitHub 都不请求**）；
    // 本地 origin 不自动改动（删完顶栏如实显示仓库已不存在，用户按需自行调整远程）
    const { vcs, repo } = vcsOf();
    if (repo.type !== 'git') {
      sendJson(res, 400, { ok: false, message: t('srv.githubGitOnly') });
      return true;
    }
    const send = (data: unknown) => {
      if (!res.destroyed && !res.writableEnded) sendJson(res, 200, data);
    };
    const body = await readBody(req);
    let remoteUrl = '';
    try {
      remoteUrl = (await vcs.remote?.()) ?? '';
    } catch {
      /* 未配置 origin：按"不是 GitHub"处理 */
    }
    const github = parseGithub(remoteUrl);
    if (!github) {
      send({ ok: false, message: t('srv.githubNotGithub') });
      return true;
    }
    const fullName = `${github.owner}/${github.repo}`;
    if (String(body.confirm ?? '').trim() !== fullName) {
      send({ ok: false, message: t('srv.githubDeleteConfirmMismatch', { name: fullName }) });
      return true;
    }
    const token = loadConfig().git?.password ?? '';
    if (!token) {
      send({ ok: false, message: t('srv.githubDeleteNoAuth') });
      return true;
    }
    const ctl = new AbortController();
    const onClose = () => ctl.abort();
    res.on('close', onClose);
    const timer = setTimeout(() => ctl.abort(), GITHUB_WRITE_TIMEOUT_MS);
    try {
      const githubRes = await fetch(`${GITHUB_API}/repos/${github.owner}/${github.repo}`, {
        method: 'DELETE',
        signal: ctl.signal,
        headers: {
          'User-Agent': GITHUB_UA,
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${token}`,
        },
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
        send({ ok: false, message });
        return true;
      }
      // DELETE 成功返回 204（无响应体）
      send({ ok: true, fullName });
    } catch (e) {
      const err = (e as Error).name === 'AbortError' ? t('srv.githubTimeout', { sec: GITHUB_WRITE_TIMEOUT_MS / 1000 }) : (e as Error).message;
      send({ ok: false, message: t('srv.githubDeleteFailed', { msg: err }) });
    } finally {
      clearTimeout(timer);
      res.off('close', onClose);
    }
    return true;
  }

  if (p === '/api/github-permissions' && req.method === 'GET') {
    // 查 origin 仓库的访问权限（推送失败后的「无写权限」判定用；纯读）。
    // 不用正则猜 git 报错文本（不可靠），直接用带凭据的 API：permissions.push + owner===login。
    const { vcs, repo } = vcsOf();
    if (repo.type !== 'git') {
      sendJson(res, 400, { ok: false, message: t('srv.githubGitOnly') });
      return true;
    }
    let remoteUrl = '';
    try {
      remoteUrl = (await vcs.remote?.()) ?? '';
    } catch {
      /* 未配置 origin：按"不是 GitHub"处理 */
    }
    const github = parseGithub(remoteUrl);
    if (!github) {
      sendJson(res, 200, { ok: true, isGithub: false });
      return true;
    }
    const base = { isGithub: true, owner: github.owner, repo: github.repo, fullName: `${github.owner}/${github.repo}` };
    const token = loadConfig().git?.password ?? '';
    if (!token) {
      // 没凭据：查不了权限（canPush=null），前端按"不引导 Fork"处理
      sendJson(res, 200, { ok: true, ...base, canPush: null, login: '', isOwn: false, defaultBranch: '' });
      return true;
    }
    const ctl = new AbortController();
    const onClose = () => ctl.abort();
    res.on('close', onClose);
    const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
    try {
      const [meRaw, repoRaw] = await Promise.all([
        githubFetch('/user', ctl.signal, token),
        githubFetch(`/repos/${github.owner}/${github.repo}`, ctl.signal, token),
      ]);
      const login = String((meRaw as Record<string, unknown>).login ?? '');
      const rj = repoRaw as Record<string, unknown>;
      const perms = rj.permissions as Record<string, unknown> | undefined;
      if (res.destroyed || res.writableEnded) return true;
      sendJson(res, 200, {
        ok: true,
        ...base,
        canPush: typeof perms?.push === 'boolean' ? perms.push : null,
        login,
        isOwn: login !== '' && login.toLowerCase() === github.owner.toLowerCase(),
        defaultBranch: String(rj.default_branch ?? ''),
      });
    } catch (e) {
      const err = (e as Error).name === 'AbortError' ? t('srv.githubTimeout', { sec: FETCH_TIMEOUT_MS / 1000 }) : (e as Error).message;
      // 查询失败：canPush 未知（前端按"不引导"处理），原因随响应回传
      if (!res.destroyed && !res.writableEnded) sendJson(res, 200, { ok: false, ...base, message: err });
    } finally {
      clearTimeout(timer);
      res.off('close', onClose);
    }
    return true;
  }

  if (p === '/api/github-identity' && req.method === 'GET') {
    // 顶栏「GitHub 身份」徽标（只读）：并发 /user + /repos/{o}/{r} 判出身份（自己的仓库 / 协作者 / 只读）。
    // 与 github-permissions 分开是**故意的**（见文件头）：那条必须实时，本条带缓存。
    // 没配凭据**直接返回、不发请求**：匿名拿不到 permissions，只会白烧 60 次/小时的匿名配额。
    const { vcs, repo } = vcsOf();
    if (repo.type !== 'git') {
      sendJson(res, 400, { ok: false, isGithub: false, hasAuth: false, message: t('srv.githubGitOnly') });
      return true;
    }
    let remoteUrl = '';
    try {
      remoteUrl = (await vcs.remote?.()) ?? '';
    } catch {
      /* 未配置 origin：按"不是 GitHub"处理 */
    }
    const github = parseGithub(remoteUrl);
    if (!github) {
      sendJson(res, 200, { ok: false, isGithub: false, hasAuth: false });
      return true;
    }
    const fullName = `${github.owner}/${github.repo}`;
    const base = { isGithub: true, owner: github.owner, repo: github.repo, fullName };
    const cfg = loadConfig();
    const token = cfg.git?.password ?? '';
    if (!token) {
      sendJson(res, 200, { ok: false, ...base, hasAuth: false });
      return true;
    }
    const cacheKey = `${fullName.toLowerCase()}::${cfg.git?.username ?? ''}`;
    const hit = githubIdentityCache.get(cacheKey);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
      sendJson(res, 200, hit.data);
      return true;
    }
    const ctl = new AbortController();
    const onClose = () => ctl.abort();
    res.on('close', onClose);
    const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
    try {
      const [me, repoRes] = await Promise.all([
        githubFetchOutcome('/user', ctl.signal, token),
        githubFetchOutcome(`/repos/${github.owner}/${github.repo}`, ctl.signal, token),
      ]);
      if (res.destroyed || res.writableEnded) return true; // 前端已断开：响应没处发
      if (!repoRes.ok) {
        // 只有「仓库 404」当"无法访问"回给前端；断网/限流/Token 无效一律 blocked=false（顶栏静默不显示）
        sendJson(res, 200, { ok: false, ...base, hasAuth: true, blocked: repoRes.notFound });
        return true;
      }
      if (!me.ok) {
        sendJson(res, 200, { ok: false, ...base, hasAuth: true, blocked: false });
        return true;
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
      githubIdentityCache.set(cacheKey, { data, at: Date.now() });
      sendJson(res, 200, data);
    } finally {
      clearTimeout(timer);
      res.off('close', onClose);
    }
    return true;
  }

  if (p === '/api/github-my-repos' && req.method === 'GET') {
    // 「我的 GitHub 仓库」列表（顶栏 GitHub 图标入口）：GET /user/repos 只取**我名下的**（含私有库）。
    // **刻意不缓存**：这是"选中即克隆"的入口，刚在本工具里新建/删除的仓库必须立刻反映（1 次请求，配额无压力）。
    // 顺带标出"本地已有"（localRepoPaths）——只读最近项目，不扫全盘。
    const token = loadConfig().git?.password ?? '';
    if (!token) {
      sendJson(res, 200, { ok: false, hasAuth: false, message: t('srv.githubMyReposNoAuth') });
      return true;
    }
    const page = Math.max(1, Number(url.searchParams.get('page') ?? '1') || 1);
    const ctl = new AbortController();
    const onClose = () => ctl.abort();
    res.on('close', onClose);
    const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
    try {
      const [ghRes, localPaths] = await Promise.all([
        fetch(`${GITHUB_API}/user/repos?affiliation=owner&sort=pushed&direction=desc&per_page=100&page=${page}`, {
          signal: ctl.signal,
          headers: { 'User-Agent': GITHUB_UA, Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}` },
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
        if (!res.destroyed && !res.writableEnded) sendJson(res, 200, { ok: false, hasAuth: true, message });
        return true;
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
      if (res.destroyed || res.writableEnded) return true; // 前端已断开：响应没处发
      sendJson(res, 200, { ok: true, hasAuth: true, repos, hasMore, page });
    } catch (e) {
      const err = (e as Error).name === 'AbortError' ? t('srv.githubTimeout', { sec: FETCH_TIMEOUT_MS / 1000 }) : (e as Error).message;
      if (!res.destroyed && !res.writableEnded) sendJson(res, 200, { ok: false, hasAuth: true, message: t('srv.githubMyReposFailed', { msg: err }) });
    } finally {
      clearTimeout(timer);
      res.off('close', onClose);
    }
    return true;
  }

  if (p === '/api/github-fork' && req.method === 'POST') {
    // Fork origin 指向的 GitHub 仓库到自己的账号（给开源项目贡献用），成功后：
    // origin 改指 fork（贡献场景常规姿势，推送/拉取链路全部复用）、原仓库记入 upstream（失败不阻断，仅备注）。
    // 前端随后按需自动走推送流程。fork 接口幂等：已 fork 过会返回既有的 fork
    const { vcs, repo } = vcsOf();
    if (repo.type !== 'git') {
      sendJson(res, 400, { ok: false, message: t('srv.githubGitOnly') });
      return true;
    }
    const send = (data: unknown) => {
      if (!res.destroyed && !res.writableEnded) sendJson(res, 200, data);
    };
    let remoteUrl = '';
    try {
      remoteUrl = (await vcs.remote?.()) ?? '';
    } catch {
      /* 未配置 origin：按"不是 GitHub"处理 */
    }
    const github = parseGithub(remoteUrl);
    if (!github) {
      send({ ok: false, message: t('srv.githubNotGithub') });
      return true;
    }
    const token = loadConfig().git?.password ?? '';
    if (!token) {
      send({ ok: false, message: t('srv.githubForkNeedAuth') });
      return true;
    }
    const ctl = new AbortController();
    const onClose = () => ctl.abort();
    res.on('close', onClose);
    const timer = setTimeout(() => ctl.abort(), GITHUB_WRITE_TIMEOUT_MS);
    try {
      // 先拿登录名：判「自己的仓库」（fork 自己的仓库无意义）并回显
      const meRaw = await githubFetch('/user', ctl.signal, token);
      const login = String((meRaw as Record<string, unknown>).login ?? '');
      if (login && login.toLowerCase() === github.owner.toLowerCase()) {
        send({ ok: false, isOwn: true, message: t('srv.githubForkIsOwn') });
        return true;
      }
      const fr = await fetch(`${GITHUB_API}/repos/${github.owner}/${github.repo}/forks`, {
        method: 'POST',
        signal: ctl.signal,
        headers: {
          'User-Agent': GITHUB_UA,
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
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
        send({ ok: false, message });
        return true;
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
      send({
        ok: true,
        forkFullName,
        forkUrl,
        login,
        defaultBranch: String(fj.default_branch ?? ''),
        upstreamUrl: remoteUrl,
        remoteSet: sr?.ok === true,
        remoteMsg: sr?.ok === true ? '' : (sr?.message ?? ''),
      });
    } catch (e) {
      const err = (e as Error).name === 'AbortError' ? t('srv.githubTimeout', { sec: GITHUB_WRITE_TIMEOUT_MS / 1000 }) : (e as Error).message;
      send({ ok: false, message: t('srv.githubForkFailed', { msg: err }) });
    } finally {
      clearTimeout(timer);
      res.off('close', onClose);
    }
    return true;
  }

  return false;
}
