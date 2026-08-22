/** 冲突防护域端点：conflicts / conflict-detail / text-diff / resolve-conflict / preflight / blame */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { run } from '../vcs/exec.js';
import { sendJson, readBody, vcsOf, inRepoRoot, isBinaryFile, readTextFile, isAuthError, authErrorOf } from './util.js';
import { diffChangedLines } from '../vcs/diff-lines.js';
import type { VcsResult } from '../vcs/index.js';
import type { Ctx } from './util.js';

export async function handle(ctx: Ctx): Promise<boolean> {
  const { req, res, url } = ctx;
  const p = url.pathname;

      if (p === '/api/conflicts') {
        // 冲突文件 + 三方内容（git: :1/:2/:3；svn: .mine/.r 文件）
        const { vcs, repo } = vcsOf();
        const items = (await vcs.status()) as { code: string; path: string }[];
        const conflictPaths = items.filter((i) => i.code === 'C').map((i) => i.path);
        const read = (p: string) => (fs.existsSync(p) ? readTextFile(p) : '');
        const out: { path: string; ours: string; theirs: string; base: string; work: string; binary: boolean }[] = [];
        for (const rel of conflictPaths) {
          const abs = path.join(repo.root, rel);
          // 二进制文件（Word/PDF/图片等）：不读内容（utf8 读取是乱码，对比无意义），界面显示提示块
          const binary = isBinaryFile(rel);
          let ours = '';
          let theirs = '';
          let base = '';
          let work = binary ? '' : read(abs);
          if (!binary) {
            if (repo.type === 'git') {
              const show = async (stage: string): Promise<string> => {
                const r = await run('git', ['show', `:${stage}:${rel}`], { cwd: repo.root, timeoutMs: 30_000 });
                return r.code === 0 ? r.stdout : '';
              };
              base = await show('1');
              ours = await show('2');
              theirs = await show('3');
            } else {
              // svn 冲突文件：xxx.mine（本地）、xxx.r<新>（对方）、xxx.r<旧>（基础）
              const dir = path.dirname(abs);
              const basename = path.basename(abs);
              let rnums: number[] = [];
              try {
                rnums = fs
                  .readdirSync(dir)
                  .filter((n) => n.startsWith(basename + '.r'))
                  .map((n) => Number(n.slice(basename.length + 2)))
                  .filter((n) => !Number.isNaN(n))
                  .sort((a, b) => a - b);
              } catch {
                /* ignore */
              }
              ours = read(abs + '.mine');
              theirs = rnums.length > 0 ? read(abs + '.r' + rnums[rnums.length - 1]!) : '';
              base = rnums.length > 1 ? read(abs + '.r' + rnums[0]!) : '';
            }
          }
          out.push({ path: rel, ours, theirs, base, work, binary });
        }
        sendJson(res, 200, { conflicts: out });
        return true;
      }

      if (p === '/api/conflict-detail') {
        // 冲突风险文件详情：对方的改动 diff + 我的改动 diff
        const { vcs, repo } = vcsOf();
        const rel = url.searchParams.get('path') ?? '';
        if (!rel) {
          sendJson(res, 400, { error: '缺少路径' });
          return true;
        }
        let theirsDiff = '';
        let myDiff = '';
        if (repo.type === 'git') {
          const branch = await vcs.branch?.();
          const t = await vcs.diff('HEAD', `origin/${branch}`, rel);
          theirsDiff = t.ok ? t.output : '';
          const m = await vcs.diff(undefined, undefined, rel);
          myDiff = m.ok ? m.output : '';
        } else {
          const t = await vcs.diff('BASE', 'HEAD', rel);
          theirsDiff = t.ok ? t.output : '';
          const m = await vcs.diff(undefined, undefined, rel);
          myDiff = m.ok ? m.output : '';
        }
        sendJson(res, 200, { path: rel, theirsDiff, myDiff });
        return true;
      }

      if (p === '/api/preflight') {
        // 提交/推送前检查：服务器版本对比 + 行级冲突检测 + 锁定
        const { vcs, repo } = vcsOf();
        const r = await vcs.preflight();
        // 行级冲突：对每个风险文件对比 对方改动行 ∩ 我的改动行
        const clash: { path: string; lines: number[] }[] = [];
        const branch = repo.type === 'git' ? await vcs.branch?.() : '';
        for (const path of (r.conflictRisk ?? []) as string[]) {
          const theirs = repo.type === 'git'
            ? await vcs.diff('HEAD', `origin/${branch}`, path)
            : await vcs.diff('BASE', 'HEAD', path);
          const mine = await vcs.diff(undefined, undefined, path);
          const tL = diffChangedLines(theirs.ok ? theirs.output : '');
          const mL = diffChangedLines(mine.ok ? mine.output : '');
          // 行冲突 = 删除行交集 ∪ 插入位置交集
          const clashSet = new Set<number>();
          for (const l of tL.del) if (mL.del.has(l)) clashSet.add(l);
          for (const l of tL.ins) if (mL.ins.has(l)) clashSet.add(l);
          const lines = [...clashSet].sort((a, b) => a - b);
          if (lines.length > 0) clash.push({ path, lines });
        }
        sendJson(res, 200, { ...r, conflictRisk: clash });
        return true;
      }

      // ---------- Blame / 清理 / 锁定 / 忽略 / 远程 ----------
      if (p === '/api/blame') {
        const { vcs } = vcsOf();
        const pathRel = url.searchParams.get('path') ?? '';
        try {
          const lines = await vcs.blame(pathRel);
          sendJson(res, 200, { lines });
        } catch (e) {
          sendJson(res, 500, { error: (e as Error).message });
        }
        return true;
      }

      if (p === '/api/text-diff' && req.method === 'POST') {
        // 任意两段文本的 unified diff（git diff --no-index，跨平台；冲突解决器用）
        const body = await readBody(req);
        const left = String(body.left ?? '');
        const right = String(body.right ?? '');
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'svnkit-diff-'));
        const f1 = path.join(tmpDir, 'ours.txt');
        const f2 = path.join(tmpDir, 'theirs.txt');
        try {
          fs.writeFileSync(f1, left);
          fs.writeFileSync(f2, right);
          const r = await run('git', ['diff', '--no-index', '--', f1, f2], { timeoutMs: 30_000 });
          // 退出码：0=无差异，1=有差异（正常），>1=错误
          sendJson(res, 200, { diff: r.code <= 1 ? r.stdout : '' });
        } finally {
          fs.rmSync(tmpDir, { recursive: true, force: true });
        }
        return true;
      }

      if (p === '/api/resolve-conflict' && req.method === 'POST') {
        const { vcs, repo } = vcsOf();
        const body = await readBody(req);
        const rel = String(body.path ?? '');
        const mode = String(body.mode ?? 'ours');
        const content = String(body.content ?? '');
        const abs = path.join(repo.root, rel);
        // 路径越界校验：manual 模式会 fs.writeFileSync(abs) 写仓库外文件
        if (!inRepoRoot(repo.root, abs)) {
          sendJson(res, 400, { error: '路径越界' });
          return true;
        }
        // 防误操作：非冲突状态执行 ours/theirs 会静默覆盖本地修改
        if (repo.type === 'git' && mode !== 'manual') {
          const u = await run('git', ['ls-files', '-u', rel], { cwd: repo.root, timeoutMs: 15_000 });
          if (u.code !== 0 || !u.stdout.trim()) {
            sendJson(res, 200, { ok: false, message: `${rel} 当前不是冲突状态，无法采用本地/对方` });
            return true;
          }
        }
        let result: VcsResult;
        if (repo.type === 'git') {
          if (mode === 'manual') {
            fs.writeFileSync(abs, content);
          } else {
            const side = mode === 'ours' ? '--ours' : '--theirs';
            const co = await run('git', ['checkout', side, rel], { cwd: repo.root, timeoutMs: 30_000 });
            if (co.code !== 0) {
              sendJson(res, 200, { ok: false, message: co.stderr.trim() || '取用失败' });
              return true;
            }
          }
          result = await vcs.add([rel]);
          if (result.ok) result = { ok: true, message: `已解决: ${rel}（${mode === 'ours' ? '采用本地' : mode === 'theirs' ? '采用对方' : '手动编辑'}）` };
        } else {
          if (mode === 'manual') fs.writeFileSync(abs, content);
          const accept = mode === 'ours' ? 'mine-full' : mode === 'theirs' ? 'theirs-full' : 'working';
          result = (await vcs.resolve?.(rel, accept)) ?? { ok: false, message: '当前仓库不支持该操作' };
        }
        sendJson(res, 200, { ...result, authError: false });
        return true;
      }

      if (p === '/api/reveal' && req.method === 'POST') {
        // 打开文件所在文件夹（Linux: xdg-open 目录；Windows: explorer 定位文件）
        const { repo } = vcsOf();
        const body = await readBody(req);
        const rel = String(body.path ?? '');
        const abs = path.join(repo.root, rel);
        if (!inRepoRoot(repo.root, abs)) {
          sendJson(res, 403, { error: '超出工作副本范围' });
          return true;
        }
        if (!fs.existsSync(abs)) {
          sendJson(res, 404, { error: '文件不存在' });
          return true;
        }
        if (process.platform === 'win32') {
          await run('explorer', ['/select,', abs], { timeoutMs: 10_000 });
        } else {
          // 目录直接打开本身；文件才打开所在文件夹（否则右键目录会定位到上一级）
          const target = fs.statSync(abs).isDirectory() ? abs : path.dirname(abs);
          await run('xdg-open', [target], { timeoutMs: 10_000 });
        }
        sendJson(res, 200, { ok: true });
        return true;
      }

  return false;
}
