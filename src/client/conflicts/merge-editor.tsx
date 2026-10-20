/** 三栏合并编辑器：左=对方 / 中=结果（可编辑）/ 右=本地。
 *
 *  块级操作按**冲突标记整块**（`<<<<<<<` 到 `>>>>>>>`）：每个冲突块在结果栏顶部给
 *  「采用对方 / 两边都要 / 采用本地」，选完即时改结果；结果栏的行双击可直接改文本。
 *  两条连接带复用文件对比的 `DiffConnectors`，点击连接带三栏一起跳到该块。
 *
 *  左右栏显示双方完整文件（不是只显示冲突段）：用户需要上下文判断该采用哪边；
 *  冲突段在完整文件里的位置用 `locateBlocks` 按行内容匹配得到，匹配不到就不画连接带
 *  （比如一侧是纯新增、冲突段为空）。 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { highlightLine } from '../shared/highlight.js';
import { DiffConnectors } from '../shared/diff-connectors.js';
import { t } from '../../shared/i18n/index.js';
import {
  blockResultLines,
  countConflictBlocks,
  joinResultLines,
  locateBlocks,
  parseConflictWork,
  type ConflictBlock,
  type ConflictChoice,
  type MergeSegment,
  type ResultLine,
  type ResultLineKind,
} from '../../shared/conflict-merge.js';

interface Props {
  /** 本地版本（ours，git :2 / svn .mine） */
  ours: string;
  /** 对方版本（theirs，git :3 / svn .rN） */
  theirs: string;
  /** 工作区文件：自动合并结果 + 冲突标记 */
  work: string;
  /** 语法高亮语言（按文件名推断） */
  lang?: string;
  /** 该侧在合并里没有这个文件（一侧删除/未添加的冲突）：栏内显示提示，不渲染空行 */
  oursMissing?: boolean;
  theirsMissing?: boolean;
  /** 结果变化回调：父组件据此保存（text 是完整结果文件内容） */
  onResultChange: (state: { text: string; unresolved: number; total: number }) => void;
}

/** 结果栏的一行。key 稳定（编辑/块替换时不重建无关行），块号 0 = 非冲突内容 */
interface Item {
  key: string;
  text: string;
  kind: ResultLineKind;
  block: number;
}

let itemSeq = 0;
const nextKey = (prefix: string) => `${prefix}${++itemSeq}`;

function toItems(lines: ResultLine[]): Item[] {
  const seen = new Map<number, number>();
  return lines.map((l) => {
    if (l.block > 0) {
      const n = (seen.get(l.block) ?? 0) + 1;
      seen.set(l.block, n);
      return { key: `b${l.block}-${n}`, text: l.text, kind: l.kind, block: l.block };
    }
    return { key: nextKey('p'), text: l.text, kind: l.kind, block: 0 };
  });
}

/** 用新内容替换某一冲突块的行，其余行原样保留（它们在数组里的前后相对位置不变） */
function replaceBlock(items: Item[], id: number, fresh: Item[]): Item[] {
  const at = items.findIndex((it) => it.block === id);
  if (at < 0) return items;
  const before = items.slice(0, at).filter((it) => it.block !== id);
  const after = items.slice(at).filter((it) => it.block !== id);
  return [...before, ...fresh, ...after];
}

/** 行首尾空白不参与比较：编辑框里不该带 \r */
const editValue = (s: string) => (s.endsWith('\r') ? s.slice(0, -1) : s);

export function MergeEditor(props: Props) {
  const { ours, theirs, work, lang, oursMissing, theirsMissing } = props;
  const segments = useMemo(() => parseConflictWork(work), [work]);
  const blocks = useMemo(() => {
    const m = new Map<number, ConflictBlock>();
    for (const seg of segments) if (seg.kind === 'conflict') m.set(seg.block.id, seg.block);
    return m;
  }, [segments]);
  const blockIds = useMemo(() => [...blocks.keys()], [blocks]);

  const [choices, setChoices] = useState<Record<number, ConflictChoice>>({});
  const [items, setItems] = useState<Item[]>(() => toItems(buildInitial(segments)));
  const [editing, setEditing] = useState<{ key: string; value: string } | null>(null);
  const [currentBlock, setCurrentBlock] = useState(0);
  /** 整段手动编辑：非 null 时结果栏渲染成文本框，文本本身就是最终结果 */
  const [editText, setEditText] = useState<string | null>(null);
  /** 手动编辑完成后的未解决块数（文本里残留的冲突标记数） */
  const [customUnresolved, setCustomUnresolved] = useState<number | null>(null);

  /** 三栏宽度权重（null = 均分）。拖两条分隔条改变相邻两栏，双击恢复均分。
   *  存像素值没关系：渲染时只当 flex-grow 权重用，窗口/弹窗变宽时按原比例缩放。 */
  const [weights, setWeights] = useState<number[] | null>(null);
  const [dragIndex, setDragIndex] = useState(-1);
  const panesRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ index: number; startX: number; widths: number[] } | null>(null);
  const weightOf = (i: number) => weights?.[i] ?? 1;
  const paneStyle = (i: number): React.CSSProperties => ({ flexGrow: weightOf(i), flexBasis: 0, minWidth: 0 });

  /** 按住分隔条开始拖拽：以拖拽开始时的实测像素为基准，避免权重/像素换算误差累积 */
  const startResize = (index: number) => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const el = panesRef.current;
    if (!el) return;
    const panes = [...el.querySelectorAll<HTMLElement>('.sb-pane')];
    const widths = panes.map((p) => p.getBoundingClientRect().width);
    if (widths.length !== 3) return;
    dragRef.current = { index, startX: e.clientX, widths };
    setDragIndex(index);
  };

  useEffect(() => {
    if (dragIndex < 0) return;
    const MIN = 120;
    const onMove = (e: MouseEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const dx = e.clientX - d.startX;
      const w = [...d.widths];
      const i = d.index;
      // 向右拖：本栏变宽、右邻栏变窄（右邻栏不许小于 MIN）；向左拖反过来（本栏不许小于 MIN）
      const move = dx >= 0 ? Math.min(dx, Math.max(0, w[i + 1]! - MIN)) : Math.max(dx, MIN - w[i]!);
      w[i] = w[i]! + move;
      w[i + 1] = w[i + 1]! - move;
      setWeights(w);
    };
    const onUp = () => {
      dragRef.current = null;
      setDragIndex(-1);
    };
    document.body.style.cursor = 'col-resize';
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      document.body.style.cursor = '';
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [dragIndex]);

  const theirsLines = useMemo(() => theirs.split('\n'), [theirs]);
  const oursLines = useMemo(() => ours.split('\n'), [ours]);
  const theirsRanges = useMemo(() => locateBlocks(segments, 'theirs', theirsLines), [segments, theirsLines]);
  const oursRanges = useMemo(() => locateBlocks(segments, 'ours', oursLines), [segments, oursLines]);

  // 手动编辑时结果文本以文本框为准；未编辑时按块选择生成
  const text = useMemo(() => editText ?? joinResultLines(items), [editText, items]);
  const unresolved =
    editText !== null
      ? countConflictBlocks(editText) // 边编辑边判断：标记删干净了保存按钮就亮
      : (customUnresolved ?? blockIds.length - Object.keys(choices).length);

  // 父组件拿到最新结果（保存按钮用），每次编辑/选择都会更新
  useEffect(() => {
    props.onResultChange({ text, unresolved, total: blockIds.length });
    // onResultChange 由父组件定义，不应参与（每次渲染都是新函数会让本效果空转）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, unresolved, blockIds.length]);

  const choose = useCallback(
    (id: number, choice: ConflictChoice) => {
      const b = blocks.get(id);
      if (!b) return;
      setCustomUnresolved(null); // 手动编辑结果被块选择覆盖了
      setChoices((prev) => ({ ...prev, [id]: choice }));
      setItems((prev) => replaceBlock(prev, id, toItems(blockResultLines(b, choice))));
      if (editing && editing.key.startsWith(`b${id}-`)) setEditing(null);
    },
    [blocks, editing],
  );

  const chooseAll = (choice: ConflictChoice) => {
    const next: Record<number, ConflictChoice> = {};
    let nextItems = items;
    for (const id of blockIds) {
      const b = blocks.get(id)!;
      next[id] = choice;
      nextItems = replaceBlock(nextItems, id, toItems(blockResultLines(b, choice)));
    }
    setCustomUnresolved(null); // 同 choose：整体选择会覆盖手动编辑
    setChoices(next);
    setItems(nextItems);
    setEditing(null);
  };

  /** 整段编辑结束：文本框内容成为结果（原来的块选择状态全部作废，以手改文本为准） */
  const finishEdit = () => {
    if (editText === null) return;
    const lines = editText.split('\n');
    setItems(lines.map((line) => ({ key: nextKey('e'), text: line, kind: 'plain' as const, block: 0 })));
    setChoices({});
    setCustomUnresolved(countConflictBlocks(editText));
    setEditText(null);
  };

  const commitEdit = (key: string, raw: string) => {
    setItems((prev) =>
      prev.map((it) => {
        if (it.key !== key) return it;
        // 原来带 \r（CRLF 文件）就补回去：保存时要保持原文件行尾
        return { ...it, text: it.text.endsWith('\r') ? `${raw}\r` : raw };
      }),
    );
    setEditing(null);
  };

  // ---- 三栏 DOM refs：连接带按 getBoundingClientRect 实测坐标，按行号/结果序号取元素 ----
  const theirsPane = useRef<HTMLDivElement>(null);
  const oursPane = useRef<HTMLDivElement>(null);
  const resultPane = useRef<HTMLDivElement>(null);
  const theirsRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const oursRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const resultRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const emptyPhRefs = useRef<Map<number, HTMLDivElement[]>>(new Map());
  const blockHeadRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  const theirsBlockOf = useMemo(() => blockIndex(theirsLines.length, theirsRanges), [theirsLines.length, theirsRanges]);
  const oursBlockOf = useMemo(() => blockIndex(oursLines.length, oursRanges), [oursLines.length, oursRanges]);
  const theirsRows = useMemo(() => theirsBlockOf.map((block, i) => ({ no: i + 1, block })), [theirsBlockOf]);
  const oursRows = useMemo(() => oursBlockOf.map((block, i) => ({ no: i + 1, block })), [oursBlockOf]);
  const resultRows = useMemo(() => items.map((it, i) => ({ no: i + 1, block: it.block })), [items]);

  const scrollTo = (pane: HTMLDivElement | null, el: HTMLDivElement | undefined) => {
    if (!pane || !el) return;
    pane.scrollTop = Math.max(0, el.offsetTop - pane.clientHeight / 2 + el.clientHeight / 2);
  };

  const jump = useCallback(
    (index: number) => {
      const id = blockIds[index];
      if (!id) return;
      setCurrentBlock(id);
      scrollTo(resultPane.current, blockHeadRefs.current.get(id));
      const tr = theirsRanges.get(id);
      if (tr) scrollTo(theirsPane.current, theirsRefs.current.get(tr.start + 1));
      const or = oursRanges.get(id);
      if (or) scrollTo(oursPane.current, oursRefs.current.get(or.start + 1));
    },
    [blockIds, theirsRanges, oursRanges],
  );

  // 首个冲突块标为当前，连接带一打开就有强调
  useEffect(() => {
    setCurrentBlock(blockIds[0] ?? 0);
  }, [blockIds]);

  const paneLine = (
    line: string,
    no: number,
    hl: boolean,
    refCb: (el: HTMLDivElement | null) => void,
  ) => (
    <div key={no} ref={refCb} className={`sb-line ${hl ? 'sb-conflict-hl' : ''}`}>
      <span className="sb-no">{no}</span>
      <span className="sb-marker">{hl ? '!' : ''}</span>
      <span className="sb-code" dangerouslySetInnerHTML={{ __html: highlightLine(line, lang) }} />
    </div>
  );

  return (
    <div className="merge-view">
      <div className="merge-toolbar">
        {editText !== null ? (
          <>
            <span className="small" style={{ color: 'var(--accent)' }}>{t('conflict.merge.editing')}</span>
            <span className="grow" />
          </>
        ) : (
          <>
            <span className="dim small">
              {blockIds.length > 0
                ? t('conflict.merge.progress', { done: blockIds.length - unresolved, total: blockIds.length })
                : t('conflict.merge.noMarkers')}
            </span>
            <span className="grow" />
            {blockIds.length > 0 && (
              <>
                <button className="mini" onClick={() => chooseAll('theirs')}>{t('conflict.merge.allTheirs')}</button>
                <button className="mini" onClick={() => chooseAll('ours')}>{t('conflict.merge.allOurs')}</button>
                <button className="mini" title={t('conflict.merge.prevTip')} onClick={() => jump(prevIndex(blockIds, currentBlock))}>↑</button>
                <button className="mini" title={t('conflict.merge.nextTip')} onClick={() => jump(nextIndex(blockIds, currentBlock))}>↓</button>
              </>
            )}
          </>
        )}
      </div>
      {/* 三栏标题：与下面的栏宽同步（同样的 flex-grow 权重；两条连接带各 44px = CONNECT_WIDTH） */}
      <div className="merge-heads">
        <span className="merge-head-slot" style={paneStyle(0)}><span className="merge-pane-tag theirs">{t('conflict.merge.tagTheirs')}</span></span>
        <span className="merge-head-gap" />
        <span className="merge-head-slot" style={paneStyle(1)}>
          <span className="merge-pane-tag result">{t('conflict.merge.tagResult')}</span>
          {/* 编辑的是结果栏：入口/取消/完成都放在「结果」标签旁边（放「本地」旁边会让人以为改本地版本） */}
          {editText === null ? (
            <button
              className="mini merge-edit-btn"
              title={t('conflict.merge.editTip')}
              onClick={() => {
                setEditing(null);
                setEditText(joinResultLines(items));
              }}
            >
              {t('conflict.merge.edit')}
            </button>
          ) : (
            <>
              <button className="mini" onClick={() => setEditText(null)}>{t('conflict.merge.editCancel')}</button>
              <button className="mini primary" onClick={finishEdit}>{t('conflict.merge.editDone')}</button>
            </>
          )}
        </span>
        <span className="merge-head-gap" />
        <span className="merge-head-slot" style={paneStyle(2)}><span className="merge-pane-tag ours">{t('conflict.merge.tagOurs')}</span></span>
      </div>
      {/* 一侧/两侧没有这个文件（删除/新增冲突）：直接说清"采用这一侧 = 删掉文件"，
          否则空栏加空结果会让人以为是内容丢了 */}
      {(oursMissing || theirsMissing) && (
        <div className="merge-banner">
          {oursMissing && theirsMissing
            ? t('conflict.merge.bothMissing')
            : oursMissing
              ? t('conflict.merge.oursMissing')
              : t('conflict.merge.theirsMissing')}
        </div>
      )}
      <div className="merge-panes" ref={panesRef}>
        {/* 左：对方完整文件 */}
        <div ref={theirsPane} className="sb-pane" style={paneStyle(0)}>
          {theirsMissing ? (
            <div className="merge-missing">{t('conflict.merge.sideEmpty')}</div>
          ) : (
            theirsLines.map((line, i) => {
              const r = theirsRows[i]!;
              return paneLine(line, r.no, r.block > 0, (el) => {
                if (el) theirsRefs.current.set(r.no, el);
              });
            })
          )}
        </div>
        <div className="merge-connect">
          <DiffConnectors
            leftPane={theirsPane}
            rightPane={resultPane}
            leftRows={theirsRows}
            rightRows={resultRows}
            leftRefs={theirsRefs}
            rightRefs={resultRefs}
            leftPhRefs={emptyPhRefs}
            currentBlockId={currentBlock}
            onJump={jump}
          />
          {/* 第一道分隔：对方 ↔ 结果 */}
          <div
            className={`merge-resizer${dragIndex === 0 ? ' active' : ''}`}
            title={t('conflict.merge.resizeTip')}
            onMouseDown={startResize(0)}
            onDoubleClick={() => setWeights(null)}
          />
        </div>
        {/* 中：结果（可编辑） */}
        <div ref={resultPane} className="sb-pane merge-result" style={paneStyle(1)}>
          {editText !== null ? (
            // 整段手动编辑：直接改结果文本（左右两栏保留作对照）
            <textarea
              className="merge-text-edit"
              value={editText}
              spellCheck={false}
              autoFocus
              onChange={(e) => setEditText(e.target.value)}
            />
          ) : (
          items.map((it, i) => {
            const isBlockHead = it.block > 0 && (i === 0 || items[i - 1]!.block !== it.block);
            const block = isBlockHead ? blocks.get(it.block) : undefined;
            const chosen = it.block > 0 && choices[it.block] !== undefined;
            const cls = [
              'sb-line',
              it.block > 0 ? 'sb-conflict-row' : '',
              it.kind === 'marker' ? 'sb-conflict-marker' : '',
              chosen && it.block > 0 ? 'sb-resolved' : '',
              it.kind === 'ours' ? 'sb-side-ours' : '',
              it.kind === 'theirs' ? 'sb-side-theirs' : '',
            ]
              .filter(Boolean)
              .join(' ');
            return (
              <React.Fragment key={it.key}>
                {block && (
                  <div
                    ref={(el) => {
                      if (el) blockHeadRefs.current.set(it.block, el);
                    }}
                    className="sb-choice-bar"
                  >
                    <button className="mini" onClick={() => choose(it.block, 'theirs')}>
                      ← {t('conflict.merge.takeTheirs')}
                    </button>
                    <button className="mini" onClick={() => choose(it.block, 'both')}>
                      {t('conflict.merge.both')}
                    </button>
                    <button className="mini" onClick={() => choose(it.block, 'ours')}>
                      {t('conflict.merge.takeOurs')} →
                    </button>
                    <span className="dim small">{t('conflict.merge.blockN', { n: it.block })}</span>
                  </div>
                )}
                <div
                  ref={(el) => {
                    if (el) resultRefs.current.set(i + 1, el);
                  }}
                  className={cls}
                  onDoubleClick={() => {
                    if (it.kind === 'marker') return; // 标记行点选择按钮处理，不直接编辑
                    setEditing({ key: it.key, value: editValue(it.text) });
                  }}
                >
                  <span className="sb-no">{i + 1}</span>
                  <span className="sb-marker">{it.kind === 'marker' ? '!' : ''}</span>
                  {editing?.key === it.key ? (
                    <input
                      className="sb-edit-input"
                      // ResizableModal 在 document 捕获阶段处理 Esc/按键；带这个标记的输入框
                      // 自己处理 Esc，弹窗不再抢（否则按 Esc 想取消编辑，整个弹窗被关掉）
                      data-inline-edit="1"
                      autoFocus
                      value={editing.value}
                      onChange={(e) => setEditing({ key: it.key, value: e.target.value })}
                      onBlur={(e) => {
                        // Esc = 取消（ResizableModal 在捕获阶段置了这个标记并失焦），
                        // 其余失焦（点别处）算提交
                        if (e.currentTarget.dataset.escapeCancel === '1') {
                          delete e.currentTarget.dataset.escapeCancel;
                          setEditing(null);
                          return;
                        }
                        commitEdit(it.key, editing ? editing.value : it.text);
                      }}
                      onKeyDown={(e) => {
                        // 中文/日文输入法组词时的回车是"上屏"，不是提交（否则刚敲的字被截断）
                        if (e.key === 'Enter' && !e.nativeEvent.isComposing) commitEdit(it.key, editing.value);
                        // 兜底：没有弹窗壳时（理论上不会有）也能用 Esc 退出
                        if (e.key === 'Escape') setEditing(null);
                      }}
                    />
                  ) : (
                    <span className="sb-code" dangerouslySetInnerHTML={{ __html: highlightLine(it.text, lang) }} />
                  )}
                </div>
              </React.Fragment>
            );
          })
          )}
        </div>
        <div className="merge-connect">
          <DiffConnectors
            leftPane={resultPane}
            rightPane={oursPane}
            leftRows={resultRows}
            rightRows={oursRows}
            leftRefs={resultRefs}
            rightRefs={oursRefs}
            leftPhRefs={emptyPhRefs}
            currentBlockId={currentBlock}
            onJump={jump}
          />
          {/* 第二道分隔：结果 ↔ 本地 */}
          <div
            className={`merge-resizer${dragIndex === 1 ? ' active' : ''}`}
            title={t('conflict.merge.resizeTip')}
            onMouseDown={startResize(1)}
            onDoubleClick={() => setWeights(null)}
          />
        </div>
        {/* 右：本地完整文件 */}
        <div ref={oursPane} className="sb-pane" style={paneStyle(2)}>
          {oursMissing ? (
            <div className="merge-missing">{t('conflict.merge.sideEmpty')}</div>
          ) : (
            oursLines.map((line, i) => {
              const r = oursRows[i]!;
              return paneLine(line, r.no, r.block > 0, (el) => {
                if (el) oursRefs.current.set(r.no, el);
              });
            })
          )}
        </div>
      </div>
    </div>
  );
}

/** 初始结果：全部按"未选择"展开（保留冲突标记，一眼看出还有多少处待处理） */
function buildInitial(segments: MergeSegment[]): ResultLine[] {
  const out: ResultLine[] = [];
  for (const seg of segments) {
    if (seg.kind === 'plain') {
      for (const text of seg.lines) out.push({ text, kind: 'plain', block: 0 });
    } else {
      out.push(...blockResultLines(seg.block, undefined));
    }
  }
  return out;
}

/** 每一行落在哪个冲突块区间内（0 = 不在冲突区）。
 *  预先摊成数组：逐行去 ranges 里找是 O(行数 × 块数)，大文件 + 多处冲突时会明显拖慢渲染。 */
function blockIndex(lineCount: number, ranges: Map<number, { start: number; end: number }>): number[] {
  const out = new Array<number>(lineCount).fill(0);
  for (const [id, r] of ranges) {
    for (let i = Math.max(0, r.start); i <= Math.min(lineCount - 1, r.end); i++) out[i] = id;
  }
  return out;
}

function prevIndex(ids: number[], current: number): number {
  const i = ids.indexOf(current);
  return i <= 0 ? Math.max(0, ids.length - 1) : i - 1;
}

function nextIndex(ids: number[], current: number): number {
  const i = ids.indexOf(current);
  return i < 0 || i >= ids.length - 1 ? 0 : i + 1;
}
