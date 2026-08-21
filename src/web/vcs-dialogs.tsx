/** 版本管理对话框：分支 / 标签 / Stash / 创建仓库（git + svn 通用） */
import React, { useEffect, useState } from 'react';
import { get, post, type BranchInfo, type StashItem, type SvnLayout, type VcsResult } from './api.js';
import { ModalShell, ResizableModal } from './modal-shell.js';
import { DirPicker } from './dir-picker.js';
import { HelpNote, FormRow } from './ui.js';
import { ConfirmModal } from './modals.js';

/** 操作结果提示行 */
function ResultLine(props: { msg: string; err?: boolean }) {
  if (!props.msg) return null;
  return <div className={props.err ? 'error mt8' : 'mt8 small'} style={props.err ? undefined : { color: 'var(--ok)' }}>{props.msg}</div>;
}

/** 执行并刷新列表的通用逻辑 */
async function runAction(
  fn: () => Promise<VcsResult>,
  onMsg: (msg: string, err?: boolean) => void,
  afterOk?: () => void
) {
  try {
    const r = await fn();
    onMsg(r.message, !r.ok);
    if (r.ok) afterOk?.();
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
  // 工具风格二次确认
  const [cfm, setCfm] = useState<{ title: string; msg: string; action: () => void } | null>(null);

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
  };
  useEffect(load, []); // eslint-disable-line react-hooks/exhaustive-deps

  const act = (action: 'create' | 'switch' | 'delete' | 'merge', name: string, force = false) => {
    setBusy(true);
    void runAction(
      () => post.branch(action, name, force),
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
      const carry = check.tracked - check.conflicts.length;
      msg = `当前有 ${check.changed} 个文件未提交/未暂存：已跟踪 ${check.tracked} 个（其中 ${carry} 个可安全带过去、${check.conflicts.length} 个会被拒绝——目标分支也改过这些文件），未跟踪 ${check.untracked} 个。`;
      if (check.conflicts.length > 0) msg += `\n可能被覆盖的文件：${check.conflicts.join('、')}`;
      msg += `\n建议先提交或暂存；仍要切换？`;
    } else {
      msg = `确认切换到分支 ${name}？工作区有未提交修改且会被覆盖时，切换会失败（请先提交或暂存）。`;
    }
    setCfm({ title: isTrunk ? '切回主干' : '切换分支', msg, action: () => act('switch', name) });
  };
  const confirmMerge = (name: string) =>
    setCfm({
      title: '合并分支',
      msg: `确认将分支 ${name} 合并到当前分支？可能产生冲突，请提前确认工作区状态。`,
      action: () => act('merge', name),
    });

  return (
    <ModalShell icon="🪵" title={`分支管理 (${props.repoType.toUpperCase()})`} onClose={props.onClose} width={640}>
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
              <br />· <strong>新建</strong>：输入名称回车 = 从当前代码状态开一条新线
              <br />· <strong>切换</strong>：换到另一个分支工作。未提交的修改能否带过去，取决于目标分支有没有动过那些文件——目标分支没动 → 改动跟着你走；目标分支也改过 → 切换会被拒绝，需先提交或暂存（未跟踪的新文件永远能带过去）
              <br />· <strong>合并</strong>：把别的分支的改动搬进当前分支。<strong>先切到目的地分支，再点来源分支的「合并」</strong>（站在哪，哪就是目的地）
              <br />· <strong>删除</strong>：已合并的分支可删除（内容已进目标分支，不丢失）。主干（main/master）是团队稳定版本，不能删除
              <br />
              绿色 ● = 当前所在分支
            </>
          ) : (
            <>
              SVN 分支是版本库里的目录复制（branches/）。默认在 trunk 上开发，需要独立改动时复制一份到 branches/ 再继续。
              <br />· <strong>新建</strong>：输入名称回车 = 复制 trunk（或当前目录）创建分支
              <br />· <strong>切换</strong>：工作副本指向该分支（本地改动会尽量保留，可能冲突）
              <br />· <strong>合并</strong>：把该分支的改动并入当前工作副本（合并前请先更新）
              <br />· <strong>删除</strong>：已合并分支可删除。主干（trunk）是团队稳定版本，不能删除
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
            if (e.key === 'Enter' && newName.trim()) act('create', newName.trim());
          }}
          style={{ flex: 1 }}
        />
        <button className="primary" disabled={busy || !newName.trim()} onClick={() => act('create', newName.trim())}>
          ➕ 新建分支
        </button>
        {props.repoType === 'svn' && data?.current && data.current !== 'trunk' && (
          <button className="mini" disabled={busy} onClick={() => confirmSwitch('trunk', true)} title="切回 trunk">
            ↩ 切回主干
          </button>
        )}
      </div>
      {/* 分支列表 */}
      <div className="vcs-list" style={{ maxHeight: 280 }}>
        {!data && <div className="dim" style={{ padding: '10px 6px' }}>加载中…</div>}
        {data && data.branches.length === 0 && <div className="dim" style={{ padding: '10px 6px' }}>暂无分支{props.repoType === 'svn' ? '（仓库根下没有 branches/ 目录）' : ''}</div>}
        {data?.branches.map((b) => (
          <div
            key={b.name}
            className={`vcs-row ${sel === b.name ? 'selected' : ''}`}
            onClick={() => setSel(b.name)}
            title={b.name === data.current ? '当前分支' : '点击选中，再操作右侧按钮'}
          >
            <span className="vcs-current" style={{ visibility: b.name === data.current ? 'visible' : 'hidden' }}>●</span>
            <span className="badge" style={{ background: b.remote ? 'var(--dim)' : 'var(--ok)', fontSize: 9, minWidth: 38, textAlign: 'center' }}>
              {b.name === data.current ? '当前' : b.remote ? '远程' : '本地'}
            </span>
            <span className="mono" style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.name}</span>
            {b.name !== data.current && (
              <span className="row" style={{ gap: 4 }} onClick={(e) => e.stopPropagation()}>
                {/* 切换对所有非当前分支开放（远程分支由后端自动创建本地跟踪分支） */}
                <button className="mini primary" disabled={busy} onClick={() => confirmSwitch(b.name)}>切换</button>
                {!b.remote && (
                  <>
                    <button className="mini btn-accent" disabled={busy} onClick={() => confirmMerge(b.name)} title="把该分支的改动合并到当前分支（先确保已切到目标分支）">🔀 合并</button>
                    <button
                      className="mini danger"
                      disabled={busy || isTrunkName(b.name)}
                      title={isTrunkName(b.name) ? '主干分支不能删除（团队稳定版本，防止误删）' : '删除分支（已合并的分支才能删）'}
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

// ==================== git 清理未跟踪（预览+确认） ====================

export function CleanDialog(props: { onClose: () => void; onDone: () => void }) {
  const [files, setFiles] = useState<string[] | null>(null);
  const [msg, setMsg] = useState('');
  const [msgErr, setMsgErr] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = () => {
    get
      .gitClean()
      .then((r) => setFiles(r.files))
      .catch((e: Error) => {
        setMsg(e.message);
        setMsgErr(true);
      });
  };
  useEffect(load, []); // eslint-disable-line react-hooks/exhaustive-deps

  const doClean = () => {
    setBusy(true);
    void runAction(
      () => post.gitClean(),
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
          <button className="danger" disabled={busy || !files || files.length === 0} onClick={doClean}>
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
        <div className="changed" style={{ maxHeight: 260, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 8, padding: 6 }}>
          {files.length === 0 && <div className="dim" style={{ padding: '10px 6px' }}>没有未跟踪文件 🎉</div>}
          {files.map((f) => (
            <div key={f} className="changed-row">
              <span style={{ color: 'var(--err)' }}>✗</span>
              <span className="mono small">{f}</span>
            </div>
          ))}
        </div>
      )}
      <ResultLine msg={msg} err={msgErr} />
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
    <ModalShell icon="🏷" title={`标签管理 (${props.repoType.toUpperCase()})`} onClose={props.onClose} width={560}>
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
        <button className="primary" disabled={busy || !newName.trim()} onClick={() => act('create', newName.trim())}>
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
  };
  useEffect(load, []); // eslint-disable-line react-hooks/exhaustive-deps

  const act = (action: 'push' | 'pop' | 'drop', index = 0, msg2 = '') => {
    setBusy(true);
    void runAction(
      () => post.stash(action, msg2, index),
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
    <ModalShell icon="📦" title={`Stash 暂存区 (GIT)`} onClose={props.onClose} width={580}>
      <HelpNote>
        Stash 把当前未提交的改动临时收起来（含未跟踪文件），让工作区变干净——适合"先切分支/先做别的，稍后再回来继续"。用法：点「保存当前改动」收起（可写说明）；列表中「恢复」= 把改动取回工作区，「丢弃」= 放弃这份改动。
      </HelpNote>
      <div className="row" style={{ margin: '12px 0' }}>
        <input
          type="text"
          placeholder="保存说明（可选）…"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') act('push', 0, message);
          }}
          style={{ flex: 1 }}
        />
        <button className="primary" disabled={busy} onClick={() => act('push', 0, message)}>
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
                  <button className="mini primary" disabled={busy} onClick={save}>{busy ? '保存中…' : '保存'}</button>
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
  const [type, setType] = useState<'git' | 'clone' | 'svn'>('git');
  const [dir, setDir] = useState(props.home ?? '');
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [standard, setStandard] = useState(true); // svn 标准布局（trunk/branches/tags），默认勾选
  const [msg, setMsg] = useState('');
  const [msgErr, setMsgErr] = useState(false);
  const [busy, setBusy] = useState(false);
  const [picker, setPicker] = useState(false); // 文件夹浏览选择器

  const submit = () => {
    if (!dir.trim() || !name.trim()) {
      setMsg('请填写目录和名称');
      setMsgErr(true);
      return;
    }
    setBusy(true);
    const repoType = type === 'clone' ? 'git' : type;
    void runAction(
      () => post.repoCreate(repoType, dir.trim(), name.trim(), type === 'clone' ? url.trim() : '', standard),
      (m, err) => {
        setMsg(m);
        setMsgErr(Boolean(err));
      },
      () => props.onCreated(`${dir.trim().replace(/\/$/, '')}/${name.trim()}`)
    ).finally(() => setBusy(false));
  };

  return (
    <ModalShell
      icon="➕"
      title="创建 / 克隆仓库"
      onClose={props.onClose}
      width={540}
      foot={
        <>
          <button onClick={props.onClose}>关闭</button>
          <button className="primary" disabled={busy} onClick={submit}>
            {busy ? '创建中…' : '创建'}
          </button>
        </>
      }
    >
      <HelpNote>
        三种方式：Git 仓库 = 在本地目录初始化新仓库（git init）；Git 克隆 = 从远程地址复制一份到本地（git clone）；SVN 仓库 = 用 svnadmin 创建本地仓库，默认创建标准布局（trunk / branches / tags）并检出 trunk 作为工作副本（目录名 + "-wc"）。
      </HelpNote>
      <div style={{ marginTop: 12 }} />
      <div className="row" style={{ marginBottom: 12, gap: 6 }}>
        {(
          [
            ['git', 'Git 仓库 (init)'],
            ['clone', 'Git 克隆'],
            ['svn', 'SVN 仓库'],
          ] as const
        ).map(([k, label]) => (
          <button key={k} className={`mini ${type === k ? 'primary' : ''}`} onClick={() => setType(k)}>
            {label}
          </button>
        ))}
      </div>
      {type === 'clone' && (
        <FormRow label="克隆地址（URL）">
          <input type="text" placeholder="https://github.com/xxx/repo.git" value={url} onChange={(e) => setUrl(e.target.value)} />
        </FormRow>
      )}
      <FormRow label="所在目录（父目录路径）">
        <div className="row" style={{ gap: 8 }}>
          <input type="text" placeholder="/home/me/projects" value={dir} onChange={(e) => setDir(e.target.value)} style={{ flex: 1 }} />
          <button className="mini tool-btn" title="打开文件夹浏览（可新建/重命名文件夹）" onClick={() => setPicker(true)}>
            📂 浏览
          </button>
        </div>
      </FormRow>
      <FormRow label={type === 'clone' ? '目标文件夹名称' : '仓库名称'}>
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
      <div className="dim small">
        {type === 'git' && '在当前目录执行 git init，创建新的 Git 仓库'}
        {type === 'clone' && 'git clone 远程仓库到本地'}
        {type === 'svn' && 'svnadmin create 创建本地 SVN 仓库，并自动检出工作副本（目录名 + "-wc"）'}
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
                onToast={setMsg}
              />
            </div>
          </ResizableModal>
        </div>
      )}
    </ModalShell>
  );
}
