/** hunk 级部分提交弹窗：列出某个文件的逐块差异，勾选要提交的块。
 *
 *  确认后把选中的块应用到暂存区，父级据此把该文件标记为「部分暂存」——
 *  提交时对该文件跳过整文件 add（见 vcs/git.ts 的 commit 的 stagedOnly 参数），
 *  否则未选中的块会被一并暂存，用户的选择就白做了。
 *
 *  数据来源：GET /api/diff-hunks（-U1 粒度，比默认 -U3 分得更细）。
 */
import React, { useEffect, useMemo, useState } from 'react';
import { get, post, type ParsedDiff } from '../shared/api.js';
import { ResizableModal } from '../shell/modal-shell.js';
import { hunkSummaryLabel } from '../shared/utils.js';
import { highlightLine, langOf } from '../shared/highlight.js';
import { t } from '../../shared/i18n/index.js';

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
      // 暂存失败: {msg}
      props.onToast(t('ops.stageHunks.err', { msg: (e as Error).message }), true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <ResizableModal width={860} minWidth={560} minHeight={360} onEsc={props.onClose}>
      {/* ✂ 选择要提交的改动 */}
      <h3>{t('ops.stageHunks.title')} — {props.path}</h3>
      <div className="body">
        {error && <div className="error">{error}</div>}
        {/* 正在读取改动… */}
        {!parsed && !error && <div className="dim">{t('ops.stageHunks.loading')}</div>}
        {/* 该文件没有可提交的改动 */}
        {parsed && total === 0 && <div className="dim">{t('ops.stageHunks.empty')}</div>}
        {parsed && total > 0 && (
          <>
            <div className="row small dim" style={{ marginBottom: 8, gap: 10 }}>
              <span>
                {/* 共 {total} 处改动，已选 {n} 处 */}
                {t('ops.stageHunks.summary', { total, n: checked.size })}
              </span>
              <button className="mini" onClick={() => setChecked(new Set(parsed.hunks.map((h) => h.index)))}>
                {/* 全选 */}
                {t('ops.select.all')}
              </button>
              <button className="mini" onClick={() => setChecked(new Set())}>
                {/* 全不选 */}
                {t('ops.select.none')}
              </button>
              <span className="grow" />
              {/* 未选中的改动会留在工作区，不进入本次提交 */}
              <span>{t('ops.stageHunks.note')}</span>
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
          {/* 取消 */}
          {t('common.cancel')}
        </button>
        <button className="primary" disabled={busy || checked.size === 0} onClick={() => void confirm()}>
          {/* 暂存中… / 暂存选中的 {n} 处 */}
          {busy ? t('ops.stageHunks.busy') : t('ops.stageHunks.confirm', { n: checked.size })}
        </button>
      </div>
    </ResizableModal>
  );
}
