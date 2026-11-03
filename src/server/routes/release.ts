/** 发版域：应用内「发布新版本」弹窗的预检与执行。
 *
 *  **流程不在这里重写**：升版本号、提交、打 tag、推送、盯 CI 全在 deploy/release.mjs；
 *  这里只做只读预检（当前版本/默认说明/工作区状态）并带参数调用脚本，
 *  避免"脚本一份、界面一份"两套实现分叉。 */
import fs from 'node:fs';
import path from 'node:path';
import { run } from '../../vcs/exec.js';
import { sendJson, readBody, repoInfo, type Ctx } from './util.js';
import { loadConfig } from '../../config.js';
import { t } from '../../shared/i18n/index.js';

const LEVELS = new Set(['patch', 'minor', 'major']);
const GITHUB_API = 'https://api.github.com';
/** 与 github.ts 同款中性 UA（含 "svn" 的产品名会被 GitHub WAF 403） */
const GITHUB_UA = 'vcs-client/1.0 (+https://github.com/yi-ding-dian/svn-git)';

async function gitOut(root: string, args: string[]): Promise<string> {
  const r = await run('git', args, { cwd: root, timeoutMs: 15_000 });
  return r.code === 0 ? r.stdout.trim() : '';
}

/** 发布相关文件是否已经在 origin/main 上：CI 工作流、根 package.json、发版脚本缺一不可。
 *  缺了推 tag 也不会触发构建，界面要提前提示"只能打标签"。 */
async function checkCiReady(root: string): Promise<{ ready: boolean; missing: string[]; hasWorkflow: boolean }> {
  let workflows: string[] = [];
  try {
    workflows = fs
      .readdirSync(path.join(root, '.github', 'workflows'))
      .filter((f) => /\.ya?ml$/i.test(f))
      .map((f) => `.github/workflows/${f}`);
  } catch {
    /* 没有 workflows 目录 */
  }
  const required = ['package.json', 'deploy/release.mjs', ...workflows];
  const remote = await gitOut(root, ['ls-tree', '-r', '--name-only', 'origin/main']);
  const remoteSet = new Set(remote.split('\n').map((s) => s.trim()).filter(Boolean));
  const missing = required.filter((f) => !remoteSet.has(f));
  return { ready: workflows.length > 0 && missing.length === 0, missing, hasWorkflow: workflows.length > 0 };
}

/** 默认发布说明：上个 tag 以来最新一条提交主题（与 release.mjs 的 defaultReleaseNote 同逻辑） */
async function defaultNote(root: string, tag: string): Promise<string> {
  const last = await gitOut(root, ['describe', '--tags', '--abbrev=0']);
  const args = ['log', '-1', '--format=%s'];
  if (last) args.push(`${last}..HEAD`);
  return ((await gitOut(root, args)) || `${tag} 发布`).slice(0, 60);
}

/** 上个 tag 以来的提交主题（发布前确认"这次带什么"，最多 8 条） */
async function commitsSinceLastTag(root: string): Promise<string[]> {
  const last = await gitOut(root, ['describe', '--tags', '--abbrev=0']);
  const out = await gitOut(root, ['log', '--format=%s', '-n', '8', last ? `${last}..HEAD` : 'HEAD']);
  return out
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** 项目自定义的 CI 产物清单（deploy/release-artifacts.json，可选）：
 *  { "items": ["项目-${version}-linux.tar.gz", ...] }，${version} 由前端按当前选择的版本替换。 */
function readArtifacts(root: string): string[] {
  try {
    const raw = fs.readFileSync(path.join(root, 'deploy', 'release-artifacts.json'), 'utf8');
    const data = JSON.parse(raw) as { items?: unknown };
    if (!Array.isArray(data.items)) return [];
    return data.items
      .filter((x): x is string => typeof x === 'string')
      .slice(0, 50)
      .map((x) => x.slice(0, 200));
  } catch {
    return [];
  }
}

function bump(cur: string, level: 'patch' | 'minor' | 'major'): string {
  const [a = 0, b = 0, c = 0] = cur.split('.').map((n) => Number(n) || 0);
  if (level === 'major') return `${a + 1}.0.0`;
  if (level === 'minor') return `${a}.${b + 1}.0`;
  return `${a}.${b}.${c + 1}`;
}

/** 查某个 tag 对应的 CI 运行状态（供发布后台任务轮询） */
async function releaseStatus(
  root: string,
  tag: string,
): Promise<{
  ok: boolean;
  error?: string;
  status: 'pending' | 'queued' | 'in_progress' | 'completed';
  conclusion: string | null;
  htmlUrl: string;
  artifacts: { name: string; size: number }[];
}> {
  const remote = await gitOut(root, ['remote', 'get-url', 'origin']);
  const m = /github\.com[:/]([^/]+)\/(.+?)(?:\.git)?$/.exec(remote);
  if (!m) return { ok: false, error: t('srv.releaseNoGithub'), status: 'pending', conclusion: null, htmlUrl: '', artifacts: [] };
  const token = loadConfig().git?.password ?? '';
  const headers: Record<string, string> = {
    'User-Agent': GITHUB_UA,
    Accept: 'application/vnd.github+json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 8_000);
  try {
    const res = await fetch(`${GITHUB_API}/repos/${m[1]}/${m[2]}/actions/runs?per_page=30`, { headers, signal: ctl.signal });
    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status}`, status: 'pending', conclusion: null, htmlUrl: '', artifacts: [] };
    }
    const data = (await res.json()) as { workflow_runs?: Record<string, unknown>[] };
    const runInfo = (data.workflow_runs ?? []).find((r) => r.head_branch === tag);
    if (!runInfo) {
      // 还没排队：Actions 页面正常，几秒内会出现运行记录
      return {
        ok: true,
        status: 'pending',
        conclusion: null,
        htmlUrl: `https://github.com/${m[1]}/${m[2]}/actions`,
        artifacts: [],
      };
    }
    const status = String(runInfo.status ?? 'pending') as 'queued' | 'in_progress' | 'completed';
    const conclusion = (runInfo.conclusion as string | null) ?? null;
    const htmlUrl = String(runInfo.html_url ?? '');
    let artifacts: { name: string; size: number }[] = [];
    if (status === 'completed' && conclusion === 'success') {
      const ar = await fetch(`${GITHUB_API}/repos/${m[1]}/${m[2]}/actions/runs/${runInfo.id}/artifacts`, {
        headers,
        signal: ctl.signal,
      });
      if (ar.ok) {
        const ad = (await ar.json()) as { artifacts?: Record<string, unknown>[] };
        artifacts = (ad.artifacts ?? []).map((a) => ({
          name: String(a.name ?? ''),
          size: Number(a.size_in_bytes ?? 0),
        }));
      }
    }
    return { ok: true, status, conclusion, htmlUrl, artifacts };
  } catch (e) {
    return {
      ok: false,
      error: (e as Error).name === 'AbortError' ? 'timeout' : (e as Error).message,
      status: 'pending',
      conclusion: null,
      htmlUrl: '',
      artifacts: [],
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function handle(ctx: Ctx): Promise<boolean> {
  const { req, res, url } = ctx;
  const p = url.pathname;
  if (p !== '/api/release' && p !== '/api/release-run' && p !== '/api/release-status') return false;

  const repo = repoInfo();
  if (!repo || repo.type !== 'git') {
    sendJson(res, 400, { error: t('srv.releaseGitOnly') });
    return true;
  }
  const script = path.join(repo.root, 'deploy', 'release.mjs');
  if (!fs.existsSync(script)) {
    sendJson(res, 400, { error: t('srv.releaseUnsupported') });
    return true;
  }

  if (p === '/api/release' && req.method === 'GET') {
    let version = '';
    try {
      version = String(JSON.parse(fs.readFileSync(path.join(repo.root, 'package.json'), 'utf8')).version ?? '');
    } catch {
      /* 没有 package.json：版本留空，前端会提示 */
    }
    const branch = await gitOut(repo.root, ['rev-parse', '--abbrev-ref', 'HEAD']);
    // 只看已跟踪文件（未跟踪文件不影响 npm version，见 release.mjs 的同款判断）
    const dirty = (await gitOut(repo.root, ['status', '--porcelain', '--untracked-files=no'])) !== '';
    const ci = await checkCiReady(repo.root);
    const next = {
      patch: bump(version, 'patch'),
      minor: bump(version, 'minor'),
      major: bump(version, 'major'),
    };
    sendJson(res, 200, {
      ok: true,
      version,
      branch,
      dirty,
      note: await defaultNote(repo.root, `v${next.patch}`),
      next,
      // 本次发布包含的提交（上个 tag 之后），发版前确认用
      commits: await commitsSinceLastTag(repo.root),
      // 项目自定义的产物清单（没有配置时为空，前端显示通用提示）
      artifacts: readArtifacts(repo.root),
      // CI 文件是否已推送到 origin/main：没推送只能打标签，不会出包
      ciReady: ci.ready,
      ciMissing: ci.missing,
      ciHasWorkflow: ci.hasWorkflow,
    });
    return true;
  }

  if (p === '/api/release-status' && req.method === 'GET') {
    const tag = String(url.searchParams.get('tag') ?? '').trim();
    if (!/^v[0-9]/.test(tag) || tag.length > 100) {
      sendJson(res, 400, { error: t('srv.releaseBadTag') });
      return true;
    }
    sendJson(res, 200, await releaseStatus(repo.root, tag));
    return true;
  }

  if (p === '/api/release-run' && req.method === 'POST') {
    const body = await readBody(req);
    const level = String(body.level ?? '');
    const note = String(body.note ?? '').trim();
    if (!LEVELS.has(level)) {
      sendJson(res, 400, { error: t('srv.releaseBadLevel') });
      return true;
    }
    if (!note || note.length > 200 || /[\r\n]/.test(note)) {
      sendJson(res, 400, { error: t('srv.releaseBadNote') });
      return true;
    }
    // 非交互调用脚本：--yes 跳过确认，--no-watch 不等 CI（弹窗不阻塞十分钟）
    const r = await run(
      process.execPath,
      [script, `--${level}`, '--yes', '--note', note, '--no-watch'],
      { cwd: repo.root, timeoutMs: 300_000, decode: 'auto' },
    );
    if (r.code !== 0) {
      // 失败把脚本输出原样带回，界面直接展示（脚本里已有中文原因）
      sendJson(res, 200, { ok: false, message: (r.stderr || r.stdout).trim(), timedOut: r.timedOut === true });
      return true;
    }
    sendJson(res, 200, { ok: true, message: r.stdout.trim() });
    return true;
  }

  return false;
}
