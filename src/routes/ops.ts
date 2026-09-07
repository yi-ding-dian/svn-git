/** 操作域端点：add/commit/update/revert/delete/push + svn-extra + 忽略规则 + 锁定/清理 */
import fs from 'node:fs';
import path from 'node:path';
import { run } from '../vcs/exec.js';
import {
  sendJson, readBody, vcsOf, inRepoRoot, authErrorOf, realpathSafe, invalidateStatusCache, getStatusCached,
  runVcs, MSG_UNSUPPORTED_OP, MSG_PATH_OUT_OF_BOUNDS,
} from './util.js';
import { getSvnIgnoreMap, isIgnoredByRules, gitGlobalExcludesFile, ensureGitGlobalExcludesFile } from '../vcs/ignore.js';
import type { Ctx } from './util.js';

/** git 忽略三处去向（展示名与写入目标）——仓库 .gitignore / 全局 excludesFile / .git/info/exclude */
const GIT_IGNORE_WHERE = {
  gitignore: '仓库 .gitignore',
  global: '全局忽略（~/.gitignore_global）',
  exclude: '.git/info/exclude',
} as const;
type GitIgnoreTarget = keyof typeof GIT_IGNORE_WHERE;

/** 三个忽略文件清单（global 未配置时 GET/删除不含；写入 global 时先确保配置）
 * 全局文件查询/确保逻辑共用 vcs/ignore.ts（渲染侧 /api/fs 同样从该处读取三来源） */
async function gitIgnoreFiles(repoRoot: string, forWriteGlobal = false): Promise<{ where: GitIgnoreTarget; file: string }[]> {
  const global = forWriteGlobal ? await ensureGitGlobalExcludesFile() : await gitGlobalExcludesFile();
  const out: { where: GitIgnoreTarget; file: string }[] = [
    { where: 'gitignore', file: path.join(repoRoot, '.gitignore') },
  ];
  if (global) out.push({ where: 'global', file: path.resolve(global) });
  out.push({ where: 'exclude', file: path.join(repoRoot, '.git', 'info', 'exclude') });
  return out;
}
/** 追加忽略规则到文件（去重：已含同 pattern 行返回 false；末尾补一行）。
 * 同文件已有其取反行 !pattern（规则被「取消忽略」废止）时：清掉 pattern/取反两行、重写干净 pattern——
 * 保证"加入忽略"必然生效（否则重复 忽略→取消→忽略 会卡在"规则已存在"而 git 实际未忽略）。
 * pattern 以 ! 开头（取消忽略的否定行）不做取反清理，仅行去重（避免!!!叠加）。 */
function appendIgnoreLine(file: string, pattern: string): boolean {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const lines = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n') : [];
  if (!pattern.startsWith('!') && lines.some((l) => l.trim() === '!' + pattern)) {
    fs.writeFileSync(file, [...lines.filter((l) => { const t = l.trim(); return t !== pattern && t !== '!' + pattern; }), pattern].join('\n') + '\n');
    return true;
  }
  if (lines.some((l) => l.trim() === pattern)) return false;
  fs.writeFileSync(file, [...lines.filter((l) => l.trim()), pattern].join('\n') + '\n');
  return true;
}

/** 清除文件中的取反行（!pattern）：任一档的取反正则按优先级（… > .gitignore > exclude > global）都能覆盖目标档，
 * 加入忽略=用户意图"文件必被忽略"，写入前清全部档位取反，避免跨档覆盖导致看似写入实则未忽略 */
function removeNegationLine(file: string, pattern: string): void {
  if (pattern.startsWith('!') || !fs.existsSync(file)) return;
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  if (lines.some((l) => l.trim() === '!' + pattern)) {
    fs.writeFileSync(file, lines.filter((l) => { const t = l.trim(); return t && t !== '!' + pattern; }).join('\n') + '\n');
  }
}

export async function handle(ctx: Ctx): Promise<boolean> {
  const { req, res, url } = ctx;
  const p = url.pathname;

      // 操作类 POST
      if (req.method === 'POST' && ['/api/add', '/api/commit', '/api/update', '/api/revert', '/api/delete', '/api/push'].includes(p)) {
        const { vcs, repo } = vcsOf();
        const body = await readBody(req);
        const paths = (body.paths as string[]) ?? [];
        const msg = String(body.message ?? '');
        // 路径越界校验：paths 为相对仓库根路径，path.resolve 归一化后 inRepoRoot 检查（防 ../ 穿越与绝对路径指向仓库外）
        const bad = paths.find((p) => !inRepoRoot(repo.root, path.resolve(repo.root, p)));
        if (bad) {
          sendJson(res, 400, { error: `路径超出工作副本范围: ${bad}` });
          return true;
        }
        let result: { ok: boolean; message: string };
        if (p === '/api/add') result = await vcs.add(paths);
        else if (p === '/api/commit') result = await vcs.commit(paths, msg);
        else if (p === '/api/update') {
          const dir = String(body.path ?? '');
          // update 的 dir 同样校验（空串 = 仓库根，通过）
          if (!inRepoRoot(repo.root, path.resolve(repo.root, dir))) {
            sendJson(res, 400, { error: '路径超出工作副本范围' });
            return true;
          }
          // 前端取消更新（请求断开）→ 终止 svn/git 子进程。
          // 注意：req 'aborted' 事件在 Node 18.17+ 已弃用不再触发，改用 res 'close' +
          // writableEnded 判断客户端是否异常断开（正常响应完成时 writableEnded=true 不误杀）
          const ac = new AbortController();
          res.on('close', () => {
            if (!res.writableEnded) ac.abort();
          });
          result = repo.type === 'git'
          ? (await vcs.pull?.(ac.signal)) ?? { ok: false, message: '当前仓库不支持拉取' }
          : (await vcs.update?.(dir || undefined, ac.signal)) ?? { ok: false, message: '当前仓库不支持更新' };
          // 更新成功后自动恢复缺失文件（磁盘删除但版本库还在 → 拉回，消除 ! 标识）
          if (result.ok) {
            try {
              const missing = await vcs.restoreMissing();
              if (missing.length > 0) {
                result = { ...result, message: `${result.message}；已恢复 ${missing.length} 个缺失文件` };
              }
            } catch {
              /* 恢复失败不阻断更新结果 */
            }
          }
        } else if (p === '/api/revert') result = await vcs.revert(paths);
        else if (p === '/api/delete') result = body.keep === true ? await vcs.removeKeep(paths) : await vcs.remove(paths);
        else result = (await vcs.push?.()) ?? { ok: false, message: MSG_UNSUPPORTED_OP };
        if (result.ok) invalidateStatusCache(repo.root); // 状态改变 → 失效 30s 缓存,否则新文件过滤仍显示旧 ?/M
        sendJson(res, 200, {
          ...(result as object),
          path: p === '/api/update' ? String(body.path ?? '') : undefined,
          authError: authErrorOf(result),
        });
        return true;
      }

      if (p === '/api/svn-extra' && req.method === 'POST') {
        const { vcs, repo } = vcsOf();
        const body = await readBody(req);
        const action = String(body.action ?? '');
        if (action === 'cleanup') return runVcs(ctx, () => vcs.cleanup?.());
        if (action === 'resolve' || action === 'propset-ignore') {
          // 路径越界校验：resolve/propset-ignore 的 path 是相对仓库根路径
          const rel = String(body.path ?? '');
          if (!inRepoRoot(repo.root, path.resolve(repo.root, rel))) {
            sendJson(res, 400, { error: MSG_PATH_OUT_OF_BOUNDS });
            return true;
          }
          // resolve/propset-ignore 改变状态码（C→干净、?→I），缓存失效由 runVcs 统一
          return runVcs(ctx, () =>
            action === 'resolve'
              ? vcs.resolve?.(rel, String(body.accept ?? 'working'))
              : vcs.propSetIgnore?.(rel, String(body.pattern ?? ''))
          );
        }
        sendJson(res, 400, { error: '未知操作' });
        return true;
      }

      if (p === '/api/git-clean') {
        const { repo, vcs } = vcsOf();
        if (repo.type !== 'git') {
          sendJson(res, 400, { error: '仅 Git 仓库支持' });
          return true;
        }
        if (req.method === 'GET') {
          const files = (await vcs.cleanList?.()) ?? [];
          sendJson(res, 200, { files });
          return true;
        }
        const body = await readBody(req);
        const paths = Array.isArray(body.paths) ? body.paths.map(String).filter(Boolean) : undefined;
        // clean 为纯本地操作（无网络认证），authErrorOf 恒 false——与原固定 authError:false 等价
        return runVcs(ctx, () => vcs.clean?.(paths?.length ? paths : undefined));
      }

      if (p === '/api/locate') {
        // 定位：目录（含子目录）下 code 匹配的文件，按 mtime 降序（点击文件夹角标跳"最近一个"）
        const { repo } = vcsOf();
        const dir = String(url.searchParams.get('dir') ?? '').replace(/\/$/, '');
        const code = String(url.searchParams.get('code') ?? '');
        if (!code || !inRepoRoot(repo.root, path.join(repo.root, dir))) {
          sendJson(res, 400, { error: '参数不合法' });
          return true;
        }
        const items = (await getStatusCached(repo, false)) as { path: string; code: string }[];
        const prefix = dir ? dir + '/' : '';
        let list = items.filter((i) => i.path.startsWith(prefix) && i.path !== dir && i.code === code);
        if (list.length > 1000) list = list.slice(0, 1000); // 超大目录保护：最多统计前 1000
        const out = list
          .map((i) => {
            let mtime = 0;
            try {
              mtime = fs.statSync(path.join(repo.root, i.path)).mtimeMs;
            } catch {
              /* 已删除磁盘文件：mtime 0 排最后 */
            }
            return { path: i.path, mtime };
          })
          .sort((a, b) => b.mtime - a.mtime);
        sendJson(res, 200, { files: out });
        return true;
      }

      if (p === '/api/fs-delete' && req.method === 'POST') {
        // 磁盘删除（未版本化 ? 文件/目录专属入口：不做版本库调度，仅删本地文件）
        const { repo } = vcsOf();
        const body = await readBody(req);
        const paths = Array.isArray(body.paths) ? body.paths.map(String).filter(Boolean) : [];
        if (paths.length === 0) {
          sendJson(res, 400, { error: '缺少路径' });
          return true;
        }
        const rootAbs = path.resolve(repo.root);
        if (paths.some((p) => !inRepoRoot(repo.root, path.join(repo.root, p)) || path.resolve(repo.root, p) === rootAbs)) {
          sendJson(res, 400, { error: MSG_PATH_OUT_OF_BOUNDS });
          return true;
        }
        try {
          for (const p of paths) fs.rmSync(path.join(repo.root, p), { recursive: true, force: true });
          invalidateStatusCache(repo.root); // 磁盘文件集变化（? 项被删），防状态缓存/过滤树显示旧文件
          sendJson(res, 200, { ok: true, message: `已删除磁盘文件 ${paths.length} 项` });
        } catch (e) {
          sendJson(res, 500, { error: `删除失败: ${(e as Error).message}` });
        }
        return true;
      }

      if (p === '/api/move' && req.method === 'POST') {
        // 版本化文件/目录重命名/移动（svn move / git mv：本地调度，提交后生效）
        const { vcs, repo } = vcsOf();
        const body = await readBody(req);
        const from = String(body.from ?? '');
        const to = String(body.to ?? '');
        if (!from || !to) { sendJson(res, 400, { error: '路径为空' }); return true; }
        if (from === to) { sendJson(res, 400, { error: '新旧路径相同' }); return true; }
        // from 存在可正常 realpath；to 可能尚未存在（新名字目录也可能未建），用 realpathSafe 逐级解析
        if (!inRepoRoot(repo.root, path.resolve(repo.root, from)) || !inRepoRoot(repo.root, realpathSafe(path.resolve(repo.root, to)))) {
          sendJson(res, 400, { error: MSG_PATH_OUT_OF_BOUNDS });
          return true;
        }
        const result = await vcs.move(from, to);
        if (result.ok) invalidateStatusCache(repo.root);
        sendJson(res, 200, {
          ...result,
          authError: authErrorOf(result),
        });
        return true;
      }

      if (p === '/api/fs-move' && req.method === 'POST') {
        // 磁盘改名（未版本化 ? / 忽略 I 文件/目录专属：不做版本库调度，仅改本地文件名，状态不变）
        const { repo } = vcsOf();
        const body = await readBody(req);
        const from = String(body.from ?? '');
        const to = String(body.to ?? '');
        if (!from || !to) { sendJson(res, 400, { error: '路径为空' }); return true; }
        if (from === to) { sendJson(res, 400, { error: '新旧路径相同' }); return true; }
        const fromAbs = path.resolve(repo.root, from);
        const toAbs = path.resolve(repo.root, to);
        if (!inRepoRoot(repo.root, fromAbs) || !inRepoRoot(repo.root, realpathSafe(toAbs))) {
          sendJson(res, 400, { error: MSG_PATH_OUT_OF_BOUNDS });
          return true;
        }
        if (fs.existsSync(toAbs)) {
          sendJson(res, 400, { error: '目标已存在' }); // renameSync 会静默覆盖，先预检拒绝
          return true;
        }
        try {
          fs.renameSync(fromAbs, toAbs);
          invalidateStatusCache(repo.root); // ?/I 路径变化，旧缓存中路径失效
          sendJson(res, 200, { ok: true, message: `已重命名 ${from} → ${to}（磁盘，不影响版本库）` });
        } catch (e) {
          sendJson(res, 500, { error: `重命名失败: ${(e as Error).message}` });
        }
        return true;
      }

      if (p === '/api/svn-lock' && req.method === 'POST') {
        const { repo, vcs } = vcsOf();
        if (repo.type !== 'svn') {
          sendJson(res, 400, { error: '仅 SVN 仓库支持' });
          return true;
        }
        const body = await readBody(req);
        const action = String(body.action ?? '');
        const pathRel = String(body.path ?? '');
        if (!inRepoRoot(repo.root, path.resolve(repo.root, pathRel))) {
          sendJson(res, 400, { error: MSG_PATH_OUT_OF_BOUNDS });
          return true;
        }
        const force = Boolean(body.force);
        // 锁定/解锁影响状态展示（锁标），缓存失效由 runVcs 统一
        return runVcs(ctx, () => (action === 'lock' ? vcs.lock?.(pathRel, force) : vcs.unlock?.(pathRel, force)));
      }

      if (p === '/api/ignore' && req.method === 'GET') {
        // 读取忽略规则（svn: svn:ignore 属性 / git: .gitignore）
        const { repo } = vcsOf();
        const pathRel = url.searchParams.get('path') ?? '';
        let rules: string[] = [];
        if (repo.type === 'svn') {
          if (!inRepoRoot(repo.root, path.resolve(repo.root, pathRel))) {
            sendJson(res, 400, { error: MSG_PATH_OUT_OF_BOUNDS });
            return true;
          }
          const r = await run('svn', ['propget', 'svn:ignore', pathRel || '.'], { cwd: repo.root, timeoutMs: 30_000 });
          if (r.code === 0 && r.stdout.trim()) rules = r.stdout.split('\n').map((s) => s.trim()).filter(Boolean);
          sendJson(res, 200, { rules });
          return true;
        } else {
          // git：三档规则合并（仓库 .gitignore / 全局 excludesFile / .git/info/exclude），sources 标注来源
          const files = await gitIgnoreFiles(repo.root);
          const rules: string[] = [];
          const sources: { pattern: string; where: string }[] = [];
          for (const { where, file } of files) {
            if (!fs.existsSync(file)) continue;
            for (const l of fs.readFileSync(file, 'utf8').split('\n')) {
              const t = l.trim();
              if (!t || t.startsWith('#') || t.startsWith('!')) continue; // 注释与否定行不列
              rules.push(t);
              sources.push({ pattern: t, where: GIT_IGNORE_WHERE[where] });
            }
          }
          sendJson(res, 200, { rules, sources });
          return true;
        }
      }

      if (p === '/api/ignore-remove' && req.method === 'POST') {
        // 删除单条忽略规则
        const { repo } = vcsOf();
        const body = await readBody(req);
        const pathRel = String(body.path ?? '');
        const pattern = String(body.pattern ?? '');
        if (repo.type === 'svn') {
          // 路径越界校验：pathRel 用于 svn propget/propset，传 ../ 可作用于仓库外路径
          if (!inRepoRoot(repo.root, path.resolve(repo.root, pathRel))) {
            sendJson(res, 400, { error: MSG_PATH_OUT_OF_BOUNDS });
            return true;
          }
          // propget → 过滤 → propset 回写
          const getRes = await run('svn', ['propget', 'svn:ignore', pathRel || '.'], { cwd: repo.root, timeoutMs: 30_000 });
          const remaining = getRes.stdout
            .split('\n')
            .map((s) => s.trim())
            .filter((s) => s && s !== pattern);
          const setRes = await run('svn', ['propset', 'svn:ignore', remaining.join('\n'), pathRel || '.'], { cwd: repo.root, timeoutMs: 30_000 });
          if (setRes.code !== 0) {
            sendJson(res, 200, { ok: false, message: setRes.stderr.trim() || '删除失败' });
            return true;
          }
        } else {
          // git：三档任一文件删除该行（where 未知/global 未配置时自然跳过）
          const files = await gitIgnoreFiles(repo.root);
          let removedAt = '';
          for (const { where, file } of files) {
            if (!fs.existsSync(file)) continue;
            const lines = fs.readFileSync(file, 'utf8').split('\n');
            const left = lines.filter((l) => l.trim() !== pattern);
            if (left.length !== lines.length) {
              fs.writeFileSync(file, left.filter((l) => l.trim()).join('\n') + '\n');
              removedAt = GIT_IGNORE_WHERE[where];
              break;
            }
          }
          invalidateStatusCache(repo.root);
          sendJson(res, 200, { ok: true, message: removedAt ? `已删除规则: ${pattern}（${removedAt}）` : `未找到规则: ${pattern}` });
          return true;
        }
        invalidateStatusCache(repo.root);
        sendJson(res, 200, { ok: true, message: `已删除规则: ${pattern}` });
        return true;
      }

      if (p === '/api/unignore' && req.method === 'POST') {
        // 取消忽略：git 追加否定规则 !<路径>（覆盖前面的排除）；svn 删除承载该路径的匹配规则
        const { repo } = vcsOf();
        const body = await readBody(req);
        const rel = String(body.path ?? '').replace(/^\/+/, '');
        if (!rel) {
          sendJson(res, 400, { error: '缺少路径' });
          return true;
        }
        const parts = rel.split('/').filter(Boolean);
        if (repo.type === 'git') {
          // git：check-ignore -v 定位命中来源（.gitignore / 全局 excludesFile / .git/info/exclude），
          // 否定规则追加到**同档文件**——跨档优先级 exclude > global > .gitignore，写错档会不生效
          const probe = await run('git', ['check-ignore', '-v', '--', rel], { cwd: repo.root, timeoutMs: 15_000 });
          const srcLine = probe.code === 0 && probe.stdout.trim() ? probe.stdout.split('\n')[0] : '';
          // source 输出为相对仓库根的路径（如 .git/info/exclude）——必须相对 repo.root 解析：
          // 用 process.cwd() 解析会错位到启动目录（打开子项目仓库时写入错误位置，曾污染父仓库）
          const srcFile = srcLine ? path.resolve(repo.root, srcLine.split(':')[0] ?? '') : null;
          if (srcLine && srcFile) {
            // 命中：在来源档追加 !<路径>（目录带 / 与反序列化交给 git 判定：直接追加路径本身）
            const isLast = parts.length >= 2 || (srcLine === srcLine && rel.includes('/') === false);
            let isDir = false;
            try {
              isDir = fs.statSync(path.join(repo.root, rel)).isDirectory();
            } catch {
              isDir = false;
            }
            appendIgnoreLine(srcFile, isDir ? `!${rel}/` : `!${rel}`);
            invalidateStatusCache(repo.root);
            const where = srcFile === path.join(repo.root, '.gitignore')
              ? GIT_IGNORE_WHERE.gitignore
              : String(srcFile).includes('info') && String(srcFile).includes('exclude')
                ? GIT_IGNORE_WHERE.exclude
                : GIT_IGNORE_WHERE.global;
            sendJson(res, 200, { ok: true, message: `已取消忽略: ${rel}（追加否定到 ${where}）` });
            return true;
          }
          sendJson(res, 200, { ok: false, message: `未找到忽略 ${rel} 的规则（该文件当前未被任何档忽略）` });
          return true;
        }
        // svn：逐级（根→自身）找承载匹配规则的目录，删除该条规则（svn:ignore 不支持否定语法）
        let found: { dir: string; rule: string } | null = null;
        let acc2 = '';
        for (const part of parts) {
          acc2 = acc2 ? `${acc2}/${part}` : part;
          const parentOf = path.dirname(acc2);
          const dir = parentOf === '.' ? '.' : parentOf;
          const rules = (await getSvnIgnoreMap(repo.root)).get(dir) ?? [];
          if (rules.length) {
            const rule = rules.find((r) => isIgnoredByRules([r], part));
            if (rule) {
              found = { dir, rule };
              break;
            }
          }
        }
        if (!found) {
          sendJson(res, 200, { ok: false, message: `未找到忽略 ${rel} 的规则（可能来自全局 ignore，请手动处理）` });
          return true;
        }
        const getRes = await run('svn', ['propget', 'svn:ignore', found.dir], { cwd: repo.root, timeoutMs: 30_000 });
        const remaining = getRes.stdout
          .split('\n')
          .map((s) => s.trim())
          .filter((s) => s && s !== found!.rule);
        const setRes = await run('svn', ['propset', 'svn:ignore', remaining.join('\n'), found.dir], { cwd: repo.root, timeoutMs: 30_000 });
        if (setRes.code !== 0) {
          sendJson(res, 200, { ok: false, message: setRes.stderr.trim() || '取消忽略失败' });
          return true;
        }
        invalidateStatusCache(repo.root);
        sendJson(res, 200, { ok: true, message: `已取消忽略: 删除 ${found.dir === '.' ? '根目录' : found.dir} 的规则「${found.rule}」，同目录匹配该规则的文件将变为未版本化` });
        return true;
      }

      if (p === '/api/ignore' && req.method === 'POST') {
        const { repo, vcs } = vcsOf();
        const body = await readBody(req);
        const pathRel = String(body.path ?? '');
        const pattern = String(body.pattern ?? '').trim();
        if (!pattern) {
          sendJson(res, 400, { error: '请填写忽略规则' });
          return true;
        }
        // svn 分支的 propSetIgnore 作用于 pathRel 目录,须在仓库根内
        if (repo.type === 'svn' && !inRepoRoot(repo.root, path.resolve(repo.root, pathRel))) {
          sendJson(res, 400, { error: MSG_PATH_OUT_OF_BOUNDS });
          return true;
        }
        // 忽略后 ? → I，状态码变化，缓存失效由 runVcs 统一
        if (repo.type === 'git') {
          // git：三向写入（.gitignore / 全局 excludesFile / .git/info/exclude）；target 缺省 .gitignore
          const target = String(body.target ?? 'gitignore') as GitIgnoreTarget;
          if (target !== 'gitignore' && target !== 'global' && target !== 'exclude') {
            sendJson(res, 400, { error: '未知忽略去向' });
            return true;
          }
          const files = await gitIgnoreFiles(repo.root, target === 'global'); // global 写入时先确保配置
          const hit = files.find((f) => f.where === target);
          if (!hit) {
            sendJson(res, 400, { error: '全局忽略未配置，请先点击「加入忽略 → 全局」重新尝试（将自动配置 core.excludesFile）' });
            return true;
          }
          // 清除所有档位的取反行（!pattern）后写入：保证 git 当前判定确实忽略（跨档取反会覆盖目标档）
          for (const f of files) removeNegationLine(f.file, pattern);
          if (appendIgnoreLine(hit.file, pattern)) {
            invalidateStatusCache(repo.root);
            sendJson(res, 200, { ok: true, message: `已加入忽略: ${pattern}（${GIT_IGNORE_WHERE[target]}）` });
          } else {
            // 正规则已存在：由于取反行已清，忽略已生效——提示"已恢复"而非"未写入"
            invalidateStatusCache(repo.root);
            sendJson(res, 200, { ok: true, message: `规则已存在,已恢复忽略生效: ${pattern}（${GIT_IGNORE_WHERE[target]}）` });
          }
          return true;
        }
        return runVcs(ctx, () => vcs.propSetIgnore?.(pathRel, pattern));
      }

  return false;
}
