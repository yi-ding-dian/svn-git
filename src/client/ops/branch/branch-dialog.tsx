/** 分支管理弹窗（容器）：加载/操作编排/列表；展示与独立流程拆到同域子文件 */
import React, { useEffect, useRef, useState } from 'react';
import { get, post, type BranchInfo } from '../../shared/api.js';
import { ModalShell } from '../../shell/modal-shell.js';
import { IconBranch } from '../../ui/icons.js';
import { ConfirmModal } from '../../ui/prompt.js';
import { cmdOfRepo } from '../../shared/cmd-preview.js';
import { isImeComposing } from '../../shared/utils.js';
import { useTasks } from '../../shared/tasks.js';
import { startTaskDeferred } from '../../shell/bg-defer.js';
import { launchMagicFlight } from '../../animations/index.js';
import { ResultLine } from '../../ui/result-line.js';
import { t } from '../../../shared/i18n/index.js';
import { LayoutNote } from '../layout-note.js';
import { BRANCH_TITLE_KEY, currentLabelOf, isTrunkName, mergeSourceNoteOf, mergeTargetOf, type BranchAction, type BranchCheckoutPayload, type PickDirRequest } from './branch-shared.js';
import { BranchHelp } from './branch-help.js';
import { BranchList } from './branch-list.js';
import { CreateBranchConfirm } from './create-branch-confirm.js';
import { DeleteBranchModal } from './delete-branch-modal.js';
import { ProjectMigratePanel } from './project-migrate-panel.js';
import { MergeScopeDialog } from './merge-scope-dialog.js';
import { MergeSourceTarget } from './merge-source-target.js';

export function BranchDialog(props: {
  repoType: 'svn' | 'git';
  /** 当前工作副本本地根：合并范围目录浏览起点、项目迁移内容预览 */
  workDir?: string;
  /** 目录选择弹窗注入：ops 域不能直接引用 repo 的目录浏览器，由 shell 提供 */
  onPickDir?: (req: PickDirRequest) => void;
  /** 打开 Git 工作树管理（宿主渲染，避免 ops 引用 repo 域） */
  onManageWorktrees?: () => void;
  /** 检出该分支为独立工作副本（宿主渲染检出弹窗并执行） */
  onCheckoutBranch?: (b: BranchCheckoutPayload) => void;
  onClose: () => void;
  onChanged: () => void;
  /** 鼠标附近弹的全局提示（err=true 时按错误态显示、停留更久）：操作结果在弹窗里只有底部一行小字，
   *  点完视线不往那儿去就看不到（用户实报"点了没反应"）——两处都显示。
   *  durationMs：自定义停留时长（转后台提示用 2 秒） */
  onToast: (msg: string, err?: boolean, quick?: boolean, durationMs?: number) => void;
}) {
  const [data, setData] = useState<BranchInfo | null>(null);
  const [sel, setSel] = useState('');
  const [newName, setNewName] = useState('');
  const [msg, setMsg] = useState('');
  const [msgErr, setMsgErr] = useState(false);
  /** 分支任务运行中（操作忙碌——按钮禁用统一用它）：从任务 store 派生，不再单独维护 state */
  const bgTasks = useTasks();
  const busy = bgTasks.some((tk) => tk.kind === 'branch' && tk.status === 'running');
  /** 飞线起点：分支操作统一经确认框——确认按钮点击时记下它的位置（3 秒转后台时从这里起飞） */
  const fromRef = useRef<{ x: number; y: number } | null>(null);
  // 是否配置了远程：没有 origin 的本地孤仓库不显示「推送到远程」（推了也会失败）
  const [hasRemote, setHasRemote] = useState(false);
  // 工具风格二次确认
  const [cfm, setCfm] = useState<{ title: string; msg: React.ReactNode; action: () => void; confirmLabel?: string; hideCancel?: boolean; confirmCmd?: string; commands?: string[]; danger?: boolean } | null>(null);
  /** 新建分支确认：name=目标名；trunkBase=git 找到的主干基点 */
  const [createCfm, setCreateCfm] = useState<{ name: string; trunkBase?: string } | null>(null);
  /** 删除分支确认弹窗（SVN：输入分支名 + 可选密码）；值为要删除的分支名 */
  const [deleteFor, setDeleteFor] = useState<string | null>(null);
  /** 删除确认里输入的密码/分支名/提交信息（只在本次 act 调用内传递，用完即清，不落任何状态/存储） */
  const deleteSecretRef = useRef<{ confirmName: string; password?: string; username?: string; message?: string } | null>(null);
  /** 新建分支弹窗里编辑的提交信息（svn copy 立即提交；git 忽略） */
  const createMsgRef = useRef<string | null>(null);
  /** SVN 项目迁移面板 */
  const [migrateOpen, setMigrateOpen] = useState(false);

  /** 当前位置的可读名称（svn：tags/SCA_HB、branches/xxx；git 原样） */
  const currentLabel = currentLabelOf(data);
  /** 合并目标 = 当前工作副本位置（列表 tooltip 与确认弹窗共用同一判断） */
  const mergeTarget = mergeTargetOf(props.repoType, data);

  const load = () => {
    get
      .branches()
      .then((r) => {
        setData(r);
        if (!sel && r.current) setSel(r.current);
      })
      .catch((e: Error) => {
        setMsg(e.message);
        setMsgErr(true);
      });
    get
      .remotes()
      .then((r) => setHasRemote(r.remotes.length > 0))
      .catch(() => setHasRemote(false)); // 查询失败按无远程处理（隐藏按钮，保守安全）
  };
  useEffect(load, []); // eslint-disable-line react-hooks/exhaustive-deps

  /** 3 秒转后台的统一收尾：收起弹窗 + 飞线 + 轻提示（子面板共用）
   *  提示 2 秒后自动消失（用户定稿：转后台的确认提示不用停留太久） */
  const background = (title: string, from?: { x: number; y: number }) => {
    props.onClose();
    if (from) launchMagicFlight(from);
    props.onToast(t('shell.tasks.backgrounded', { title }), false, false, 2000);
  };

  /** 分支操作统一入口（**3 秒延迟后台化**——用户定稿）：任务从发起起就在 store 里，
   *  3 秒内完成：弹窗内照常收尾（结果行/列表刷新），用户无感；
   *  超时未完成：收起弹窗 + 飞线（起点=确认按钮）+ 轻提示"已转入后台"，完成走统一通知。 */
  const act = (action: BranchAction, name: string, force = false, base?: string, pathRel?: string, track?: { ahead: number; behind: number }) => {
    const title = t(BRANCH_TITLE_KEY[action], { name });
    const from = fromRef.current ?? undefined;
    fromRef.current = null; // 用掉即清（每次确认时重新记）
    // 获取远程 / 更新分支 / 新建分支：点击（或确认）当下就飞线——任务再快也能看到反馈；
    // 3 秒后转后台时不再重复飞，只收起弹窗 + 提示。其余分支操作仍保持"转后台才飞"
    const flyNow = action === 'fetch' || action === 'update' || action === 'create';
    if (flyNow && from) launchMagicFlight(from);
    // 切换进度通道：svn switch 每处理一个条目输出一行，后端按行上报「已处理 N 个文件」
    const chan = action === 'switch' ? `switch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` : undefined;
    startTaskDeferred({
      kind: 'branch',
      title,
      ...(chan ? { chan } : {}),
      run: async (signal) => {
        // 删除确认里输入的密码/分支名/提交信息：只取一次，防止 3 秒后转后台时还挂在 ref 上
        const del = action === 'delete' ? deleteSecretRef.current : null;
        deleteSecretRef.current = null;
        const createMsg = action === 'create' ? createMsgRef.current : null;
        createMsgRef.current = null;
        // fetch 只刷新远程引用（无分支名）；update 需要 ahead/behind 判断能否快进
        const r = action === 'fetch'
          ? await post.branch('fetch', '', false, signal)
          : action === 'update'
            ? await post.branch('update', name, false, signal, undefined, undefined, track?.ahead ?? 0, track?.behind ?? 0)
            : action === 'create'
              // svn：提交信息可由弹窗编辑（空则后端回退模板）；git 无提交，忽略
              ? await post.branchCreate(name, base, createMsg ?? undefined, signal)
              : action === 'delete'
                // svn：服务端校验 confirmName 后才删；password 可选（验证后即用即丢）；message 可编辑
                ? await post.branchDelete(name, del?.confirmName ?? name, del?.password, del?.username, del?.message, signal)
                : action === 'switch'
                  // svn：带进度通道，任务详情显示已处理文件数
                  ? await post.branchSwitch(name, chan, signal)
                  : await post.branch(action, name, force, signal, base, pathRel);
        // 未合并导致删除被拒 → 不干巴巴报错，改弹"强制删除"二次确认（3 秒内弹窗还开着才有意义；
        // 已转后台的失败可从通知里看到提示后重新进弹窗强删）。
        // （确认框文案早就写着"可强制删除"，但 force 从没传下去过，未合并的分支根本删不掉 —— 用户实报）
        if (action === 'delete' && !r.ok && !force && /没有完全合并|not fully merged/.test(r.message)) { // i18n-ignore: 解析 git 命令输出的中英文报错（判断"未合并"）
          setCfm({
            // ⚠ 分支未完全合并
            title: t('ops.branch.notMergedTitle'),
            // 强制删除会永久丢失该分支上未合并的提交，无法恢复。仍要删除吗？
            msg: `${r.message}\n\n${t('ops.branch.notMergedBody')}`,
            danger: true,
            // 强制删除
            confirmLabel: t('ops.branch.forceDelete'),
            commands: [`git branch -D ${name}`],
            action: () => act('delete', name, true),
          });
          return { ok: false, message: r.message };
        }
        // 可在「解决冲突」中用「中止合并」放弃本次合并
        const text = action === 'merge' && !r.ok ? `${r.message} ${t('ops.branch.mergeAbortHint')}` : r.message;
        setMsg(text);
        setMsgErr(!r.ok);
        // 成功刷新；合并"失败"（冲突 ok=false）时工作区也已变化——同样刷新后「解决冲突」入口才出现；
        // fetch/update 失败时远程引用也可能已部分更新，一并刷新避免徽标停在旧值
        if (r.ok || action === 'merge' || action === 'fetch' || action === 'update') {
          load();
          props.onChanged();
        }
        return { ok: r.ok, message: text };
      },
      // 起飞方向已在点击/确认时飞过（flyNow），转后台这里只负责收尾，不再重复飞
      onSlow: () => background(title, flyNow ? undefined : from),
    });
  };

  /** 新建分支确认：确保创建的分支能按要求合回主干——
   *  git：当前在非主干时可选基点（基于主干/当前分支），基于主干可避免"新分支包含当前分支已提交的改动、合回主干时一并进入"；
   *  svn：来源可选 trunk / 当前目录（非 trunk 检出的子项目也能开分支），默认按当前位置推断 */
  const confirmCreate = (name: string) => {
    const cur = data?.current;
    if (props.repoType === 'svn') {
      const canTrunk = Boolean(data?.layout?.trunk);
      const kind = data?.currentKind;
      // 从当前目录复制：项目根（或其他非布局位置）会把 branches/tags 一起卷进去，禁止（后端同样拒绝）
      const canCurrent = kind === 'trunk' || kind === 'branch' || kind === 'tag';
      if (!canTrunk && !canCurrent) {
        // 无法创建分支 / 知道了 / 仓库没有 trunk（非标准布局），无法创建分支 {name}。\n分支需从 trunk 复制才能保证合并回主干；请先补建 trunk 目录。
        setCfm({ title: t('ops.branch.cannotCreate'), confirmLabel: t('ui.modal.gotIt'), hideCancel: true, msg: t('ops.branch.noTrunkMsg', { name }), action: () => setCfm(null) });
        return;
      }
      setCreateCfm({ name });
      return;
    }
    // git：找主干基点（本地 main/master 优先，其次远程 origin/main|master）
    const trunkBase =
      data?.branches.find((b) => !b.remote && (b.name === 'main' || b.name === 'master'))?.name ??
      data?.branches.find((b) => b.remote && /^origin\/(main|master)$/.test(b.name))?.name;
    // 当前已在主干（或拿不到当前分支）→ 简单确认
    if (!cur || isTrunkName(cur)) {
      setCfm({
        // 新建分支
        title: t('ops.branch.createTitle'),
        msg: cur
          // 确认从主干 {cur} 创建分支 {name}？\n（新分支基于 {cur} 最新提交，开发后可直接合并回主干。创建后不自动切换，仍停留在 {cur}。）
          ? t('ops.branch.createFromHead', { cur, name })
          // 确认创建分支 {name}？\n（基于当前提交。创建后不自动切换。）
          : t('ops.branch.createPlain', { name }),
        // 创建
        confirmLabel: t('ops.branch.create'),
        confirmCmd: cmdOfRepo(props.repoType, 'branch_create', { name }),
        action: () => act('create', name),
      });
      return;
    }
    // 当前在非主干分支：找到主干 → 带基点选择的确认弹窗；找不到 → 警告确认（只能基于当前分支）
    if (trunkBase) {
      setCreateCfm({ name, trunkBase });
      return;
    }
    setCfm({
      // 新建分支
      title: t('ops.branch.createTitle'),
      // 确认基于当前分支 {cur} 创建分支 {name}？\n\n⚠ 仓库中未找到主干分支（main/master），新分支将包含 {cur} 已提交的全部改动——合回主干时这些改动也会一并进入。
      msg: t('ops.branch.createNoTrunk', { cur, name }),
      // 创建
      confirmLabel: t('ops.branch.create'),
      confirmCmd: cmdOfRepo(props.repoType, 'branch_create', { name }),
      action: () => act('create', name),
    });
  };

  // 切换 / 合并为影响工作区的操作，统一走二次确认（复用 ConfirmModal）。
  // 切换前先扫描工作区：无修改直接切换（零打扰）；有修改精确提示数量与风险文件（git 判断哪些会被拒绝）
  const confirmSwitch = async (name: string, isTrunk = false) => {
    let check: { changed: number; tracked: number; untracked: number; conflicts: string[] } | null = null;
    try {
      check = await get.switchCheck(name);
    } catch {
      /* 检查失败不阻塞，走默认确认流程 */
    }
    // svn：当前在 tags/独立目录——与 trunk/普通分支的目录层级可能不同，切换会整体替换目录树，不能零打扰
    const svnForeign = props.repoType === 'svn' && (data?.currentKind === 'tag' || data?.currentKind === 'other');
    // 工作区干净且层级正常 → 直接切换，不弹确认
    if (check && check.changed === 0 && !svnForeign) {
      act('switch', name);
      return;
    }
    let msg: string;
    if (props.repoType === 'svn') {
      // 当前在 tags/独立目录：提示层级风险（目标若不是从当前目录复制，切换会整体替换内容）
      const svnTarget = name === 'trunk' ? 'trunk' : `branches/${name}`;
      msg = svnForeign ? t('ops.branch.switchSvnForeign', { current: currentLabel, target: svnTarget }) : '';
      if (check && (check.tracked > 0 || check.untracked > 0)) {
        // 已跟踪改动才可能冲突；未跟踪文件不会被切换替换，单独说明
        const dirty = t('ops.branch.switchSvnWarnSplit', { tracked: check.tracked, untracked: check.untracked });
        // 逐个比对过目标分支的已跟踪改动（后端最多查 20 个）：列出前 3 个会冲突的
        let conflictNote = '';
        if (check.conflicts.length > 0) {
          const shown = check.conflicts.slice(0, 3).join(t('common.listSep'));
          conflictNote =
            '\n' +
            (check.conflicts.length > 3
              ? t('ops.branch.switchSvnConflictMore', { files: shown, n: check.conflicts.length })
              : t('ops.branch.switchSvnConflict', { files: shown }));
        }
        msg = msg ? `${msg}\n\n${dirty}${conflictNote}` : `${dirty}${conflictNote}`;
      } else if (!msg) {
        msg = t('ops.branch.switchSvnWarn', { n: check?.changed ?? '?' });
      }
    } else if (name.includes('/')) {
      const local = name.split('/').slice(1).join('/');
      // 确认切换到远程分支 {name}？将自动创建本地跟踪分支 {local} 并切换过去。
      msg = t('ops.branch.switchRemote', { name, local });
      // 当前有 {changed} 个文件未提交/未暂存（已跟踪 {tracked} 个、未跟踪 {untracked} 个），建议先提交或储藏。
      if (check) msg += t('ops.branch.dirtyFilesSuggest', { changed: check.changed, tracked: check.tracked, untracked: check.untracked });
    } else if (check) {
      // git 本地分支：能带过去的 vs 会被拒绝的（目标分支也改过这些文件）
      // 当前有 {changed} 个文件未提交/未暂存：已跟踪 {tracked} 个、未跟踪 {untracked} 个。
      msg = t('ops.branch.dirtyFiles', { changed: check.changed, tracked: check.tracked, untracked: check.untracked });
      // 会被拒绝的文件：{files}（目标分支也改过这些文件）
      if (check.conflicts.length > 0) msg += '\n' + t('ops.branch.willReject', { files: check.conflicts.join(t('common.listSep')) });
      // 建议先提交或储藏；仍要切换？
      msg += `\n\n${t('ops.branch.suggestSwitch')}`;
    } else {
      // 确认切换到分支 {name}？工作区有未提交修改且会被覆盖时，切换会失败（请先提交或储藏）。
      msg = t('ops.branch.switchWarn', { name });
    }
    const run = () => act('switch', name);
    setCfm({ title: t(isTrunk ? 'ops.branch.switchTrunkTitle' : 'ops.branch.switchTitle'), msg, action: run });
    // 结构差异摘要（svn/git）：异步补进确认框——大项目可能要几秒，不能让点「切换」卡住等
    get
      .switchPlan(name)
      .then((plan) => {
        if (!plan) return;
        const parts: string[] = [];
        if (plan.added || plan.deleted || plan.modified) {
          // 目标分支与当前内容差异：新增 {added} 个、删除 {deleted} 个、更新 {modified} 个文件。
          parts.push(t('ops.branch.switchPlan', { added: plan.added, deleted: plan.deleted, modified: plan.modified }));
        }
        if (plan.obstructed.length > 0) {
          // ⚠ 这些本地未跟踪文件会挡住切换：{files}（请先移走或提交）
          parts.push(
            t('ops.branch.switchPlanObstructed', {
              files: plan.obstructed.slice(0, 3).join(t('common.listSep')),
            }),
          );
        }
        if (plan.untrackedInDeleted.length > 0) {
          // svn：会产生树冲突；git：保留为未跟踪内容（文案不同）
          parts.push(
            t(
              props.repoType === 'git' ? 'ops.branch.switchPlanDeletedUntrackedGit' : 'ops.branch.switchPlanDeletedUntracked',
              { files: plan.untrackedInDeleted.slice(0, 3).join(t('common.listSep')) },
            ),
          );
        }
        if (parts.length === 0) return;
        // 只更新同一确认框（用户可能已点取消/确认，别把新弹窗内容覆盖掉）
        setCfm((prev) => (prev && prev.action === run ? { ...prev, msg: `${msg}\n\n${parts.join('\n')}` } : prev));
      })
      .catch(() => {
        /* 摘要失败：不显示，不影响切换 */
      });
  };
  /** 合并预检（/api/merge-check）：
   *  L1 工作区级：未提交改动 ∩ 分支改动文件 → 拦截（git 对未提交改动按文件级拒绝）；
   *  L2 提交级：merge-tree 三方试算的 lineConflicts——即使提交后再合并仍冲突的文件（两边已提交改动重叠）。
   *  L2 干净工作区时作为"合并将冲突"预先提示（可合并，解决冲突视图处理）；L1 拦截时作为"提交也没用"的预告。
   *  svn：outdated 拦截（WC 必须最新才能合并）+ 本地改动提示。 */
  /** SVN 合并范围对话框（选择整树或某个目录/文件）；Git 不经过这里 */
  const [mergeScopeFor, setMergeScopeFor] = useState<string | null>(null);

  /** 合并入口：SVN 先选范围（可留空），Git 保持原有直接确认流程 */
  const startMerge = (name: string) => {
    if (props.repoType === 'svn') {
      setMergeScopeFor(name);
      return;
    }
    void confirmMerge(name);
  };

  /** 合并确认正文：结构化「源 → 目标」+ 附加提示块（本地改动/副本落后/冲突预告/合并范围） */
  const mergeMsgNode = (source: string, notes: string[], extra?: string[], scope?: string) => {
    const blocks = [notes, extra ?? [], scope ? [t('ops.mergeScope.confirmNote', { path: scope })] : []].filter((b) => b.length > 0);
    return (
      <>
        <MergeSourceTarget
          source={source}
          sourceNote={mergeSourceNoteOf(props.repoType, source)}
          target={mergeTarget.name}
          targetIsWorkCopy={mergeTarget.isWorkCopy}
        />
        {blocks.map((b, i) => (
          <div key={i} style={{ whiteSpace: 'pre-wrap', marginTop: 10 }}>{b.join('\n')}</div>
        ))}
      </>
    );
  };

  const confirmMerge = async (name: string, scope?: string) => {
    let check: Awaited<ReturnType<typeof get.mergeCheck>> | null = null;
    try {
      check = await get.mergeCheck(name, scope);
    } catch {
      /* 检查失败不阻塞，走默认确认流程 */
    }
    const lineConflicts = check?.lineConflicts ?? [];
    // 干净且无冲突预告 → 直接合并（零打扰，与切换一致）；指定了范围时不零打扰，至少让用户看到范围命令
    if (check && check.changed === 0 && !check.outdated && lineConflicts.length === 0 && !scope) {
      act('merge', name);
      return;
    }
    const lines: string[] = [];
    if (check?.outdated) {
      // ⚠ 工作副本落后于仓库（r{wc} → r{head}）。
      lines.push(t('ops.branch.outdated', { wc: check.outdated.wcRev, head: check.outdated.headRev }));
      // SVN 要求合并前更新到最新，否则合的是旧 BASE——会产生虚假冲突或同一改动被重复合并。
      lines.push(t('ops.branch.outdatedNote'));
    }
    if (check && check.changed > 0) {
      if (props.repoType === 'svn') {
        // 当前有 {changed} 个文件的本地改动（未跟踪 {untracked} 个），合并会保留这些改动，但可能产生冲突。建议先提交。
        lines.push(t('ops.branch.mergeSvnDirty', { changed: check.changed, untracked: check.untracked }));
      } else {
        // 当前有 {changed} 个文件未提交/未暂存：已跟踪 {tracked} 个、未跟踪 {untracked} 个。
        lines.push(t('ops.branch.dirtyFiles', { changed: check.changed, tracked: check.tracked, untracked: check.untracked }));
        // 会被合并拒绝的文件：{files}（目标分支也改过这些文件）
        if (check.conflicts.length > 0) lines.push(t('ops.branch.mergeReject', { files: check.conflicts.join(t('common.listSep')) }));
      }
    }
    // L1 拦截：重叠（git）或 WC 落后（svn）→ 不执行合并，说明原因
    if (check && (check.conflicts.length > 0 || Boolean(check.outdated))) {
      lines.push('');
      // 请先提交或储藏这些文件，再重新合并。
      if (check.conflicts.length > 0) lines.push(t('ops.branch.mergeCommitFirst'));
      // 请先「更新」工作副本，再重新合并。
      if (check.outdated) lines.push(t('ops.branch.mergeUpdateFirst'));
      if (lineConflicts.length > 0) {
        lines.push('');
        // ⚠ 即使提交后再合并，以下文件仍会冲突（两边已改动相同区域）：
        lines.push(t('ops.branch.mergeStillConflict'));
        lines.push(lineConflicts.join(t('common.listSep')));
        // 建议先手动整合两边的改动成一个提交，再合并就顺利了。
        lines.push(t('ops.branch.mergeIntegrateHint'));
      }
      // 无法合并 / 知道了
      setCfm({ title: t('ops.branch.cannotMerge'), confirmLabel: t('ui.modal.gotIt'), hideCancel: true, msg: lines.join('\n'), action: () => setCfm(null) });
      return;
    }
    // L2 预告：工作区干净，但两分支已提交改动重叠 → 合并仍会冲突（不拦，由解决冲突视图收尾）
    if (check && check.changed === 0 && !check.outdated && lineConflicts.length > 0) {
      setCfm({
        // 合并分支（可能冲突）
        title: t('ops.branch.mergeMaybeConflict'),
        // ⚠ 合并将对 {n} 个文件产生冲突（两边已改动相同区域）：\n{files}\n\n仍要合并？合并后可在「解决冲突」中处理。
        msg: mergeMsgNode(
          name,
          [],
          [t('ops.branch.mergeConflictMsg', { n: lineConflicts.length, files: lineConflicts.join(t('common.listSep')) })],
          scope,
        ),
        action: () => act('merge', name, false, undefined, scope),
      });
      return;
    }
    setCfm({
      // 合并分支
      title: t('ops.branch.mergeTitle'),
      // 结构化「源 → 目标」+ 本地改动/副本落后等提示
      msg: mergeMsgNode(name, lines, undefined, scope),
      action: () => act('merge', name, false, undefined, scope),
    });
  };
  /** 推送到远程：本地分支未推送（无 origin/<名字>）时可推，首次自动建立上游跟踪。
   *  推送前检测工作区未提交修改（与切换/合并一致），提醒推送只包含已提交版本。 */
  /** 推送到远程：**只推已提交内容**，工作区未提交改动永远进不了推送，所以只提示、不拦截。
   *  - 当前分支：统计并提示工作区未提交改动（这些不会被推送）
   *  - 其它分支：工作区属于当前分支，与目标分支无关，不查、不误导
   *  - ahead 为空 = 首次推送（还没有 origin/<名>），提示自动建立跟踪 */
  const confirmPush = async (name: string, ahead?: number) => {
    const isCurrent = name === data?.current;
    let dirty = '';
    // 只有推当前分支时，工作区状态才和这次推送"有关"（提醒哪些内容不会被推）
    if (isCurrent) {
      let changed = 0;
      let untracked = 0;
      try {
        const st = await get.status();
        const items = st.items ?? [];
        changed = items.filter((i) => i.code && i.code !== ' ' && i.code !== 'I' && i.code !== 'X').length;
        untracked = items.filter((i) => i.code === '?').length;
      } catch {
        /* 检测失败不阻塞，按 0 处理 */
      }
      dirty = changed > 0
        // ⚠ 当前工作区有 {changed} 个未提交修改（含未跟踪 {untracked} 个）。\n推送只包含已提交的版本，这些修改不会被推上去。
        ? `\n\n${t('ops.branch.pushDirtyWarn', { changed, untracked })}`
        // 当前工作区无未提交修改。
        : `\n\n${t('ops.branch.pushClean')}`;
    }
    // ahead 有值 = 已有上游，能说清推几个提交；空 = 首次推送（行内按钮只在无 origin/同名 时出现）
    const base = ahead == null
      // 确认将本地分支 {name} 推送到远程服务器（origin）？\n首次推送会自动建立上游跟踪。
      ? t('ops.branch.pushMsg', { name })
      : isCurrent
        // 确认推送当前分支 {name} 的 {n} 个提交到 {upstream}？
        ? t('ops.branch.pushCurrentMsg', { name, n: ahead, upstream: `origin/${name}` })
        // 确认推送分支 {name} 的 {n} 个提交到 origin/{name}？
        : t('ops.branch.pushOtherMsg', { name, n: ahead });
    // 非当前分支：明确说工作区未提交内容与它无关，避免把"当前工作区有改动"误读成阻止推送
    const otherNote = !isCurrent && ahead != null
      // 当前工作区在 {current}；未提交内容属于当前分支，与 {name} 的这次推送无关。
      ? `\n\n${t('ops.branch.pushOtherNote', { current: data?.current ?? '', name })}`
      : '';
    setCfm({
      // 推送到远程
      title: t('ops.branch.pushTitle'),
      msg: `${base}${otherNote}${dirty}`,
      action: () => act('push', name),
    });
  };

  /** 快进更新指定本地分支（↓N 徽标点击）：
   *  当前分支 = fetch + merge --ff-only（会改工作区，提前提示未提交改动）；
   *  其它本地分支 = fetch origin <名>:<名>（不碰工作区）。
   *  分叉（ahead>0）不走到这里——由 showDiverged 只做说明。 */
  const confirmUpdate = async (name: string, ahead: number, behind: number) => {
    let dirtyNote = '';
    // 只有当前分支的更新会改工作区；其它分支的 fetch 不碰工作区
    if (name === data?.current) {
      try {
        const st = await get.status();
        const items = st.items ?? [];
        const changed = items.filter((i) => i.code && i.code !== ' ' && i.code !== '?' && i.code !== 'I' && i.code !== 'X').length;
        if (changed > 0) {
          // 当前有 {changed} 个文件未提交/未暂存，更新会尽量保留；与更新内容冲突时 git 会中止并保持现状。
          dirtyNote = `\n\n${t('ops.branch.updateDirtyNote', { changed })}`;
        }
      } catch {
        /* 检测失败不阻塞 */
      }
    }
    // 命令预览与后端实际执行保持一致（当前分支 merge --ff-only；其它分支 fetch 直接快进本地引用）
    const cmd = name === data?.current
      ? `git fetch origin ${name} && git merge --ff-only origin/${name}`
      : `git fetch origin ${name}:${name}`;
    setCfm({
      // 更新分支
      title: t('ops.branch.updateTitle'),
      // 确认将本地分支 {name} 快进更新到 {upstream}？\n远端领先 {behind} 个提交。
      msg: `${t('ops.branch.updateMsg', { name, upstream: `origin/${name}`, behind })}${dirtyNote}`,
      confirmCmd: cmd,
      action: () => act('update', name, false, undefined, undefined, { ahead, behind }),
    });
  };

  /** 分叉（↑N ↓M）点徽标：只说明原因，不做任何写操作 */
  const showDiverged = (name: string, ahead: number, behind: number) => {
    setCfm({
      // 无法快进更新
      title: t('ops.branch.divergedTitle'),
      // 本地 {name} 与 {upstream} 已分叉：本地领先 {ahead} 个提交，远端领先 {behind} 个提交。...
      msg: t('ops.branch.divergedMsg', { name, upstream: `origin/${name}`, ahead, behind }),
      confirmLabel: t('ui.modal.gotIt'),
      hideCancel: true,
      action: () => setCfm(null),
    });
  };

  /** 徽标点击总入口：↓ 更新；↑ 推送；↑↓ 只说明；✓ 在列表里不可点（不会走到这里） */
  const onTrackClick = ({ name, ahead, behind }: { name: string; ahead: number; behind: number }) => {
    if (ahead > 0 && behind > 0) {
      showDiverged(name, ahead, behind);
      return;
    }
    if (behind > 0) {
      void confirmUpdate(name, ahead, behind);
      return;
    }
    void confirmPush(name, ahead);
  };

  /** 删除远程分支：远程将不再存在（本地分支不受影响）；网络操作带进度窗可取消 */
  const confirmRemoteDelete = async (name: string) => {
    setCfm({
      // 删除远程分支
      title: t('ops.branch.remoteDeleteTitle'),
      // 确认删除远程分支 {name}？\n远程服务器上该分支将不再存在（本地分支不受影响），此操作不可恢复。
      msg: t('ops.branch.remoteDeleteMsg', { name }),
      confirmCmd: cmdOfRepo(props.repoType, 'branch_remote_delete', { name: name.split('/').slice(1).join('/') }),
      commands: [`git push origin --delete ${name.split('/').slice(1).join('/')}`],
      action: () => act('remote-delete', name),
    });
  };

  /** 删除分支（列表行内按钮）：
   *  svn → GitHub 式弹窗（原样输入分支名；保存了账号时可再用密码验证；删的是服务器目录不可撤销）
   *  git → 原有二次确认（本地分支可恢复，未合并时由后端拒绝后转强制删除） */
  const confirmDelete = (name: string) => {
    if (props.repoType === 'svn') {
      setDeleteFor(name);
      return;
    }
    setCfm({
      // 删除分支
      title: t('ops.branch.deleteTitle'),
      // 确认删除分支 {name}？未合并的分支会被 git 拒绝，届时可选择强制删除。
      msg: t('ops.branch.deleteMsg', { name }),
      commands: [cmdOfRepo(props.repoType, 'branch_delete', { name }) ?? `git branch -d ${name}`],
      action: () => act('delete', name, false),
    });
  };

  /** 检出分支为独立工作副本：SVN 直接拼分支 URL；Git 交给宿主补来源（origin / 本地路径） */
  const checkoutBranch = (b: { name: string; remote: boolean }) => {
    if (!props.onCheckoutBranch) return;
    const localName = b.remote ? b.name.split('/').slice(1).join('/') : b.name;
    if (props.repoType === 'svn') {
      const root = (data?.projectRoot ?? '').replace(/\/+$/, '');
      const url =
        b.name === 'trunk'
          ? (data?.mainlineUrl ?? (root ? `${root}/trunk` : ''))
          : root
            ? `${root}/branches/${encodeURIComponent(localName)}`
            : '';
      if (!url) {
        setMsg(t('ops.branch.checkoutNoUrl'));
        setMsgErr(true);
        return;
      }
      props.onCheckoutBranch({ repoType: 'svn', name: b.name, localName, remote: false, url });
      return;
    }
    // 远程行且本地已有同名分支：按本地分支检出（worktree 不能重复建同名分支）
    const hasLocal = data?.branches.some((x) => !x.remote && x.name === localName) ?? false;
    props.onCheckoutBranch({ repoType: 'git', name: b.name, localName, remote: b.remote && !hasLocal });
  };

  return (
    // 分支管理
    <ModalShell
      icon={<IconBranch size={16} />}
      title={`${t('ops.branch.title')} (${props.repoType.toUpperCase()})`}
      onClose={props.onClose}
      width={640}
      closeIcon
      hideFoot
    >
      <BranchHelp repoType={props.repoType} />
      {/* 仓库布局提示（svn 非标准布局时提醒） */}
      {props.repoType === 'svn' && data?.layout && <LayoutNote layout={data.layout} />}
      {/* SVN 分支在版本库里：解释列表徽标，切换只换工作副本指向、不额外占磁盘 */}
      {props.repoType === 'svn' && data && data.branches.length > 0 && (
        <div className="small dim" style={{ margin: '6px 0' }}>
          {t('ops.branch.repoNote')}
        </div>
      )}
      {/* 当前工作副本不在 branches/ 下（如 tags/定制项目）：说明列表与迁移入口 */}
      {props.repoType === 'svn' && data && data.currentKind !== 'trunk' && data.currentKind !== 'branch' && (
        <div className="small" style={{ color: 'var(--warn)', margin: '6px 0' }}>
          {/* 当前工作副本在 {current}（不在 branches/ 下）。可「新建分支」从当前目录复制，或用「项目迁移」独立出去。 */}
          {t('ops.branch.currentTagNote', { current: currentLabel })}
          {data.mainlineRelative && (
            <>
              <br />
              {/* 主干对应路径：{path}（「切回主干」会切到这里） */}
              {t('ops.branch.mainlineNote', { path: data.mainlineRelative })}
            </>
          )}
        </div>
      )}
      {/* 新建分支：输入行 */}
      <div className="row" style={{ margin: '12px 0 6px', gap: 6 }}>
        <input
          type="text"
          // 新分支名称…（回车创建）
          placeholder={t('ops.branch.namePlaceholder')}
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (isImeComposing(e)) return;
            if (e.key === 'Enter' && newName.trim()) confirmCreate(newName.trim());
          }}
          style={{ flex: 1, minWidth: 160 }}
        />
        <button
          className="primary"
          disabled={busy || !newName.trim()}
          onClick={() => confirmCreate(newName.trim())}
          title={cmdOfRepo(props.repoType, 'branch_create', { name: newName.trim() || '…' })}
        >
          {/* ➕ 新建分支 */}
          {t('ops.branch.createBtn')}
        </button>
        {/* 项目迁移（SVN）：把当前工作副本独立成带 trunk/branches/tags 的新项目。
            跟「新建分支」放在同一行——两者都是“再造一条线”的入口 */}
        {props.repoType === 'svn' && data && (
          <button className="btn-accent" disabled={busy} onClick={() => setMigrateOpen((v) => !v)} title={t('ops.branch.migrateTip')}>
            {/* 项目迁移… */}
            {t('ops.branch.migrateBtn')}
          </button>
        )}
        {/* 获取远程：git fetch --all --prune（只刷新远程引用，不改工作区/本地分支）；SVN 无对应概念 */}
        {props.repoType === 'git' && (
          <button
            className="mini"
            disabled={busy}
            onClick={(e) => {
              // 起点=按钮位置：与顶栏「拉取」同款，点击立即飞线（act 里读取后起飞）
              fromRef.current = e.currentTarget.getBoundingClientRect();
              act('fetch', '');
            }}
            title={`${t('ops.branch.fetchTip')}\n\ngit fetch --all --prune`}
          >
            {/* ⟳ 获取远程 */}
            {t('ops.branch.fetchBtn')}
          </button>
        )}
        {/* 工作树管理：Git 专有（worktree 共享 .git） */}
        {props.repoType === 'git' && props.onManageWorktrees && (
          <button
            className="mini"
            disabled={busy}
            onClick={props.onManageWorktrees}
            title={t('ops.branch.worktreeTip')}
          >
            {/* 工作树… */}
            {t('ops.branch.worktreeBtn')}
          </button>
        )}
      </div>
      {/* SVN 项目迁移面板（独立子域，内部自管理状态） */}
      {props.repoType === 'svn' && migrateOpen && data && (
        <ProjectMigratePanel
          data={data}
          workDir={props.workDir ?? ''}
          onClose={() => setMigrateOpen(false)}
          onResult={(m, err) => {
            setMsg(m);
            setMsgErr(err);
          }}
          onChanged={() => {
            load();
            props.onChanged();
          }}
          onBackground={background}
        />
      )}
      <BranchList
        repoType={props.repoType}
        data={data}
        sel={sel}
        busy={busy}
        hasRemote={hasRemote}
        onSelect={setSel}
        onSwitch={(n) => void confirmSwitch(n, n === 'trunk')}
        onMerge={startMerge}
        onDelete={confirmDelete}
        onPush={confirmPush}
        onRemoteDelete={confirmRemoteDelete}
        onTrackClick={onTrackClick}
        onCheckout={checkoutBranch}
      />
      <ResultLine msg={msg} err={msgErr} />
      {/* SVN 合并范围（目录/文件级）；留空回车 = 整个分支 */}
      {mergeScopeFor && (
        <MergeScopeDialog
          name={mergeScopeFor}
          target={mergeTarget.name}
          targetIsWorkCopy={mergeTarget.isWorkCopy}
          workDir={props.workDir ?? ''}
          onPickDir={props.onPickDir}
          onCancel={() => setMergeScopeFor(null)}
          onConfirm={(scope) => {
            const name = mergeScopeFor;
            setMergeScopeFor(null);
            if (name) void confirmMerge(name, scope);
          }}
        />
      )}
      {/* 删除分支确认（SVN）：输入分支名 + 可选密码，展示最后提交/未合并版本/命令预览 */}
      {deleteFor && props.repoType === 'svn' && (
        <DeleteBranchModal
          name={deleteFor}
          // 网络仓库（http/svn://）删除前必须再输账号密码；file:// 本地仓库无认证
          needCred={!!data?.currentUrl && !/^file:/i.test(data.currentUrl)}
          onCancel={() => setDeleteFor(null)}
          onConfirm={(password, from, message, username) => {
            if (from) fromRef.current = from;
            // 密码/账号/提交信息只交给本次删除任务，弹窗关闭后不再保留
            deleteSecretRef.current = { confirmName: deleteFor, password, username, message };
            setDeleteFor(null);
            act('delete', deleteFor);
          }}
        />
      )}
      {/* 通用二次确认（切换/合并/删除/推送等） */}
      {cfm && (
        <ConfirmModal
          title={cfm.title}
          message={cfm.msg}
          danger={cfm.danger}
          // 确认
          confirmLabel={cfm.confirmLabel ?? t('ui.modal.confirm')}
          hideCancel={cfm.hideCancel}
          confirmCmd={cfm.confirmCmd}
          commands={cfm.commands}
          onConfirm={(e) => {
            // 飞线起点：记下确认按钮位置（3 秒转后台时从这里起飞）
            fromRef.current = e.currentTarget.getBoundingClientRect();
            const a = cfm.action;
            setCfm(null);
            a();
          }}
          onCancel={() => setCfm(null)}
        />
      )}
      {/* 新建分支确认：git 基点 / svn 来源 */}
      {createCfm && data?.current && (
        <CreateBranchConfirm
          repoType={props.repoType}
          data={data}
          name={createCfm.name}
          trunkBase={createCfm.trunkBase}
          onCancel={() => setCreateCfm(null)}
          onConfirm={(base, from, message) => {
            fromRef.current = from;
            // svn copy 的提交信息（弹窗里可编辑；git 为空）
            createMsgRef.current = message ?? null;
            const name = createCfm.name;
            setCreateCfm(null);
            act('create', name, false, base);
          }}
        />
      )}
    </ModalShell>
  );
}
