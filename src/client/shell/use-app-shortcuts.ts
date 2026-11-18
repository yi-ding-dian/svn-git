/** App 的全局快捷键与缩放提示：从 app.tsx 原样抽出。
 *
 *  - Ctrl+` 打开终端（已有弹窗时不响应）
 *  - Ctrl+滚轮：界面缩放 / 内容区文字缩放（60ms 节流，提示跟随鼠标）
 *  - Ctrl+0 复位缩放、Ctrl+A 在内容区全选
 *  - F5 拦截整页重载，改为重新扫描当前项目
 *
 *  useState / useRef / useEffect 的依赖数组与清理函数保持与原组件一致。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type React from 'react';
import {
  ZOOM_DEFAULT,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_STEP,
  CONTENT_ZOOM_DEFAULT,
  CONTENT_ZOOM_MAX,
  CONTENT_ZOOM_MIN,
} from '../appearance/use-appearance.js';
import type { Modal } from './modal-types.js';
import { t } from '../../shared/i18n/index.js';

export interface ZoomTip {
  x: number;
  y: number;
  percent: number;
  content: boolean;
}

export function useAppShortcuts(opts: {
  zoom: number;
  setZoom: (n: number) => void;
  contentZoom: number;
  setContentZoom: (n: number) => void;
  mouseRef: React.MutableRefObject<{ x: number; y: number }>;
  refresh: () => void;
  showToast: (msg: string, err?: boolean, quick?: boolean, durationMs?: number) => void;
  setModal: React.Dispatch<React.SetStateAction<Modal>>;
}) {
  const { zoom, setZoom, contentZoom, setContentZoom, mouseRef, refresh, showToast, setModal } = opts;

  // Ctrl+` 打开终端（跟 VSCode 一致）。用 e.code === 'Backquote' 而不是 e.key ——
  // 后者随键盘布局变（中文输入法/非美式布局下 e.key 未必是反引号）。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.code === 'Backquote') {
        // 已有弹窗打开时不响应：直接 setModal 会把当前弹窗替换掉，未提交的注释等状态随卸载丢失
        if (document.querySelector('.modal-mask')) return;
        e.preventDefault();
        setModal({ type: 'terminal' });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setModal]);

  /** 缩放提示（Ctrl+滚轮 / Ctrl+0）：跟随鼠标，停止滚动后消失；content = 缩放的是文件内容 */
  const [zoomTip, setZoomTip] = useState<ZoomTip | null>(null);
  const zoomTipTimerRef = useRef<number | null>(null);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const contentZoomRef = useRef(contentZoom);
  contentZoomRef.current = contentZoom;
  const showZoomTip = useCallback((x: number, y: number, percent: number, content: boolean) => {
    setZoomTip({ x, y, percent, content });
    // 滚动过程中不断重置计时器：一直在滚就一直显示，松手约 0.9 秒后消失
    if (zoomTipTimerRef.current !== null) window.clearTimeout(zoomTipTimerRef.current);
    zoomTipTimerRef.current = window.setTimeout(() => setZoomTip(null), 900);
  }, []);
  useEffect(() => {
    return () => {
      if (zoomTipTimerRef.current !== null) window.clearTimeout(zoomTipTimerRef.current);
    };
  }, []);
  // Ctrl+滚轮：鼠标在文件内容区（预览正文 / 差异正文）时只缩放内容文字、界面不动；
  // 在界面其它地方缩放界面文字（±10%/格）。触摸板捏合也会发 ctrl+wheel 且事件很密，
  // 用 60ms 节流避免一次手势直接冲到上限；preventDefault 掉页面滚动和浏览器自带的缩放。
  useEffect(() => {
    let lastStepAt = 0;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey || e.deltaY === 0) return;
      e.preventDefault();
      const now = performance.now();
      if (now - lastStepAt < 60) return;
      lastStepAt = now;
      const step = e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP;
      const el = e.target instanceof Element ? e.target : null;
      if (el?.closest('[data-content-zoom]')) {
        const cur = contentZoomRef.current;
        const next = Math.min(CONTENT_ZOOM_MAX, Math.max(CONTENT_ZOOM_MIN, cur + step));
        if (next !== cur) setContentZoom(next);
        showZoomTip(e.clientX, e.clientY, next, true);
        return;
      }
      const cur = zoomRef.current;
      const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, cur + step));
      if (next !== cur) setZoom(next);
      showZoomTip(e.clientX, e.clientY, next, false);
    };
    window.addEventListener('wheel', onWheel, { passive: false });
    return () => window.removeEventListener('wheel', onWheel);
  }, [setZoom, setContentZoom, showZoomTip]);
  // 内容区快捷键：
  //  - Ctrl+0：把鼠标所在位置的缩放复原到 100%（内容区复原内容缩放，其它地方复原界面缩放）
  //  - Ctrl+A：鼠标在文件内容区时全选该内容（统一差异里 = 所有文件的正文），不选界面文字；
  //    输入框 / 编辑区里保持原生行为（选它们自己的内容）。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyA') {
        const el = e.target as HTMLElement | null;
        if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
        const { x, y } = mouseRef.current;
        const under = document.elementFromPoint(x, y) as Element | null;
        // 鼠标不在内容区时退一步看当前选区：刚点选过文字、鼠标稍微移开也还能全选
        const sel = window.getSelection();
        const anchor = sel?.anchorNode ?? null;
        const anchorEl = anchor
          ? anchor.nodeType === Node.ELEMENT_NODE
            ? (anchor as Element)
            : anchor.parentElement
          : null;
        const scope = under?.closest('[data-content-zoom]') ?? anchorEl?.closest('[data-content-zoom]');
        if (!scope) return;
        e.preventDefault();
        const range = document.createRange();
        range.selectNodeContents(scope);
        sel?.removeAllRanges();
        sel?.addRange(range);
        return;
      }
      if (!((e.ctrlKey || e.metaKey) && (e.code === 'Digit0' || e.code === 'Numpad0'))) return;
      e.preventDefault();
      const { x, y } = mouseRef.current;
      const under = document.elementFromPoint(x, y) as Element | null;
      if (under?.closest('[data-content-zoom]')) {
        setContentZoom(CONTENT_ZOOM_DEFAULT);
        showZoomTip(x, y, CONTENT_ZOOM_DEFAULT, true);
      } else {
        setZoom(ZOOM_DEFAULT);
        showZoomTip(x, y, ZOOM_DEFAULT, false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setZoom, setContentZoom, showZoomTip, mouseRef]);

  // F5 刷新：拦掉浏览器整页重载，改为重新扫描当前项目（与顶栏「刷新」同一动作）。
  // 不重载页面 → 输入框内容、弹窗和视图状态都不会丢；轻提示 1.5 秒确认已生效。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'F5' || e.repeat) return;
      e.preventDefault();
      refresh();
      showToast(t('common.refreshed'), false, true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [refresh, showToast]);

  return { zoomTip };
}
