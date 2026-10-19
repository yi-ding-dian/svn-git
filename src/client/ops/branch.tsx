/** 分支管理弹窗：列表 / 新建 / 切换 / 合并 / 删除 / 推送（git + svn 通用） */
import React, { useEffect, useRef, useState } from 'react';
import { get, post, type BranchInfo, type MainlinePlan } from '../shared/api.js';
import { ModalShell } from '../shell/modal-shell.js';
import { IconBranch } from '../ui/icons.js';
import { HelpNote } from '../ui/ui.js';
import { ConfirmModal } from '../ui/prompt.js';
import { cmdOfRepo } from '../shared/cmd-preview.js';
import { isImeComposing } from '../shared/utils.js';
import { useTasks } from '../shared/tasks.js';
import { startTaskDeferred } from '../shell/bg-defer.js';
import { launchMagicFlight } from '../animations/index.js';
import { ResultLine } from '../ui/result-line.js';
import { t, type I18nKey } from '../../shared/i18n/index.js';
import { LayoutNote } from './layout-note.js';
// ==================== 分支管理 ====================

/** 分支操作 → 任务标题 key（**模块级**：同 OP_BUSY_KEY 惯例，避免每次渲染重建） */
const BRANCH_TITLE_KEY: Record<'create' | 'switch' | 'delete' | 'merge' | 'push' | 'remote-delete', I18nKey> = {
  create: 'shell.tasks.branchCreate',
  switch: 'shell.tasks.branchSwitch',
  delete: 'shell.tasks.branchDelete',
  merge: 'shell.tasks.branchMerge',
  push: 'shell.tasks.branchPush',
  'remote-delete': 'shell.tasks.branchRemoteDelete',
};

export function BranchDialog(props: {
  repoType: 'svn' | 'git';
  onClose: () => void;
  onChanged: () => void;
  /** 鼠标附近弹的全局提示（err=true 时按错误态显示、停留更久）：操作结果在弹窗里只有底部一行小字，
   *  点完视线不往那儿去就看不到（用户实报"点了没反应"）——两处都显示 */
  onToast: (msg: string, err?: boolean) => void;
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
  // 科普折叠块展开状态（新手教学，默认收起不打扰）
  const [showHelp, setShowHelp] = useState(false);
  // 是否配置了远程：没有 origin 的本地孤仓库不显示「推送到远程」（推了也会失败）
  const [hasRemote, setHasRemote] = useState(false);
  // 工具风格二次确认
  const [cfm, setCfm] = useState<{ title: string; msg: React.ReactNode; action: () => void; confirmLabel?: string; hideCancel?: boolean; confirmCmd?: string; danger?: boolean } | null>(null);
  /** 新建分支确认（git 非主干带基点选择）：name=目标名；trunkBase=找到的主干基点 */
  const [createCfm, setCreateCfm] = useState<{ name: string; trunkBase?: string } | null>(null);
  /** 基点选择：trunk=基于主干（推荐）、current=基于当前分支（默认保持现状行为） */
  const [createBase, setCreateBase] = useState<'trunk' | 'current'>('current');
  /** SVN 新建分支来源：trunk=标准主干、current=当前工作副本目录 */
  const [svnBase, setSvnBase] = useState<'trunk' | 'current'>('trunk');
  /** SVN 项目迁移面板（用户要求：分支管理里加「项目迁移」入口） */
  const [migrateOpen, setMigrateOpen] = useState(false);
  const [migrateMode, setMigrateMode] = useState<'devline' | 'project'>('devline');
  const [migrateName, setMigrateName] = useState('');
  const [migrateSwitch, setMigrateSwitch] = useState(true);
  /** 合回主干面板（svn）：主干对应路径 + 本地主干工作副本 */
  const [mainlineOpen, setMainlineOpen] = useState(false);
  const [mainlineDir, setMainlineDir] = useState('');
  const [mainlinePlan, setMainlinePlan] = useState<MainlinePlan | null>(null);
  const [mainlineAutoCommit, setMainlineAutoCommit] = useState(true);
  const [mainlineChecking, setMainlineChecking] = useState(false);
  const [mainlineConflicts, setMainlineConflicts] = useState<string[]>([]);

  /** 主干分支：git main/master、svn trunk（团队稳定版本，禁止删除） */
  const isTrunkName = (name: string) => name === 'main' || name === 'master' || name === 'trunk';
  /** 当前位置的可读名称（svn：tags/SCA_HB、branches/xxx；git 原样） */
  const currentLabel = data
    ? data.currentKind === 'tag'
      ? `tags/${data.current}`
      : data.currentKind === 'branch'
        ? `branches/${data.current}`
        : data.current
    : '';
  /** 当前项是否就是分支列表里的某项（tag/other 不在 branches 列表，不能高亮同名项） */
  const isCurrentBranch = (name: string) => name === data?.current && data?.currentKind !== 'tag' && data?.currentKind !== 'other';
  /** 项目迁移目标路径预览（按模式实时计算） */
  const migrateTarget = (() => {
    const root = data?.projectRoot;
    const name = migrateName.trim();
    if (!root || !name) return '';
    return migrateMode === 'devline' ? `${root}/branches/${name}` : `${root.replace(/\/[^/]+$/, '')}/${name}/trunk`;
  })();
  /** 合回主干预检状态文案/颜色 */
  const mainlineState = (() => {
    const p = mainlinePlan;
    if (mainlineChecking || !p) return { text: t('ops.branch.mainlineChecking'), color: 'var(--dim)' };
    if (p.error) return { text: p.error, color: 'var(--err)' };
    switch (p.targetState) {
      case 'missing':
        return { text: t('ops.branch.mainlineStateMissing'), color: 'var(--warn)' };
      case 'not-wc':
        return { text: t('ops.branch.mainlineStateNotWc'), color: 'var(--err)' };
      case 'wrong-url':
        return { text: t('ops.branch.mainlineStateWrongUrl', { url: p.targetUrl ?? '', target: p.mainlineUrl ?? '' }), color: 'var(--err)' };
      case 'dirty':
        return { text: t('ops.branch.mainlineStateDirty'), color: 'var(--err)' };
      default:
        return { text: t('ops.branch.mainlineStateReady'), color: 'var(--ok)' };
    }
  })();
  const mainlineCanRun = Boolean(mainlinePlan && mainlineDir.trim() && (mainlinePlan.targetState === 'missing' || mainlinePlan.targetState === 'ready'));

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

  /** 分支操作统一入口（**3 秒延迟后台化**——用户定稿）：任务从发起起就在 store 里，
   *  3 秒内完成：弹窗内照常收尾（结果行/列表刷新），用户无感；
   *  超时未完成：收起弹窗 + 飞线（起点=确认按钮）+ 轻提示"已转入后台"，完成走统一通知。 */
  const act = (action: 'create' | 'switch' | 'delete' | 'merge' | 'push' | 'remote-delete', name: string, force = false, base?: string) => {
    const title = t(BRANCH_TITLE_KEY[action], { name });
    const from = fromRef.current ?? undefined;
    fromRef.current = null; // 用掉即清（每次确认时重新记）
    startTaskDeferred({
      kind: 'branch',
      title,
      run: async (signal) => {
        const r = await post.branch(action, name, force, signal, base);
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
            action: () => act('delete', name, true),
          });
          return { ok: false, message: r.message };
        }
        // 可在「解决冲突」中用「中止合并」放弃本次合并
        const text = action === 'merge' && !r.ok ? `${r.message} ${t('ops.branch.mergeAbortHint')}` : r.message;
        setMsg(text);
        setMsgErr(!r.ok);
        // 成功刷新；合并"失败"（冲突 ok=false）时工作区也已变化——同样刷新后「解决冲突」入口才出现
        if (r.ok || action === 'merge') {
          load();
          props.onChanged();
        }
        return { ok: r.ok, message: text };
      },
      onSlow: () => {
        props.onClose(); // 收起弹窗（任务后台继续；完成走气泡+铃铛通知）
        if (from) launchMagicFlight(from);
        props.onToast(t('shell.tasks.backgrounded', { title }), false);
      },
    });
  };

  /** 项目迁移执行：把当前工作副本独立成开发线/独立项目（>3 秒转后台，与分支操作同机制） */
  const runMigrate = (name: string) => {
    const mode = migrateMode;
    const switchAfter = migrateSwitch;
    const title = t('shell.tasks.projectMigrate', { name });
    const from = fromRef.current ?? undefined;
    fromRef.current = null;
    startTaskDeferred({
      kind: 'branch',
      title,
      run: async (signal) => {
        const r = await post.projectMigrate(mode, name, switchAfter, signal);
        setMsg(r.message);
        setMsgErr(!r.ok);
        if (r.ok) {
          setMigrateOpen(false);
          load();
          props.onChanged();
        }
        return { ok: r.ok, message: r.message };
      },
      onSlow: () => {
        props.onClose();
        if (from) launchMagicFlight(from);
        props.onToast(t('shell.tasks.backgrounded', { title }), false);
      },
    });
  };

  /** 迁移确认：列出将执行的多步 SVN 命令，确认后执行 */
  const confirmMigrate = () => {
    const name = migrateName.trim();
    const root = data?.projectRoot;
    if (!name || !root) return;
    const fromRel = currentLabel || data?.current || '';
    const newRoot = `${root.replace(/\/[^/]+$/, '')}/${name}`;
    const cmd =
      migrateMode === 'devline'
        ? `svn copy ${data?.currentUrl ?? ''} ${root}/branches/${name} -m "${t('vcs.commitMsg.migrateDevline', { name, from: fromRel })}"`
        : [
            `svn mkdir --parents ${newRoot}/branches ${newRoot}/tags -m "${t('vcs.commitMsg.migrateProjectSkeleton', { name })}"`,
            `svn copy ${data?.currentUrl ?? ''} ${newRoot}/trunk -m "${t('vcs.commitMsg.migrateProject', { name, from: fromRel })}"`,
          ].join('\n');
    setCfm({
      // 项目迁移
      title: t('ops.branch.migrateTitle'),
      msg: (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, whiteSpace: 'normal' }}>
          <div>{t(migrateMode === 'devline' ? 'ops.branch.migrateDevlineConfirm' : 'ops.branch.migrateProjectConfirm', { name })}</div>
          <pre className="mono small" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', margin: 0 }}>{cmd}</pre>
          {migrateSwitch && <div className="dim small">{t('ops.branch.migrateSwitchNote')}</div>}
        </div>
      ),
      // 开始迁移
      confirmLabel: t('ops.branch.migrateRun'),
      action: () => runMigrate(name),
    });
  };

  /** 合回主干：打开面板并做一次预检（空目录 → 返回推荐路径） */
  const openMainline = async () => {
    setMainlineOpen(true);
    setMainlineConflicts([]);
    setMainlineChecking(true);
    try {
      const p = await post.mergeMainlineCheck('');
      setMainlinePlan(p);
      if (!mainlineDir) setMainlineDir(p.suggestion);
    } catch (e) {
      setMsg((e as Error).message);
      setMsgErr(true);
    } finally {
      setMainlineChecking(false);
    }
  };

  /** 重新检查本地主干工作副本目录 */
  const checkMainline = async () => {
    setMainlineChecking(true);
    try {
      setMainlinePlan(await post.mergeMainlineCheck(mainlineDir.trim()));
    } catch (e) {
      setMsg((e as Error).message);
      setMsgErr(true);
    } finally {
      setMainlineChecking(false);
    }
  };

  /** 执行合回主干（>3 秒转后台）：在目标工作副本上 svn merge，冲突时不提交 */
  const runMainline = (dir: string, autoCommit: boolean) => {
    const title = t('shell.tasks.mergeMainline', { name: data?.mainlineRelative ?? '' });
    const from = fromRef.current ?? undefined;
    fromRef.current = null;
    setMainlineConflicts([]);
    startTaskDeferred({
      kind: 'branch',
      title,
      run: async (signal) => {
        const r = await post.mergeMainline(dir, autoCommit, signal);
        setMsg(r.message);
        setMsgErr(!r.ok);
        if (r.conflicts?.length) setMainlineConflicts(r.conflicts);
        if (r.ok) {
          setMainlineOpen(false);
          load();
          props.onChanged();
        }
        // 结果落盘后再预检一次（冲突时面板里能看到目标工作副本的当前状态）
        post.mergeMainlineCheck(dir).then(setMainlinePlan).catch(() => {});
        return { ok: r.ok, message: r.message };
      },
      onSlow: () => {
        props.onClose();
        if (from) launchMagicFlight(from);
        props.onToast(t('shell.tasks.backgrounded', { title }), false);
      },
    });
  };

  /** 合回主干确认：缺失目标时会先检出，命令/结果在任务里执行 */
  const confirmMainline = () => {
    const dir = mainlineDir.trim();
    const p = mainlinePlan;
    if (!dir || !p) return;
    const willCheckout = p.targetState === 'missing';
    setCfm({
      // 合回主干
      title: t('ops.branch.mergeMainlineTitle'),
      msg: (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, whiteSpace: 'normal' }}>
          <div>
            {willCheckout
              ? t('ops.branch.mergeMainlineCheckoutConfirm', { mainline: p.mainlineUrl ?? '', dir, source: data?.currentUrl ?? '' })
              : t('ops.branch.mergeMainlineConfirm', { source: data?.currentUrl ?? '', target: dir })}
          </div>
          <div className="small dim">
            {mainlineAutoCommit ? t('ops.branch.mergeMainlineAutoNote') : t('ops.branch.mergeMainlinePendingNote')}
          </div>
        </div>
      ),
      // 检出并合并 / 开始合并
      confirmLabel: willCheckout ? t('ops.branch.mergeMainlineCheckoutRun') : t('ops.branch.mergeMainlineRun'),
      action: () => runMainline(dir, mainlineAutoCommit),
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
      // 默认来源：在 trunk/普通分支上用 trunk；在标签或独立目录里默认从当前目录复制（给子项目再开分支）
      const defaultBase: 'trunk' | 'current' = canCurrent && kind !== 'trunk' && kind !== 'branch' ? 'current' : canTrunk ? 'trunk' : 'current';
      setSvnBase(defaultBase);
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
      setCreateBase('current'); // 默认保持现状行为（基于当前分支），弹窗内推荐主干
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
      msg = svnForeign
        ? t('ops.branch.switchSvnForeign', { current: currentLabel, target: name === 'trunk' ? 'trunk' : `branches/${name}` })
        : t('ops.branch.switchSvnWarn', { n: check?.changed ?? '?' });
      if (svnForeign && check && check.changed > 0) msg += `\n\n${t('ops.branch.switchSvnWarn', { n: check.changed })}`;
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
    setCfm({ title: t(isTrunk ? 'ops.branch.switchTrunkTitle' : 'ops.branch.switchTitle'), msg, action: () => act('switch', name) });
  };
  /** 合并预检（/api/merge-check）：
   *  L1 工作区级：未提交改动 ∩ 分支改动文件 → 拦截（git 对未提交改动按文件级拒绝）；
   *  L2 提交级：merge-tree 三方试算的 lineConflicts——即使提交后再合并仍冲突的文件（两边已提交改动重叠）。
   *  L2 干净工作区时作为"合并将冲突"预先提示（可合并，解决冲突视图处理）；L1 拦截时作为"提交也没用"的预告。
   *  svn：outdated 拦截（WC 必须最新才能合并）+ 本地改动提示。 */
  const confirmMerge = async (name: string) => {
    let check: Awaited<ReturnType<typeof get.mergeCheck>> | null = null;
    try {
      check = await get.mergeCheck(name);
    } catch {
      /* 检查失败不阻塞，走默认确认流程 */
    }
    const lineConflicts = check?.lineConflicts ?? [];
    // 干净且无冲突预告 → 直接合并（零打扰，与切换一致）
    if (check && check.changed === 0 && !check.outdated && lineConflicts.length === 0) {
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
        // 确认将分支 {name} 合并到当前分支？\n\n⚠ 合并将对 {n} 个文件产生冲突（两边已改动相同区域）：\n{files}\n\n仍要合并？合并后可在「解决冲突」中处理。
        msg: t('ops.branch.mergeConflictMsg', { name, n: lineConflicts.length, files: lineConflicts.join(t('common.listSep')) }),
        action: () => act('merge', name),
      });
      return;
    }
    setCfm({
      // 合并分支
      title: t('ops.branch.mergeTitle'),
      // 确认将分支 {name} 合并到当前分支？
      msg: `${t('ops.branch.mergeMsg', { name })}${lines.length ? '\n\n' + lines.join('\n') : ''}`,
      action: () => act('merge', name),
    });
  };
  /** 推送到远程：本地分支未推送（无 origin/<名字>）时可推，首次自动建立上游跟踪。
   *  推送前检测工作区未提交修改（与切换/合并一致），提醒推送只包含已提交版本。 */
  const confirmPush = async (name: string) => {
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
    const warn = changed > 0
      // ⚠ 当前工作区有 {changed} 个未提交修改（含未跟踪 {untracked} 个）。\n推送只包含已提交的版本，这些修改不会被推上去。
      ? `\n\n${t('ops.branch.pushDirtyWarn', { changed, untracked })}`
      // 当前工作区无未提交修改。
      : `\n\n${t('ops.branch.pushClean')}`;
    setCfm({
      // 推送到远程
      title: t('ops.branch.pushTitle'),
      // 确认将本地分支 {name} 推送到远程服务器（origin）？\n首次推送会自动建立上游跟踪。
      msg: `${t('ops.branch.pushMsg', { name })}${warn}`,
      action: () => act('push', name),
    });
  };

  /** 删除远程分支：远程将不再存在（本地分支不受影响）；网络操作带进度窗可取消 */
  const confirmRemoteDelete = async (name: string) => {
    setCfm({
      // 删除远程分支
      title: t('ops.branch.remoteDeleteTitle'),
      // 确认删除远程分支 {name}？\n远程服务器上该分支将不再存在（本地分支不受影响），此操作不可恢复。
      msg: t('ops.branch.remoteDeleteMsg', { name }),
      confirmCmd: cmdOfRepo(props.repoType, 'branch_remote_delete', { name: name.split('/').slice(1).join('/') }),
      action: () => act('remote-delete', name),
    });
  };

  return (
    // 分支管理
    <ModalShell icon={<IconBranch size={16} />} title={`${t('ops.branch.title')} (${props.repoType.toUpperCase()})`} onClose={props.onClose} width={640}>
      {/* 科普折叠块：新手教学，默认收起不打扰老用户 */}
      <div
        className="row small dim nowrap"
        style={{ gap: 6, cursor: 'pointer', userSelect: 'none', padding: '2px 0', marginBottom: showHelp ? 6 : 0 }}
        onClick={() => setShowHelp((s) => !s)}
        title={t(showHelp ? 'ops.branch.collapse' : 'ops.branch.expand')}
      >
        <span style={{ display: 'inline-block', transition: 'transform .15s', transform: showHelp ? 'rotate(90deg)' : '', fontSize: 10 }}>▶</span>
        <span>{t(showHelp ? 'ops.branch.helpCollapse' : 'ops.branch.helpExpand')}</span>
      </div>
      {showHelp && (
        <HelpNote>
          {props.repoType === 'git' ? (
            <>
              {/* 分支 = 同一份代码的平行工作空间，互不干扰。在分支上改代码不会影响主干。 */}
              {t('ops.branch.helpGit.intro')}
              {/* ➕ 新建 / ：输入名称回车 = 从当前代码状态开一条新线 */}
              <br />· <strong className="help-k ok">{t('ops.branch.help.new')}</strong>{t('ops.branch.helpGit.newText')}
              {/* ⇄ 切换 / ：换到另一个分支工作。未提交的修改能否带过去，取决于目标分支有没有动过那些文件——目标分支没动 → 改动跟着你走；目标分支也改过 → 切换会被拒绝，需先提交或储藏（未跟踪的新文件永远能带过去） */}
              <br />· <strong className="help-k primary">{t('ops.branch.help.switch')}</strong>{t('ops.branch.helpGit.switchText')}
              {/* 🔀 合并 / ：把别的分支的改动搬进当前分支。先切到目的地分支，再点来源分支的「合并」（站在哪，哪就是目的地） */}
              <br />· <strong className="help-k accent">{t('ops.branch.help.merge')}</strong>{t('ops.branch.helpGit.mergeText')}
              {/* ✕ 删除 / ：已合并的分支可删除（内容已进目标分支，不丢失）。主干（main/master）是团队稳定版本，不能删除 */}
              <br />· <strong className="help-k err">{t('ops.branch.help.delete')}</strong>{t('ops.branch.helpGit.deleteText')}
              {/* 灰色的远程行（origin/xxx）= 服务器上那个分支的镜像，不是你本地的分支。本地还没有它时，点「切换」= 新建同名本地分支并自动跟踪它（拉同事的分支就靠这一步）；本地已有同名分支时，按钮会变成「切到本地 xxx」 */}
              <br />· {t('ops.branch.helpGit.remoteText')}
              <br />
              {/* 绿色 ● = 当前所在分支 */}
              {t('ops.branch.helpGit.currentMark')}
            </>
          ) : (
            <>
              {/* SVN 分支是版本库里的目录复制（branches/）。默认在 trunk 上开发，需要独立改动时复制一份到 branches/ 再继续。 */}
              {t('ops.branch.helpSvn.intro')}
              {/* ➕ 新建 / ：输入名称回车 = 复制 trunk（或当前目录）创建分支 */}
              <br />· <strong className="help-k ok">{t('ops.branch.help.new')}</strong>{t('ops.branch.helpSvn.newText')}
              {/* ⇄ 切换 / ：工作副本指向该分支（本地改动会尽量保留，可能冲突） */}
              <br />· <strong className="help-k primary">{t('ops.branch.help.switch')}</strong>{t('ops.branch.helpSvn.switchText')}
              {/* 🔀 合并 / ：把该分支的改动并入当前工作副本（合并前请先更新） */}
              <br />· <strong className="help-k accent">{t('ops.branch.help.merge')}</strong>{t('ops.branch.helpSvn.mergeText')}
              {/* ✕ 删除 / ：已合并分支可删除。主干（trunk）是团队稳定版本，不能删除 */}
              <br />· <strong className="help-k err">{t('ops.branch.help.delete')}</strong>{t('ops.branch.helpSvn.deleteText')}
              <br />
              {/* 绿色 ● = 当前分支 */}
              {t('ops.branch.helpSvn.currentMark')}
            </>
          )}
        </HelpNote>
      )}
      {/* 仓库布局提示（svn 非标准布局时提醒） */}
      {props.repoType === 'svn' && data?.layout && <LayoutNote layout={data.layout} />}
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
      </div>
      {/* 分支辅助操作独立一行（避免把名称输入框挤窄）：切回主干 / 项目迁移 / 合回主干 */}
      {props.repoType === 'svn' && data && (
        <div className="row" style={{ margin: '0 0 10px', gap: 6, flexWrap: 'wrap' }}>
          {data.current && data.currentKind !== 'trunk' && (
            // 切回 trunk
            <button className="mini" disabled={busy} onClick={() => confirmSwitch('trunk', true)} title={t('ops.branch.backToTrunkTip')}>
              {/* ↩ 切回主干 */}
              {t('ops.branch.backToTrunkBtn')}
            </button>
          )}
          {/* 把当前开发线独立成长期开发线，或独立成带 trunk/branches/tags 的新项目 */}
          <button
            className="mini btn-accent"
            disabled={busy}
            onClick={() => {
              if (!migrateOpen) setMigrateName(data.current || '');
              setMigrateOpen((v) => !v);
            }}
            title={t('ops.branch.migrateTip')}
          >
            {/* 项目迁移… */}
            {t('ops.branch.migrateBtn')}
          </button>
          {data.mainlineUrl && data.currentUrl && data.mainlineUrl !== data.currentUrl && data.currentKind !== 'trunk' && (
            <button
              className="mini"
              disabled={busy}
              onClick={() => void openMainline()}
              title={t('ops.branch.mergeMainlineTip', { path: data.mainlineRelative ?? data.mainlineUrl })}
            >
              {/* 合回主干… */}
              {t('ops.branch.mergeMainlineBtn')}
            </button>
          )}
        </div>
      )}
      {/* SVN 项目迁移面板（入口在新建分支行右侧） */}
      {props.repoType === 'svn' && migrateOpen && data && (
        <div className="migrate-panel" style={{ border: '1px solid var(--line)', borderRadius: 8, padding: '10px 12px', margin: '4px 0 10px' }}>
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
            {/* 项目迁移 */}
            <strong>{t('ops.branch.migrateTitle')}</strong>
            <button className="mini" onClick={() => setMigrateOpen(false)}>{t('common.cancel')}</button>
          </div>
          {/* 把当前工作副本独立出去：仍属于原项目的长期开发线，或一个带 trunk/branches/tags 的独立项目。 */}
          <div className="small dim" style={{ margin: '6px 0' }}>{t('ops.branch.migrateIntro')}</div>
          <div className="small mono" style={{ margin: '4px 0', wordBreak: 'break-all' }}>
            {/* 来源：{url} */}
            {t('ops.branch.migrateSource', { url: data.currentUrl ?? '' })}
          </div>
          <label className="row" style={{ alignItems: 'flex-start', gap: 6, cursor: 'pointer', margin: '6px 0' }}>
            <input type="radio" checked={migrateMode === 'devline'} onChange={() => setMigrateMode('devline')} style={{ marginTop: 3 }} />
            <span>
              <strong>{t('ops.branch.migrateDevlineTitle')}</strong>
              <span className="small dim" style={{ display: 'block' }}>{t('ops.branch.migrateDevlineDesc')}</span>
            </span>
          </label>
          <label className="row" style={{ alignItems: 'flex-start', gap: 6, cursor: 'pointer', margin: '6px 0' }}>
            <input type="radio" checked={migrateMode === 'project'} onChange={() => setMigrateMode('project')} style={{ marginTop: 3 }} />
            <span>
              <strong>{t('ops.branch.migrateProjectTitle')}</strong>
              <span className="small dim" style={{ display: 'block' }}>{t('ops.branch.migrateProjectDesc')}</span>
            </span>
          </label>
          <div className="row" style={{ gap: 6, margin: '8px 0 4px' }}>
            {/* 新名称 */}
            <span className="small">{t('ops.branch.migrateNameLabel')}</span>
            <input
              type="text"
              value={migrateName}
              onChange={(e) => setMigrateName(e.target.value)}
              onKeyDown={(e) => {
                if (isImeComposing(e)) return;
                if (e.key === 'Enter' && migrateName.trim()) confirmMigrate();
              }}
              style={{ flex: 1 }}
            />
          </div>
          <div className="small" style={{ wordBreak: 'break-all' }}>
            {/* 目标：{target} */}
            {t('ops.branch.migrateTarget', { target: migrateTarget || '…' })}
          </div>
          <label className="row small" style={{ alignItems: 'center', gap: 6, cursor: 'pointer', margin: '6px 0' }}>
            <input type="checkbox" checked={migrateSwitch} onChange={(e) => setMigrateSwitch(e.target.checked)} />
            {/* 迁移完成后把当前工作副本切换过去 */}
            {t('ops.branch.migrateSwitch')}
          </label>
          <div className="row" style={{ justifyContent: 'flex-end', gap: 6, marginTop: 8 }}>
            <button className="mini" onClick={() => setMigrateOpen(false)}>{t('common.cancel')}</button>
            <button className="primary" disabled={busy || !migrateName.trim()} onClick={confirmMigrate}>
              {/* 开始迁移 */}
              {t('ops.branch.migrateRun')}
            </button>
          </div>
        </div>
      )}
      {/* SVN 合回主干面板 */}
      {props.repoType === 'svn' && mainlineOpen && data && (
        <div className="mainline-panel" style={{ border: '1px solid var(--line)', borderRadius: 8, padding: '10px 12px', margin: '4px 0 10px' }}>
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
            {/* 合回主干 */}
            <strong>{t('ops.branch.mergeMainlineTitle')}</strong>
            <button className="mini" onClick={() => setMainlineOpen(false)}>{t('common.cancel')}</button>
          </div>
          {/* 把当前工作副本的已提交改动合并到主干对应路径。SVN 必须站在目标工作副本上拉取合并。 */}
          <div className="small dim" style={{ margin: '6px 0' }}>{t('ops.branch.mergeMainlineIntro')}</div>
          <div className="small mono" style={{ margin: '4px 0', wordBreak: 'break-all' }}>
            {/* 来源：{url} */}
            {t('ops.branch.mergeMainlineSource', { url: data.currentUrl ?? '' })}
          </div>
          <div className="small mono" style={{ margin: '4px 0', wordBreak: 'break-all' }}>
            {/* 主干目标：{path} */}
            {t('ops.branch.mergeMainlineTarget', { path: data.mainlineRelative ?? data.mainlineUrl ?? '' })}
          </div>
          <div className="small" style={{ margin: '8px 0 4px' }}>
            {/* 本地主干工作副本 */}
            {t('ops.branch.mergeMainlineDirLabel')}
          </div>
          <div className="row" style={{ gap: 6 }}>
            <input
              type="text"
              value={mainlineDir}
              onChange={(e) => setMainlineDir(e.target.value)}
              onBlur={() => void checkMainline()}
              title={mainlineDir}
              style={{ flex: 1, minWidth: 0 }}
            />
            <button className="mini" disabled={mainlineChecking || !mainlineDir.trim()} onClick={() => void checkMainline()}>
              {/* 检查 */}
              {t('ops.branch.mergeMainlineCheck')}
            </button>
          </div>
          <div className="small" style={{ color: mainlineState.color, margin: '4px 0', wordBreak: 'break-all' }}>
            {mainlineState.text}
          </div>
          {mainlineConflicts.length > 0 && (
            <div className="small" style={{ color: 'var(--err)', margin: '4px 0' }}>
              {/* 冲突文件（在目标工作副本中处理）：{files} */}
              {t('ops.branch.mergeMainlineConflicts', { files: mainlineConflicts.join(t('common.listSep')) })}
            </div>
          )}
          <label className="row small" style={{ alignItems: 'center', gap: 6, cursor: 'pointer', margin: '6px 0' }}>
            <input type="checkbox" checked={mainlineAutoCommit} onChange={(e) => setMainlineAutoCommit(e.target.checked)} />
            {/* 合并无冲突时自动提交 */}
            {t('ops.branch.mergeMainlineAutoCommit')}
          </label>
          <div className="row" style={{ justifyContent: 'flex-end', gap: 6, marginTop: 8 }}>
            <button className="mini" onClick={() => setMainlineOpen(false)}>{t('common.cancel')}</button>
            <button className="primary" disabled={busy || !mainlineCanRun} onClick={confirmMainline}>
              {/* 检出并合并 / 开始合并 */}
              {mainlinePlan?.targetState === 'missing' ? t('ops.branch.mergeMainlineCheckoutRun') : t('ops.branch.mergeMainlineRun')}
            </button>
          </div>
        </div>
      )}
      {/* 分支列表 */}
      <div className="vcs-list" style={{ flex: 1, minHeight: 60 }}>
        {/* 加载中… */}
        {!data && <div className="dim" style={{ padding: '10px 6px' }}>{t('ops.loading')}</div>}
        {/* 暂无分支 / （仓库根下没有 branches/ 目录） */}
        {data && data.branches.length === 0 && <div className="dim" style={{ padding: '10px 6px' }}>{t('ops.branch.none')}{props.repoType === 'svn' ? t('ops.branch.noneSvn') : ''}</div>}
        {data?.branches.map((b) => {
          // 当前项（tag/独立目录不在 branches 列表里，不能高亮同名分支）
          const isCur = isCurrentBranch(b.name);
          // 是否已推送：本地分支能否找到对应的 origin/<名字> 远程项
          const isPushed = data.branches.some((r) => r.remote && r.name === 'origin/' + b.name);
          // 远程行（origin/xxx；只有 git 有，svn 的 branchList 全是 remote:false）的「切换」实际语义
          // 取决于本地有没有同名分支（见 vcs/git.ts branchSwitch）：
          //   本地没有 → 新建本地跟踪分支并切过去（**这才是它的价值**：远程有、本地没有）
          //   本地已有 → 就是切到那个本地分支，名字是去掉 origin/ 前缀的那部分
          // 所以本地已有同名分支时按钮要说实情（「切到本地 xxx」）；而本地那个**正是当前分支**时
          // 点了等于没点——用户实报的困惑场景（点了 origin/main 的切换，只回一句"已切换到 main"），直接不显示
          const remoteLocal = b.remote ? b.name.split('/').slice(1).join('/') : '';
          const remoteHasLocal = b.remote ? data.branches.some((r) => !r.remote && r.name === remoteLocal) : false;
          const remoteIsCurrent = b.remote && remoteLocal === data.current;
          return (
            <div
              key={b.name}
              className={`vcs-row ${sel === b.name ? 'selected' : ''}`}
              onClick={() => setSel(b.name)}
              // 当前分支
              title={isCur ? t('ops.branch.isCurrent') : undefined}
            >
              <span className="vcs-current" style={{ visibility: isCur ? 'visible' : 'hidden' }}>●</span>
              <span className="badge" style={{ background: b.remote ? 'var(--dim)' : 'var(--ok)', fontSize: 9, minWidth: 38, textAlign: 'center' }}>
                {t(isCur ? 'ops.branch.badgeCurrent' : b.remote ? 'ops.branch.badgeRemote' : 'ops.branch.badgeLocal')}
              </span>
              <span className="mono" style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.name}</span>
              {/* 非当前分支的常规操作；当前分支若未推送也显示「推送到远程」（仅仓库配了远程时） */}
              {(isCur === false || (props.repoType === 'git' && hasRemote && !b.remote && !isPushed)) && (
                <span className="row" style={{ gap: 4 }} onClick={(e) => e.stopPropagation()}>
                  {!isCur && !remoteIsCurrent && (
                    <button
                      className="mini primary"
                      disabled={busy}
                      onClick={() => confirmSwitch(b.name)}
                      title={
                        b.remote
                          ? remoteHasLocal
                            // 本地已有分支 {local} —— {name} 对应的就是它\n点此切换到 {local}
                            ? `${t('ops.branch.remoteHasLocalTip', { local: remoteLocal, name: b.name })}\n\n${cmdOfRepo(props.repoType, 'branch_switch', { name: remoteLocal })}`
                            // 本地还没有这个分支\n点此新建本地跟踪分支 {local} 并切换过去
                            : `${t('ops.branch.remoteNoLocalTip', { local: remoteLocal })}\n\n${cmdOfRepo(props.repoType, 'branch_switch_remote', { name: remoteLocal, remote: b.name })}`
                          : cmdOfRepo(props.repoType, 'branch_switch', { name: b.name })
                      }
                    >
                      {/* 切到本地 {local} / 切换 */}
                      {b.remote && remoteHasLocal ? t('ops.branch.switchToLocal', { local: remoteLocal }) : t('ops.branch.switchBtn')}
                    </button>
                  )}
                  {props.repoType === 'git' && hasRemote && !b.remote && !isPushed && (
                    // 该分支尚未推送到远程\n点此将 {name} 推送到远程服务器（origin） / ⬆ 推送到远程
                    <button className="mini btn-accent" disabled={busy} onClick={() => confirmPush(b.name)} title={t('ops.branch.pushTip', { name: b.name })}>{t('ops.branch.pushBtn')}</button>
                  )}
                  {b.remote && (() => {
                    // 远程主干（origin/main|master）同本地主干一起保护：稳定分支不提供删除入口
                    const bare = b.name.split('/').slice(1).join('/');
                    return (
                      <button
                        className="mini danger"
                        disabled={busy || isTrunkName(bare)}
                        onClick={() => confirmRemoteDelete(b.name)}
                        title={isTrunkName(bare)
                          // 主干分支不能删除（团队稳定版本，防止误删）
                          ? t('ops.branch.trunkNoDelete')
                          // 删除远程分支：远程将不再存在（本地分支不受影响）
                          : `${cmdOfRepo(props.repoType, 'branch_remote_delete', { name: bare }) ?? ''}\n\n${t('ops.branch.remoteDeleteTip')}`}
                      >
                        {/* 删除远程 */}
                        {t('ops.branch.remoteDeleteBtn')}
                      </button>
                    );
                  })()}
                  {!b.remote && !isCur && (
                    <>
                      {/* 把该分支的改动合并到当前分支（先确保已切到目标分支） / 🔀 合并 */}
                      <button className="mini btn-accent" disabled={busy} onClick={() => confirmMerge(b.name)} title={`${cmdOfRepo(props.repoType, 'branch_merge', { name: b.name })}\n\n${t('ops.branch.mergeTip')}`}>{t('ops.branch.mergeBtn')}</button>
                      <button
                        className="mini danger"
                        disabled={busy || isTrunkName(b.name)}
                        title={isTrunkName(b.name)
                          // 主干分支不能删除（团队稳定版本，防止误删）
                          ? t('ops.branch.trunkNoDelete')
                          // 删除分支（已合并的分支才能删）
                          : `${cmdOfRepo(props.repoType, 'branch_delete', { name: b.name })}\n\n${t('ops.branch.deleteTip')}`}
                        onClick={() =>
                          setCfm({
                            // 删除分支
                            title: t('ops.branch.deleteTitle'),
                            // 确认删除分支 {name}？未合并的分支会被 git 拒绝，届时可选择强制删除。
                            msg: t('ops.branch.deleteMsg', { name: b.name }),
                            action: () => act('delete', b.name, false),
                          })
                        }
                      >
                        {/* 删除 */}
                        {t('common.delete')}
                      </button>
                    </>
                  )}
                </span>
              )}
            </div>
          );
        })}
      </div>
      <ResultLine msg={msg} err={msgErr} />
          {/* 新建分支二次确认（工具风格） */}
      {cfm && (
        <ConfirmModal
          title={cfm.title}
          message={cfm.msg}
          danger={cfm.danger}
          // 确认
          confirmLabel={cfm.confirmLabel ?? t('ui.modal.confirm')}
          hideCancel={cfm.hideCancel}
          confirmCmd={cfm.confirmCmd}
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
      {/* 新建分支确认：git 带基点选择（主干/当前分支）；svn 带来源选择（trunk/当前目录） */}
      {createCfm && data?.current && (
        <ConfirmModal
          // 新建分支
          title={t('ops.branch.createTitle')}
          width={480}
          message={
            props.repoType === 'git' ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, whiteSpace: 'normal' }}>
                {/* 确认创建新分支 {name}？ */}
                <div>{t('ops.branch.confirmCreate', { name: createCfm.name })}</div>
                <label className="row" style={{ alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                  <input type="radio" checked={createBase === 'trunk'} onChange={() => setCreateBase('trunk')} />
                  {/* 基于主干 {base}（推荐） */}
                  <span>{t('ops.branch.baseTrunk', { base: createCfm.trunkBase! })}</span>
                </label>
                <label className="row" style={{ alignItems: 'center', gap: 6, cursor: 'pointer', flexWrap: 'wrap' }}>
                  <input type="radio" checked={createBase === 'current'} onChange={() => setCreateBase('current')} />
                  {/* 基于当前分支 {current} */}
                  <span>{t('ops.branch.baseCurrent', { current: data.current })}</span>
                  {createBase === 'current' && (
                    <span className="small" style={{ color: 'var(--warn)' }}>
                      {/* ⚠ 包含 {current} 已提交的改动，合并回主干时一并进入 */}
                      {t('ops.branch.baseCurrentWarn', { current: data.current })}
                    </span>
                  )}
                </label>
                {/* 创建后不自动切换，仍停留在当前分支 {current}。 */}
                <div className="dim small">{t('ops.branch.noAutoSwitch', { current: data.current })}</div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, whiteSpace: 'normal' }}>
                {/* 确认创建新分支 {name}？ */}
                <div>{t('ops.branch.confirmCreate', { name: createCfm.name })}</div>
                {data.layout?.trunk && (
                  <label className="row" style={{ alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                    <input type="radio" checked={svnBase === 'trunk'} onChange={() => setSvnBase('trunk')} />
                    {/* 从 trunk 复制（标准主干开发） */}
                    <span>{t('ops.branch.baseSvnTrunk')}</span>
                  </label>
                )}
                <label className="row" style={{ alignItems: 'center', gap: 6, cursor: 'pointer', flexWrap: 'wrap' }}>
                  <input type="radio" checked={svnBase === 'current'} onChange={() => setSvnBase('current')} />
                  {/* 从当前目录 {current} 复制 */}
                  <span>{t('ops.branch.baseSvnCurrent', { current: currentLabel })}</span>
                  {svnBase === 'current' && (
                    <span className="small" style={{ color: 'var(--warn)' }}>
                      {/* ⚠ 包含当前目录已提交的全部改动；若它不在 trunk 层级，合回主干时要指定对应子目录 */}
                      {t('ops.branch.baseSvnCurrentWarn')}
                    </span>
                  )}
                </label>
                {/* 创建后不自动切换，仍停留在 {current}。 */}
                <div className="dim small">{t('ops.branch.noAutoSwitch', { current: currentLabel })}</div>
              </div>
            )
          }
          // 创建
          confirmLabel={t('ops.branch.create')}
          confirmCmd={
            props.repoType === 'git'
              ? cmdOfRepo(
                  'git',
                  'branch_create',
                  createBase === 'trunk' ? { name: createCfm.name, base: createCfm.trunkBase! } : { name: createCfm.name },
                )
              : svnBase === 'current'
                ? cmdOfRepo('svn', 'branch_create_from', { name: createCfm.name, from: data.currentUrl ?? currentLabel, target: `${data.projectRoot}/branches/${createCfm.name}` })
                : cmdOfRepo('svn', 'branch_create', { name: createCfm.name })
          }
          onConfirm={(e) => {
            // 飞线起点：记下确认按钮位置（3 秒转后台时从这里起飞）
            fromRef.current = e.currentTarget.getBoundingClientRect();
            const { name, trunkBase } = createCfm;
            const base =
              props.repoType === 'git'
                ? createBase === 'trunk'
                  ? trunkBase
                  : undefined
                : svnBase === 'current'
                  ? 'current'
                  : undefined;
            setCreateCfm(null);
            act('create', name, false, base);
          }}
          onCancel={() => setCreateCfm(null)}
        />
      )}
</ModalShell>
  );
}
