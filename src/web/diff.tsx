/** 差异视图：并排双栏对比（左原版/右当前，修改行 M 标识，语法高亮，点击联动）/ 版本间文本 diff */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { get } from './api.js';
import { DiffRender } from './diff-render.js';
import { langOf, highlightLine } from './highlight.js';
import { renderMarkdown } from './markdown.js';

export interface DiffTarget {
  path?: string;
  a?: string;
  b?: string;
}

interface Props {
  target: DiffTarget | null;
  tick: number;
  onBack: () => void;
  /** 当前视图是否激活（视图常驻挂载、display 切换；键盘监听只在激活时生效，防止隐藏时 ←/Esc 误触发返回） */
  active: boolean;
}

/** unified diff 解析出的行 */
export interface DiffLine {
  text: string;
  type: 'ctx' | 'del' | 'add';
  leftNo: number;
  rightNo: number;
  block: number;
}

/**
 * 判定每个变更块的标记类型（新增/删除/修改）：
 * - 删除块后紧跟新增块（成对，编号连续）→ 修改（mod，显示 M）
 * - 孤立的新增块 → 新增（add，显示 +）
 * - 孤立的删除块 → 删除（del，显示 -）
 */
export function markTypesOf(lines: DiffLine[]): Map<number, 'mod' | 'add' | 'del'> {
  const blocks = new Map<number, { hasDel: boolean; hasAdd: boolean }>();
  for (const l of lines) {
    if (l.type === 'add') {
      const b = blocks.get(l.block) ?? { hasDel: false, hasAdd: false };
      b.hasAdd = true;
      blocks.set(l.block, b);
    } else if (l.type === 'del') {
      const b = blocks.get(l.block) ?? { hasDel: false, hasAdd: false };
      b.hasDel = true;
      blocks.set(l.block, b);
    }
  }
  const ids = [...blocks.keys()].sort((a, b) => a - b);
  const out = new Map<number, 'mod' | 'add' | 'del'>();
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i]!;
    const b = blocks.get(id)!;
    const nextId = ids[i + 1];
    const next = nextId !== undefined ? blocks.get(nextId) : undefined;
    if (b.hasDel && !b.hasAdd && next && !next.hasDel && next.hasAdd && nextId === id + 1) {
      // 删除段紧跟新增段（成对）→ 这段替换是"修改"
      out.set(id, 'mod');
      out.set(nextId, 'mod');
      i++;
    } else if (b.hasAdd && !b.hasDel) {
      out.set(id, 'add');
    } else if (b.hasDel && !b.hasAdd) {
      out.set(id, 'del');
    } else {
      out.set(id, 'mod'); // 同一块内混合（少见）按修改处理
    }
  }
  return out;
}

export function parseUnifiedDiff(text: string): DiffLine[] {
  const out: DiffLine[] = [];
  let leftNo = 0;
  let rightNo = 0;
  let block = 0;
  let blockOpen = false;
  let inHunk = false;
  for (const raw of text.split('\n')) {
    const hunk = raw.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)/);
    if (hunk && hunk[1] && hunk[2]) {
      leftNo = Number(hunk[1]);
      rightNo = Number(hunk[2]);
      inHunk = true;
      blockOpen = false;
      continue;
    }
    if (!inHunk) continue;
    const ch = raw[0];
    if (ch === ' ') {
      out.push({ text: raw.slice(1), type: 'ctx', leftNo: leftNo++, rightNo: rightNo++, block: -1 });
      blockOpen = false;
    } else if (ch === '-') {
      if (!blockOpen) {
        block += 1;
        blockOpen = true;
      }
      out.push({ text: raw.slice(1), type: 'del', leftNo: leftNo++, rightNo: 0, block });
    } else if (ch === '+') {
      if (!blockOpen) {
        block += 1;
        blockOpen = true;
      }
      out.push({ text: raw.slice(1), type: 'add', leftNo: 0, rightNo: rightNo++, block });
    } else if (ch === '\\') {
      /* 无换行符提示，忽略 */
    } else {
      inHunk = false;
    }
  }
  return out;
}

export function DiffView(props: Props) {
  const [versions, setVersions] = useState<{ left: string; right: string; leftLabel: string; rightLabel: string } | null>(null);
  const [diffLines, setDiffLines] = useState<DiffLine[]>([]);
  // 变更块标记类型（新增 + / 删除 - / 修改 M）
  const markTypes = useMemo(() => markTypesOf(diffLines), [diffLines]);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  // 差异块导航
  const [curBlock, setCurBlock] = useState(0);
  // diff 内搜索（右栏 = 当前内容）
  const [dSearch, setDSearch] = useState('');
  const [dSearchActive, setDSearchActive] = useState(false);
  const [dMatchIdx, setDMatchIdx] = useState(0);
  // 左栏搜索（原版内容），独立于右栏搜索
  const [dSearchL, setDSearchL] = useState('');
  const [dSearchLActive, setDSearchLActive] = useState(false);
  const [dMatchLIdx, setDMatchLIdx] = useState(0);
  // md 文件双栏预览：左右独立开关（预览=该栏原文 Markdown 渲染，非 diff 行视图）
  const [previewL, setPreviewL] = useState(false);
  const [previewR, setPreviewR] = useState(false);
  // 双栏同步滚动（按钮开关）：滚任一栏 → 另一栏按修改块对齐跟随
  const [syncMode, setSyncMode] = useState(false);
  const syncLock = useRef(false);
  // 文件更新检测
  const [staleTip, setStaleTip] = useState(false);
  const mtimeRef = useRef<{ mtime: number; size: number } | null>(null);

  const leftRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const rightRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  // 左栏新增占位行 refs（按 block 定位）
  const leftPhRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const leftPane = useRef<HTMLDivElement>(null);
  const rightPane = useRef<HTMLDivElement>(null);

  const sideMode = Boolean(props.target?.path);
  // md 文件：左右栏预览（renderMarkdown 复用文件预览同款渲染；baseDir 供相对图片路径）
  const isMd = Boolean(props.target?.path?.toLowerCase().endsWith('.md'));
  const mdBaseDir = props.target?.path?.includes('/') ? props.target.path.slice(0, props.target.path.lastIndexOf('/')) : '';

  useEffect(() => {
    if (!props.target) return;
    let cancelled = false;
    setLoading(true);
    setError('');
    const t = props.target;
    if (sideMode) {
      // 并排模式：加载左右版本 + 行级 diff
      Promise.all([
        get.fileVersions(t.path!, t.a, t.b),
        get.diff(t.path, t.a, t.b),
      ])
        .then(([fv, d]) => {
          if (cancelled) return;
          setVersions({ left: fv.left, right: fv.right, leftLabel: fv.leftLabel, rightLabel: fv.rightLabel });
          setDiffLines(d.ok ? parseUnifiedDiff(d.output) : []);
          setCurBlock(0);
          // 记录文件指纹，开始外部更新检测
          get.fileMtime(t.path!).then((m) => { mtimeRef.current = m; }).catch(() => {});
          setStaleTip(false);
        })
        .catch((e: Error) => {
          if (!cancelled) setError(e.message);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    } else {
      // 文本模式（全仓库 diff 或版本间）
      get
        .diff(t.path, t.a, t.b)
        .then((r) => {
          if (!cancelled) {
            if (!r.ok) setError(r.error ?? 'diff 失败');
            else setText(r.output.trim() || '(无差异)');
          }
        })
        .catch((e: Error) => {
          if (!cancelled) setError(e.message);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }
    return () => {
      cancelled = true;
    };
  }, [props.target, props.tick]); // eslint-disable-line react-hooks/exhaustive-deps

  // 差异块导航
  const blocksRef = useRef<{ id: number; left: number; right: number }[]>([]);
  const curBlockRef = useRef(0);
  curBlockRef.current = curBlock;
  // 跳转目标块高亮：点击一侧/块导航后，另一侧对应块脉冲呼吸 1.5s（多块散布时一眼锁定对应修改）
  const [targetBlock, setTargetBlock] = useState<number | null>(null);
  const targetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashTarget = useCallback((block: number) => {
    setTargetBlock(block);
    if (targetTimer.current) clearTimeout(targetTimer.current);
    targetTimer.current = setTimeout(() => setTargetBlock(null), 1500);
  }, []);

  // 跳转到差异块：左右两栏都滚动到块首行
  const goBlock = useCallback((i: number) => {
    const b = blocksRef.current[i];
    if (!b) return;
    setCurBlock(i);
    flashTarget(b.id);
    leftRefs.current.get(b.left)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    rightRefs.current.get(b.right)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [flashTarget]);

  // ← / Esc 返回；↑↓ 差异块导航（并排模式且有差异时）
  useEffect(() => {
    if (!props.active) return; // 视图隐藏时键盘不响应（防止穿透到其他视图）
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key === 'ArrowLeft' || e.key === 'Escape') {
        e.preventDefault();
        props.onBack();
        return;
      }
      if (sideMode && blocksRef.current.length > 0) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          goBlock((curBlockRef.current + 1) % blocksRef.current.length);
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          goBlock((curBlockRef.current - 1 + blocksRef.current.length) % blocksRef.current.length);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [props.onBack, sideMode, props.active]);

  // 差异块列表
  const blocks = useMemo(() => {
    const m = new Map<number, { left: number; right: number }>();
    for (const l of diffLines) {
      const v = m.get(l.block) ?? { left: Number.MAX_SAFE_INTEGER, right: Number.MAX_SAFE_INTEGER };
      if (l.type === 'del') v.left = Math.min(v.left, l.leftNo);
      if (l.type === 'add') v.right = Math.min(v.right, l.rightNo);
      m.set(l.block, v);
    }
    return [...m.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([id, v]) => ({ id, left: v.left, right: v.right }));
  }, [diffLines]);
  blocksRef.current = blocks;

  // 左右栏比例拖拽
  const [leftRatio, setLeftRatio] = useState(50);
  const dragState = useRef<{ startX: number; startRatio: number } | null>(null);
  const startDrag = (e: React.MouseEvent) => {
    dragState.current = { startX: e.clientX, startRatio: leftRatio };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };
  useEffect(() => {
    const move = (e: MouseEvent) => {
      if (!dragState.current) return;
      const delta = ((e.clientX - dragState.current.startX) / window.innerWidth) * 100;
      setLeftRatio(Math.min(85, Math.max(15, dragState.current.startRatio + delta)));
    };
    const up = () => {
      dragState.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
  }, []);

  // 外部更新检测（3 秒轮询文件指纹）
  useEffect(() => {
    if (!sideMode || !props.target?.path) return;
    const path = props.target.path;
    const timer = setInterval(() => {
      if (staleTip) return;
      get
        .fileMtime(path)
        .then((m) => {
          if (mtimeRef.current && (m.mtime !== mtimeRef.current.mtime || m.size !== mtimeRef.current.size)) {
            setStaleTip(true);
          }
        })
        .catch(() => {});
    }, 3000);
    return () => clearInterval(timer);
  }, [sideMode, props.target, staleTip]);

  // 并排行拆分：左栏 = 原版每行 + 删除行标记；右栏 = 当前每行 + 新增行标记。
  // 左栏在"新增"处插入空占位行（带背景标记），左右视觉对齐、定位直观
  const leftRows = useMemo(() => {
    if (!versions) return [];
    const rows: { no: number; text: string; change: boolean; block: number; ph?: boolean }[] = [];
    for (const l of diffLines) {
      if (l.type === 'ctx') rows.push({ no: l.leftNo, text: l.text, change: false, block: -1 });
      else if (l.type === 'del') rows.push({ no: l.leftNo, text: l.text, change: true, block: l.block });
      else if (l.type === 'add') rows.push({ no: -l.block, text: '', change: true, block: l.block, ph: true }); // 占位行
    }
    return rows;
  }, [versions, diffLines]);

  const rightRows = useMemo(() => {
    if (!versions) return [];
    const rightMap = new Map<number, { text: string; block: number }>();
    for (const l of diffLines) {
      if (l.type === 'add') rightMap.set(l.rightNo, { text: l.text, block: l.block });
    }
    const out: { no: number; text: string; change: boolean; block: number }[] = [];
    versions.right.split('\n').forEach((t, i) => {
      const no = i + 1;
      const m = rightMap.get(no);
      if (m) out.push({ no, text: m.text, change: true, block: m.block });
      else out.push({ no, text: t, change: false, block: -1 });
    });
    return out;
  }, [versions, diffLines]);

  // diff 搜索匹配（右栏 = 当前内容）
  const dMatches = useMemo(() => {
    if (!dSearchActive || !dSearch.trim()) return [] as number[];
    const q = dSearch.toLowerCase();
    const out: number[] = [];
    rightRows.forEach((r) => {
      if (r.text.toLowerCase().includes(q)) out.push(r.no);
    });
    return out;
  }, [dSearch, dSearchActive, rightRows]);

  const goNextDMatch = useCallback(() => {
    if (dMatches.length === 0) return;
    const next = (dMatchIdx + 1) % dMatches.length;
    setDMatchIdx(next);
    // 预览模式：无行元素，按匹配比例滚动预览容器（近似定位）
    if (previewR) {
      const p = rightPane.current;
      if (p) p.scrollTop = (next / Math.max(1, dMatches.length)) * (p.scrollHeight - p.clientHeight);
      return;
    }
    rightRefs.current.get(dMatches[next]!)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [dMatches, dMatchIdx, previewR]);

  // 左栏搜索匹配 + 跳转
  const dMatchesL = useMemo(() => {
    if (!dSearchLActive || !dSearchL.trim()) return [] as number[];
    const q = dSearchL.toLowerCase();
    return leftRows.filter((r) => r.text.toLowerCase().includes(q)).map((r) => r.no);
  }, [dSearchL, dSearchLActive, leftRows]);
  const goNextLMatch = useCallback(() => {
    if (dMatchesL.length === 0) return;
    const next = (dMatchLIdx + 1) % dMatchesL.length;
    setDMatchLIdx(next);
    // 预览模式：无行元素，按匹配比例滚动预览容器（近似定位）
    if (previewL) {
      const p = leftPane.current;
      if (p) p.scrollTop = (next / Math.max(1, dMatchesL.length)) * (p.scrollHeight - p.clientHeight);
      return;
    }
    leftRefs.current.get(dMatchesL[next]!)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [dMatchesL, dMatchLIdx, previewL]);

  // 滚动条预览标记：修改块位置（绿=有新增/修改行，红=纯删除）
  const scrollMarkers = useMemo(() => {
    if (blocks.length === 0) return [] as { block: number; percent: number; color: 'add' | 'del' }[];
    const total = Math.max(leftRows.length, rightRows.length, 1);
    return blocks.map((b) => {
      const hasAdd = b.right > 0 && b.right !== Number.MAX_SAFE_INTEGER;
      const anchor = hasAdd ? b.right : b.left;
      return { block: b.id, percent: Math.min(99, Math.max(0, (anchor / total) * 100)), color: hasAdd ? ('add' as const) : ('del' as const) };
    });
  }, [blocks, leftRows.length, rightRows.length]);

  // 变更块定位：本侧有对应行（del→左栏 / add→右栏）用其行号；
  // 本侧无对应行（点击新增行跳左栏 / 删除行跳右栏）定位到该块最近位置（负数 = 左栏占位行）
  const blockFirstLeft = useMemo(() => {
    const m = new Map<number, number>();
    let lastCtx = 0;
    for (const l of diffLines) {
      if (l.type === 'ctx') lastCtx = l.leftNo;
      else if (l.type === 'del' && !m.has(l.block)) m.set(l.block, l.leftNo);
      else if (l.type === 'add' && !m.has(l.block)) m.set(l.block, -l.block); // 占位行
    }
    return m;
  }, [diffLines]);
  const blockFirstRight = useMemo(() => {
    const m = new Map<number, number>();
    let lastCtx = 0;
    for (const l of diffLines) {
      if (l.type === 'ctx') lastCtx = l.rightNo;
      else if (l.type === 'add' && !m.has(l.block)) m.set(l.block, l.rightNo);
      else if (l.type === 'del' && !m.has(l.block)) m.set(l.block, lastCtx || 1);
    }
    return m;
  }, [diffLines]);

  /** 双栏同步滚动：绑在两侧 pane 的 onScroll。两栏行高一致（占位行设计），
   *  高度相近时直接等量同步；差异大时按变更块对齐（否则比例同步）；syncLock 防循环。
   *  死区 ±2px：目标与当前差小于 2px 不设置——防止浮点取整造成的 ±1px 往返抽搐 */
  const lockTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onScrollSync = useCallback(
    (side: 'left' | 'right') => (e: React.UIEvent<HTMLDivElement>) => {
      if (!syncMode || syncLock.current) return;
      syncLock.current = true;
      const pane = e.currentTarget;
      const rows = side === 'left' ? leftRows : rightRows;
      const dstPane = (side === 'left' ? rightPane : leftPane).current;
      const setDst = (target: number): boolean => {
        if (!dstPane) return true;
        if (Math.abs(dstPane.scrollTop - target) < 2) return true; // 已对齐：不动（防振荡）
        dstPane.scrollTop = Math.max(0, target);
        return true;
      };
      if (dstPane) {
        const hDiff = Math.abs(pane.scrollHeight - dstPane.scrollHeight);
        if (hDiff < 300) {
          setDst(pane.scrollTop); // 等量同步（同行高 + 占位对齐，普通文件高度差 <300px）
        } else if (rows.length > 0 && pane.firstElementChild) {
          const rowH = (pane.firstElementChild as HTMLElement).offsetHeight || 18;
          let i = Math.min(Math.max(0, Math.floor(pane.scrollTop / rowH)), rows.length - 1);
          while (i < rows.length && rows[i].block < 0) i++; // 向下找视口处最近的变更块
          if (i < rows.length && rows[i].block >= 0) {
            const block = rows[i].block;
            const dstBlockNo = side === 'left' ? blockFirstRight.get(block) : blockFirstLeft.get(block);
            // 目标元素：右栏目标恒为行（无占位）；左栏目标优先占位行（phRefs key=block），否则行
            let dstEl: HTMLDivElement | undefined = undefined;
            if (side === 'left') dstEl = dstBlockNo !== undefined ? (rightRefs.current.get(dstBlockNo) ?? undefined) : undefined;
            else dstEl = leftPhRefs.current.get(block) ?? (dstBlockNo !== undefined ? (leftRefs.current.get(dstBlockNo) ?? undefined) : undefined);
            const phRow = (rows[i] as { ph?: boolean }).ph;
            const srcEl = phRow
              ? leftPhRefs.current.get(block)
              : (side === 'left' ? leftRefs.current : rightRefs.current).get(rows[i].no);
            if (dstEl && srcEl) {
              setDst(dstEl.offsetTop + (pane.scrollTop - srcEl.offsetTop));
            } else {
              // 无块可对齐：比例同步
              const maxSrc = Math.max(1, pane.scrollHeight - pane.clientHeight);
              const maxDst = Math.max(1, dstPane.scrollHeight - dstPane.clientHeight);
              setDst(Math.min(Math.max(0, (pane.scrollTop / maxSrc) * maxDst), maxDst));
            }
          } else {
            // 无块可对齐：比例同步
            const maxSrc = Math.max(1, pane.scrollHeight - pane.clientHeight);
            const maxDst = Math.max(1, dstPane.scrollHeight - dstPane.clientHeight);
            setDst(Math.min(Math.max(0, (pane.scrollTop / maxSrc) * maxDst), maxDst));
          }
        }
      }
      if (lockTimer.current) clearTimeout(lockTimer.current);
      lockTimer.current = setTimeout(() => {
        syncLock.current = false;
      }, 80);
    },
    [syncMode, leftRows, rightRows, blockFirstLeft, blockFirstRight],
  );

  // 手动滚动到指定行（scrollIntoView 会连带滚动外层容器，改为 pane 内精确滚动，左右联动可靠）
  const scrollToLine = (pane: HTMLDivElement | null, el: HTMLDivElement | undefined) => {
    if (!pane || !el) return;
    const rect = el.getBoundingClientRect();
    const paneRect = pane.getBoundingClientRect();
    pane.scrollTop += rect.top - paneRect.top - pane.clientHeight / 2;
  };
  // 点击右侧修改行 → 左侧滚动到对应修改块首行（新增块滚到左栏占位行）并高亮该块
  const jumpLeft = (block: number) => {
    const no = blockFirstLeft.get(block);
    if (no === undefined) return;
    flashTarget(block);
    if (no < 0) scrollToLine(leftPane.current, leftPhRefs.current.get(-no));
    else scrollToLine(leftPane.current, leftRefs.current.get(no));
  };
  // 点击左侧修改行 → 右侧滚动 + 同块高亮
  const jumpRight = (block: number) => {
    const no = blockFirstRight.get(block);
    if (no === undefined) return;
    flashTarget(block);
    scrollToLine(rightPane.current, rightRefs.current.get(no));
  };

  const lang = props.target?.path ? langOf(props.target.path) : undefined;

  const title = props.target
    ? props.target.a && props.target.b
      ? `${props.target.a} → ${props.target.b}`
      : '工作区差异'
    : '';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div className="row" style={{ marginBottom: 8, flexShrink: 0, flexWrap: 'wrap' }}>
        <span className="dim">
          差异: {title}
          {props.target?.path ? ` — ${props.target.path}` : ''}
        </span>
        <span className="grow" />
        {sideMode && blocks.length > 0 && (
          <>
            <span className="dim small nowrap">差异点 {curBlock + 1}/{blocks.length}</span>
            <button className="mini" onClick={() => goBlock((curBlock - 1 + blocks.length) % blocks.length)}>上一个 ↑</button>
            <button className="mini" onClick={() => goBlock((curBlock + 1) % blocks.length)}>下一个 ↓</button>
            <button
              className={`mini${syncMode ? ' primary' : ''}`}
              onClick={() => setSyncMode((v) => !v)}
              title="开启后滚动任一栏，另一栏自动跟随（预览模式下为按比例跟随，无行对齐）"
            >
              ↔ 同步滚动
            </button>
          </>
        )}
        <span className="dim small">← 键返回</span>
        <button className="mini" onClick={props.onBack}>← 返回</button>
      </div>
      {staleTip && (
        <div className="stale-tip" style={{ marginBottom: 8 }}>
          <span>⚠ 文件已更新，是否更新文件？</span>
          <span className="grow" />
          <button
            className="mini primary"
            onClick={() => {
              setStaleTip(false);
              setLoading(true);
              setError('');
              const t = props.target!;
              Promise.all([get.fileVersions(t.path!, t.a, t.b), get.diff(t.path, t.a, t.b)])
                .then(([fv, d]) => {
                  setVersions({ left: fv.left, right: fv.right, leftLabel: fv.leftLabel, rightLabel: fv.rightLabel });
                  setDiffLines(d.ok ? parseUnifiedDiff(d.output) : []);
                  get.fileMtime(t.path!).then((m) => { mtimeRef.current = m; }).catch(() => {});
                })
                .catch((e: Error) => setError(e.message))
                .finally(() => setLoading(false));
            }}
          >
            更新文件
          </button>
          <button className="mini" onClick={() => setStaleTip(false)}>忽略</button>
        </div>
      )}
      {error && <div className="error">{error}</div>}
      {loading && !error && <div className="loading">⏳ 加载对比…</div>}
      {!loading && !error && sideMode && versions && (
        <>
          {/* 栏头：左右各带独立搜索框（定位各自栏内代码） */}
          <div style={{ display: 'flex', flexShrink: 0, marginBottom: 6, gap: 8 }}>
            {/* 左栏：原版 */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="dim small" style={{ marginBottom: 4 }}>◀ {versions.leftLabel}</div>
              <div className="row" style={{ gap: 6 }}>
                {dSearchLActive ? (
                  <>
                    <input
                      autoFocus
                      type="text"
                      placeholder="搜索左栏代码…"
                      value={dSearchL}
                      onChange={(e) => {
                        setDSearchL(e.target.value);
                        setDMatchLIdx(0);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') goNextLMatch();
                        if (e.key === 'Escape') setDSearchLActive(false);
                      }}
                      style={{ flex: 1, minWidth: 0 }}
                    />
                    <span className="dim small nowrap">
                      {dSearchL.trim() && dMatchesL.length > 0 ? `${dMatchLIdx + 1}/${dMatchesL.length}` : dSearchL.trim() ? '无匹配' : ''}
                    </span>
                    <button className="mini" onClick={goNextLMatch}>下一个 ↓</button>
                  </>
                ) : (
                  <button className="mini" onClick={() => setDSearchLActive(true)}>🔍 搜索此栏</button>
                )}
                {isMd && previewL && (
                  <button className="mini" onClick={() => setPreviewL((v) => !v)} title="返回差异行视图">
                    返回对比
                  </button>
                )}
                {isMd && !previewL && (
                  <button className="mini" onClick={() => setPreviewL((v) => !v)} title="Markdown 渲染预览（原版）">
                    👁 预览
                  </button>
                )}
              </div>
            </div>
            {/* 右栏：当前 */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="dim small" style={{ marginBottom: 4 }}>▶ {versions?.rightLabel}</div>
              <div className="row" style={{ gap: 6 }}>
                {dSearchActive ? (
                  <>
                    <input
                      autoFocus
                      type="text"
                      placeholder="搜索右栏代码…"
                      value={dSearch}
                      onChange={(e) => {
                        setDSearch(e.target.value);
                        setDMatchIdx(0);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') goNextDMatch();
                        if (e.key === 'Escape') setDSearchActive(false);
                      }}
                      style={{ flex: 1, minWidth: 0 }}
                    />
                    <span className="dim small nowrap">
                      {dSearch.trim() && dMatches.length > 0 ? `${dMatchIdx + 1}/${dMatches.length}` : dSearch.trim() ? '无匹配' : ''}
                    </span>
                    <button className="mini" onClick={goNextDMatch}>下一个 ↓</button>
                  </>
                ) : (
                  <button className="mini" onClick={() => setDSearchActive(true)}>🔍 搜索此栏</button>
                )}
                {isMd && (
                  <button className="mini" onClick={() => setPreviewR((v) => !v)} title={previewR ? '返回差异行视图' : 'Markdown 渲染预览（当前）'}>
                    {previewR ? '返回对比' : '👁 预览'}
                  </button>
                )}
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', flex: 1, minHeight: 0, border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
            {/* 左栏：原版（flex 不伸缩，宽度由 leftRatio 控制；sb-pane 默认 flex:1 会覆盖 width） */}
            <div ref={leftPane} className="sb-pane" style={{ width: `${leftRatio}%`, flex: '0 0 auto' }} onScroll={onScrollSync('left')}>
              {previewL ? (
                <div
                  className="md-render"
                  style={{ padding: 16 }}
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(versions?.left ?? '', { baseDir: mdBaseDir }) }}
                />
              ) : (
              <>
              {leftRows.length === 0 && <div className="dim" style={{ padding: 20 }}>（原版为空 — 新增文件）</div>}
              {leftRows.map((r) => {
                const isHitL = dSearchLActive && dMatchesL.includes(r.no);
                const isCurL = isHitL && r.no === dMatchesL[dMatchLIdx % Math.max(1, dMatchesL.length)];
                return (
                <div
                  key={`l${r.no}`}
                  ref={(el) => {
                    if (r.ph) {
                      if (el) leftPhRefs.current.set(r.block, el);
                      else leftPhRefs.current.delete(r.block);
                    } else if (el) leftRefs.current.set(r.no, el);
                  }}
                  className={`sb-line ${r.ph ? 'sb-ph' : r.change ? 'sb-del' : ''} ${isHitL ? 'pv-hit' : ''} ${isCurL ? 'pv-cur' : ''} ${r.change && r.block === targetBlock ? 'sb-target' : ''}`}
                  onClick={() => r.change && jumpRight(r.block)}
                  title={r.ph ? '右栏此处有新增（点击右侧定位）' : r.change ? '修改处（点击右侧定位）' : ''}
                >
                  <span className="sb-no">{r.ph ? '' : r.no}</span>
                  <span className="sb-marker" style={{ color: r.ph ? 'var(--ok)' : r.change && markTypes.get(r.block) === 'del' ? 'var(--err)' : undefined }}>
                    {r.ph ? '+' : r.change ? (markTypes.get(r.block) === 'mod' ? 'M' : '-') : ''}
                  </span>
                  <span className="sb-code" dangerouslySetInnerHTML={{ __html: highlightLine(r.text, lang) }} />
                </div>
                );
              })}
              </>
              )}
            </div>
            {/* 拖拽手柄 */}
            <div className="sb-resizer" onMouseDown={startDrag} title="拖动调整左右栏宽度" />
            {/* 右栏：当前 + 滚动条预览标记 */}
            <div style={{ position: 'relative', flex: 1, display: 'flex', minWidth: 0 }}>
            <div ref={rightPane} className="sb-pane" onScroll={onScrollSync('right')}>
              {previewR ? (
                <div
                  className="md-render"
                  style={{ padding: 16 }}
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(versions?.right ?? '', { baseDir: mdBaseDir }) }}
                />
              ) : (
              <>
              {rightRows.length === 0 && <div className="dim" style={{ padding: 20 }}>（当前为空 — 文件已删除）</div>}
              {rightRows.map((r) => {
                const isHit = dSearchActive && dMatches.includes(r.no);
                const isCur = isHit && r.no === dMatches[dMatchIdx % Math.max(1, dMatches.length)];
                return (
                  <div
                    key={`r${r.no}`}
                    ref={(el) => {
                      if (el) rightRefs.current.set(r.no, el);
                    }}
                    className={`sb-line ${r.change ? 'sb-add' : ''} ${isHit ? 'pv-hit' : ''} ${isCur ? 'pv-cur' : ''} ${r.change && r.block === targetBlock ? 'sb-target' : ''}`}
                    onClick={() => r.change && jumpLeft(r.block)}
                    title={r.change ? '修改处（点击左侧定位）' : ''}
                  >
                    <span className="sb-no">{r.no}</span>
                    <span className="sb-marker" style={{ color: r.change && markTypes.get(r.block) === 'add' ? 'var(--ok)' : undefined }}>
                      {r.change ? (markTypes.get(r.block) === 'mod' ? 'M' : '+') : ''}
                    </span>
                    <span className="sb-code" dangerouslySetInnerHTML={{ __html: highlightLine(r.text, lang) }} />
                  </div>
                );
              })}
              </>
              )}
            </div>
            {/* 滚动条预览标记：绿=新增/修改，红=删除 */}
            {scrollMarkers.length > 0 && (
              <div className="sb-scrollbar" title="修改位置（点击跳转）">
                {scrollMarkers.map((m) => (
                  <div
                    key={m.block}
                    className={`sb-marker-dot ${m.color} ${m.block === curBlock ? 'current' : ''}`}
                    style={{ top: `${m.percent}%` }}
                    onClick={(e) => {
                      e.stopPropagation();
                      goBlock(blocks.findIndex((b) => b.id === m.block));
                    }}
                    title={m.color === 'add' ? '新增/修改' : '删除'}
                  />
                ))}
              </div>
            )}
            </div>
          </div>
        </>
      )}
      {!loading && !error && sideMode && !versions && <div className="empty">（无差异）</div>}
      {!loading && !error && !sideMode && <DiffRender text={text} />}
    </div>
  );
}
