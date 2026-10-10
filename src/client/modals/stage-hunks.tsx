/** hunk 级部分提交弹窗：列出某个文件的逐块差异，勾选要提交的块。
 *
 *  确认后把选中的块应用到暂存区，父级据此把该文件标记为「部分暂存」——
 *  提交时对该文件跳过整文件 add（见 vcs/git.ts 的 commit 的 stagedOnly 参数），
 *  否则未选中的块会被一并暂存，用户的选择就白做了。
 *
 *  数据来源：GET /api/diff-hunks（-U1 粒度，比默认 -U3 分得更细）。
 */
import React, { useEffect, useMemo, useState } from 'react';
import { get, post, type ParsedDiff } from '../api.js';
import { ResizableModal } from './modal-shell.js';
import { hunkSummaryLabel } from '../utils.js';
import { highlightLine, langOf } from '../highlight.js';

export function StageHunksModal(props: {
  /** 文件相对路径 */
  path: string;
  onClose: () => void;
  /** 暂存成功（父级把该文件记为 stagedOnly） */
  onStaged: () => void;
  onToast: (m: string, err?: boolean) => void;
}) {
  const [parsed, setParsed] = useState<ParsedDiff | null>(null);
  const [error, setError] = useState('');
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    get
      .diffHunks(props.path)
      .then((r) => {
        if (cancelled) return;
        setParsed(r);
        setChecked(new Set(r.hunks.map((h) => h.index))); // 默认全选（多数情况是想全提交）
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [props.path]);

  const lang = useMemo(() => langOf(props.path), [props.path]);
  const total = parsed?.hunks.length ?? 0;

  const toggle = (i: number) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });

  const confirm = async () => {
    if (checked.size === 0) return;
    setBusy(true);
    try {
      // 带上打开弹窗时的内容指纹：文件若被外部改过，后端会拒绝而不是按旧索引暂存到别的块
      const blob = parsed?.fileHeader.match(/^index [0-9a-f]+\.\.([0-9a-f]+)/m)?.[1];
      const r = await post.stageHunks(props.path, [...checked], blob);
      props.onToast(r.message, !r.ok);
      if (r.ok) {
        props.onStaged();
        props.onClose();
      }
    } catch (e) {
      props.onToast(`暂存失败: ${(e as Error).message}`, true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <ResizableModal width={860} minWidth={560} minHeight={360} onEsc={props.onClose}>
      <h3>✂ 选择要提交的改动 — {props.path}</h3>
      <div className="body">
        {error && <div className="error">{error}</div>}
        {!parsed && !error && <div className="dim">正在读取改动…</div>}
        {parsed && total === 0 && <div className="dim">该文件没有可提交的改动</div>}
        {parsed && total > 0 && (
          <>
            <div className="row small dim" style={{ marginBottom: 8, gap: 10 }}>
              <span>
                共 {total} 处改动，已选 <b>{checked.size}</b> 处
              </span>
              <button className="mini" onClick={() => setChecked(new Set(parsed.hunks.map((h) => h.index)))}>
                全选
              </button>
              <button className="mini" onClick={() => setChecked(new Set())}>
                全不选
              </button>
              <span className="grow" />
              <span>未选中的改动会留在工作区，不进入本次提交</span>
            </div>
            <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
              {parsed.hunks.map((h) => (
                <div
                  key={h.index}
                  style={{
                    marginBottom: 10,
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                    background: 'var(--panel2)',
                    overflow: 'hidden',
                  }}
                >
                  <label
                    className="row small"
                    style={{ padding: '6px 10px', gap: 8, cursor: 'pointer', borderBottom: '1px solid var(--border)' }}
                  >
                    <input type="checkbox" checked={checked.has(h.index)} onChange={() => toggle(h.index)} />
                    <span style={{ fontWeight: 600 }}>{hunkSummaryLabel(h)}</span>
                    <span className="dim mono" style={{ marginLeft: 'auto' }}>
                      {h.header}
                    </span>
                  </label>
                  <div className="mono small" style={{ padding: '4px 0' }}>
                    {h.lines
                      .filter((l) => l.type !== 'meta')
                      .map((l, li) => (
                        <div
                          key={li}
                          style={{
                            padding: '0 10px',
                            whiteSpace: 'pre',
                            background: l.type === 'add' ? 'rgba(63,185,80,.14)' : l.type === 'del' ? 'rgba(248,81,73,.14)' : undefined,
                          }}
                        >
                          <span className="dim" style={{ userSelect: 'none' }}>
                            {l.type === 'add' ? '+ ' : l.type === 'del' ? '− ' : '  '}
                          </span>
                          <span dangerouslySetInnerHTML={{ __html: highlightLine(l.text, lang) }} />
                        </div>
                      ))}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
      <div className="foot">
        <button onClick={props.onClose} disabled={busy}>
          取消
        </button>
        <button className="primary" disabled={busy || checked.size === 0} onClick={() => void confirm()}>
          {busy ? '暂存中…' : `暂存选中的 ${checked.size} 处`}
        </button>
      </div>
    </ResizableModal>
  );
}
