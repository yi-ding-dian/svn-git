/** 版本管理对话框：分支 / 标签 / Stash / 创建仓库（git + svn 通用） */
import React, { useEffect, useRef, useState } from 'react';
import { get, post, type BranchInfo, type StashItem, type SvnLayout, type VcsResult, type RepoCheck } from './api.js';
import { ModalShell, ResizableModal } from './modal-shell.js';
import { IconBranch, IconTag, IconStash, IconPlus, IconDownload, IconOk, IconErr } from './icons.js';
import { DirPicker } from './dir-picker.js';
import { HelpNote, FormRow } from './ui.js';
import { ConfirmModal } from './modals.js';
import { cmdOfRepo } from './cmd-preview.js';

/** 操作结果提示行：成功绿√ / 失败红×（SVG 图标+文本，样式不变只加图标） */
function ResultLine(props: { msg: string; err?: boolean }) {
  if (!props.msg) return null;
  return (
    <div
      className={props.err ? 'error mt8' : 'mt8 small'}
      style={{
        ...(props.err ? {} : { color: 'var(--ok)' }),
        display: 'flex',
        alignItems: 'center',
        gap: 6,
      }}
    >
      {props.err ? <IconErr /> : <IconOk />}
      <span>{props.msg}</span>
    </div>
  );
}

/** 执行并刷新列表的通用逻辑
 *  onFailOk=true 时失败（ok=false）也执行 afterOk：merge 冲突这类"返回失败但工作区已变"的操作（MERGE_HEAD/C 状态）
 *  不刷新的话「解决冲突」入口不会出现，用户看到提示却找不到地方 */
async function runAction<T extends VcsResult = VcsResult>(
  fn: () => Promise<T>,
  onMsg: (msg: string, err?: boolean) => void,
  afterOk?: (r: T) => void,
  onFailOk = false
) {
  try {
    const r = await fn();
    onMsg(r.message, !r.ok);
    if (r.ok) afterOk?.(r);
    else if (onFailOk) afterOk?.(r);
  } catch (e) {
    onMsg((e as Error).message, true);
  }
}

// ==================== SVN 布局提示条 ====================

/** SVN 仓库布局提示条：标准布局绿色确认，非标准布局黄色提醒（分支/标签弹窗共用） */
function LayoutNote(props: { layout: SvnLayout }) {
  const { trunk, branches, tags } = props.layout;
  if (trunk && branches && tags) {
    return <div className="small" style={{ color: 'var(--ok)', margin: '6px 0' }}>✓ 标准布局（trunk / branches / tags）</div>;
  }
  const missing: string[] = [];
  if (!trunk) missing.push('trunk/');
  if (!branches) missing.push('branches/');
  if (!tags) missing.push('tags/');
  const tips: string[] = [];
  if (!branches) tips.push('分支列表为空，可先「新建分支」自动创建该目录');
  if (!trunk) tips.push('无法切回主干，新建分支将以当前目录为来源');
  if (!tags) tips.push('标签列表为空，可先「创建标签」自动创建该目录');
  return (
    <div className="small" style={{ color: 'var(--warn)', margin: '6px 0' }}>
      ⚠ 仓库缺少 {missing.join('、')}（非标准布局）。{tips.join(' ')}
    </div>
  );
}

// ==================== 分支管理 ====================

export function BranchDialog(props: {
  repoType: 'svn' | 'git';
  onClose: () => void;
  onChanged: () => void;
}) {
  const [data, setData] = useState<BranchInfo | null>(null);
  const [sel, setSel] = useState('');
  const [newName, setNewName] = useState('');
  const [msg, setMsg] = useState('');
  const [msgErr, setMsgErr] = useState(false);
  const [busy, setBusy] = useState(false);
  // 科普折叠块展开状态（新手教学，默认收起不打扰）
  const [showHelp, setShowHelp] = useState(false);
  // 是否配置了远程：没有 origin 的本地孤仓库不显示「推送到远程」（推了也会失败）
  const [hasRemote, setHasRemote] = useState(false);
  // 工具风格二次确认
  const [cfm, setCfm] = useState<{ title: string; msg: string; action: () => void; confirmLabel?: string; hideCancel?: boolean; confirmCmd?: string } | null>(null);
  /** 新建分支确认（git 非主干带基点选择）：name=目标名；trunkBase=找到的主干基点 */
  const [createCfm, setCreateCfm] = useState<{ name: string; trunkBase?: string } | null>(null);
  /** 基点选择：trunk=基于主干（推荐）、current=基于当前分支（默认保持现状行为） */
  const [createBase, setCreateBase] = useState<'trunk' | 'current'>('current');

  /** 主干分支：git main/master、svn trunk（团队稳定版本，禁止删除） */
  const isTrunkName = (name: string) => name === 'main' || name === 'master' || name === 'trunk';

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

  // 分推送进度窗（网络卡时可见可取消，与主推送一致）
  const [pushProg, setPushProg] = useState<{ action: 'push' | 'remote-delete'; name: string } | null>(null);
  const pushAbortRef = useRef<AbortController | null>(null);
  const [pushElapsed, setPushElapsed] = useState(0);
  useEffect(() => {
    if (!pushProg) return;
    setPushElapsed(0);
    const t = setInterval(() => setPushElapsed((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [pushProg]);
  /** 推送到远程/删除远程分支：进度窗 + 可取消（与主推送同款交互；认证失败走结果消息） */
  const doBranchNet = async (action: 'push' | 'remote-delete', name: string) => {
    setBusy(true);
    setPushProg({ action, name });
    const ac = new AbortController();
    pushAbortRef.current = ac;
    try {
      const r = await post.branch(action, name, false, ac.signal);
      setMsg(r.message);
      setMsgErr(!r.ok);
      if (r.ok) {
        setPushProg(null);
        load();
        props.onChanged();
      } else {
        setPushProg(null); // 失败/取消：关闭进度窗，结果消息留在对话框提示行
      }
    } catch (e) {
      setMsg((e as Error).message);
      setMsgErr(true);
      setPushProg(null);
    } finally {
      setBusy(false);
      pushAbortRef.current = null;
    }
  };

  const act = (action: 'create' | 'switch' | 'delete' | 'merge' | 'push', name: string, force = false, base?: string) => {
    setBusy(true);
    void runAction(
      () => post.branch(action, name, force, undefined, base),
      (m, err) => {
        setMsg(action === 'merge' && err ? `${m} 可在「解决冲突」中用「中止合并」放弃本次合并` : m);
        setMsgErr(Boolean(err));
      },
      () => {
        load();
        props.onChanged();
      },
      action === 'merge' // 合并冲突（ok=false）时工作区已变化：刷新后「解决冲突」入口才会出现
    ).finally(() => setBusy(false));
  };

  /** 新建分支确认：确保创建的分支能按要求合回主干——
   *  git：当前在非主干时可选基点（基于主干/当前分支），基于主干可避免"新分支包含当前分支已提交的改动、合回主干时一并进入"；
   *  svn：仅标准布局（有 trunk）允许，来源固定 trunk；无 trunk 弹「知道了」说明框（后端同样拒绝） */
  const confirmCreate = (name: string) => {
    const cur = data?.current;
    if (props.repoType === 'svn') {
      if (!data?.layout?.trunk) {
        setCfm({ title: '无法创建分支', confirmLabel: '知道了', hideCancel: true, msg: `仓库没有 trunk（非标准布局），无法创建分支 ${name}。\n分支需从 trunk 复制才能保证合并回主干；请先补建 trunk 目录。`, action: () => setCfm(null) });
        return;
      }
      setCfm({
        title: '新建分支',
        msg: `确认从 trunk 复制创建分支 ${name}？\n（标准分支策略：开发完成后在主干上点「合并」即可合回主干。创建后不自动切换，需手动切换使用。）`,
        confirmLabel: '创建',
        confirmCmd: cmdOfRepo(props.repoType, 'branch_create', { name }),
        action: () => act('create', name),
      });
      return;
    }
    // git：找主干基点（本地 main/master 优先，其次远程 origin/main|master）
    const trunkBase =
      data?.branches.find((b) => !b.remote && (b.name === 'main' || b.name === 'master'))?.name ??
      data?.branches.find((b) => b.remote && /^origin\/(main|master)$/.test(b.name))?.name;
    // 当前已在主干（或拿不到当前分支）→ 简单确认
    if (!cur || isTrunkName(cur)) {
      setCfm({
        title: '新建分支',
        msg: cur
          ? `确认从主干 ${cur} 创建分支 ${name}？\n（新分支基于 ${cur} 最新提交，开发后可直接合并回主干。创建后不自动切换，仍停留在 ${cur}。）`
          : `确认创建分支 ${name}？\n（基于当前提交。创建后不自动切换。）`,
        confirmLabel: '创建',
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
      title: '新建分支',
      msg: `确认基于当前分支 ${cur} 创建分支 ${name}？\n\n⚠ 仓库中未找到主干分支（main/master），新分支将包含 ${cur} 已提交的全部改动——合回主干时这些改动也会一并进入。`,
      confirmLabel: '创建',
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
    // 工作区干净 → 直接切换，不弹确认
    if (check && check.changed === 0) {
      act('switch', name);
      return;
    }
    let msg: string;
    if (props.repoType === 'svn') {
      msg = `当前有 ${check?.changed ?? '?'} 个文件的本地改动，切换分支会尽量保留（可能产生冲突）。建议先提交；仍要切换？`;
    } else if (name.includes('/')) {
      const local = name.split('/').slice(1).join('/');
      msg = `确认切换到远程分支 ${name}？将自动创建本地跟踪分支 ${local} 并切换过去。`;
      if (check) msg += `当前有 ${check.changed} 个文件未提交/未暂存（已跟踪 ${check.tracked} 个、未跟踪 ${check.untracked} 个），建议先提交或暂存。`;
    } else if (check) {
      // git 本地分支：能带过去的 vs 会被拒绝的（目标分支也改过这些文件）
      msg = `当前有 ${check.changed} 个文件未提交/未暂存：已跟踪 ${check.tracked} 个、未跟踪 ${check.untracked} 个。`;
      if (check.conflicts.length > 0) msg += `\n会被拒绝的文件：${check.conflicts.join('、')}（目标分支也改过这些文件）`;
      msg += `\n\n建议先提交或暂存；仍要切换？`;
    } else {
      msg = `确认切换到分支 ${name}？工作区有未提交修改且会被覆盖时，切换会失败（请先提交或暂存）。`;
    }
    setCfm({ title: isTrunk ? '切回主干' : '切换分支', msg, action: () => act('switch', name) });
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
      lines.push(`⚠ 工作副本落后于仓库（r${check.outdated.wcRev} → r${check.outdated.headRev}）。`);
      lines.push('SVN 要求合并前更新到最新，否则合的是旧 BASE——会产生虚假冲突或同一改动被重复合并。');
    }
    if (check && check.changed > 0) {
      if (props.repoType === 'svn') {
        lines.push(`当前有 ${check.changed} 个文件的本地改动（未跟踪 ${check.untracked} 个），合并会保留这些改动，但可能产生冲突。建议先提交。`);
      } else {
        lines.push(`当前有 ${check.changed} 个文件未提交/未暂存：已跟踪 ${check.tracked} 个、未跟踪 ${check.untracked} 个。`);
        if (check.conflicts.length > 0) lines.push(`会被合并拒绝的文件：${check.conflicts.join('、')}（目标分支也改过这些文件）`);
      }
    }
    // L1 拦截：重叠（git）或 WC 落后（svn）→ 不执行合并，说明原因
    if (check && (check.conflicts.length > 0 || Boolean(check.outdated))) {
      lines.push('');
      if (check.conflicts.length > 0) lines.push('请先提交或暂存这些文件，再重新合并。');
      if (check.outdated) lines.push('请先「更新」工作副本，再重新合并。');
      if (lineConflicts.length > 0) {
        lines.push('');
        lines.push(`⚠ 即使提交后再合并，以下文件仍会冲突（两边已改动相同区域）：`);
        lines.push(lineConflicts.join('、'));
        lines.push('建议先手动整合两边的改动成一个提交，再合并就顺利了。');
      }
      setCfm({ title: '无法合并', confirmLabel: '知道了', hideCancel: true, msg: lines.join('\n'), action: () => setCfm(null) });
      return;
    }
    // L2 预告：工作区干净，但两分支已提交改动重叠 → 合并仍会冲突（不拦，由解决冲突视图收尾）
    if (check && check.changed === 0 && !check.outdated && lineConflicts.length > 0) {
      setCfm({
        title: '合并分支（可能冲突）',
        msg: `确认将分支 ${name} 合并到当前分支？\n\n⚠ 合并将对 ${lineConflicts.length} 个文件产生冲突（两边已改动相同区域）：\n${lineConflicts.join('、')}\n\n仍要合并？合并后可在「解决冲突」中处理。`,
        action: () => act('merge', name),
      });
      return;
    }
    setCfm({
      title: '合并分支',
      msg: `确认将分支 ${name} 合并到当前分支？${lines.length ? '\n\n' + lines.join('\n') : ''}`,
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
      ? `\n\n⚠ 当前工作区有 ${changed} 个未提交修改（含未跟踪 ${untracked} 个）。\n推送只包含已提交的版本，这些修改不会被推上去。`
      : `\n\n当前工作区无未提交修改。`;
    setCfm({
      title: '推送到远程',
      msg: `确认将本地分支 ${name} 推送到远程服务器（origin）？\n首次推送会自动建立上游跟踪。${warn}`,
      action: () => void doBranchNet('push', name),
    });
  };

  /** 删除远程分支：远程将不再存在（本地分支不受影响）；网络操作带进度窗可取消 */
  const confirmRemoteDelete = async (name: string) => {
    setCfm({
      title: '删除远程分支',
      msg: `确认删除远程分支 ${name}？\n远程服务器上该分支将不再存在（本地分支不受影响），此操作不可恢复。`,
      confirmCmd: cmdOfRepo(props.repoType, 'branch_remote_delete', { name: name.split('/').slice(1).join('/') }),
      action: () => void doBranchNet('remote-delete', name),
    });
  };

  return (
    <ModalShell icon={<IconBranch size={16} />} title={`分支管理 (${props.repoType.toUpperCase()})`} onClose={props.onClose} width={640}>
      {/* 科普折叠块：新手教学，默认收起不打扰老用户 */}
      <div
        className="row small dim nowrap"
        style={{ gap: 6, cursor: 'pointer', userSelect: 'none', padding: '2px 0', marginBottom: showHelp ? 6 : 0 }}
        onClick={() => setShowHelp((s) => !s)}
        title={showHelp ? '收起' : '展开'}
      >
        <span style={{ display: 'inline-block', transition: 'transform .15s', transform: showHelp ? 'rotate(90deg)' : '', fontSize: 10 }}>▶</span>
        <span>{showHelp ? '收起分支使用说明' : '❓ 分支使用说明（新手必读，点击展开）'}</span>
      </div>
      {showHelp && (
        <HelpNote>
          {props.repoType === 'git' ? (
            <>
              分支 = 同一份代码的<strong>平行工作空间</strong>，互不干扰。在分支上改代码不会影响主干。
              <br />· <strong className="help-k ok">➕ 新建</strong>：输入名称回车 = 从当前代码状态开一条新线
              <br />· <strong className="help-k primary">⇄ 切换</strong>：换到另一个分支工作。未提交的修改能否带过去，取决于目标分支有没有动过那些文件——目标分支没动 → 改动跟着你走；目标分支也改过 → 切换会被拒绝，需先提交或暂存（未跟踪的新文件永远能带过去）
              <br />· <strong className="help-k accent">🔀 合并</strong>：把别的分支的改动搬进当前分支。<strong>先切到目的地分支，再点来源分支的「合并」</strong>（站在哪，哪就是目的地）
              <br />· <strong className="help-k err">✕ 删除</strong>：已合并的分支可删除（内容已进目标分支，不丢失）。主干（main/master）是团队稳定版本，不能删除
              <br />
              绿色 ● = 当前所在分支
            </>
          ) : (
            <>
              SVN 分支是版本库里的目录复制（branches/）。默认在 trunk 上开发，需要独立改动时复制一份到 branches/ 再继续。
              <br />· <strong className="help-k ok">➕ 新建</strong>：输入名称回车 = 复制 trunk（或当前目录）创建分支
              <br />· <strong className="help-k primary">⇄ 切换</strong>：工作副本指向该分支（本地改动会尽量保留，可能冲突）
              <br />· <strong className="help-k accent">🔀 合并</strong>：把该分支的改动并入当前工作副本（合并前请先更新）
              <br />· <strong className="help-k err">✕ 删除</strong>：已合并分支可删除。主干（trunk）是团队稳定版本，不能删除
              <br />
              绿色 ● = 当前分支
            </>
          )}
        </HelpNote>
      )}
      {/* 仓库布局提示（svn 非标准布局时提醒） */}
      {props.repoType === 'svn' && data?.layout && <LayoutNote layout={data.layout} />}
      {/* 新建分支 */}
      <div className="row" style={{ margin: '12px 0' }}>
        <input
          type="text"
          placeholder="新分支名称…（回车创建）"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && newName.trim()) confirmCreate(newName.trim());
          }}
          style={{ flex: 1 }}
        />
        <button
          className="primary"
          disabled={busy || !newName.trim()}
          onClick={() => confirmCreate(newName.trim())}
          title={cmdOfRepo(props.repoType, 'branch_create', { name: newName.trim() || '…' })}
        >
          ➕ 新建分支
        </button>
        {props.repoType === 'svn' && data?.current && data.current !== 'trunk' && (
          <button className="mini" disabled={busy} onClick={() => confirmSwitch('trunk', true)} title="切回 trunk">
            ↩ 切回主干
          </button>
        )}
      </div>
      {/* 分支列表 */}
      <div className="vcs-list" style={{ flex: 1, minHeight: 60 }}>
        {!data && <div className="dim" style={{ padding: '10px 6px' }}>加载中…</div>}
        {data && data.branches.length === 0 && <div className="dim" style={{ padding: '10px 6px' }}>暂无分支{props.repoType === 'svn' ? '（仓库根下没有 branches/ 目录）' : ''}</div>}
        {data?.branches.map((b) => {
          // 是否已推送：本地分支能否找到对应的 origin/<名字> 远程项
          const isPushed = data.branches.some((r) => r.remote && r.name === 'origin/' + b.name);
          return (
            <div
              key={b.name}
              className={`vcs-row ${sel === b.name ? 'selected' : ''}`}
              onClick={() => setSel(b.name)}
              title={b.name === data.current ? '当前分支' : undefined}
            >
              <span className="vcs-current" style={{ visibility: b.name === data.current ? 'visible' : 'hidden' }}>●</span>
              <span className="badge" style={{ background: b.remote ? 'var(--dim)' : 'var(--ok)', fontSize: 9, minWidth: 38, textAlign: 'center' }}>
                {b.name === data.current ? '当前' : b.remote ? '远程' : '本地'}
              </span>
              <span className="mono" style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.name}</span>
              {/* 非当前分支的常规操作；当前分支若未推送也显示「推送到远程」（仅仓库配了远程时） */}
              {(b.name !== data.current || (props.repoType === 'git' && hasRemote && !b.remote && !isPushed)) && (
                <span className="row" style={{ gap: 4 }} onClick={(e) => e.stopPropagation()}>
                  {b.name !== data.current && (
                    <button className="mini primary" disabled={busy} onClick={() => confirmSwitch(b.name)} title={cmdOfRepo(props.repoType, 'branch_switch', { name: b.name })}>切换</button>
                  )}
                  {props.repoType === 'git' && hasRemote && !b.remote && !isPushed && (
                    <button className="mini btn-accent" disabled={busy} onClick={() => confirmPush(b.name)} title={`该分支尚未推送到远程\n点此将 ${b.name} 推送到远程服务器（origin）`}>⬆ 推送到远程</button>
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
                          ? '主干分支不能删除（团队稳定版本，防止误删）'
                          : `${cmdOfRepo(props.repoType, 'branch_remote_delete', { name: bare }) ?? ''}\n\n删除远程分支：远程将不再存在（本地分支不受影响）`}
                      >
                        删除远程
                      </button>
                    );
                  })()}
                  {!b.remote && b.name !== data.current && (
                    <>
                      <button className="mini btn-accent" disabled={busy} onClick={() => confirmMerge(b.name)} title={`${cmdOfRepo(props.repoType, 'branch_merge', { name: b.name })}\n\n把该分支的改动合并到当前分支（先确保已切到目标分支）`}>🔀 合并</button>
                      <button
                        className="mini danger"
                        disabled={busy || isTrunkName(b.name)}
                        title={isTrunkName(b.name)
                          ? '主干分支不能删除（团队稳定版本，防止误删）'
                          : `${cmdOfRepo(props.repoType, 'branch_delete', { name: b.name })}\n\n删除分支（已合并的分支才能删）`}
                        onClick={() =>
                          setCfm({
                            title: '删除分支',
                            msg: `确认删除分支 ${b.name}？未合并的改动会丢失（可强制删除）。`,
                            action: () => act('delete', b.name, false),
                          })
                        }
                      >
                        删除
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
          confirmLabel={cfm.confirmLabel ?? '确认'}
          hideCancel={cfm.hideCancel}
          confirmCmd={cfm.confirmCmd}
          onConfirm={() => {
            const a = cfm.action;
            setCfm(null);
            a();
          }}
          onCancel={() => setCfm(null)}
        />
      )}
      {/* 新建分支（git 非主干）：带基点选择——基于主干（推荐）/ 基于当前分支 */}
      {createCfm && data?.current && (
        <ConfirmModal
          title="新建分支"
          width={480}
          message={
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, whiteSpace: 'normal' }}>
              <div>确认创建新分支 <span className="mono">{createCfm.name}</span>？</div>
              <label className="row" style={{ alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                <input type="radio" checked={createBase === 'trunk'} onChange={() => setCreateBase('trunk')} />
                <span>基于主干 <span className="mono">{createCfm.trunkBase}</span>（推荐）</span>
              </label>
              <label className="row" style={{ alignItems: 'center', gap: 6, cursor: 'pointer', flexWrap: 'wrap' }}>
                <input type="radio" checked={createBase === 'current'} onChange={() => setCreateBase('current')} />
                <span>基于当前分支 <span className="mono">{data.current}</span></span>
                {createBase === 'current' && (
                  <span className="small" style={{ color: 'var(--warn)' }}>
                    ⚠ 包含 {data.current} 已提交的改动，合并回主干时一并进入
                  </span>
                )}
              </label>
              <div className="dim small">创建后不自动切换，仍停留在当前分支 {data.current}。</div>
            </div>
          }
          confirmLabel="创建"
          confirmCmd={cmdOfRepo(
            'git',
            'branch_create',
            createBase === 'trunk' ? { name: createCfm.name, base: createCfm.trunkBase! } : { name: createCfm.name },
          )}
          onConfirm={() => {
            const { name, trunkBase } = createCfm;
            const base = createBase === 'trunk' ? trunkBase : undefined;
            setCreateCfm(null);
            act('create', name, false, base);
          }}
          onCancel={() => setCreateCfm(null)}
        />
      )}
      {/* 分支推送中：转圈提示，可取消（与主推送同款） */}
      {pushProg && (
        <div className="modal-mask">
          <div className="modal" style={{ width: 380 }}>
            <div className="body" style={{ textAlign: 'center', padding: '26px 18px' }}>
              <div className="spinner" />
              <div style={{ marginTop: 14, fontWeight: 600 }}>
                {pushProg.action === 'remote-delete' ? `正在删除远程分支 ${pushProg.name}…` : `正在推送分支 ${pushProg.name}…`}
              </div>
              <div className="dim small" style={{ marginTop: 6 }}>视网络情况可能需要一些时间，可随时取消</div>
              <div className="small" style={{ marginTop: 8, color: 'var(--accent)' }}>已耗时 {pushElapsed}s</div>
              <button className="mini danger" style={{ marginTop: 18 }} onClick={() => pushAbortRef.current?.abort()}>
                {pushProg.action === 'remote-delete' ? '取消删除' : '取消推送'}
              </button>
            </div>
          </div>
        </div>
      )}
</ModalShell>
  );
}

// ==================== git 清理未跟踪（预览+确认） ====================

export function CleanDialog(props: { onClose: () => void; onDone: () => void }) {
  const [files, setFiles] = useState<string[] | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState('');
  const [msgErr, setMsgErr] = useState(false);
  const [busy, setBusy] = useState(false);
  // 二次确认：防误触（清理不可恢复，与删除分支/丢弃 stash 一致）
  const [cfm, setCfm] = useState<{ title: string; msg: string; action: () => void } | null>(null);

  const load = () => {
    get
      .gitClean()
      .then((r) => {
        setFiles(r.files);
        setChecked(new Set(r.files)); // 默认全选（全量清理语义与现状一致）
      })
      .catch((e: Error) => {
        setMsg(e.message);
        setMsgErr(true);
      });
  };
  useEffect(load, []); // eslint-disable-line react-hooks/exhaustive-deps

  /** 全选（全部文件）→ 不传 paths 走原全量命令；部分勾选 → 只清理选中的路径 */
  const doClean = () => {
    const sel = (files ?? []).filter((f) => checked.has(f));
    const paths = sel.length > 0 && sel.length < (files?.length ?? 0) ? sel : undefined;
    setBusy(true);
    void runAction(
      () => post.gitClean(paths),
      (m, err) => {
        setMsg(m);
        setMsgErr(Boolean(err));
      },
      props.onDone
    ).finally(() => setBusy(false));
  };

  return (
    <ModalShell
      title="清理未跟踪文件 (GIT)"
      onClose={props.onClose}
      width={520}
      foot={
        <>
          <button onClick={props.onClose}>关闭</button>
          <button
            className="danger"
            disabled={busy || !files || files.length === 0 || checked.size === 0}
            onClick={() =>
              setCfm({
                title: '⚠ 确认清理',
                msg: `将删除已勾选的 ${checked.size} 个未跟踪文件，不可恢复。确认清理？`,
                action: () => doClean(),
              })
            }
            title={`删除已勾选的 ${checked.size} 个未跟踪文件（${[...checked].slice(0, 3).join(' ') ?? ''}${checked.size > 3 ? ' …' : ''}）`}
          >
            {busy ? '清理中…' : '确认清理'}
          </button>
        </>
      }
    >
      <div className="dim small" style={{ marginBottom: 8 }}>
        <div>
          以下文件将被永久删除，不可恢复。清理的是工作区里存在、但<strong>没被 git 纳入版本管理</strong>的文件
          （未跟踪文件：新建未提交、编译产物、临时文件、被忽略文件等）：
        </div>
        <div style={{ color: 'var(--warn)', marginTop: 6 }}>
          ⚠ 特别提醒：如果你有自己新建的、还没想好要不要提交的文件，请先确认好再执行清理！
        </div>
      </div>
      {files === null && !msgErr && <div className="dim" style={{ padding: '10px 6px' }}>扫描中…</div>}
      {files && (
        <div className="changed" style={{ maxHeight: 260, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 8, padding: 6, marginBottom: 12 }}>
          {files.length === 0 ? (
            <div className="dim" style={{ padding: '10px 6px' }}>没有未跟踪文件 🎉</div>
          ) : (
            <>
              <label className="row" style={{ cursor: 'pointer', gap: 6, borderBottom: '1px solid var(--border2)', paddingBottom: 6, marginBottom: 4, flexShrink: 0 }}>
                <input
                  type="checkbox"
                  checked={checked.size === files.length}
                  onChange={() => setChecked(checked.size === files.length ? new Set() : new Set(files))}
                />
                <span className="dim small">{checked.size === files.length ? '取消全选' : '全选'}</span>
                <span className="dim small" style={{ marginLeft: 'auto' }}>已勾选 {checked.size}/{files.length}</span>
              </label>
              {files.map((f) => (
                <label key={f} className="changed-row" style={{ cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={checked.has(f)}
                    onChange={() => {
                      const nx = new Set(checked);
                      if (nx.has(f)) nx.delete(f);
                      else nx.add(f);
                      setChecked(nx);
                    }}
                    style={{ flexShrink: 0 }}
                  />
                  <span style={{ color: 'var(--err)', flexShrink: 0, display: 'inline-flex', alignItems: 'center' }}>
                    <IconErr size={12} />
                  </span>
                  <span className="mono small" style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f}</span>
                </label>
              ))}
            </>
          )}
        </div>
      )}
      <ResultLine msg={msg} err={msgErr} />
      {cfm && (
        <ConfirmModal
          title={cfm.title}
          message={cfm.msg}
          danger
          confirmLabel="确认清理"
          confirmCmd="git clean -fd"
          onConfirm={() => {
            const a = cfm.action;
            setCfm(null);
            a();
          }}
          onCancel={() => setCfm(null)}
        />
      )}
    </ModalShell>
  );
}

// ==================== 标签管理 ====================

export function TagDialog(props: { repoType: 'svn' | 'git'; onClose: () => void; onChanged: () => void }) {
  const [data, setData] = useState<{ tags: string[]; layout?: SvnLayout } | null>(null);
  const [newName, setNewName] = useState('');
  const [msg, setMsg] = useState('');
  const [msgErr, setMsgErr] = useState(false);
  const [busy, setBusy] = useState(false);
  // 工具风格二次确认
  const [cfm, setCfm] = useState<{ title: string; msg: string; action: () => void } | null>(null);

  const load = () => {
    get
      .tags()
      .then((r) => setData(r))
      .catch((e: Error) => {
        setMsg(e.message);
        setMsgErr(true);
      });
  };
  useEffect(load, []); // eslint-disable-line react-hooks/exhaustive-deps

  const act = (action: 'create' | 'delete', name: string) => {
    setBusy(true);
    void runAction(
      () => post.tag(action, name),
      (m, err) => {
        setMsg(m);
        setMsgErr(Boolean(err));
      },
      () => {
        load();
        props.onChanged();
      }
    ).finally(() => setBusy(false));
  };

  return (
    <ModalShell icon={<IconTag size={16} />} title={`标签管理 (${props.repoType.toUpperCase()})`} onClose={props.onClose} width={560}>
      <HelpNote>
        {props.repoType === 'git'
          ? '标签是给当前提交打的固定名字，常用于标记发布版本（v1.0、v2.0 等）。用法：输入名称回车 = 给当前代码打标签；列表中的标签可「删除」。'
          : 'SVN 标签是版本库中的目录快照（tags/），只读性质，用于标记发布版本。用法：输入名称回车 = 复制 trunk（或当前目录）创建标签；列表中的标签可「删除」（危险操作会确认）。'}
      </HelpNote>
      {/* 仓库布局提示（svn 非标准布局时提醒） */}
      {props.repoType === 'svn' && data?.layout && <LayoutNote layout={data.layout} />}
      <div className="row" style={{ margin: '12px 0' }}>
        <input
          type="text"
          placeholder="新标签名称…（回车创建）"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && newName.trim()) act('create', newName.trim());
          }}
          style={{ flex: 1 }}
        />
        <button
          className="primary"
          disabled={busy || !newName.trim()}
          onClick={() => act('create', newName.trim())}
          title={cmdOfRepo(props.repoType, 'tag_create', { name: newName.trim() || '…', msg: '…' })}
        >
          🏷 创建标签
        </button>
      </div>
      <div className="vcs-list" style={{ maxHeight: 260 }}>
        {!data && <div className="dim" style={{ padding: '10px 6px' }}>加载中…</div>}
        {data && data.tags.length === 0 && <div className="dim" style={{ padding: '10px 6px' }}>暂无标签</div>}
        {data?.tags.map((t) => (
          <div key={t} className="changed-row">
            <span style={{ color: 'var(--accent)' }}>🏷</span>
            <span className="mono" style={{ flex: 1 }}>{t}</span>
            <button
              className="mini danger"
              disabled={busy}
              onClick={() =>
                setCfm({
                  title: '删除标签',
                  msg: `确认删除标签 ${t}？`,
                  action: () => act('delete', t),
                })
              }
              title={cmdOfRepo(props.repoType, 'tag_delete', { name: t })}
            >
              删除
            </button>
          </div>
        ))}
      </div>
      <ResultLine msg={msg} err={msgErr} />
      {/* 远程仓库（git） */}
      {props.repoType === 'git' && <RemoteList />}
      {/* 二次确认（工具风格） */}
      {cfm && (
        <ConfirmModal
          title={cfm.title}
          message={cfm.msg}
          confirmLabel="确认"
          onConfirm={() => {
            const a = cfm.action;
            setCfm(null);
            a();
          }}
          onCancel={() => setCfm(null)}
        />
      )}
    </ModalShell>
  );
}

/** git 远程列表展示 */
function RemoteList() {
  const [remotes, setRemotes] = useState<{ name: string; url: string }[]>([]);
  useEffect(() => {
    get
      .remotes()
      .then((r) => setRemotes(r.remotes))
      .catch(() => {});
  }, []);
  if (remotes.length === 0) return null;
  return (
    <div style={{ marginTop: 12 }}>
      <div className="dim small" style={{ marginBottom: 4 }}>远程仓库：</div>
      {remotes.map((r) => (
        <div key={r.name} className="changed-row">
          <span className="badge git" style={{ background: 'var(--accent)', fontSize: 9 }}>{r.name}</span>
          <span className="mono small dim" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.url}</span>
        </div>
      ))}
    </div>
  );
}

// ==================== Stash（git） ====================

export function StashDialog(props: { onClose: () => void; onChanged: () => void }) {
  const [items, setItems] = useState<StashItem[]>([]);
  const [message, setMessage] = useState('');
  const [msg, setMsg] = useState('');
  const [msgErr, setMsgErr] = useState(false);
  const [busy, setBusy] = useState(false);
  // 当前工作区改动（可暂存列表）：含未跟踪(?)；冲突(C)不可暂存（先解决），I/X 同理排除
  const [files, setFiles] = useState<{ path: string; code: string }[]>([]);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  // 工具风格二次确认
  const [cfm, setCfm] = useState<{ title: string; msg: string; action: () => void } | null>(null);

  const load = () => {
    get
      .stash()
      .then((r) => setItems(r.items))
      .catch((e: Error) => {
        setMsg(e.message);
        setMsgErr(true);
      });
    get
      .status()
      .then((r) => {
        const list = (r.items ?? []).filter((i) => i.code && i.code !== 'I' && i.code !== 'X' && i.code !== 'C');
        setFiles(list.map((i) => ({ path: i.path, code: i.code })));
        setChecked(new Set(list.map((i) => i.path))); // 默认全选
      })
      .catch(() => {});
  };
  useEffect(load, []); // eslint-disable-line react-hooks/exhaustive-deps

  const act = (action: 'push' | 'pop' | 'drop', index = 0, msg2 = '', paths?: string[]) => {
    setBusy(true);
    void runAction(
      () => post.stash(action, msg2, index, paths),
      (m, err) => {
        setMsg(m);
        setMsgErr(Boolean(err));
      },
      () => {
        load();
        props.onChanged();
      }
    ).finally(() => setBusy(false));
  };

  /** 保存当前改动：全选 = 全量 stash（-u 收全部，与原行为一致）；取消部分勾选 = 部分 stash（-- paths 只收选中的） */
  const doPush = () => {
    const sel = files.filter((f) => checked.has(f.path)).map((f) => f.path);
    act('push', 0, message, sel.length > 0 && sel.length < files.length ? sel : undefined);
  };

  return (
    <ModalShell icon={<IconStash size={16} />} title={`Stash 暂存区 (GIT)`} onClose={props.onClose} width={580}>
      <HelpNote>
        Stash 把当前未提交的改动临时收起来（含未跟踪文件），让工作区变干净——适合"先切分支/先做别的，稍后再回来继续"。用法：点「保存当前改动」收起（可写说明）；列表中「恢复」= 把改动取回工作区，「丢弃」= 放弃这份改动。
      </HelpNote>
      {/* 当前工作区改动：可勾选部分暂存（默认全选=全量收走，含未跟踪） */}
      <div className="small dim" style={{ margin: '12px 0 4px' }}>
        当前工作区改动（{files.length} 项，默认全选；取消勾选 = 只暂存选中的文件）
      </div>
      <div className="vcs-list" style={{ maxHeight: 132 }}>
        {files.length === 0 && <div className="dim" style={{ padding: '10px 6px' }}>工作区没有改动可暂存（先修改文件，再回来保存）</div>}
        {files.map((f) => (
          <div key={f.path} className="vcs-row" style={{ cursor: 'default' }}>
            <input
              type="checkbox"
              checked={checked.has(f.path)}
              onChange={(e) => {
                const nx = new Set(checked);
                if (e.target.checked) nx.add(f.path);
                else nx.delete(f.path);
                setChecked(nx);
              }}
            />
            <span className={`code ${f.code}`}>{f.code}</span>
            <span className="mono small" style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.path}</span>
          </div>
        ))}
      </div>
      <div className="row" style={{ margin: '12px 0' }}>
        <input
          type="text"
          placeholder="保存说明（可选）…"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') doPush();
          }}
          style={{ flex: 1 }}
        />
        <button
          className="primary"
          disabled={busy || files.length === 0 || checked.size === 0}
          onClick={doPush}
          title={`${cmdOfRepo('git', 'stash_push', { msg: message.trim() || '…' }) ?? ''}`}
        >
          📦 保存当前改动
        </button>
      </div>
      <div className="vcs-list" style={{ maxHeight: 260 }}>
        {items.length === 0 && <div className="dim" style={{ padding: '10px 6px' }}>暂无 Stash</div>}
        {items.map((it) => (
          <div key={it.index} className="changed-row">
            <span style={{ color: 'var(--warn)' }}>📦</span>
            <span className="mono small" style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              stash@{it.index}: {it.label}
            </span>
            <button
              className="mini"
              disabled={busy}
              onClick={() =>
                setCfm({
                  title: '恢复 Stash',
                  msg: `确认恢复 stash@{${it.index}}？改动将合入工作区（如产生冲突会保留该条 Stash 供处理）。`,
                  action: () => act('pop', it.index),
                })
              }
              title={`${cmdOfRepo('git', 'stash_pop', { index: String(it.index) }) ?? ''}`}
            >
              恢复
            </button>
            <button
              className="mini danger"
              disabled={busy}
              onClick={() =>
                setCfm({
                  title: '丢弃 Stash',
                  msg: `确认丢弃 stash@{${it.index}}？改动将丢失。`,
                  action: () => act('drop', it.index),
                })
              }
            >
              丢弃
            </button>
          </div>
        ))}
      </div>
      <ResultLine msg={msg} err={msgErr} />
      {/* 二次确认（工具风格） */}
      {cfm && (
        <ConfirmModal
          title={cfm.title}
          message={cfm.msg}
          confirmLabel="确认"
          onConfirm={() => {
            const a = cfm.action;
            setCfm(null);
            a();
          }}
          onCancel={() => setCfm(null)}
        />
      )}
    </ModalShell>
  );
}

// ==================== Git 信息与配置 ====================

/** Git 信息弹窗：分支 / 远程 / 上游 / 最近提交，可修改远程地址 */
export function GitInfoModal(props: { onClose: () => void; onToast: (m: string) => void }) {
  const [info, setInfo] = useState<{
    branch: string;
    remote: string;
    upstream: string;
    lastCommit: { hash: string; author: string; date: string; msg: string } | null;
  } | null>(null);
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => {
    get
      .gitInfo()
      .then((r) => {
        setInfo(r);
        setUrl(r.remote);
      })
      .catch((e: Error) => props.onToast((e as Error).message));
  };
  useEffect(load, []); // eslint-disable-line react-hooks/exhaustive-deps

  const save = () => {
    if (!url.trim()) {
      props.onToast('远程地址不能为空');
      return;
    }
    setBusy(true);
    void post
      .gitConfig(url.trim())
      .then((r) => {
        props.onToast(r.message);
        if (r.ok) load();
      })
      .catch((e: Error) => props.onToast(`配置失败: ${(e as Error).message}`))
      .finally(() => setBusy(false));
  };

  return (
    <div className="modal-mask">
      <ResizableModal width={560} minWidth={480}>
        <h3>⚙ Git 信息</h3>
        <div className="body">
          {!info && <div className="loading">⏳ 读取 Git 信息…</div>}
          {info && (
            <>
              <div className="help-note" style={{ marginBottom: 12 }}>
                <div className="small" style={{ lineHeight: 1.9 }}>
                  <div className="row" style={{ gap: 8 }}>
                    <span className="dim" style={{ width: 72 }}>当前分支</span>
                    <span className="mono" style={{ color: 'var(--accent)', fontWeight: 600 }}>{info.branch || '（分离头指针）'}</span>
                  </div>
                  <div className="row" style={{ gap: 8 }}>
                    <span className="dim" style={{ width: 72 }}>上游跟踪</span>
                    <span className="mono">{info.upstream || <span style={{ color: 'var(--warn)' }}>未设置（更新时自动按 origin/分支拉取）</span>}</span>
                  </div>
                  {info.lastCommit && (
                    <>
                      <div className="row" style={{ gap: 8 }}>
                        <span className="dim" style={{ width: 72 }}>最近提交</span>
                        <span className="mono">{info.lastCommit.hash}</span>
                      </div>
                      <div className="row" style={{ gap: 8 }}>
                        <span className="dim" style={{ width: 72 }}>提交信息</span>
                        <span className="small" style={{ flex: 1, wordBreak: 'break-all' }}>{info.lastCommit.msg}</span>
                      </div>
                      <div className="row" style={{ gap: 8 }}>
                        <span className="dim" style={{ width: 72 }}>作者 / 时间</span>
                        <span className="small">{info.lastCommit.author} · {info.lastCommit.date}</span>
                      </div>
                    </>
                  )}
                </div>
              </div>
              {/* 远程地址配置 */}
              <FormRow label="远程地址（origin）">
                <div className="row" style={{ gap: 8 }}>
                  <input type="text" placeholder="git@host:user/repo.git 或 https://..." value={url} onChange={(e) => setUrl(e.target.value)} style={{ flex: 1 }} />
                  <button className="mini primary" disabled={busy} onClick={save} title={`${cmdOfRepo('git', 'set_remote', { url: url.trim() || '…' }) ?? ''}`}>{busy ? '保存中…' : '保存'}</button>
                </div>
                <div className="dim small" style={{ marginTop: 6 }}>修改后推送/拉取将使用新地址（已有 origin 则更新，没有则添加）</div>
              </FormRow>
            </>
          )}
        </div>
        <div className="foot">
          <button onClick={props.onClose}>关闭</button>
        </div>
      </ResizableModal>
    </div>
  );
}

// ==================== Git 推送认证 ====================

/** 推送认证弹窗：GitHub 用户名+Token / 服务器用户名+密码 / SSH 提示 */
export function GitPushAuthModal(props: {
  type: 'github' | 'server' | 'ssh';
  username?: string;
  /** 上次推送失败的认证错误（显示在窗口内提示用户检查） */
  error?: string;
  onClose: () => void;
  onSaved: () => void;
  onToast: (m: string) => void;
}) {
  const [username, setUsername] = useState(props.username ?? '');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const isGithub = props.type === 'github';
  // 打开时预填已保存的用户名（token 不回传，需重新输入）
  useEffect(() => {
    if (props.username) return;
    get
      .gitAuth()
      .then((r) => r.username && setUsername(r.username))
      .catch(() => {});
  }, [props.username]);

  const save = () => {
    if (!username.trim() || !password) {
      props.onToast('请填写用户名和密码');
      return;
    }
    setBusy(true);
    void post
      .gitAuthSave(username.trim(), password)
      .then((r) => {
        props.onToast(r.message);
        if (r.ok) props.onSaved();
      })
      .catch((e: Error) => props.onToast(`保存失败: ${(e as Error).message}`))
      .finally(() => setBusy(false));
  };

  return (
    <div className="modal-mask">
      <ResizableModal width={460} minWidth={420}>
        <h3>{isGithub ? '🔑 GitHub 推送认证' : props.type === 'ssh' ? '🔑 SSH 推送提示' : '🔑 Git 服务器推送认证'}</h3>
        <div className="body">
          {props.error && (
            <div className="error" style={{ marginBottom: 10, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
              ⚠ 认证失败：{props.error}
            </div>
          )}
          {props.type === 'ssh' ? (
            <HelpNote>
              当前远程地址使用 <b>SSH</b>(git@…)。请确认本机已配置 SSH 密钥并已加入 ssh-agent
              （<span className="mono">ssh-keygen -t ed25519</span> 生成、<span className="mono">ssh-add</span> 加入、
              <span className="mono">ssh -T git@github.com</span> 验证）。
              如需使用用户名密码推送，请改用 <b>HTTPS</b> 地址（可在「Git 信息」中修改远程地址）。
            </HelpNote>
          ) : (
            <>
              <div className="form-row">
                <label>{isGithub ? 'GitHub 用户名' : '用户名'}</label>
                <input type="text" placeholder={isGithub ? 'your-github-username' : '服务器用户名'} value={username} onChange={(e) => setUsername(e.target.value)} />
              </div>
              <div className="form-row">
                <label>{isGithub ? 'Personal Access Token' : '密码 / Token'}</label>
                <input
                  type="password"
                  placeholder={isGithub ? 'ghp_xxx（Settings → Developer settings → Tokens）' : '密码或访问令牌'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') save();
                  }}
                />
              </div>
              {isGithub && (
                <div className="dim small">
                  在 GitHub 的 Settings → Developer settings → Personal access tokens 生成，勾选
                  <b> repo </b> 权限即可推送。
                </div>
              )}
            </>
          )}
        </div>
        <div className="foot">
          <button onClick={props.onClose}>取消</button>
          {props.type !== 'ssh' && (
            <button className="primary" disabled={busy} onClick={save}>
              {busy ? '保存中…' : '保存并推送'}
            </button>
          )}
        </div>
      </ResizableModal>
    </div>
  );
}

// ==================== 创建 / 克隆仓库 ====================

export function CreateRepoDialog(props: { home?: string; onClose: () => void; onCreated: (dir: string) => void }) {
  const [type, setType] = useState<'git' | 'svn'>('git');
  const [dir, setDir] = useState(props.home ?? '');
  const [name, setName] = useState('');
  const [standard, setStandard] = useState(true); // svn 标准布局（trunk/branches/tags），默认勾选
  const [msg, setMsg] = useState('');
  const [msgErr, setMsgErr] = useState(false);
  const [busy, setBusy] = useState(false);
  const [picker, setPicker] = useState(false); // 文件夹浏览选择器
  const [pending, setPending] = useState<RepoCheck | null>(null); // 二次确认数据（打开确认框）

  const submit = () => {
    if (!dir.trim() || !name.trim()) {
      setMsg('请填写目录和名称');
      setMsgErr(true);
      return;
    }
    setBusy(true);
    // 前置风险检测（目标已存在 / 位于仓库内），成功后弹二次确认
    void post
      .repoCheck(type, dir.trim(), name.trim())
      .then((r) => setPending(r))
      .catch((e) => {
        setMsg((e as Error).message);
        setMsgErr(true);
      })
      .finally(() => setBusy(false));
  };

  // 二次确认后执行创建
  const doCreate = () => {
    setPending(null);
    setBusy(true);
    void runAction(
      () => post.repoCreate(type, dir.trim(), name.trim(), '', standard),
      (m, err) => {
        setMsg(m);
        setMsgErr(Boolean(err));
      },
      // 打开服务端返回的仓库路径（git=目标目录；svn=xxx-wc 工作副本），没返回时兜底拼路径
      (r) => props.onCreated(r.repoDir ?? `${dir.trim().replace(/\/$/, '')}/${name.trim()}`)
    ).finally(() => setBusy(false));
  };

  return (
    <ModalShell
      icon={<IconPlus size={16} />}
      title="新建仓库"
      onClose={props.onClose}
      width={540}
      foot={
        <>
          <button onClick={props.onClose}>关闭</button>
          <button
            className="primary"
            disabled={busy}
            onClick={submit}
            title={
              `${
                type === 'git'
                  ? (cmdOfRepo('git', 'init', { dir: `${dir.trim()}/${name.trim() || '…'}` }) ?? '')
                  : (cmdOfRepo('svn', 'create', { dir: `${dir.trim()}/${name.trim() || '…'}` }) ?? '')
              }`
            }
          >
            {busy ? '创建中…' : '创建'}
          </button>
        </>
      }
    >
      <HelpNote>
        两种方式：Git 仓库 = 在本地目录初始化新仓库（git init）；SVN 仓库 = 用 svnadmin 创建本地仓库，默认创建标准布局（trunk / branches / tags）并检出 trunk 作为工作副本（目录名 + "-wc"）。
      </HelpNote>
      <div style={{ marginTop: 12 }} />
      <div className="row" style={{ marginBottom: 12, gap: 6 }}>
        {(
          [
            ['git', 'Git 仓库 (init)'],
            ['svn', 'SVN 仓库（svnadmin）'],
          ] as const
        ).map(([k, label]) => (
          <button key={k} className={`mini ${type === k ? 'primary' : ''}`} onClick={() => setType(k)}>
            {label}
          </button>
        ))}
      </div>
      <FormRow label="所在目录（父目录路径）">
        <div className="row" style={{ gap: 8 }}>
          <input type="text" placeholder="/home/me/projects" value={dir} onChange={(e) => setDir(e.target.value)} style={{ flex: 1 }} />
          <button className="mini tool-btn" title="打开文件夹浏览（可新建/重命名文件夹）" onClick={() => setPicker(true)}>
            📂 浏览
          </button>
        </div>
      </FormRow>
      <FormRow label="仓库名称">
        <input
          type="text"
          placeholder="my-project"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
          }}
        />
      </FormRow>
      <div className="dim small" style={{ whiteSpace: 'pre-line' }}>
        {(() => {
          const base = `${dir.trim().replace(/\/$/, '')}/${name.trim() || '…'}`;
          if (type === 'git') return `将创建：Git 仓库 ${base}\ngit init 创建，创建后自动打开`;
          return `将创建：SVN 版本库 ${base}（服务器存储，不能直接编辑）\n并检出工作副本 ${base}-wc（创建后自动打开；日常编辑、添加、提交都在工作副本进行）`;
        })()}
      </div>
      {/* SVN 标准布局选项（默认勾选，非标准布局仓库分支管理受限） */}
      {type === 'svn' && (
        <>
          <label className="row" style={{ gap: 6, marginTop: 8, cursor: 'pointer' }}>
            <input type="checkbox" checked={standard} onChange={(e) => setStandard(e.target.checked)} />
            <span className="small">创建标准布局（trunk / branches / tags），工作副本检出 trunk</span>
          </label>
          {!standard && (
            <div className="small" style={{ color: 'var(--warn)', marginTop: 4 }}>
              ⚠ 不创建标准布局：分支 / 标签管理将不可用（后续无法自动创建分支和标签）
            </div>
          )}
        </>
      )}
      <ResultLine msg={msg} err={msgErr} />
      {/* 二次确认：目标路径 + 命令 + 风险检测 */}
      {pending && (
        <ConfirmModal
          title="确认创建仓库？"
          message={
            <>
              <div>目标路径：{pending.target}</div>
              <div>将执行：{type === 'git' ? 'git init 初始化仓库' : 'svnadmin create 创建版本库 + 检出工作副本'}（命令预览见按钮）</div>
              {pending.inRepo && (
                <div style={{ color: 'var(--warn)', marginTop: 6 }}>
                  ⚠ 目标位于 {pending.inRepo.type.toUpperCase()} 仓库内（{pending.inRepo.root}）——在其内部创建会成为外层仓库的未版本化内容，状态/数据可能错乱
                </div>
              )}
              {pending.existsNonEmpty && (
                <div style={{ color: 'var(--warn)', marginTop: 6 }}>
                  ⚠ 目标目录已存在且非空（{pending.target}）——可能已有仓库/文件，继续创建可能失败或产生嵌套
                </div>
              )}
            </>
          }
          confirmLabel="确认创建"
          confirmCmd={
            type === 'git'
              ? (cmdOfRepo('git', 'init', { dir: pending.target }) ?? '')
              : (cmdOfRepo('svn', 'create', { dir: pending.target }) ?? '')
          }
          onConfirm={doCreate}
          onCancel={() => setPending(null)}
        />
      )}
      {/* 文件夹浏览选择器：新建/重命名，确定填充所在目录 */}
      {picker && (
        <div className="modal-mask">
          <ResizableModal width={640}>
            <h3>📂 选择所在目录</h3>
            <div className="body">
              <DirPicker
                startDir={props.home ?? ''}
                onPick={(p) => {
                  setDir(p);
                  setPicker(false);
                }}
                onClose={() => setPicker(false)}
              />
            </div>
          </ResizableModal>
        </div>
      )}
    </ModalShell>
  );
}

/** 获取仓库：Git 克隆 / SVN 检出（成员从服务器/远程获取工作副本，不是新建） */
export function GetRepoDialog(props: { home?: string; onClose: () => void; onCreated: (dir: string) => void }) {
  const [type, setType] = useState<'git' | 'svn'>('git');
  const [url, setUrl] = useState('');
  const [dir, setDir] = useState(props.home ?? '');
  const [name, setName] = useState('');
  const [msg, setMsg] = useState('');
  const [msgErr, setMsgErr] = useState(false);
  const [busy, setBusy] = useState(false);
  const [picker, setPicker] = useState(false);
  const [pending, setPending] = useState<RepoCheck | null>(null); // 二次确认数据

  const submit = () => {
    if (!url.trim()) {
      setMsg('请填写地址（URL）');
      setMsgErr(true);
      return;
    }
    if (!dir.trim() || !name.trim()) {
      setMsg('请填写目标和名称');
      setMsgErr(true);
      return;
    }
    setBusy(true);
    // 前置风险检测（目标已存在 / 位于仓库内），成功后弹二次确认
    void post
      .repoCheck(type, dir.trim(), name.trim(), url.trim())
      .then((r) => setPending(r))
      .catch((e) => {
        setMsg((e as Error).message);
        setMsgErr(true);
      })
      .finally(() => setBusy(false));
  };

  // 二次确认后执行获取
  const doGet = () => {
    setPending(null);
    setBusy(true);
    void runAction(
      () => post.repoCreate(type, dir.trim(), name.trim(), url.trim(), true),
      (m, err) => {
        setMsg(m);
        setMsgErr(Boolean(err));
      },
      // 打开服务端返回的仓库路径（git/svn 均为目标目录），没返回时兜底拼路径
      (r) => props.onCreated(r.repoDir ?? `${dir.trim().replace(/\/$/, '')}/${name.trim()}`)
    ).finally(() => setBusy(false));
  };

  return (
    <ModalShell
      icon={<IconDownload size={16} />}
      title="获取仓库"
      onClose={props.onClose}
      width={540}
      foot={
        <>
          <button onClick={props.onClose}>关闭</button>
          <button
            className="primary"
            disabled={busy}
            onClick={submit}
            title={
              `${
                type === 'git'
                  ? (cmdOfRepo('git', 'clone', { url: url.trim() || '…', dir: `${dir.trim()}/${name.trim() || '…'}` }) ?? '')
                  : (cmdOfRepo('svn', 'checkout', { url: url.trim() || '…', dir: `${dir.trim()}/${name.trim() || '…'}` }) ?? '')
              }`
            }
          >
            {busy ? '获取中…' : '获取'}
          </button>
        </>
      }
    >
      <HelpNote>
        两种方式：Git 克隆 = git clone（从地址复制一份到本地）；SVN 检出 = svn checkout（从服务器获取工作副本，目标目录即本地名称）。
      </HelpNote>
      <div style={{ marginTop: 12 }} />
      <div className="row" style={{ marginBottom: 12, gap: 6 }}>
        {(
          [
            ['git', 'Git 克隆'],
            ['svn', 'SVN 检出'],
          ] as const
        ).map(([k, label]) => (
          <button key={k} className={`mini ${type === k ? 'primary' : ''}`} onClick={() => setType(k)}>
            {label}
          </button>
        ))}
      </div>
      <FormRow label="地址（URL）">
        <input
          type="text"
          placeholder={type === 'git' ? 'https://github.com/xxx/repo.git' : 'http://192.168.0.30:8080/software2/projects/xxx/trunk'}
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
      </FormRow>
      <FormRow label="所在目录（父目录路径）">
        <div className="row" style={{ gap: 8 }}>
          <input type="text" placeholder="/home/me/projects" value={dir} onChange={(e) => setDir(e.target.value)} style={{ flex: 1 }} />
          <button className="mini tool-btn" title="打开文件夹浏览（可新建/重命名文件夹）" onClick={() => setPicker(true)}>
            📂 浏览
          </button>
        </div>
      </FormRow>
      <FormRow label="本地名称（工作副本名）">
        <input
          type="text"
          placeholder="my-project"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
          }}
        />
      </FormRow>
      <div className="dim small" style={{ whiteSpace: 'pre-line' }}>
        {(() => {
          const base = `${dir.trim().replace(/\/$/, '')}/${name.trim() || '…'}`;
          const u = url.trim() || '…';
          if (type === 'git') return `将克隆：${u} → ${base}\ngit clone 后自动打开`;
          return `将检出：${u} → ${base}\nsvn checkout 后自动打开（SVN 建议检出 trunk 或目标分支/标签）`;
        })()}
      </div>
      <ResultLine msg={msg} err={msgErr} />
      {/* 二次确认：目标路径 + 命令 + 风险检测 */}
      {pending && (
        <ConfirmModal
          title="确认获取仓库？"
          message={
            <>
              <div>目标路径：{pending.target}</div>
              <div>将执行：{type === 'git' ? `git clone ${url.trim()}` : `svn checkout ${url.trim()}`}（命令预览见按钮）</div>
              {pending.inRepo && (
                <div style={{ color: 'var(--warn)', marginTop: 6 }}>
                  ⚠ 目标位于 {pending.inRepo.type.toUpperCase()} 仓库内（{pending.inRepo.root}）——检出的文件会成为外层仓库的未版本化内容，状态/数据可能错乱
                </div>
              )}
              {pending.existsNonEmpty && (
                <div style={{ color: 'var(--warn)', marginTop: 6 }}>
                  ⚠ 目标目录已存在且非空（{pending.target}）——克隆/检出到非空目录会失败，可能已有仓库/文件
                </div>
              )}
            </>
          }
          confirmLabel="确认获取"
          confirmCmd={
            type === 'git'
              ? (cmdOfRepo('git', 'clone', { url: url.trim(), dir: pending.target }) ?? '')
              : (cmdOfRepo('svn', 'checkout', { url: url.trim(), dir: pending.target }) ?? '')
          }
          onConfirm={doGet}
          onCancel={() => setPending(null)}
        />
      )}
      {/* 文件夹浏览选择器：选择所在目录 */}
      {picker && (
        <div className="modal-mask">
          <ResizableModal width={640}>
            <h3>📂 选择所在目录</h3>
            <div className="body">
              <DirPicker
                startDir={props.home ?? ''}
                onPick={(p) => {
                  setDir(p);
                  setPicker(false);
                }}
                onClose={() => setPicker(false)}
              />
            </div>
          </ResizableModal>
        </div>
      )}
    </ModalShell>
  );
}
