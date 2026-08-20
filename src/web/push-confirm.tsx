/** 推送确认弹窗：未推送提交列表（含变更文件）+ 推送条件（远程落后/冲突风险） */
import React, { useEffect, useState } from 'react';
import { get, type LogEntry } from './api.js';
import { ResizableModal } from './modal-shell.js';

/** 二进制/图片等不支持差异查看的文件扩展名（双击查看差异前过滤） */
const BINARY_EXT = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'ico', 'avif',
  'pdf', 'zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz',
  'mp3', 'mp4', 'avi', 'mov', 'wav', 'flac', 'ogg', 'mkv',
  'exe', 'dll', 'so', 'bin', 'dat', 'iso',
  'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
]);

/** 是否为文本文件（可查看差异） */
function isTextFile(p: string): boolean {
  const ext = p.split('.').pop()?.toLowerCase() ?? '';
  return ext ? !BINARY_EXT.has(ext) : true; // 无扩展名视为文本
}

export function PushConfirmModal(props: {
  onConfirm: () => void;
  onCancel: () => void;
  /** 双击变更文件查看差异（path, 所属提交 rev；返回时恢复本弹窗） */
  onDiff?: (path: string, rev: string) => void;
}) {
  const [loading, setLoading] = useState(true);
  const [unpushed, setUnpushed] = useState<LogEntry[]>([]);
  const [pf, setPf] = useState<Awaited<ReturnType<typeof get.preflight>> | null>(null);
  /** 展开查看变更文件的提交 rev */
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // 未推送提交列表 + 推送条件（落后/冲突检查；preflight 内部有超时，失败不阻断）
    get
      .gitUnpushed()
      .then((r) => {
        if (!cancelled) setUnpushed(r.unpushed);
      })
      .catch(() => {});
    get
      .preflight()
      .then((r) => {
        if (!cancelled) setPf(r);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="modal-mask">
      <ResizableModal width={680} minWidth={520}>
        <h3>🔄 确认推送（{unpushed.length} 个未推送提交）</h3>
        <div className="body" style={{ maxHeight: '60vh', overflow: 'auto' }}>
          {/* 推送条件 */}
          <div style={{ marginBottom: 10 }}>
            {loading ? (
              <div className="dim small">⏳ 检查远程状态…</div>
            ) : pf ? (
              pf.behind > 0 ? (
                <div className="error" style={{ marginBottom: 0 }}>
                  ⚠ 远程有 <b>{pf.behind}</b> 个新提交，当前分支落后。直接推送会被拒绝，建议先「更新」拉取合并。
                </div>
              ) : (
                <div className="small" style={{ color: 'var(--ok)' }}>✅ 远程状态正常（无新提交），可以推送</div>
              )
            ) : (
              <div className="dim small">远程状态检查失败，可尝试直接推送</div>
            )}
            {pf && pf.conflictRisk.length > 0 && (
              <div className="error" style={{ margin: '8px 0 0' }}>
                ⚠ 以下文件双方都有修改，推送后拉取时可能冲突：
                {pf.conflictRisk.map((f) => f.path).join('、')}
              </div>
            )}
          </div>
          {/* 未推送提交列表（类似历史界面，只含未推送） */}
          <div className="dim small" style={{ marginBottom: 6 }}>未推送提交（点击展开变更文件）：</div>
          {unpushed.length === 0 && !loading && <div className="dim" style={{ padding: 8 }}>没有未推送的提交</div>}
          <div className="vcs-list" style={{ border: '1px solid var(--border)', borderRadius: 8 }}>
            {unpushed.map((l) => (
              <div key={l.rev}>
                <div
                  className="vcs-row"
                  style={{ cursor: 'pointer' }}
                  onClick={() => setExpanded(expanded === l.rev ? null : l.rev)}
                  title={l.changed.length > 0 ? '点击展开/收起变更文件' : l.msg}
                >
                  <span className="badge" style={{ background: '#22c55e', flexShrink: 0 }}>🟢</span>
                  <span className="mono small" style={{ flexShrink: 0 }}>{l.rev}</span>
                  <span className="small dim" style={{ flexShrink: 0 }}>{l.date.slice(0, 16)}</span>
                  <span className="small" style={{ flexShrink: 0 }}>{l.author}</span>
                  <span
                    className="small"
                    style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                  >
                    {l.msg}
                  </span>
                  <span className="small dim" style={{ flexShrink: 0 }}>{l.changed.length} 文件 {expanded === l.rev ? '▾' : '▸'}</span>
                </div>
                {expanded === l.rev && (
                  <div style={{ padding: '2px 10px 8px 44px', background: 'var(--panel2)' }}>
                    {l.changed.length === 0 && <div className="dim small">无文件变更</div>}
                    {l.changed.map((c) => {
                      const text = isTextFile(c.path);
                      return (
                        <div
                          key={c.path}
                          className="small mono"
                          style={{ padding: '1px 0', cursor: props.onDiff && text ? 'pointer' : 'default' }}
                          title={text ? `${c.path}\n双击查看差异` : `${c.path}\n（图片/二进制文件不支持查看差异）`}
                          onDoubleClick={(ev) => {
                            ev.preventDefault();
                            if (props.onDiff && text) props.onDiff(c.path, l.rev);
                          }}
                        >
                          <span className={`act ${c.action}`} style={{ marginRight: 6 }}>{c.action}</span>
                          <span className="dim">{c.path}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
        <div className="foot">
          <button onClick={props.onCancel}>取消</button>
          <button className="primary" disabled={unpushed.length === 0} onClick={props.onConfirm}>
            确认推送（{unpushed.length}）
          </button>
        </div>
      </ResizableModal>
    </div>
  );
}
