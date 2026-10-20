/** 左右两栏各自独立的搜索：输入/匹配计数/上一个下一个，以及搜索框宽度的持久化与拖拽收起。
 *  拖拽复用 shared/use-resize-cursor 的统一光标（实例由外壳持有并传入，保证全局只有一个浮层）。 */
import { useCallback, useMemo, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent, MutableRefObject, RefObject } from 'react';
import type { LeftRow, RightRow } from './use-diff-rows.js';

/** 搜索框宽度：右边缘拖拽调整、**左右两栏各自独立**、localStorage 持久化；越界值回默认。
 *  往左拖窄到阈值内（SEARCH_W_COLLAPSE）松手 = 收起搜索（拖动中显示提示），收起不落盘 */
const SEARCH_W_KEY_L = 'diffSearch.widthL';
const SEARCH_W_KEY_R = 'diffSearch.widthR';
const SEARCH_W_DEFAULT = 360;
const SEARCH_W_MIN = 60; // 拖拽硬下限（再窄即进入"将收起"区）
const SEARCH_W_COLLAPSE = 100; // 松手时宽度 < 此值 → 收起搜索
const SEARCH_W_MAX = 520;

/** 统一拖拽光标的最小接口（useResizeCursor() 的 start/move/stop） */
export interface ResizeCursorControls {
  start: (x: number, y: number) => void;
  move: (x: number, y: number) => void;
  stop: () => void;
}

export function useDiffSearch(args: {
  leftRows: LeftRow[];
  rightRows: RightRow[];
  leftRefs: MutableRefObject<Map<number, HTMLDivElement>>;
  rightRefs: MutableRefObject<Map<number, HTMLDivElement>>;
  leftPane: RefObject<HTMLDivElement>;
  rightPane: RefObject<HTMLDivElement>;
  isMd: boolean;
  previewL: boolean;
  previewR: boolean;
  resizeCursor: ResizeCursorControls;
}) {
  const { leftRows, rightRows, leftRefs, rightRefs, leftPane, rightPane, isMd, previewL, previewR, resizeCursor } = args;

  // diff 内搜索（右栏 = 当前内容）
  const [dSearch, setDSearch] = useState('');
  const [dSearchActive, setDSearchActive] = useState(false);
  const [dMatchIdx, setDMatchIdx] = useState(0);
  // 左栏搜索（原版内容），独立于右栏搜索
  const [dSearchL, setDSearchL] = useState('');
  const [dSearchLActive, setDSearchLActive] = useState(false);
  const [dMatchLIdx, setDMatchLIdx] = useState(0);
  /** 搜索框宽度（左右各自独立；右边缘拖拽调整，鼠标松开落盘）。
   *  往左拖窄过阈值 = 松手收起搜索（拖动中显示提示）；收起不落盘，下次展开恢复收起前的宽度 */
  const readSearchW = (key: string) => {
    const saved = Number(localStorage.getItem(key));
    return Number.isFinite(saved) && saved >= SEARCH_W_MIN && saved <= SEARCH_W_MAX ? saved : SEARCH_W_DEFAULT;
  };
  const [dSearchWL, setDSearchWL] = useState(() => readSearchW(SEARCH_W_KEY_L));
  const [dSearchWR, setDSearchWR] = useState(() => readSearchW(SEARCH_W_KEY_R));
  /** 拖拽中的"将收起"提示归属哪一栏（''=无） */
  const [collapseHint, setCollapseHint] = useState<'' | 'L' | 'R'>('');
  const wRefL = useRef(dSearchWL);
  wRefL.current = dSearchWL;
  const wRefR = useRef(dSearchWR);
  wRefR.current = dSearchWR;
  const dResizeRef = useRef<{ side: 'L' | 'R'; startX: number; startW: number } | null>(null);
  /** 右边缘拖拽：左右移动调宽；拖窄过阈值时显示"将收起"提示、松手收起（宽度还原为拖动前的值）。
   *  拖拽期间隐藏系统光标、由应用内图标跟随 */
  const onDSearchResizeDown = (side: 'L' | 'R') => (e: ReactMouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startW = side === 'L' ? wRefL.current : wRefR.current;
    dResizeRef.current = { side, startX: e.clientX, startW };
    resizeCursor.start(e.clientX, e.clientY);
    const onMove = (ev: MouseEvent) => {
      resizeCursor.move(ev.clientX, ev.clientY);
      const d = dResizeRef.current;
      if (!d) return;
      const w = Math.min(SEARCH_W_MAX, Math.max(SEARCH_W_MIN, d.startW + (ev.clientX - d.startX)));
      if (d.side === 'L') {
        wRefL.current = w;
        setDSearchWL(w);
      } else {
        wRefR.current = w;
        setDSearchWR(w);
      }
      setCollapseHint(w < SEARCH_W_COLLAPSE ? d.side : '');
    };
    const onUp = () => {
      const d = dResizeRef.current;
      dResizeRef.current = null;
      resizeCursor.stop();
      setCollapseHint('');
      if (!d) return;
      const w = d.side === 'L' ? wRefL.current : wRefR.current;
      if (w < SEARCH_W_COLLAPSE) {
        // 拖窄过阈值：收起（宽度还原为拖动前的值、不落盘——下次展开还是收起前的宽度）
        if (d.side === 'L') {
          wRefL.current = d.startW;
          setDSearchWL(d.startW);
          setDSearchLActive(false);
        } else {
          wRefR.current = d.startW;
          setDSearchWR(d.startW);
          setDSearchActive(false);
        }
      } else {
        localStorage.setItem(d.side === 'L' ? SEARCH_W_KEY_L : SEARCH_W_KEY_R, String(w));
      }
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

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
    if (isMd && previewR) {
      const p = rightPane.current;
      if (p) p.scrollTop = (next / Math.max(1, dMatches.length)) * (p.scrollHeight - p.clientHeight);
      return;
    }
    rightRefs.current.get(dMatches[next]!)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [dMatches, dMatchIdx, previewR, isMd, rightPane, rightRefs]);

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
    if (isMd && previewL) {
      const p = leftPane.current;
      if (p) p.scrollTop = (next / Math.max(1, dMatchesL.length)) * (p.scrollHeight - p.clientHeight);
      return;
    }
    leftRefs.current.get(dMatchesL[next]!)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [dMatchesL, dMatchLIdx, previewL, isMd, leftPane, leftRefs]);

  return {
    dSearch,
    setDSearch,
    dSearchActive,
    setDSearchActive,
    dMatchIdx,
    setDMatchIdx,
    dMatches,
    goNextDMatch,
    dSearchL,
    setDSearchL,
    dSearchLActive,
    setDSearchLActive,
    dMatchLIdx,
    setDMatchLIdx,
    dMatchesL,
    goNextLMatch,
    dSearchWL,
    dSearchWR,
    collapseHint,
    onDSearchResizeDown,
  };
}

export type DiffSearchApi = ReturnType<typeof useDiffSearch>;
