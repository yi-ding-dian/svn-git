/** 发版域：应用内「发布新版本」弹窗的预检与执行。
 *
 *  **流程不在这里重写**：升版本号、提交、打 tag、推送、盯 CI 全在 deploy/release.mjs；
 *  这里只做只读预检（当前版本/默认说明/工作区状态）并带参数调用脚本，
 *  避免"脚本一份、界面一份"两套实现分叉。 */
import fs from 'node:fs';
import path from 'node:path';
import { run } from '../../vcs/exec.js';
import { sendJson, readBody, repoInfo, type Ctx } from './util.js';
import { t } from '../../shared/i18n/index.js';

const LEVELS = new Set(['patch', 'minor', 'major']);

async function gitOut(root: string, args: string[]): Promise<string> {
  const r = await run('git', args, { cwd: root, timeoutMs: 15_000 });
  return r.code === 0 ? r.stdout.trim() : '';
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

function bump(cur: string, level: 'patch' | 'minor' | 'major'): string {
  const [a = 0, b = 0, c = 0] = cur.split('.').map((n) => Number(n) || 0);
  if (level === 'major') return `${a + 1}.0.0`;
  if (level === 'minor') return `${a}.${b + 1}.0`;
  return `${a}.${b}.${c + 1}`;
}

export async function handle(ctx: Ctx): Promise<boolean> {
  const { req, res, url } = ctx;
  const p = url.pathname;
  if (p !== '/api/release' && p !== '/api/release-run') return false;

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
    });
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
