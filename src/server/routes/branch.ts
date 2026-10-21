/** 版本管理扩展域端点：branches / branch / tags / tag / stash / git 子操作 */
import { sendJson, readBody, vcsOf, authErrorOf, invalidateStatusCache, runVcs, MSG_UNSUPPORTED_OP } from './util.js';
import { progressDone } from '../../transfer-progress.js';
import { invalidateRemoteProbe } from './recent.js';
import { t } from '../../shared/i18n/index.js';
import type { VcsResult } from '../../vcs/index.js';
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
          // 缺少分支名
          sendJson(res, 400, { error: t('srv.missingBranch') });
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
          // 缺少分支名
          sendJson(res, 400, { error: t('srv.missingBranch') });
          return true;
        }
        const { vcs } = vcsOf();
        try {
          // path：svn 只合并分支下某个目录/文件（空=整树）
          const mergePath = String(url.searchParams.get('path') ?? '').trim() || undefined;
          sendJson(res, 200, (await vcs.mergeCheck?.(branch, mergePath)) ?? (await vcs.switchCheck(branch)));
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
        // 取消/转后台统一（写操作链路）：客户端断开（任务面板「取消」）→ 杀掉在跑的子进程
        // （切换/合并可能几十秒——大仓库；推送/删除远程是网络操作）
        const ac = new AbortController();
        res.on('close', () => {
          if (!res.writableEnded) ac.abort();
        });
        if (action === 'create') result = await vcs.branchCreate(name, String(body.base ?? '') || undefined, ac.signal, String(body.message ?? '') || undefined);
        else if (action === 'delete-check') {
          // 删除前风险信息（最后提交 / 未合并版本数）；带 password 时顺带验证账号。
          // 密码不落盘、不进日志；git 不实现 → 返回 null
          sendJson(res, 200, (await vcs.branchDeleteCheck?.(name, String(body.password ?? '') || undefined)) ?? null);
          return true;
        }
        else if (action === 'switch') {
          result = await vcs.branchSwitch(name, ac.signal);
          // svn switch 会改写工作副本文件（回主干等）；git checkout 后工作区内容换分支——防旧状态残留
          if (result.ok) {
            invalidateStatusCache(vcsOf().repo.root);
            // 分支变了，远端"待拉取"数也随之变（三源取大里的 remoteProbe）——不清会挂着旧分支的 ⬇ 角标
            invalidateRemoteProbe(vcsOf().repo.root);
          }
        }
        else if (action === 'delete') {
          // 服务端二次校验：前端要求输入分支名，绕过前端直接打 API 也不能误删
          const confirmName = String(body.confirmName ?? '');
          if (confirmName !== name) {
            // 分支名确认不一致，未删除
            sendJson(res, 400, { error: t('srv.deleteConfirmMismatch') });
            return true;
          }
          // password：仅 svn 使用（可选，验证后即用即丢）；message：svn 提交信息（可编辑，空则后端回退模板）
          result = await vcs.branchDelete(name, Boolean(body.force), ac.signal, String(body.password ?? '') || undefined, String(body.message ?? '') || undefined);
        }
        else if (action === 'merge') {
          // path：svn 只合并分支下某个目录/文件（空=整树；git 忽略）
          result = await vcs.merge(name, String(body.path ?? '').trim() || undefined, ac.signal);
          // 合并成功/冲突都会让工作区状态骤变（C/MERGE_HEAD/干净），一律失效 30s 缓存
          //（冲突时虽然 ok=false，但界面需要立刻显示 C 状态，否则「解决冲突」入口不出现）
          invalidateStatusCache(vcsOf().repo.root);
          // 合并改变当前分支内容（git 快进/合并提交；svn 工作副本），远程待拉取数同样要重算
          invalidateRemoteProbe(vcsOf().repo.root);
        }
        else if (action === 'merge-abort') {
          // 当前仓库不支持中止合并
          result = (await vcs.mergeAbort?.()) ?? { ok: false, message: t('srv.mergeAbortUnsupported') };
          // 中止后工作区/冲突状态全变，失效 30s 缓存（否则界面还显示旧的 C 状态）
          if (result.ok) invalidateStatusCache(vcsOf().repo.root);
        }
        else if (action === 'remote-delete') {
          // 删除远程分支：仅 git（svn 无本地/远程之分，删除分支即仓库删除）；网络操作可取消，同 push
          const { repo } = vcsOf();
          if (repo.type !== 'git') {
            // 仅 Git 仓库支持
            sendJson(res, 400, { error: t('srv.gitOnly') });
            return true;
          }
          if (!name.includes('/')) {
            // 需远程分支名（origin/名字）
            sendJson(res, 400, { error: t('srv.remoteBranchName') });
            return true;
          }
          // 远程主干同本地主干保护：main/master/trunk 是团队稳定分支，不允许删除（防绕过界面直接调接口）
          const bare = name.split('/').slice(1).join('/');
          if (bare === 'main' || bare === 'master' || bare === 'trunk') {
            // 主干分支不能删除（团队稳定版本，防止误删）
            sendJson(res, 400, { error: t('srv.trunkNoDelete') });
            return true;
          }
          result = (await vcs.branchRemoteDelete?.(name, ac.signal)) ?? { ok: false, message: MSG_UNSUPPORTED_OP() };
        }
        else if (action === 'push') {
          // 当前仓库类型不支持分支推送
          result = (await vcs.branchPush?.(name, ac.signal)) ?? { ok: false, message: t('srv.branchPushUnsupported') };
        }
        else if (action === 'fetch') {
          // 获取远程更新（git 独有）：只刷新远程跟踪引用/分支列表，不改工作区、不改本地分支；
          // 远程引用变了，项目探测/待拉取角标依赖的缓存也要失效
          result = (await vcs.fetchRemote?.(ac.signal)) ?? { ok: false, message: MSG_UNSUPPORTED_OP() };
          invalidateStatusCache(vcsOf().repo.root);
        }
        else if (action === 'update') {
          // 快进更新指定本地分支（git 独有）：当前分支会改工作区，成功/失败都让状态缓存失效
          result = (await vcs.branchUpdate?.(name, Number(body.ahead) || 0, Number(body.behind) || 0, ac.signal)) ?? { ok: false, message: MSG_UNSUPPORTED_OP() };
          invalidateStatusCache(vcsOf().repo.root);
        }
        else {
          // 未知操作
          sendJson(res, 400, { error: t('srv.unknownAction') });
          return true;
        }
        sendJson(res, 200, { ...result, authError: authErrorOf(result) });
        return true;
      }

      if (p === '/api/project-migrate' && req.method === 'POST') {
        // 项目迁移（仅 svn）：当前工作副本独立成长期开发线 / 独立项目
        const { vcs, repo } = vcsOf();
        if (repo.type !== 'svn') {
          // 仅 SVN 仓库支持
          sendJson(res, 400, { error: t('srv.svnOnly') });
          return true;
        }
        const body = await readBody(req);
        const mode = String(body.mode ?? '');
        const name = String(body.name ?? '').trim();
        if (mode !== 'devline' && mode !== 'project') {
          // 未知操作
          sendJson(res, 400, { error: t('srv.unknownAction') });
          return true;
        }
        if (!name) {
          // 缺少名称
          sendJson(res, 400, { error: t('srv.missingName') });
          return true;
        }
        // 网络写操作（svn copy / mkdir / switch）可取消：客户端断开即杀子进程
        const ac = new AbortController();
        res.on('close', () => {
          if (!res.writableEnded) ac.abort();
        });
        const trunkSubPath = typeof body.trunkSubPath === 'string' ? body.trunkSubPath : undefined;
        const extraDirs = Array.isArray(body.extraDirs) ? body.extraDirs.filter((d): d is string => typeof d === 'string') : undefined;
        const chan = typeof body.chan === 'string' ? body.chan : undefined;
        let result: VcsResult & { targetUrl?: string };
        try {
          result = (await vcs.projectMigrate?.(mode, name, Boolean(body.switchAfter), ac.signal, trunkSubPath, extraDirs, chan)) ?? {
            ok: false,
            message: MSG_UNSUPPORTED_OP(),
          };
        } finally {
          // 阶段进度表随手清理（成功/失败/取消都不留）
          if (chan) progressDone(chan);
        }
        // 迁移后工作副本可能已 switch 到新路径：状态缓存失效（项目根由下次请求重新探测）
        if (result.ok) invalidateStatusCache(repo.root);
        sendJson(res, 200, { ...result, authError: authErrorOf(result) });
        return true;
      }

      if (p === '/api/merge-mainline' && req.method === 'POST') {
        // 合回主干（仅 svn）：识别主干对应路径，并在主干工作副本上拉取合并
        const { vcs, repo } = vcsOf();
        if (repo.type !== 'svn') {
          sendJson(res, 400, { error: t('srv.svnOnly') });
          return true;
        }
        const body = await readBody(req);
        const action = String(body.action ?? '');
        const targetDir = String(body.targetDir ?? '').trim();
        const mergePath = String(body.path ?? '').trim() || undefined;
        if (action === 'check') {
          const plan = await vcs.mergeMainlineCheck?.(targetDir, mergePath);
          if (!plan) {
            sendJson(res, 400, { error: MSG_UNSUPPORTED_OP() });
            return true;
          }
          sendJson(res, 200, plan);
          return true;
        }
        if (action === 'run') {
          const ac = new AbortController();
          res.on('close', () => {
            if (!res.writableEnded) ac.abort();
          });
          const result = (await vcs.mergeMainline?.(targetDir, Boolean(body.autoCommit), mergePath, ac.signal)) ?? {
            ok: false,
            message: MSG_UNSUPPORTED_OP(),
          };
          sendJson(res, 200, { ...result, authError: authErrorOf(result) });
          return true;
        }
        // 未知操作
        sendJson(res, 400, { error: t('srv.unknownAction') });
        return true;
      }

      if (p === '/api/commit-message') {
        // 读取提交的完整说明（标题+正文，仅 git）：「修改注释」弹窗回显（列表接口只带标题）
        const { vcs, repo } = vcsOf();
        if (repo.type !== 'git') {
          // 仅 Git 仓库支持
          sendJson(res, 400, { error: t('srv.gitOnly') });
          return true;
        }
        const rev = String(url.searchParams.get('rev') ?? '').trim();
        if (!rev) {
          // 缺少 rev 参数
          sendJson(res, 400, { error: t('srv.missingRev') });
          return true;
        }
        try {
          const message = (await vcs.commitMessage?.(rev)) ?? '';
          sendJson(res, 200, { message });
        } catch (e) {
          sendJson(res, 400, { error: (e as Error).message });
        }
        return true;
      }

      if (p === '/api/commit-messages' && req.method === 'POST') {
        // 批量读取提交完整说明（仅 git）：提交列表悬浮提示（列表接口只带 %s 标题）
        const { vcs, repo } = vcsOf();
        if (repo.type !== 'git') {
          // 仅 Git 仓库支持
          sendJson(res, 400, { error: t('srv.gitOnly') });
          return true;
        }
        const body = await readBody(req);
        const revs = Array.isArray(body.revs) ? body.revs.map((r) => String(r)).filter(Boolean) : [];
        if (revs.length === 0) {
          sendJson(res, 200, { messages: {} });
          return true;
        }
        try {
          const messages = (await vcs.commitMessages?.(revs)) ?? {};
          sendJson(res, 200, { messages });
        } catch (e) {
          sendJson(res, 400, { error: (e as Error).message });
        }
        return true;
      }

      if (p === '/api/git-amend' && req.method === 'POST') {
        // 修改最近一次提交注释（仅 git）
        const { vcs, repo } = vcsOf();
        if (repo.type !== 'git') {
          // 仅 Git 仓库支持
          sendJson(res, 400, { error: t('srv.gitOnly') });
          return true;
        }
        const body = await readBody(req);
        const message = String(body.message ?? '').trim();
        if (!message) {
          // 注释不能为空
          sendJson(res, 400, { error: t('srv.messageRequired') });
          return true;
        }
        const result = (await vcs.amend?.(message)) ?? { ok: false, message: MSG_UNSUPPORTED_OP() };
        sendJson(res, 200, { ...result, authError: authErrorOf(result) });
        return true;
      }

      if (p === '/api/git-reword' && req.method === 'POST') {
        // 修改任意未推送提交的注释（rebase -i reword，仅 git）
        const { vcs, repo } = vcsOf();
        if (repo.type !== 'git') {
          // 仅 Git 仓库支持
          sendJson(res, 400, { error: t('srv.gitOnly') });
          return true;
        }
        const body = await readBody(req);
        const hash = String(body.hash ?? '').trim();
        const message = String(body.message ?? '').trim();
        if (!hash || !message) {
          // 参数不完整
          sendJson(res, 400, { error: t('srv.incompleteParams') });
          return true;
        }
        const result = (await vcs.reword?.(hash, message)) ?? { ok: false, message: MSG_UNSUPPORTED_OP() };
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
          // 仅 Git 仓库支持
          sendJson(res, 400, { error: t('srv.gitOnly') });
          return true;
        }
        // --soft 撤销后改动回到暂存区：runVcs 内部统一失效 30s 状态缓存（否则主界面还显示"已提交"的干净状态）
        return runVcs(ctx, () => vcs.resetSoft?.());
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
          // 未知操作
          sendJson(res, 400, { error: t('srv.unknownAction') });
          return true;
        }
        sendJson(res, 200, { ...result, authError: authErrorOf(result) });
        return true;
      }

      if (p === '/api/stash') {
        const { vcs, repo } = vcsOf();
        if (repo.type !== 'git') {
          // SVN 不支持 Stash 功能
          sendJson(res, 200, { ok: false, message: t('srv.svnNoStash') });
          return true;
        }
        if (req.method === 'GET') {
          // 带 index = 查该条 stash 的内容文件列表（储藏弹窗点行展开用）
          const idxRaw = url.searchParams.get('index');
          if (idxRaw !== null) {
            const files = (await vcs.stashFiles?.(Number(idxRaw))) ?? [];
            sendJson(res, 200, { files });
            return true;
          }
          const list = (await vcs.stashList?.()) ?? [];
          sendJson(res, 200, { items: list });
          return true;
        }
        const body = await readBody(req);
        const action = String(body.action ?? '');
        let result: VcsResult;
        if (action === 'push') {
          const paths = Array.isArray(body.paths) ? body.paths.map(String).filter(Boolean) : undefined;
          result = (await vcs.stashPush?.(String(body.message ?? ''), paths?.length ? paths : undefined)) ?? { ok: false, message: MSG_UNSUPPORTED_OP() };
          // stash 后工作区变干净：失效 30s 缓存，否则弹窗内的可储藏文件列表显示旧状态
          if (result.ok) invalidateStatusCache(vcsOf().repo.root);
        }
        else if (action === 'pop') result = (await vcs.stashPop?.(Number(body.index ?? 0))) ?? { ok: false, message: MSG_UNSUPPORTED_OP() };
        else if (action === 'drop') result = (await vcs.stashDrop?.(Number(body.index ?? 0))) ?? { ok: false, message: MSG_UNSUPPORTED_OP() };
        else {
          // 未知操作
          sendJson(res, 400, { error: t('srv.unknownAction') });
          return true;
        }
        sendJson(res, 200, { ...result, authError: authErrorOf(result) });
        return true;
      }

  return false;
}
