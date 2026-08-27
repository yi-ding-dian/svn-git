/** 操作域端点：add/commit/update/revert/delete/push + svn-extra + 忽略规则 + 锁定/清理 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { run } from '../vcs/exec.js';
import { sendJson, readBody, vcsOf, inRepoRoot, isAuthError, authErrorOf, realpathSafe, invalidateStatusCache, getStatusCached } from './util.js';
import { getSvnIgnoreMap, isIgnoredByRules } from '../vcs/ignore.js';
import type { VcsResult } from '../vcs/index.js';
import type { Ctx } from './util.js';

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
        else result = (await vcs.push?.()) ?? { ok: false, message: '当前仓库不支持该操作' };
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
        let result: VcsResult;
        if (action === 'cleanup') result = (await vcs.cleanup?.()) ?? { ok: false, message: '当前仓库不支持该操作' };
        else if (action === 'resolve' || action === 'propset-ignore') {
          // 路径越界校验：resolve/propset-ignore 的 path 是相对仓库根路径
          const rel = String(body.path ?? '');
          if (!inRepoRoot(repo.root, path.resolve(repo.root, rel))) {
            sendJson(res, 400, { error: '路径越界' });
            return true;
          }
          if (action === 'resolve') result = (await vcs.resolve?.(rel, String(body.accept ?? 'working'))) ?? { ok: false, message: '当前仓库不支持该操作' };
          else result = (await vcs.propSetIgnore?.(rel, String(body.pattern ?? ''))) ?? { ok: false, message: '当前仓库不支持该操作' };
        } else {
          sendJson(res, 400, { error: '未知操作' });
          return true;
        }
        sendJson(res, 200, { ...result, authError: authErrorOf(result) });
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
        const r = (await vcs.clean?.(paths?.length ? paths : undefined)) ?? { ok: false, message: '当前仓库不支持该操作' };
        sendJson(res, 200, { ...r, authError: false });
        return true;
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
          sendJson(res, 400, { error: '路径越界' });
          return true;
        }
        try {
          for (const p of paths) fs.rmSync(path.join(repo.root, p), { recursive: true, force: true });
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
          sendJson(res, 400, { error: '路径越界' });
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
          sendJson(res, 400, { error: '路径越界' });
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
          sendJson(res, 400, { error: '路径越界' });
          return true;
        }
        const force = Boolean(body.force);
        const r = action === 'lock'
          ? (await vcs.lock?.(pathRel, force)) ?? { ok: false, message: '当前仓库不支持该操作' }
          : (await vcs.unlock?.(pathRel, force)) ?? { ok: false, message: '当前仓库不支持该操作' };
        sendJson(res, 200, { ...r, authError: authErrorOf(r) });
        return true;
      }

      if (p === '/api/ignore' && req.method === 'GET') {
        // 读取忽略规则（svn: svn:ignore 属性 / git: .gitignore）
        const { repo } = vcsOf();
        const pathRel = url.searchParams.get('path') ?? '';
        let rules: string[] = [];
        if (repo.type === 'svn') {
          if (!inRepoRoot(repo.root, path.resolve(repo.root, pathRel))) {
            sendJson(res, 400, { error: '路径越界' });
            return true;
          }
          const r = await run('svn', ['propget', 'svn:ignore', pathRel || '.'], { cwd: repo.root, timeoutMs: 30_000 });
          if (r.code === 0 && r.stdout.trim()) rules = r.stdout.split('\n').map((s) => s.trim()).filter(Boolean);
        } else {
          const g = path.join(repo.root, '.gitignore');
          if (fs.existsSync(g)) {
            rules = fs
              .readFileSync(g, 'utf8')
              .split('\n')
              .map((s) => s.trim())
              .filter((s) => s && !s.startsWith('#'));
          }
        }
        sendJson(res, 200, { rules });
        return true;
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
            sendJson(res, 400, { error: '路径越界' });
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
          const g = path.join(repo.root, '.gitignore');
          if (fs.existsSync(g)) {
            const content = fs.readFileSync(g, 'utf8');
            fs.writeFileSync(g, content.split('\n').filter((l) => l.trim() !== pattern).join('\n'));
          }
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
          // git：规则全部在根 .gitignore，从根逐级找第一级被匹配的段 → 追加 !<段>（目录带 /）
          const g = path.join(repo.root, '.gitignore');
          let rules: string[] = [];
          if (fs.existsSync(g)) {
            rules = fs
              .readFileSync(g, 'utf8')
              .split('\n')
              .map((s) => s.trim())
              .filter((s) => s && !s.startsWith('#'));
          }
          let matched = ''; // 被匹配段（可能为祖先目录）
          let acc = '';
          for (const part of parts) {
            acc = acc ? `${acc}/${part}` : part;
            if (isIgnoredByRules(rules, part)) {
              matched = acc;
              break;
            }
          }
          if (!matched) {
            sendJson(res, 200, { ok: false, message: `未找到忽略 ${rel} 的规则（可能来自 .git/info/exclude 或全局配置，请手动处理）` });
            return true;
          }
          // 匹配段是祖先（非最后一段）→ 必为目录；是路径自身 → 按磁盘类型判断
          const isLast = matched === rel;
          let isDir = !isLast;
          if (isLast) {
            try {
              isDir = fs.statSync(path.join(repo.root, matched)).isDirectory();
            } catch {
              isDir = false;
            }
          }
          const neg = isDir ? `!${matched}/` : `!${matched}`;
          try {
            let content = '';
            if (fs.existsSync(g)) content = fs.readFileSync(g, 'utf8');
            if (!content.endsWith('\n') && content) content += '\n';
            fs.writeFileSync(g, content + neg + '\n');
          } catch (err) {
            sendJson(res, 200, { ok: false, message: `写入 .gitignore 失败: ${(err as Error).message}` });
            return true;
          }
          invalidateStatusCache(repo.root);
          sendJson(res, 200, { ok: true, message: `已取消忽略: ${neg}（${isDir ? '目录下文件将按剩余规则重新判定' : rel + ' 变为未版本化'}）` });
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
          sendJson(res, 400, { error: '路径越界' });
          return true;
        }
        const r =
          repo.type === 'git'
            ? (await vcs.ignoreAdd?.(pattern)) ?? { ok: false, message: '当前仓库不支持该操作' }
            : (await vcs.propSetIgnore?.(pathRel, pattern)) ?? { ok: false, message: '当前仓库不支持该操作' };
        sendJson(res, 200, { ...r, authError: authErrorOf(r) });
        return true;
      }

  return false;
}
