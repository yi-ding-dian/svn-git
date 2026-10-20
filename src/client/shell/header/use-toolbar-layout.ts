/** 工具栏布局状态与拖拽定制：按钮顺序持久化在 localStorage，拖拽用手动 mousedown
 *  （不依赖 HTML5 DnD：真实/模拟环境都可靠）。与渲染分离，AppHeader 只管画。 */
import type React from 'react';
import { useEffect, useRef, useState } from 'react';
import { DEFAULT_LAYOUT, LAYOUT_KEY, isSepItem, loadLayout, type ToolbarLayout } from './toolbar-tools.js';

export function useToolbarLayout(closeMenu: () => void) {
  // 工具栏布局（默认 → localStorage；拖拽即时更新）
  const [layout, setLayout] = useState<ToolbarLayout>(loadLayout);
  useEffect(() => {
    try {
      localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout));
    } catch {
      /* 存储失败忽略 */
    }
  }, [layout]);

  // 拖拽状态（手动 mousedown 实现）：
  // 当前拖的项（按钮 key 或分隔符唯一 id）+ 插入位置（参考项 id；null=末尾）+ ⋯ 高亮 + ghost 位置
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [dropBefore, setDropBefore] = useState<string | null | undefined>(undefined);
  const [moreDrop, setMoreDrop] = useState(false);
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null);
  // 插入位置的实时值（mousemove 写入；mouseup 读取——State 异步会读到闭包旧值，必须用 ref）
  const dropBeforeRef = useRef<string | null | undefined>(undefined);
  // 菜单内重排：落点参考项（hidden 数组中该项之前）+ 其 ref
  const [dropMenuBefore, setDropMenuBefore] = useState<string | null | undefined>(undefined);
  const dropMenuBeforeRef = useRef<string | null | undefined>(undefined);

  /** drop 落点：移到工具栏（beforeKey=插在哪个项（按钮/分隔符唯一 id）之前；null=末尾）。项 id 全局唯一，无索引偏移 */
  const moveToShown = (item: string, beforeKey: string | null) => {
    setLayout((l) => {
      const shown = l.shown.filter((x) => x !== item);
      let idx = shown.indexOf(beforeKey ?? '');
      if (beforeKey === null || idx < 0) idx = shown.length;
      shown.splice(Math.min(idx, shown.length), 0, item);
      return { shown, hidden: isSepItem(item) ? l.hidden : l.hidden.filter((k) => k !== item) };
    });
  };
  /** drop 落点：移入 ⋯ 菜单（分隔符无隐藏语义，直接删除；按钮收进菜单） */
  const moveToHidden = (item: string) => {
    setLayout((l) =>
      isSepItem(item)
        ? { shown: l.shown.filter((x) => x !== item), hidden: l.hidden }
        : { shown: l.shown.filter((x) => x !== item), hidden: [...l.hidden.filter((k) => k !== item), item] }
    );
  };
  /** 菜单内部重排：hidden 数组中移到 beforeKey（唯一 id）之前；null=末尾 */
  const moveHiddenOrder = (item: string, beforeKey: string | null) => {
    setLayout((l) => {
      const hidden = l.hidden.filter((k) => k !== item);
      const idx = hidden.indexOf(beforeKey ?? '');
      hidden.splice(idx < 0 ? hidden.length : idx, 0, item);
      return { shown: l.shown, hidden };
    });
  };

  /** 手动拖拽开始（mousedown，item=按钮 key 或分隔符唯一 id）：
   *  window 级 mousemove 更新插入线/ghost，mouseup 判定落点（工具栏 / ⋯ / 取消）
   *  移动距离 < 4px 视为普通点击：不动布局（onClick 正常执行） */
  const beginDrag = (item: string) => (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const sx = e.clientX;
    const sy = e.clientY;
    setDragKey(item);
    setDragPos({ x: e.clientX, y: e.clientY });
    const onMove = (ev: MouseEvent) => {
      // 菜单内部重排：鼠标在菜单面板内 → 落点参考项（纵向：该项中心之上→插其前）
      const menu = document.querySelector<HTMLElement>('.ctx-menu');
      const menuR = menu?.getBoundingClientRect();
      if (menuR && ev.clientX >= menuR.left && ev.clientX <= menuR.right && ev.clientY >= menuR.top && ev.clientY <= menuR.bottom) {
        const items = [...document.querySelectorAll<HTMLElement>('.ctx-menu [data-menu-key]')];
        let mBefore: string | null = null;
        for (const el of items) {
          const r = el.getBoundingClientRect();
          if (ev.clientY < r.top + r.height / 2) {
            mBefore = el.dataset.menuKey ?? null;
            break;
          }
        }
        dropMenuBeforeRef.current = mBefore;
        setDropMenuBefore(mBefore);
        setDropBefore(undefined);
        dropBeforeRef.current = undefined;
        setMoreDrop(false);
        setDragPos({ x: ev.clientX, y: ev.clientY });
        return;
      }
      // 工具栏插入线：按鼠标与各元素（按钮+分隔符，data-item-key 即唯一 id）中点位置
      const els = [...document.querySelectorAll<HTMLElement>('[data-tool-bar] [data-item-key]')];
      let beforeKey: string | null = null;
      for (const el of els) {
        const r = el.getBoundingClientRect();
        if (ev.clientX < r.left + r.width / 2) {
          beforeKey = el.dataset.itemKey ?? null;
          break;
        }
      }
      dropBeforeRef.current = beforeKey;
      setDropBefore(beforeKey);
      setDropMenuBefore(undefined);
      dropMenuBeforeRef.current = undefined;
      // ⋯ 按钮（无 data-tool-key 的 tool-btn）悬停高亮
      const more = document.querySelector<HTMLElement>('.header button.tool-btn:not([data-tool-key])');
      const inMore = !!more && (() => {
        const r = more.getBoundingClientRect();
        return ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom;
      })();
      setMoreDrop(inMore);
      setDragPos({ x: ev.clientX, y: ev.clientY });
    };
    const onUp = (ev: MouseEvent) => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      // 未移动（<4px）：普通点击，布局不动（onClick 事件照常执行）
      const moved = Math.hypot(ev.clientX - sx, ev.clientY - sy) > 4;
      if (moved) {
        const menu = document.querySelector<HTMLElement>('.ctx-menu');
        const menuR = menu?.getBoundingClientRect();
        const inMenu = !!menuR && ev.clientX >= menuR.left && ev.clientX <= menuR.right && ev.clientY >= menuR.top && ev.clientY <= menuR.bottom;
        if (inMenu) {
          // 菜单内部重排（只动顺序；落点在目标项之前）
          moveHiddenOrder(item, dropMenuBeforeRef.current ?? null);
        } else {
          const more = document.querySelector<HTMLElement>('.header button.tool-btn:not([data-tool-key])');
          const inMore = !!more && (() => {
            const r = more.getBoundingClientRect();
            return ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom;
          })();
          if (inMore) {
            moveToHidden(item);
            closeMenu(); // 从菜单拖入工具栏后收起菜单（拖出行为的自然完成）
          } else {
            const bar = document.querySelector<HTMLElement>('.header [data-tool-bar]');
            const r = bar?.getBoundingClientRect();
            const inBar = !!r && ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom;
            if (inBar) {
              moveToShown(item, dropBeforeRef.current ?? null);
              closeMenu();
            }
            // 其他位置：取消（保持原布局）
          }
        }
      }
      setDragKey(null);
      setDragPos(null);
      setDropBefore(undefined);
      dropBeforeRef.current = undefined;
      setDropMenuBefore(undefined);
      dropMenuBeforeRef.current = undefined;
      setMoreDrop(false);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  /** 恢复默认布局（⋯ 菜单「恢复默认布局」） */
  const resetLayout = () => {
    try { localStorage.removeItem(LAYOUT_KEY); } catch { /* ignore */ }
    setLayout({ shown: [...DEFAULT_LAYOUT.shown], hidden: [...DEFAULT_LAYOUT.hidden] });
  };

  return { layout, resetLayout, dragKey, dragPos, dropBefore, dropMenuBefore, moreDrop, beginDrag };
}
