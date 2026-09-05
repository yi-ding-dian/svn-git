/** 工作区整理弹窗：git 清理未跟踪文件（CleanDialog）+ Stash 暂存区（StashDialog） */
import React, { useEffect, useState } from 'react';
import { get, post, type StashItem } from '../api.js';
import { ModalShell } from '../modal-shell.js';
import { IconErr, IconStash } from '../icons.js';
import { HelpNote } from '../ui.js';
import { ConfirmModal } from '../modals.js';
import { cmdOfRepo } from '../cmd-preview.js';
import { ResultLine, runAction } from './common.js';
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
