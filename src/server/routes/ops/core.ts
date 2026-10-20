/** 仓库级操作端点：add / commit / update / revert / delete / push。
 *
 *  这几条共享同一套入参（paths）+ 越界校验 + 成功后的状态缓存失效，放在同一文件；
 *  文件级读写、忽略规则、清理/锁见同目录其它模块。 */
import path from 'node:path';
import { sendJson, readBody, vcsOf, inRepoRoot, authErrorOf, invalidateStatusCache, MSG_UNSUPPORTED_OP, MSG_PATH_OUT_OF_BOUNDS } from '../util.js';
import { invalidateRemoteProbe } from '../recent.js';
import type { Ctx } from '../util.js';
import { t } from '../../../shared/i18n/index.js';

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
      // 路径超出工作副本范围: {path}
      sendJson(res, 400, { error: t('srv.pathOutOfWc', { path: bad }) });
      return true;
    }
    let result: { ok: boolean; message: string };
    if (p === '/api/add') result = await vcs.add(paths);
    else if (p === '/api/commit') {
      // stagedOnly：在 hunk 弹窗里部分暂存过的文件，提交时跳过整文件 add（加校验，同样不能越界）
      const stagedOnly = Array.isArray(body.stagedOnly) ? (body.stagedOnly as unknown[]).map(String) : [];
      const badStaged = stagedOnly.find((sp) => !inRepoRoot(repo.root, path.resolve(repo.root, sp)));
      if (badStaged) {
        // 路径超出工作副本范围: {path}
        sendJson(res, 400, { error: t('srv.pathOutOfWc', { path: badStaged }) });
        return true;
      }
      result = await vcs.commit(paths, msg, stagedOnly);
    }
    else if (p === '/api/update') {
      const dir = String(body.path ?? '');
      // update 的 dir 同样校验（空串 = 仓库根，通过）
      if (!inRepoRoot(repo.root, path.resolve(repo.root, dir))) {
        sendJson(res, 400, { error: MSG_PATH_OUT_OF_BOUNDS() });
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
      // 当前仓库不支持拉取
      ? (await vcs.pull?.(ac.signal)) ?? { ok: false, message: t('srv.pullUnsupported') }
      // 当前仓库不支持更新
      : (await vcs.update?.(dir || undefined, ac.signal)) ?? { ok: false, message: t('srv.updateUnsupported') };
      // 更新成功后自动恢复缺失文件（磁盘删除但版本库还在 → 拉回，消除 ! 标识）
      if (result.ok) {
        try {
          const missing = await vcs.restoreMissing();
          if (missing.length > 0) {
            // {msg}；已恢复 {n} 个缺失文件
            result = { ...result, message: t('srv.restoredMissing', { msg: result.message, n: missing.length }) };
          }
        } catch {
          /* 恢复失败不阻断更新结果 */
        }
      }
    } else if (p === '/api/revert') result = await vcs.revert(paths);
    else if (p === '/api/delete') result = body.keep === true ? await vcs.removeKeep(paths) : await vcs.remove(paths);
    else {
      // push：前端断开（后台任务面板「取消」/关页）→ 一并终止 git push 子进程（同 update 手法）
      const ac = new AbortController();
      res.on('close', () => {
        if (!res.writableEnded) ac.abort();
      });
      result = (await vcs.push?.(ac.signal)) ?? { ok: false, message: MSG_UNSUPPORTED_OP() };
    }
    if (result.ok) {
      invalidateStatusCache(repo.root); // 状态改变 → 失效 30s 缓存,否则新文件过滤仍显示旧 ?/M
      // update 后工作副本版本已变：最近项目的"远程检查"缓存也要失效，否则侧栏 ⬇ 角标
      // 要等 60s 过期才归零（拉取成功后界面仍显示"↓12"，用户实报）
      if (p === '/api/update') invalidateRemoteProbe(repo.root);
    }
    sendJson(res, 200, {
      ...(result as object),
      path: p === '/api/update' ? String(body.path ?? '') : undefined,
      authError: authErrorOf(result),
    });
    return true;
  }

  return false;
}
