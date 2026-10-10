/** 提交弹窗：勾选待提交文件 + 写注释 */
import React, { useState } from 'react';
import { ResizableModal } from '../shell/modal-shell.js';
import { pathAutoWidth, useCheckedSet } from '../shared/utils.js';
import { cmdOfRepo } from '../shared/cmd-preview.js';
import { IconOk } from '../ui/icons.js';
import { CommitCommentBox } from './commit-comment.js';

export function CommitModal(props: {
  repoType: string;
  paths: string[];
  onClose: () => void;
  onDone: (msg: string, paths: string[]) => void;
}) {
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  // 待提交文件勾选：默认全部勾选；"全选/全不选"按钮二次点击反向
  const { checked, setChecked, toggle } = useCheckedSet(props.paths);
  const allChecked = props.paths.length > 0 && checked.size === props.paths.length;

  const submit = async () => {
    if (!msg.trim()) {
      setErr('提交信息不能为空');
      return;
    }
    if (checked.size === 0) {
      setErr('请至少勾选一个文件');
      return;
    }
    setBusy(true);
    try {
      await props.onDone(msg, props.paths.filter((p) => checked.has(p)));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // 弹窗宽度自适应最长文件名（公式见 utils.pathAutoWidth）
  const maxPathLen = props.paths.reduce((m, p) => Math.max(m, p.length), 0);
  const autoWidth = pathAutoWidth(maxPathLen, 660, 1400);

  return (
    <div className="modal-mask">
      <ResizableModal width={autoWidth} onEsc={props.onClose}>
        <h3>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>📝 提交</span>
            <span className="dim small" style={{ fontWeight: 400 }}>({props.repoType.toUpperCase()})</span>
          </span>
        </h3>
        <div className="body" style={{ display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
          {/* 待提交文件列表：可勾选，默认全选；弹窗高度变化时跟随伸缩，全部显示得下则不滚动 */}
          {props.paths.length > 0 && (
            <div className="row" style={{ marginBottom: 8, gap: 10, flexShrink: 0 }}>
              <span className="small dim" style={{ flex: 1 }}>
                📁 待提交 <b>{checked.size}</b>/{props.paths.length} 个文件
              </span>
              <button className="mini" onClick={() => setChecked(allChecked ? new Set() : new Set(props.paths))}>
                {allChecked ? '全不选' : '全选'}
              </button>
            </div>
          )}
          {props.paths.length > 0 && (
            <div className="vcs-list" style={{ flex: 1, minHeight: 80, overflow: 'auto', marginBottom: 12 }}>
              {props.paths.map((p) => (
                <label key={p} className="vcs-row" style={{ cursor: 'pointer' }}>
                  <input type="checkbox" checked={checked.has(p)} onChange={() => toggle(p)} style={{ flexShrink: 0 }} />
                  {/* minWidth:0 让超长路径省略号生效，勾选框不会被挤出 */}
                  <span className="mono small" style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={p}>
                    {p}
                  </span>
                </label>
              ))}
            </div>
          )}
          {/* 提交注释：清晰标签 + 美化输入框 */}
          <CommitCommentBox
            value={msg}
            onChange={setMsg}
            onSubmit={() => void submit()}
            rows={5}
            placeholder="简要说明本次提交内容，如：修复xxx问题、新增xxx功能、重构xxx模块…"
            autoFocus
          />
          {err && <div className="error mt8">{err}</div>}
        </div>
        <div className="foot">
          <button onClick={props.onClose} disabled={busy}>取消</button>
          <button
            className="primary"
            onClick={() => void submit()}
            disabled={busy || !msg.trim() || checked.size === 0}
            title={`${cmdOfRepo(props.repoType as 'git' | 'svn', 'commit', { msg: msg.trim() || '…' }) ?? ''}`}
          >
            {busy ? (
              '⏳ 提交中…'
            ) : (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <IconOk size={13} />
                确认提交
              </span>
            )}
          </button>
        </div>
      </ResizableModal>
    </div>
  );
}
