/** 远程冲突对比：你修改的文件被他人先提交 → 查看对方改动 vs 我的改动 */
import React, { useEffect, useState } from 'react';
import { get } from './api.js';
import { DiffRender } from './diff-render.js';
import { ResizableModal } from './modal-shell.js';

export function RemoteConflictModal(props: { riskFiles: string[]; onClose: () => void }) {
  const [sel, setSel] = useState(0);
  const [detail, setDetail] = useState<{ path: string; theirsDiff: string; myDiff: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    const p = props.riskFiles[sel];
    if (!p) return;
    let cancelled = false;
    setLoading(true);
    setErr('');
    get
      .conflictDetail(p)
      .then((r) => {
        if (!cancelled) setDetail(r);
      })
      .catch((e: Error) => {
        if (!cancelled) setErr(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [sel, props.riskFiles]);

  const cur = props.riskFiles[sel] ?? null;

  return (
    <div className="modal-mask">
      <ResizableModal width={920} maxWidth="95vw">
        <h3>⚠ 你修改的文件已被他人提交新版本（{props.riskFiles.length}）</h3>
        <div className="body" style={{ display: 'flex', gap: 12, minHeight: 420 }}>
          {/* 左：风险文件列表 */}
          <div className="vcs-list" style={{ width: 180, flexShrink: 0, maxHeight: 460 }}>
            {props.riskFiles.map((p, i) => (
              <div key={p} className={`vcs-row ${i === sel ? 'selected' : ''}`} onClick={() => setSel(i)} title={p}>
                <span className="badge" style={{ background: 'var(--warn)', flexShrink: 0 }}>⚠</span>
                <span className="mono small" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {p.split('/').pop()}
                </span>
              </div>
            ))}
          </div>
          {/* 右：双 diff */}
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {err && <div className="error">{err}</div>}
            {loading && !err && <div className="dim small">加载对比…</div>}
            {detail && (
              <>
                <div>
                  <div className="dim small" style={{ marginBottom: 4 }}>
                    🔴 <b>{cur}</b> — 对方的改动（远程新版本 vs 你的基准，更新后这些会进来）：
                  </div>
                  <div style={{ maxHeight: 190, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
                    <DiffRender text={detail.theirsDiff || '（对方未改动此文件）'} />
                  </div>
                </div>
                <div>
                  <div className="dim small" style={{ marginBottom: 4 }}>
                    🟢 <b>{cur}</b> — 你的改动（工作区 vs 你的基准，更新时这些可能冲突）：
                  </div>
                  <div style={{ maxHeight: 190, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
                    <DiffRender text={detail.myDiff || '（你未改动此文件）'} />
                  </div>
                </div>
                <div className="dim small" style={{ marginTop: 2 }}>
                  💡 建议：先点「去更新」拉取对方改动，再手动合并两边内容后提交。
                </div>
              </>
            )}
          </div>
        </div>
        <div className="foot">
          <button onClick={props.onClose}>关闭</button>
        </div>
      </ResizableModal>
    </div>
  );
}
