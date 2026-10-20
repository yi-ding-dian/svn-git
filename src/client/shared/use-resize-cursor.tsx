/** 分隔条拖拽的统一光标：拖拽时隐藏系统光标，显示应用内绘制的 SVG 图标。
 *
 *  所有"拖动调整尺寸"的分隔条共用（侧栏、历史栏、差异栏、搜索框等），保证手感与外观一致；
 *  弹窗 8 方向缩放、文件拖拽、工具栏按钮排序不属于调整尺寸，不套用。
 *
 *  用法：
 *    const { ghostRef, start, move, stop } = useResizeCursor();
 *    onMouseDown: start(e.clientX, e.clientY)
 *    onMouseMove: move(ev.clientX, ev.clientY)
 *    onMouseUp:   stop()
 *    渲染一次 <ResizeCursor ghostRef={ghostRef} />（fixed 定位，放哪个组件里都行） */
import React, { useCallback, useRef } from 'react';
import { IconResizeHorizontal } from '../ui/icons.js';

export function useResizeCursor() {
  const ghostRef = useRef<HTMLSpanElement | null>(null);

  const move = useCallback((x: number, y: number) => {
    const g = ghostRef.current;
    if (!g) return;
    // 24×24 浮层居中压在鼠标点：图标与分隔条上的手柄完全一致，按下时不会"跳"
    g.style.display = 'flex';
    g.style.left = `${x - 12}px`;
    g.style.top = `${y - 12}px`;
  }, []);

  const start = useCallback((x: number, y: number) => {
    // 整页强制 cursor:none（否则移到按钮上会变回 pointer），并禁选中
    document.body.classList.add('resizing');
    move(x, y);
  }, [move]);

  const stop = useCallback(() => {
    document.body.classList.remove('resizing');
    const g = ghostRef.current;
    if (g) g.style.display = 'none';
  }, []);

  return { ghostRef, start, move, stop };
}

/** 跟随鼠标的图标浮层；每个使用 useResizeCursor 的组件渲染一次即可 */
export function ResizeCursor({ ghostRef }: { ghostRef: React.MutableRefObject<HTMLSpanElement | null> }) {
  return (
    <span ref={ghostRef} className="resize-ghost" aria-hidden="true">
      <IconResizeHorizontal size={14} />
    </span>
  );
}
