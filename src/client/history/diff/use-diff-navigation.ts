/** 差异块导航与滚动定位：上/下一块、点刻度、点击行联动、双栏同步滚动、滚动条预览标记。
 *  行模型（use-diff-rows）只算数据；这里处理 DOM 滚动与跳转期间的锁。 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Dispatch, MouseEvent as ReactMouseEvent, MutableRefObject, RefObject, SetStateAction, UIEvent as ReactUIEvent } from 'react';
import type { DiffLine } from '../../../shared/diff-parse.js';
import type { InlineEditorHandle } from '../../shared/inline-editor.js';
import type { DiffBlock, LeftRow, RightAnchor, RightRow } from './use-diff-rows.js';
import type { ResizeCursorControls } from './use-diff-search.js';

export function useDiffNavigation(args: {
  diffLines: DiffLine[];
  leftRows: LeftRow[];
  rightRows: RightRow[];
  blocks: DiffBlock[];
  curBlock: number;
  delAnchorRight: Map<number, RightAnchor>;
  leftRefs: MutableRefObject<Map<number, HTMLDivElement>>;
  rightRefs: MutableRefObject<Map<number, HTMLDivElement>>;
  leftPhRefs: MutableRefObject<Map<number, HTMLDivElement[]>>;
  leftPane: RefObject<HTMLDivElement>;
  rightPane: RefObject<HTMLDivElement>;
  editing: boolean;
  editingRef: MutableRefObject<boolean>;
  editorRef: { current: InlineEditorHandle | null };
  syncMode: boolean;
  setCurBlock: Dispatch<SetStateAction<number>>;
  resizeCursor: ResizeCursorControls;
}) {
  const {
    diffLines,
    leftRows,
    rightRows,
    blocks,
    curBlock,
    delAnchorRight,
    leftRefs,
    rightRefs,
    leftPhRefs,
    leftPane,
    rightPane,
    editing,
    editingRef,
    editorRef,
    syncMode,
    setCurBlock,
    resizeCursor,
  } = args;
  const { start: startResizeCursor, move: moveResizeCursor, stop: stopResizeCursor } = resizeCursor;

  // 差异块导航
  const blocksRef = useRef<DiffBlock[]>(blocks);
  blocksRef.current = blocks;
  const curBlockRef = useRef(curBlock);
  curBlockRef.current = curBlock;
  // 跳转目标块高亮：点击一侧/块导航后，两侧对应块脉冲呼吸约 2.2s（多块散布时一眼锁定对应修改）
  const [targetBlock, setTargetBlock] = useState<number | null>(null);
  const targetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashTarget = useCallback((block: number) => {
    // 先清、隔一帧再设：连点同一个点（targetBlock 值不变）时类没被移除过，CSS 动画不会重播
    // ——用户想"再看一眼"时闪不出来。跨帧先摘类再挂，动画每次都从头播
    setTargetBlock(null);
    if (targetTimer.current) clearTimeout(targetTimer.current);
    targetTimer.current = setTimeout(() => setTargetBlock(null), 2500); // 与 CSS 的 0.75s×3 匹配、留余量
    requestAnimationFrame(() => setTargetBlock(block));
  }, []);
  // 经 ref 读取：locateDel 要放进 goBlock（依赖稳定的 useCallback），直接闭包会捕获过期表
  const delAnchorRef = useRef(delAnchorRight);
  delAnchorRef.current = delAnchorRight;

  /** 定位纯删除块：返回右栏**占位行**的行号（-block，由 rightRows 插入并注册进 rightRefs）；
   *  非删除块返回 undefined（调用方走默认定位）。占位行常驻，无需临时角标与定时清除。 */
  const locateDel = useCallback((block: number): number | undefined => {
    return delAnchorRef.current.has(block) ? -block : undefined;
  }, []);

  // 变更块定位：本侧有对应行（del→左栏 / add→右栏）用其行号；
  // 本侧无对应行（点击新增行跳左栏 / 删除行跳右栏）定位到该块最近位置（负数 = 左栏占位行）
  const blockFirstLeft = useMemo(() => {
    const m = new Map<number, number>();
    for (const l of diffLines) {
      if (l.type === 'del' && !m.has(l.block)) m.set(l.block, l.leftNo);
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
  /** 每个差异块在**工作区**的行范围（min..max add 行；块内 add 行连续）——编辑态"整块脉冲高亮"用 */
  const blockRightRange = useMemo(() => {
    const m = new Map<number, { from: number; to: number }>();
    for (const l of diffLines) {
      if (l.type !== 'add' || l.block < 0) continue;
      const cur = m.get(l.block);
      m.set(l.block, cur ? { from: Math.min(cur.from, l.rightNo), to: Math.max(cur.to, l.rightNo) } : { from: l.rightNo, to: l.rightNo });
    }
    return m;
  }, [diffLines]);
  /** goBlock 是缓存闭包，读它要走镜像 ref（同 blocksRef 模式） */
  const blockRightRangeRef = useRef(blockRightRange);
  blockRightRangeRef.current = blockRightRange;

  // 跳转到差异块：左右两栏都滚动到块首行。
  // **跳转期间锁住同步滚动**（jumpLock）：smooth 滚动触发的 onScroll 若让同步逻辑介入，
  // 会与跳转互相拉扯、两栏各停"差一点"（实测：开着同步滚动时上/下一个与点刻度点都跳不准）。
  // 锁 700ms（smooth 动画时长量级）后自释；期间用户手动滚动的同步会暂歇——跳转后本就该稳定
  const jumpLock = useRef(false);
  const goBlock = useCallback((i: number) => {
    const b = blocksRef.current[i];
    if (!b) return;
    setCurBlock(i);
    flashTarget(b.id);
    jumpLock.current = true;
    window.setTimeout(() => {
      jumpLock.current = false;
    }, 700);
    // 左栏：有 del 行用其行号；纯新增块的 b.left 是 MAX_SAFE_INTEGER 哨兵（块内无 del 行），
    // 落到块内第一个占位行（leftPhRefs 按块号存）——否则「下一个/左栏刻度」点了左栏纹丝不动
    const leftEl = b.left !== Number.MAX_SAFE_INTEGER ? leftRefs.current.get(b.left) : leftPhRefs.current.get(b.id)?.[0];
    leftEl?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    // 编辑态：右栏是编辑器（没有行元素，rightRefs 定位不到）——把光标定位到块的工作区行，
    // 并让**整块的行**脉冲高亮（flashRange=块的工作区行范围——像非编辑态的块级 sb-target；
    // 纯删除块无对应行，range/行号缺省时 gotoLine 自行忽略）
    if (editingRef.current) {
      editorRef.current?.gotoLine(
        b.right > 0 && b.right < Number.MAX_SAFE_INTEGER ? b.right : 0,
        blockRightRangeRef.current.get(b.id),
      );
      return;
    }
    // 纯删除块的 b.right 是 MAX_SAFE_INTEGER 哨兵（块内无 add 行），get 不到元素 → 右栏原本纹丝不动
    rightRefs.current.get(locateDel(b.id) ?? b.right)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [flashTarget, locateDel, editingRef, editorRef, leftPhRefs, leftRefs, rightRefs, setCurBlock]);

  /** 双栏同步滚动：绑在两侧 pane 的 onScroll。两栏行高一致（占位行设计），
   *  高度相近时直接等量同步；差异大时按变更块对齐（否则比例同步）；syncLock 防循环。
   *  死区 ±2px：目标与当前差小于 2px 不设置——防止浮点取整造成的 ±1px 往返抽搐 */
  const syncLock = useRef(false);
  const lockTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onScrollSync = useCallback(
    (side: 'left' | 'right') => (e: ReactUIEvent<HTMLDivElement>) => {
      if (!syncMode || syncLock.current || jumpLock.current) return;
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
            else dstEl = leftPhRefs.current.get(block)?.[0] ?? (dstBlockNo !== undefined ? (leftRefs.current.get(dstBlockNo) ?? undefined) : undefined);
            const phRow = (rows[i] as { ph?: boolean }).ph;
            const srcEl = phRow
              ? leftPhRefs.current.get(block)?.[(rows[i] as { phIndex?: number }).phIndex ?? 0]
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
    [syncMode, leftRows, rightRows, blockFirstLeft, blockFirstRight, leftPane, leftPhRefs, leftRefs, rightPane, rightRefs],
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
    if (no < 0) scrollToLine(leftPane.current, leftPhRefs.current.get(-no)?.[0]);
    else scrollToLine(leftPane.current, leftRefs.current.get(no));
  };
  // 点击左侧修改行 → 右侧滚动 + 同块高亮（纯删除块右栏无对应行 → 滚到插入的删除占位行）
  const jumpRight = (block: number) => {
    const no = locateDel(block) ?? blockFirstRight.get(block);
    if (no === undefined) return;
    flashTarget(block);
    if (editing) {
      // 就地编辑中：右栏是编辑器——点击改为把**光标**定位到对应行。
      // 行号用块的 b.right（add 行的**工作区行号**——与进入编辑时的定位同源，实测准）；
      // 不走 blockFirstRight：它对"修改块"给的是 del 行的左栏行号（凑巧相同场景才没暴露，实测差 1 行）。
      // 纯删除块（right 是哨兵）不定位（工作区没有该内容，光标留在原处）
      const b = blocksRef.current[blocksRef.current.findIndex((x) => x.id === block)];
      const line = b && b.right > 0 && b.right < Number.MAX_SAFE_INTEGER ? b.right : 0;
      // 整块脉冲（块的工作区行范围）——编辑态点左栏"指认改动处"，与右栏行高亮同效果
      editorRef.current?.gotoLine(line, blockRightRange.get(block));
      return;
    }
    scrollToLine(rightPane.current, rightRefs.current.get(no));
  };

  // 滚动条预览标记：修改块位置（绿=有新增/修改行，红=纯删除）。
  // index 是块在 blocks 数组里的序号（curBlock / goBlock 的语义）；block 是 diff 块号（从 1 起，见
  // diff-parse 的块号约定）——高亮与跳转一律用 index：早期误用 block 与 curBlock 比较，错位 1
  const scrollMarkers = useMemo(() => {
    if (blocks.length === 0) return [] as { block: number; index: number; percent: number; color: 'add' | 'del' }[];
    const total = Math.max(leftRows.length, rightRows.length, 1);
    return blocks.map((b, index) => {
      const hasAdd = b.right > 0 && b.right !== Number.MAX_SAFE_INTEGER;
      const anchor = hasAdd ? b.right : b.left;
      return { block: b.id, index, percent: Math.min(99, Math.max(0, (anchor / total) * 100)), color: hasAdd ? ('add' as const) : ('del' as const) };
    });
  }, [blocks, leftRows.length, rightRows.length]);

  // 左栏滚动条标记：与右栏同款（同块同色、点击走同一 goBlock 两侧联动）。
  // 位置按**左栏行索引**算：左栏未「显示全部」时是差异片段、行号不连续——用行号比例会错位；
  // index 同右栏（高亮/跳转用）；rowIdx = 锚行在 leftRows 里的序号（纵向定位用，见渲染处 min(…)）
  const leftScrollMarkers = useMemo(() => {
    if (blocks.length === 0 || leftRows.length === 0) return [] as { block: number; index: number; rowIdx: number; percent: number; color: 'add' | 'del' }[];
    return blocks.flatMap((b, index) => {
      const idx = leftRows.findIndex((r) => r.block === b.id);
      if (idx < 0) return [];
      const hasAdd = b.right > 0 && b.right !== Number.MAX_SAFE_INTEGER;
      return [{ block: b.id, index, rowIdx: idx, percent: Math.min(99, Math.max(0, (idx / leftRows.length) * 100)), color: hasAdd ? ('add' as const) : ('del' as const) }];
    });
  }, [blocks, leftRows]);

  // 左栏代码行的行高（px）：纵向定位的像素项用。取 pane 继承的 line-height 实测值
  // （CSS 调了自动跟上）；首帧（ref 未挂）先用默认值，误差一帧内自愈
  const [leftLineH, setLeftLineH] = useState(20.15);
  useEffect(() => {
    const pane = leftPane.current;
    if (!pane) return;
    const lh = parseFloat(getComputedStyle(pane).lineHeight);
    if (lh > 0) setLeftLineH(lh);
  }, [leftPane]);

  // 左右栏比例拖拽
  const [leftRatio, setLeftRatio] = useState(50);
  const dragState = useRef<{ startX: number; startRatio: number } | null>(null);
  const startDrag = (e: ReactMouseEvent) => {
    dragState.current = { startX: e.clientX, startRatio: leftRatio };
    startResizeCursor(e.clientX, e.clientY);
  };
  useEffect(() => {
    const move = (e: MouseEvent) => {
      if (!dragState.current) return;
      moveResizeCursor(e.clientX, e.clientY);
      const delta = ((e.clientX - dragState.current.startX) / window.innerWidth) * 100;
      setLeftRatio(Math.min(85, Math.max(15, dragState.current.startRatio + delta)));
    };
    const up = () => {
      dragState.current = null;
      stopResizeCursor();
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
  }, [moveResizeCursor, stopResizeCursor]);

  return {
    blocksRef,
    curBlockRef,
    targetBlock,
    flashTarget,
    locateDel,
    goBlock,
    blockFirstLeft,
    blockFirstRight,
    blockRightRange,
    onScrollSync,
    scrollMarkers,
    leftScrollMarkers,
    leftLineH,
    jumpLeft,
    jumpRight,
    leftRatio,
    startDrag,
  };
}

export type DiffNavigationApi = ReturnType<typeof useDiffNavigation>;
