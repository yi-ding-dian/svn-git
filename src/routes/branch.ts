/** 版本管理扩展域端点：branches / branch / tags / tag / stash / git 子操作 */
import { sendJson, readBody, vcsOf, isAuthError, authErrorOf, invalidateStatusCache } from './util.js';
import type { VcsResult } from '../vcs/index.js';
import type { Ctx } from './util.js';

export async function handle(ctx: Ctx): Promise<boolean> {
  const { req, res, url } = ctx;
  const p = url.pathname;

      if (p === '/api/branches') {
        const { vcs } = vcsOf();
        const r = await vcs.branchList();
        sendJson(res, 200, r);
        return true;
      }

      if (p === '/api/switch-check') {
        // 切换分支前检查：工作区改动统计 + 与目标分支冲突文件（前端据此决定直接切/提示确认）
        const branch = String(url.searchParams.get('branch') ?? '');
        if (!branch) {
          sendJson(res, 400, { error: '缺少分支名' });
          return true;
        }
        const { vcs } = vcsOf();
        try {
          sendJson(res, 200, await vcs.switchCheck(branch));
        } catch (e) {
          sendJson(res, 500, { error: (e as Error).message });
        }
        return true;
      }

      if (p === '/api/branch' && req.method === 'POST') {
        const { vcs } = vcsOf();
        const body = await readBody(req);
        const action = String(body.action ?? '');
        const name = String(body.name ?? '');
        let result: VcsResult;
        if (action === 'create') result = await vcs.branchCreate(name);
        else if (action === 'switch') result = await vcs.branchSwitch(name);
        else if (action === 'delete') result = await vcs.branchDelete(name, Boolean(body.force));
        else if (action === 'merge') result = await vcs.merge(name);
        else if (action === 'merge-abort') {
          result = (await vcs.mergeAbort?.()) ?? { ok: false, message: '当前仓库不支持中止合并' };
          // 中止后工作区/冲突状态全变，失效 30s 缓存（否则界面还显示旧的 C 状态）
          if (result.ok) invalidateStatusCache(vcsOf().repo.root);
        }
        else if (action === 'push') result = (await vcs.branchPush?.(name)) ?? { ok: false, message: '当前仓库类型不支持分支推送' };
        else {
          sendJson(res, 400, { error: '未知操作' });
          return true;
        }
        sendJson(res, 200, { ...result, authError: authErrorOf(result) });
        return true;
      }

      if (p === '/api/git-amend' && req.method === 'POST') {
        // 修改最近一次提交注释（仅 git）
        const { vcs, repo } = vcsOf();
        if (repo.type !== 'git') {
          sendJson(res, 400, { error: '仅 git 仓库支持' });
          return true;
        }
        const body = await readBody(req);
        const message = String(body.message ?? '').trim();
        if (!message) {
          sendJson(res, 400, { error: '注释不能为空' });
          return true;
        }
        const result = (await vcs.amend?.(message)) ?? { ok: false, message: '当前仓库不支持该操作' };
        sendJson(res, 200, { ...result, authError: authErrorOf(result) });
        return true;
      }

      if (p === '/api/git-reword' && req.method === 'POST') {
        // 修改任意未推送提交的注释（rebase -i reword，仅 git）
        const { vcs, repo } = vcsOf();
        if (repo.type !== 'git') {
          sendJson(res, 400, { error: '仅 git 仓库支持' });
          return true;
        }
        const body = await readBody(req);
        const hash = String(body.hash ?? '').trim();
        const message = String(body.message ?? '').trim();
        if (!hash || !message) {
          sendJson(res, 400, { error: '参数不完整' });
          return true;
        }
        const result = (await vcs.reword?.(hash, message)) ?? { ok: false, message: '当前仓库不支持该操作' };
        sendJson(res, 200, { ...result, authError: authErrorOf(result) });
        return true;
      }

      if (p === '/api/git-unpushed-count') {
        // 未推送提交数量（推送按钮角标，仅 git）
        const { vcs, repo } = vcsOf();
        if (repo.type !== 'git') {
          sendJson(res, 200, { count: 0 });
          return true;
        }
        const count = await vcs.unpushedCount?.();
        sendJson(res, 200, { count });
        return true;
      }

      if (p === '/api/git-unpushed') {
        // 未推送提交完整列表（含变更文件，推送确认弹窗，仅 git）
        const { vcs, repo } = vcsOf();
        if (repo.type !== 'git') {
          sendJson(res, 200, { count: 0, unpushed: [] });
          return true;
        }
        const unpushed = (await vcs.unpushedLog?.()) ?? [];
        sendJson(res, 200, { count: unpushed.length, unpushed });
        return true;
      }

      if (p === '/api/git-reset' && req.method === 'POST') {
        // 撤销最近一次提交（--soft 保留修改，仅 git）
        const { vcs, repo } = vcsOf();
        if (repo.type !== 'git') {
          sendJson(res, 400, { error: '仅 git 仓库支持' });
          return true;
        }
        const result = (await vcs.resetSoft?.()) ?? { ok: false, message: '当前仓库不支持该操作' };
        sendJson(res, 200, { ...result, authError: authErrorOf(result) });
        return true;
      }

      if (p === '/api/tags') {
        const { vcs } = vcsOf();
        const tags = await vcs.tagList();
        // svn 附带仓库布局探测（git 无 layout 方法，?. 跳过）
        const layout = await vcs.layout?.().catch(() => undefined);
        sendJson(res, 200, layout ? { tags, layout } : { tags });
        return true;
      }

      if (p === '/api/tag' && req.method === 'POST') {
        const { vcs } = vcsOf();
        const body = await readBody(req);
        const action = String(body.action ?? '');
        const name = String(body.name ?? '');
        let result: VcsResult;
        if (action === 'create') result = await vcs.tagCreate(name);
        else if (action === 'delete') result = await vcs.tagDelete(name);
        else {
          sendJson(res, 400, { error: '未知操作' });
          return true;
        }
        sendJson(res, 200, { ...result, authError: authErrorOf(result) });
        return true;
      }

      if (p === '/api/stash') {
        const { vcs, repo } = vcsOf();
        if (repo.type !== 'git') {
          sendJson(res, 200, { ok: false, message: 'SVN 不支持 Stash 功能' });
          return true;
        }
        if (req.method === 'GET') {
          const list = (await vcs.stashList?.()) ?? [];
          sendJson(res, 200, { items: list });
          return true;
        }
        const body = await readBody(req);
        const action = String(body.action ?? '');
        let result: VcsResult;
        if (action === 'push') result = (await vcs.stashPush?.(String(body.message ?? ''))) ?? { ok: false, message: '当前仓库不支持该操作' };
        else if (action === 'pop') result = (await vcs.stashPop?.(Number(body.index ?? 0))) ?? { ok: false, message: '当前仓库不支持该操作' };
        else if (action === 'drop') result = (await vcs.stashDrop?.(Number(body.index ?? 0))) ?? { ok: false, message: '当前仓库不支持该操作' };
        else {
          sendJson(res, 400, { error: '未知操作' });
          return true;
        }
        sendJson(res, 200, { ...result, authError: authErrorOf(result) });
        return true;
      }

  return false;
}
