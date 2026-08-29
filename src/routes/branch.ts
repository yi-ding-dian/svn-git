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

      if (p === '/api/merge-check') {
        // 合并预检：与切换同一交集判断（git 未实现 mergeCheck → 回退 switchCheck）；svn 额外带 outdated 检测
        const branch = String(url.searchParams.get('branch') ?? '');
        if (!branch) {
          sendJson(res, 400, { error: '缺少分支名' });
          return true;
        }
        const { vcs } = vcsOf();
        try {
          sendJson(res, 200, (await vcs.mergeCheck?.(branch)) ?? (await vcs.switchCheck(branch)));
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
        if (action === 'create') result = await vcs.branchCreate(name, String(body.base ?? '') || undefined);
        else if (action === 'switch') {
          result = await vcs.branchSwitch(name);
          // svn switch 会改写工作副本文件（回主干等）；git checkout 后工作区内容换分支——防旧状态残留
          if (result.ok) invalidateStatusCache(vcsOf().repo.root);
        }
        else if (action === 'delete') result = await vcs.branchDelete(name, Boolean(body.force));
        else if (action === 'merge') {
          result = await vcs.merge(name);
          // 合并成功/冲突都会让工作区状态骤变（C/MERGE_HEAD/干净），一律失效 30s 缓存
          //（冲突时虽然 ok=false，但界面需要立刻显示 C 状态，否则「解决冲突」入口不出现）
          invalidateStatusCache(vcsOf().repo.root);
        }
        else if (action === 'merge-abort') {
          result = (await vcs.mergeAbort?.()) ?? { ok: false, message: '当前仓库不支持中止合并' };
          // 中止后工作区/冲突状态全变，失效 30s 缓存（否则界面还显示旧的 C 状态）
          if (result.ok) invalidateStatusCache(vcsOf().repo.root);
        }
        else if (action === 'remote-delete') {
          // 删除远程分支：仅 git（svn 无本地/远程之分，删除分支即仓库删除）；网络操作可取消，同 push
          const { repo } = vcsOf();
          if (repo.type !== 'git') {
            sendJson(res, 400, { error: '仅 Git 仓库支持' });
            return true;
          }
          if (!name.includes('/')) {
            sendJson(res, 400, { error: '需远程分支名（origin/名字）' });
            return true;
          }
          const ac = new AbortController();
          res.on('close', () => {
            if (!res.writableEnded) ac.abort();
          });
          result = (await vcs.branchRemoteDelete?.(name, ac.signal)) ?? { ok: false, message: '当前仓库不支持该操作' };
        }
        else if (action === 'push') {
          // 分支推送可取消：客户端断开（fetch abort → res close 且未写完）时终止 git push 子进程
          const ac = new AbortController();
          res.on('close', () => {
            if (!res.writableEnded) ac.abort();
          });
          result = (await vcs.branchPush?.(name, ac.signal)) ?? { ok: false, message: '当前仓库类型不支持分支推送' };
        }
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
        // --soft 撤销后改动回到暂存区：失效 30s 状态缓存（否则主界面还显示"已提交"的干净状态）
        if (result.ok) invalidateStatusCache(vcsOf().repo.root);
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
        if (action === 'push') {
          const paths = Array.isArray(body.paths) ? body.paths.map(String).filter(Boolean) : undefined;
          result = (await vcs.stashPush?.(String(body.message ?? ''), paths?.length ? paths : undefined)) ?? { ok: false, message: '当前仓库不支持该操作' };
          // stash 后工作区变干净：失效 30s 缓存，否则弹窗内的可暂存文件列表显示旧状态
          if (result.ok) invalidateStatusCache(vcsOf().repo.root);
        }
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
