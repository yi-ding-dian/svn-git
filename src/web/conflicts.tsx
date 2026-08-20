/** 三方冲突解决器：冲突文件列表 + 基础/本地/对方 内容 + 手动编辑 + 采用按钮 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { get, post } from './api.js';
import { highlightLine, langOf } from './highlight.js';
import { parseUnifiedDiff, type DiffLine } from './diff.js';
import { IconFolder } from './icons.js';
import { ConfirmModal } from './modals.js';
import { ResizableModal } from './modal-shell.js';

interface Conflict {
  path: string;
  ours: string;
  theirs: string;
  base: string;
  work: string;
}

type Tab = 'base' | 'ours' | 'theirs';

export function ConflictResolverModal(props: { onClose: () => void; onResolved: () => void }) {
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [sel, setSel] = useState(0);
  const [tab, setTab] = useState<Tab>('theirs');
  const [manual, setManual] = useState('');
  const [msg, setMsg] = useState('');
  const [msgErr, setMsgErr] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    get
      .conflicts()
      .then((r) => {
        setConflicts(r.conflicts);
        setSel((s) => Math.min(s, Math.max(0, r.conflicts.length - 1)));
        if (r.conflicts[sel] !== undefined) setManual(r.conflicts[sel]!.work);
      })
      .catch((e: Error) => {
        setMsg(e.message);
        setMsgErr(true);
      })
      .finally(() => setLoading(false));
  }, [sel]);

  useEffect(load, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 选中变化时同步手动编辑内容
  useEffect(() => {
    const c = conflicts[sel];
    if (c) setManual(c.work);
    setMsg('');
    setMsgErr(false);
  }, [sel, conflicts]);

  const cur = conflicts[sel] ?? null;
  const lang = cur ? langOf(cur.path) : undefined;

  // 本地 vs 对方 的 diff（选中文件时拉取）
  const [vsDiff, setVsDiff] = useState('');
  useEffect(() => {
    if (!cur) return;
    let cancelled = false;
    setVsDiff('');
    post
      .textDiff(cur.ours, cur.theirs)
      .then((r) => {
        if (!cancelled) setVsDiff(r.diff || '（本地与对方内容一致）');
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [cur?.path, sel]); // eslint-disable-line react-hooks/exhaustive-deps

  // 双栏行映射：diff 的 - 行 = 本地（ours），+ 行 = 对方（theirs）
  const vsLines: DiffLine[] = parseUnifiedDiff(vsDiff);
  type VsRow = { no: number; text: string; change: boolean; block: number };
  const theirsRows = useMemo<VsRow[]>(() => {
    if (!cur) return [];
    const mark = new Map<number, number>();
    for (const l of vsLines) if (l.type === 'add') mark.set(l.rightNo, l.block);
    return cur.theirs.split('\n').map((t, i) => {
      const no = i + 1;
      const b = mark.get(no);
      return { no, text: t, change: b !== undefined, block: b ?? -1 };
    });
  }, [cur, vsLines]); // eslint-disable-line react-hooks/exhaustive-deps
  const oursRows = useMemo<VsRow[]>(() => {
    if (!cur) return [];
    const mark = new Map<number, number>();
    for (const l of vsLines) if (l.type === 'del') mark.set(l.leftNo, l.block);
    return cur.ours.split('\n').map((t, i) => {
      const no = i + 1;
      const b = mark.get(no);
      return { no, text: t, change: b !== undefined, block: b ?? -1 };
    });
  }, [cur, vsLines]); // eslint-disable-line react-hooks/exhaustive-deps

  // 放大/还原（对比区撑满）
  const [expanded, setExpanded] = useState(false);

  // 双栏滚动容器 + 冲突块标记
  const theirsPane = useRef<HTMLDivElement>(null);
  const oursPane = useRef<HTMLDivElement>(null);
  const MAX = Number.MAX_SAFE_INTEGER;
  const vsBlocks = useMemo(() => {
    const m = new Map<number, { theirs: number; ours: number }>();
    for (const l of vsLines) {
      const v = m.get(l.block) ?? { theirs: MAX, ours: MAX };
      if (l.type === 'add') v.theirs = Math.min(v.theirs, l.rightNo);
      if (l.type === 'del') v.ours = Math.min(v.ours, l.leftNo);
      m.set(l.block, v);
    }
    return [...m.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([id, v]) => ({ id, ...v }));
  }, [vsLines]); // eslint-disable-line react-hooks/exhaustive-deps
  const vsMarkers = useMemo(() => {
    const total = Math.max(theirsRows.length, oursRows.length, 1);
    return vsBlocks.map((b) => {
      const hasAdd = b.theirs !== MAX;
      const anchor = hasAdd ? b.theirs : b.ours;
      return { id: b.id, percent: Math.min(99, Math.max(0, (anchor / total) * 100)), color: hasAdd ? ('add' as const) : ('del' as const) };
    });
  }, [vsBlocks, theirsRows.length, oursRows.length]);

  /** 行级 ref：精确滚动定位 */
  const rowRefsT = useRef<Map<number, HTMLDivElement>>(new Map());
  const rowRefsO = useRef<Map<number, HTMLDivElement>>(new Map());

  const scrollByRatio = (pane: HTMLDivElement | null, ratio: number) => {
    if (!pane) return;
    pane.scrollTop = Math.min(ratio, 1) * (pane.scrollHeight - pane.clientHeight);
  };

  /** 行级定位（手动 scrollTop，避免 smooth scrollIntoView 连续调用互相取消） */
  const scrollToRow = (pane: HTMLDivElement | null, el: HTMLDivElement | undefined) => {
    if (!pane || !el) return;
    pane.scrollTop = Math.max(0, el.offsetTop - pane.clientHeight / 2 + el.clientHeight / 2);
  };

  /** 点击标记：两栏精确定位到冲突点（无对应行的一侧定位到最近的上下文行） */
  const goBlock = (i: number) => {
    const b = vsBlocks[i];
    if (!b) return;
    // 找该块前最近的上下文行（ctx 两侧都有行号，用于无对应行的一侧定位）
    let ctxLeft = -1;
    let ctxRight = -1;
    for (let x = 0; x < vsLines.length; x++) {
      if (vsLines[x].block === b.id) {
        for (let j = x - 1; j >= 0 && vsLines[j].type === 'ctx'; j--) {
          ctxLeft = vsLines[j].leftNo;
          ctxRight = vsLines[j].rightNo;
        }
        break;
      }
    }
    const tNo = b.theirs !== MAX ? b.theirs : ctxRight;
    const oNo = b.ours !== MAX ? b.ours : ctxLeft;
    const elT = tNo > 0 ? rowRefsT.current.get(tNo) : undefined;
    const elO = oNo > 0 ? rowRefsO.current.get(oNo) : undefined;
    if (elT) scrollToRow(theirsPane.current, elT);
    else scrollByRatio(theirsPane.current, (b.ours !== MAX ? b.ours : b.theirs) / Math.max(theirsRows.length, 1));
    if (elO) scrollToRow(oursPane.current, elO);
    else scrollByRatio(oursPane.current, (b.theirs !== MAX ? b.theirs : b.ours) / Math.max(oursRows.length, 1));
  };

  // 二次确认：避免误覆盖丢失内容（工具风格弹窗）
  const [confirmMode, setConfirmMode] = useState<'ours' | 'theirs' | 'manual' | null>(null);
  const resolve = async (mode: 'ours' | 'theirs' | 'manual') => {
    if (!cur) return;
    setConfirmMode(mode);
  };
  const doResolve = async (mode: 'ours' | 'theirs' | 'manual') => {
    setConfirmMode(null);
    setBusy(true);
    try {
      const r = await post.resolveConflict(cur.path, mode, mode === 'manual' ? manual : '');
      setMsg(r.message);
      setMsgErr(!r.ok);
      if (r.ok) {
        // 重新加载列表（已解决的文件应消失）
        const res = await get.conflicts();
        setConflicts(res.conflicts);
        setSel((s) => Math.min(s, Math.max(0, res.conflicts.length - 1)));
        if (res.conflicts.length === 0) {
          setMsg('🎉 所有冲突已解决');
          props.onResolved();
        }
      }
    } catch (e) {
      setMsg((e as Error).message);
      setMsgErr(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-mask">
      <ResizableModal
        width={980}
        maxed={expanded}
        maxedWidth="98vw"
        maxedHeight="96vh"
        onToggleMax={() => setExpanded(false)}
      >
        <h3>⚠ 解决冲突（{conflicts.length}）</h3>
        <div className="body" style={{ display: 'flex', gap: 12, minHeight: expanded ? 'calc(96vh - 90px)' : 460 }}>
          {/* 左：冲突文件列表 */}
          <div className="vcs-list" style={{ width: 200, flexShrink: 0, minHeight: 120 }}>
            {loading && <div className="dim" style={{ padding: 10 }}>加载中…</div>}
            {!loading && conflicts.length === 0 && <div className="dim" style={{ padding: 10 }}>暂无冲突</div>}
            {conflicts.map((c, i) => (
              <div
                key={c.path}
                className={`vcs-row ${i === sel ? 'selected' : ''}`}
                onClick={() => setSel(i)}
                title={c.path}
              >
                <span className="badge" style={{ background: 'var(--err)', flexShrink: 0 }}>C</span>
                <span className="mono small" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {c.path.split('/').pop()}
                </span>
              </div>
            ))}
          </div>
          {/* 右：内容与操作 */}
          {cur && (
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
              <div className="row" style={{ marginBottom: 6 }}>
                <span className="mono small dim" style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {cur.path}
                </span>
                {!expanded && (
                  <span className="row" style={{ gap: 4 }}>
                    {(
                      [
                        ['base', '基础'],
                        ['ours', '本地'],
                        ['theirs', '对方'],
                      ] as [Tab, string][]
                    ).map(([k, label]) => (
                      <button key={k} className={`mini ${tab === k ? 'primary' : ''}`} onClick={() => setTab(k)}>
                        {label}
                      </button>
                    ))}
                  </span>
                )}
              </div>
              {!expanded && (
                <pre className="diff" style={{ flex: 1, maxHeight: 140, overflow: 'auto', fontSize: 12 }}>
                  {(tab === 'base' ? cur.base : tab === 'ours' ? cur.ours : cur.theirs || '（无内容）')
                    .split('\n')
                    .map((l, i) => (
                      <div key={i} dangerouslySetInnerHTML={{ __html: highlightLine(l, lang) }} />
                    ))}
                </pre>
              )}
              {/* 本地 vs 对方：双栏并排对比（左=对方，右=本地） */}
              <div className="row" style={{ margin: '8px 0 4px' }}>
                <span className="dim small">
                  🔀 双栏对比：<span style={{ color: 'var(--err)' }}>左=对方</span> · <span style={{ color: 'var(--ok)' }}>右=本地</span> · M=修改处
                </span>
                <span className="grow" />
                <button className="mini" onClick={() => setExpanded((s) => !s)}>
                  {expanded ? '⛶ 还原' : '⛶ 放大'}
                </button>
              </div>
              <div
                style={{
                  display: 'flex',
                  flex: expanded ? 1 : undefined,
                  minHeight: expanded ? 0 : 230,
                  maxHeight: expanded ? '100%' : 230,
                  overflow: 'hidden',
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                }}
              >
                {/* 左栏：对方（position:relative 使行 offsetTop 相对容器） */}
                <div ref={theirsPane} className="sb-pane" style={{ overflow: 'auto', position: 'relative' }}>
                  {theirsRows.map((r) => (
                    <div
                      key={`t${r.no}`}
                      ref={(el) => {
                        if (el) rowRefsT.current.set(r.no, el);
                      }}
                      className={`sb-line ${r.change ? 'sb-add' : ''}`}
                    >
                      <span className="sb-no">{r.no}</span>
                      <span className="sb-marker">{r.change ? 'M' : ''}</span>
                      <span className="sb-code" dangerouslySetInnerHTML={{ __html: highlightLine(r.text, lang) }} />
                    </div>
                  ))}
                </div>
                {/* 右栏：本地 */}
                <div ref={oursPane} className="sb-pane" style={{ overflow: 'auto', borderLeft: '1px solid var(--border)', position: 'relative' }}>
                  {oursRows.map((r) => (
                    <div
                      key={`o${r.no}`}
                      ref={(el) => {
                        if (el) rowRefsO.current.set(r.no, el);
                      }}
                      className={`sb-line ${r.change ? 'sb-del' : ''}`}
                    >
                      <span className="sb-no">{r.no}</span>
                      <span className="sb-marker">{r.change ? 'M' : ''}</span>
                      <span className="sb-code" dangerouslySetInnerHTML={{ __html: highlightLine(r.text, lang) }} />
                    </div>
                  ))}
                </div>
                {/* 右侧滚动条冲突标记：点击双栏同步滚动 */}
                {vsMarkers.length > 0 && (
                  <div className="sb-scrollbar" title="冲突位置（点击双栏同步跳转）">
                    {vsMarkers.map((m, i) => (
                      <div
                        key={m.id}
                        className={`sb-marker-dot ${m.color}`}
                        style={{ top: `${m.percent}%` }}
                        onClick={() => goBlock(i)}
                        title={m.color === 'add' ? '对方修改处' : '删除处'}
                      />
                    ))}
                  </div>
                )}
              </div>
              {!expanded && (
                <>
                  <div className="dim small" style={{ margin: '8px 0 4px' }}>手动编辑合并结果（初始为当前合并内容）：</div>
                  <textarea
                    rows={6}
                    className="mono"
                    style={{ fontSize: 12 }}
                    value={manual}
                    onChange={(e) => setManual(e.target.value)}
                  />
                </>
              )}
              <div className="row" style={{ marginTop: 10, gap: 6 }}>
                <button className="primary" disabled={busy} onClick={() => void resolve('ours')}>✅ 采用本地</button>
                <button disabled={busy} onClick={() => void resolve('theirs')}>采用对方</button>
                <button disabled={busy} onClick={() => void resolve('manual')}>💾 保存手动编辑</button>
                <button
                  className="mini tool-btn"
                  title="打开冲突文件所在文件夹"
                  onClick={() => {
                    if (!cur) return;
                    void post
                      .reveal(cur.path)
                      .catch((e: Error) => setMsg((e as Error).message));
                  }}
                >
                  <IconFolder /> 打开文件夹
                </button>
                <span className="grow" />
                {msg && <span className={`small ${msgErr ? 'dim' : ''}`} style={{ color: msgErr ? 'var(--err)' : 'var(--ok)' }}>{msg}</span>}
              </div>
            </div>
          )}
        </div>
        <div className="foot">
          <button onClick={props.onClose} disabled={busy}>关闭</button>
        </div>
      </ResizableModal>
      {/* 解决方式二次确认（工具风格） */}
      {confirmMode && (
        <ConfirmModal
          title="⚠ 确认解决冲突"
          message={
            {
              ours: '将用【你的版本】覆盖冲突文件，对方的修改会丢失。确认采用本地？',
              theirs: '将用【对方的版本】覆盖冲突文件，你的修改会丢失。确认采用对方？',
              manual: '将用你编辑的内容覆盖冲突文件。确认保存？',
            }[confirmMode]
          }
          confirmLabel="确认"
          onConfirm={() => void doResolve(confirmMode)}
          onCancel={() => setConfirmMode(null)}
        />
      )}
    </div>
  );
}
