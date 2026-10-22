/** 冲突防护域端点：conflicts / conflict-detail / text-diff / resolve-conflict / preflight / blame */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { run } from '../../vcs/exec.js';
import { platform } from '../../platform/index.js';
import { sendJson, readBody, vcsOf, inRepoRoot, isBinaryFile, readTextFile, runVcs, writeTextKeepEncoding, MSG_PATH_OUT_OF_BOUNDS, MSG_OUT_OF_SCOPE } from './util.js';
import { detectTextEncoding } from '../../shared/text.js';
import { diffChangedLines } from '../../vcs/diff-lines.js';
import { t } from '../../shared/i18n/index.js';
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
        const out: {
          path: string;
          ours: string;
          theirs: string;
          base: string;
          work: string;
          binary: boolean;
          /** 该侧在此版本里没有这个文件（一侧删除/未添加的冲突）：空内容 ≠ 空文件，
           *  界面据此提示"采用这一侧 = 删除文件"，而不是显示一个空栏 */
          oursExists: boolean;
          theirsExists: boolean;
          encoding?: string;
        }[] = [];
        for (const rel of conflictPaths) {
          const abs = path.join(repo.root, rel);
          // 二进制文件（Word/PDF/图片等）：不读内容（utf8 读取是乱码，对比无意义），界面显示提示块
          const binary = isBinaryFile(rel);
          let ours = '';
          let theirs = '';
          let base = '';
          let oursExists = true;
          let theirsExists = true;
          const work = binary ? '' : read(abs);
          if (!binary) {
            if (repo.type === 'git') {
              const show = async (stage: string): Promise<{ text: string; exists: boolean }> => {
                // decode: 'auto' —— 这是**内容型**调用点（见 vcs/exec.ts:50 的说明）：
                // 取出来的是文件内容，可能是 GBK；默认按 UTF-8 硬解会让双栏 diff 整行乱码
                // （实测：解出 "��һ�� �Է��ĵ�"，正确应为「第一行 本地改的」。
                //  同一个面板里编辑框走 readTextFile 有探测、是对的，就这半边错 —— 就是这个漏传）
                const r = await run('git', ['show', `:${stage}:${rel}`], { cwd: repo.root, timeoutMs: 30_000, decode: 'auto' });
                return { text: r.code === 0 ? r.stdout : '', exists: r.code === 0 };
              };
              const b = await show('1');
              const o = await show('2');
              const th = await show('3');
              base = b.text;
              ours = o.text;
              theirs = th.text;
              // add/add 冲突没有 stage 1（双方新增）、deleted-by-them 没有 stage 3，以此类推
              oursExists = o.exists;
              theirsExists = th.exists;
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
              const minePath = abs + '.mine';
              const theirsPath = rnums.length > 0 ? abs + '.r' + rnums[rnums.length - 1]! : '';
              ours = read(minePath);
              theirs = theirsPath ? read(theirsPath) : '';
              base = rnums.length > 1 ? read(abs + '.r' + rnums[0]!) : '';
              oursExists = fs.existsSync(minePath);
              theirsExists = !!theirsPath && fs.existsSync(theirsPath);
            }
          }
          // 编码提示：非 UTF-8（GBK 等）时告诉前端一声，手动编辑框据此挂警告条 ——
          // 非 UTF-8 的编码是"不是合法 UTF-8 就当 GB18030"猜出来的，猜错（日文/繁体/韩文）时
          // 内容看着像正常汉字、保存却把原编码毁掉；真 GBK 与猜错的在探测层无法区分，只能提示用户。
          // 探测看工作区那份（编辑的对象就是它）；多读一次盘，冲突是低频场景，不优化。
          let encoding: string | undefined;
          if (!binary) {
            try {
              const enc = detectTextEncoding(fs.readFileSync(abs));
              if (enc !== 'utf-8') encoding = enc;
            } catch {
              /* 读不到（已删除等）：不提示 */
            }
          }
          out.push({ path: rel, ours, theirs, base, work, binary, oursExists, theirsExists, encoding });
        }
        sendJson(res, 200, { conflicts: out });
        return true;
      }

      if (p === '/api/conflict-detail') {
        // 冲突风险文件详情：对方的改动 diff + 我的改动 diff
        const { vcs, repo } = vcsOf();
        const rel = url.searchParams.get('path') ?? '';
        if (!rel) {
          // 缺少路径
          sendJson(res, 400, { error: t('srv.missingPath') });
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
          // 行冲突 = 删除行交集 ∪ 插入位置交集。
          // 注意：**改一行**会同时体现为"删了第 N 行"和"在第 N 行之后插入"（插入位置记成 N+1），
          // 两者是同一处 —— 不去重的话"N 处"会翻倍，插入位置那个行号还会把第 N+1 行误标成冲突。
          const delClash = new Set<number>();
          for (const l of tL.del) if (mL.del.has(l)) delClash.add(l);
          const insClash = new Set<number>();
          for (const l of tL.ins) if (mL.ins.has(l)) insClash.add(l);
          for (const l of [...insClash]) if (delClash.has(l - 1)) insClash.delete(l);
          const lines = [...delClash, ...insClash].sort((a, b) => a - b);
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
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'svngit-diff-'));
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

      if (p === '/api/resolve-conflict' && req.method === 'POST') {        const { vcs, repo } = vcsOf();
        const body = await readBody(req);
        const rel = String(body.path ?? '');
        const mode = String(body.mode ?? 'ours');
        const content = String(body.content ?? '');
        const abs = path.join(repo.root, rel);
        // 路径越界校验：manual 模式会 fs.writeFileSync(abs) 写仓库外文件
        if (!inRepoRoot(repo.root, abs)) {
          sendJson(res, 400, { error: MSG_PATH_OUT_OF_BOUNDS() });
          return true;
        }
        // 防误操作：非冲突状态执行 ours/theirs 会静默覆盖本地修改
        if (repo.type === 'git' && mode !== 'manual') {
          const u = await run('git', ['ls-files', '-u', rel], { cwd: repo.root, timeoutMs: 15_000 });
          if (u.code !== 0 || !u.stdout.trim()) {
            // {path} 当前不是冲突状态，无法采用本地/对方
            sendJson(res, 200, { ok: false, message: t('srv.notInConflict', { path: rel }) });
            return true;
          }
        }
        if (repo.type === 'git') {
          // 采用"没有该文件的那一侧"时用 git rm 解决（git rm 已经把删除暂存了，
          // 下面不能再 git add —— 对已删除路径 `git add <path>` 会报 "pathspec did not match"）
          let removed = false;
          if (mode === 'manual') {
            const w = writeTextKeepEncoding(abs, content);
            if (!w.ok) {
              sendJson(res, 200, { ok: false, message: w.message });
              return true;
            }
          } else {
            const side = mode === 'ours' ? '--ours' : '--theirs';
            const stage = mode === 'ours' ? '2' : '3';
            // 该侧在合并里没有这个文件（对方删了 / 我方新增之类）：采用它 = 从工作区删掉文件。
            // 直接 checkout 会报错（stage 不存在），所以先把"存在性"本身当作选择的一部分。
            const probe = await run('git', ['show', `:${stage}:${rel}`], { cwd: repo.root, timeoutMs: 15_000 });
            if (probe.code !== 0) {
              const rm = await run('git', ['rm', '-f', '--', rel], { cwd: repo.root, timeoutMs: 30_000 });
              if (rm.code !== 0) {
                sendJson(res, 200, { ok: false, message: rm.stderr.trim() || t('srv.takeFailed') });
                return true;
              }
              removed = true;
            } else {
              const co = await run('git', ['checkout', side, rel], { cwd: repo.root, timeoutMs: 30_000 });
              if (co.code !== 0) {
                // 取用失败
                sendJson(res, 200, { ok: false, message: co.stderr.trim() || t('srv.takeFailed') });
                return true;
              }
            }
          }
          if (removed) {
            return runVcs(ctx, () => ({
              ok: true,
              message: t('srv.resolved', { path: rel, how: mode === 'ours' ? t('srv.takeOurs') : t('srv.takeTheirs') }),
            }));
          }
          const added = await vcs.add([rel]);
          // git add 为纯本地操作（无网络认证），authErrorOf 恒 false——与原固定 authError:false 等价
          // 已解决: {path}（{how}） / 采用本地 / 采用对方 / 手动编辑
          return runVcs(ctx, () => (added.ok ? { ok: true, message: t('srv.resolved', { path: rel, how: mode === 'ours' ? t('srv.takeOurs') : mode === 'theirs' ? t('srv.takeTheirs') : t('srv.manualEdit') }) } : added));
        }
        if (mode === 'manual') {
          const w = writeTextKeepEncoding(abs, content);
          if (!w.ok) {
            sendJson(res, 200, { ok: false, message: w.message });
            return true;
          }
        }
        const accept = mode === 'ours' ? 'mine-full' : mode === 'theirs' ? 'theirs-full' : 'working';
        // svn resolve 为纯本地操作，authErrorOf 恒 false——与原固定 authError:false 等价；"不支持"兜底由 runVcs 统一
        return runVcs(ctx, () => vcs.resolve?.(rel, accept));
      }

      if (p === '/api/reveal' && req.method === 'POST') {
        // 打开文件所在文件夹（Linux: xdg-open 目录；Windows: explorer 定位文件）
        const { repo } = vcsOf();
        const body = await readBody(req);
        const raw = String(body.path ?? '');
        // 绝对路径（如工作树副本，可能不在当前仓库内）直接打开；相对路径仍按仓库根解析并校验
        const abs = path.isAbsolute(raw) ? raw : path.join(repo.root, raw);
        if (!path.isAbsolute(raw) && !inRepoRoot(repo.root, abs)) {
          sendJson(res, 403, { error: MSG_OUT_OF_SCOPE() });
          return true;
        }
        if (!fs.existsSync(abs)) {
          // 文件不存在
          sendJson(res, 404, { error: t('srv.fileNotFound') });
          return true;
        }
        await platform.revealPath(abs);
        sendJson(res, 200, { ok: true });
        return true;
      }

      if (p === '/api/open-terminal' && req.method === 'POST') {
        // 在当前浏览目录打开系统终端（Linux: 终端模拟器；Windows: Windows Terminal / cmd）。
        // 工作目录同样做仓库边界校验——终端是"在那里执行任意命令"，越界就等于开了个仓库外 shell
        const { repo } = vcsOf();
        const body = await readBody(req);
        const rel = String(body.path ?? '');
        const abs = path.join(repo.root, rel);
        if (!inRepoRoot(repo.root, abs)) {
          sendJson(res, 403, { error: MSG_OUT_OF_SCOPE() });
          return true;
        }
        let isDir = false;
        try {
          isDir = fs.statSync(abs).isDirectory();
        } catch {
          /* 目录刚被删等：按不存在处理 */
        }
        if (!isDir) {
          // 目录不存在：{path}
          sendJson(res, 404, { error: t('srv.dirNotFound', { path: rel || '.' }) });
          return true;
        }
        sendJson(res, 200, await platform.openTerminal(abs));
        return true;
      }

  return false;
}
