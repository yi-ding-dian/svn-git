/** FsView 的右键菜单挂载/关闭逻辑：从 index.tsx 原样抽出。
 *
 *  - 菜单状态（位置 + items）与右键选中锁定
 *  - 延迟关闭计时（鼠标移出条目/菜单后 250ms 关；回到原条目或移入菜单则取消）
 *  - 点击其他地方 / 滚动 → 立即关闭
 *  - ctxPos：菜单尺寸估算，超出屏幕右/下边界时上移/左移
 *
 *  菜单内容（buildRowItems / buildMultiItems / buildBlankItems）仍由主组件生成。
 */
import { useEffect, useRef, useState } from 'react';
import type React from 'react';
import type { CtxMenuItem } from '../ui/context-menu.js';

export interface CtxState {
  x: number;
  y: number;
  items: CtxMenuItem[];
}

export function useFsContextMenu() {
  const [ctx, setCtx] = useState<CtxState | null>(null);
  // 右键选中锁定：右键后条目保持选中（hover 不清），点击其他地方/菜单关闭才取消
  const [ctxLocked, setCtxLocked] = useState(false);
  // 菜单随悬停消失：延迟关闭计时器 + 右键的条目 rel（空白右键为 null，用于判断鼠标是否回到原条目）
  const ctxHideTimer = useRef<ReturnType<typeof setTimeout>>();
  const ctxRelRef = useRef<string | null>(null);

  // 关闭右键菜单（同时解锁右键选中锁定，并清空"原右键条目"记录，避免残留误判）
  const closeCtx = () => {
    if (ctxHideTimer.current) {
      clearTimeout(ctxHideTimer.current);
      ctxHideTimer.current = undefined;
    }
    ctxRelRef.current = null;
    setCtx(null);
    setCtxLocked(false);
  };
  // 延迟关闭：鼠标离开条目/菜单后短暂等待（给鼠标移入菜单留时间），移入菜单或回到原条目则取消
  const closeCtxSoon = () => {
    if (!ctx) return; // 菜单已关（渲染时闭包），无需再启动计时
    if (ctxHideTimer.current) return; // 已有计时，不重置（避免条目间快速移动反复刷新）
    ctxHideTimer.current = setTimeout(closeCtx, 250);
  };
  const cancelCtxClose = () => {
    if (ctxHideTimer.current) {
      clearTimeout(ctxHideTimer.current);
      ctxHideTimer.current = undefined;
    }
  };
  // 点击其他地方 / 滚动 → 立即关闭（同时解锁）
  useEffect(() => {
    if (!ctx) return;
    window.addEventListener('click', closeCtx);
    window.addEventListener('scroll', closeCtx, true);
    return () => {
      window.removeEventListener('click', closeCtx);
      window.removeEventListener('scroll', closeCtx, true);
      cancelCtxClose();
    };
  }, [ctx]);

  /** 菜单定位：动态估算菜单尺寸，超出屏幕右/下边界时上移/左移，保证完整显示 */
  const ctxPos = (e: React.MouseEvent, itemCount: number) => {
    const itemH = 36; // 每项高度（含分隔线/间距）估算
    const h = itemCount * itemH + 12;
    const w = 220;
    const x = Math.max(4, Math.min(e.clientX, window.innerWidth - w - 8));
    const y = Math.max(4, Math.min(e.clientY, window.innerHeight - h - 8));
    return { x, y };
  };

  return { ctx, setCtx, ctxLocked, setCtxLocked, ctxHideTimer, ctxRelRef, closeCtx, closeCtxSoon, cancelCtxClose, ctxPos };
}
