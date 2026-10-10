/** 远程冲突对比：你修改的文件被他人先提交 → 看双方改动，并把"双方都改到的行"标出来。
 *  这里是**已确认行冲突**的文件（后端把两侧改动行号求了交集），所以文案直说"改了同一处、更新时会冲突"，
 *  不再是"已被他人提交新版本"这种听着不疼不痒的文件级说法（用户实报："明明改动的地方一样，为啥不提示冲突"）。 */
import React, { useEffect, useState } from 'react';
import { get } from '../shared/api.js';
import { DiffRender } from '../ui/diff-render.js';
import { ResizableModal } from '../shell/modal-shell.js';

export function RemoteConflictModal(props: { riskFiles: { path: string; lines: number[] }[]; onClose: () => void }) {
  const [sel, setSel] = useState(0);
  const [detail, setDetail] = useState<{ path: string; theirsDiff: string; myDiff: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  const cur = props.riskFiles[sel] ?? null;

  useEffect(() => {
    const p = props.riskFiles[sel]?.path;
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

  // 冲突行（BASE 坐标）：两侧 diff 都按同一套行号标黄
  const markSet = new Set(cur?.lines ?? []);

  return (
    <div className="modal-mask">
      <ResizableModal width={920} maxWidth="95vw">
        <h3>
          ⚠ 这 <span style={{ color: 'var(--err)', fontWeight: 700 }}>{props.riskFiles.length}</span> 个文件你和对方改了同一处，更新时会冲突
        </h3>
        <div className="body" style={{ display: 'flex', gap: 12, minHeight: 420 }}>
          {/* 左：冲突文件列表（带"几处"） */}
          <div className="vcs-list" style={{ width: 200, flexShrink: 0, maxHeight: 460 }}>
            {props.riskFiles.map((p, i) => (
              <div
                key={p.path}
                className={`vcs-row ${i === sel ? 'selected' : ''}`}
                onClick={() => setSel(i)}
                title={p.path}
              >
                <span className="badge" style={{ background: 'var(--warn)', flexShrink: 0 }}>⚠</span>
                <span className="mono small" style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {p.path.split('/').pop()}
                </span>
                <span className="dim small nowrap" title={`双方都改到的行：${p.lines.join('、')}`}>
                  {p.lines.length} 处
                </span>
              </div>
            ))}
          </div>
          {/* 右：双 diff（冲突行标黄） */}
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {err && <div className="error">{err}</div>}
            {loading && !err && <div className="dim small">加载对比…</div>}
            {detail && cur && (
              <>
                <div>
                  <div className="dim small" style={{ marginBottom: 4 }}>
                    🔴 <b>{cur.path}</b> — 对方的改动（远程新版本 vs 你的基准，更新后这些会进来）：
                  </div>
                  <div style={{ maxHeight: 190, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
                    <DiffRender text={detail.theirsDiff || '（对方未改动此文件）'} marks={markSet} />
                  </div>
                </div>
                <div>
                  <div className="dim small" style={{ marginBottom: 4 }}>
                    🟢 <b>{cur.path}</b> — 你的改动（工作区 vs 你的基准）：
                  </div>
                  <div style={{ maxHeight: 190, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
                    <DiffRender text={detail.myDiff || '（你未改动此文件）'} marks={markSet} />
                  </div>
                </div>
                <div className="dim small" style={{ marginTop: 2, lineHeight: 1.7 }}>
                  💡 标黄的就是你和对方都改到的行（共 {cur.lines.length} 处）。
                  先点「去更新」拉取对方改动 —— 这几个文件会变成<b>冲突状态</b>，再到「解决冲突」里逐处处理。
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
