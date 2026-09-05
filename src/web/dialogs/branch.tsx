/** 分支管理弹窗：列表 / 新建 / 切换 / 合并 / 删除 / 推送（git + svn 通用） */
import React, { useEffect, useRef, useState } from 'react';
import { get, post, type BranchInfo } from '../api.js';
import { ModalShell } from '../modal-shell.js';
import { IconBranch } from '../icons.js';
import { HelpNote } from '../ui.js';
import { ConfirmModal } from '../modals.js';
import { cmdOfRepo } from '../cmd-preview.js';
import { LayoutNote, ResultLine, runAction } from './common.js';
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
