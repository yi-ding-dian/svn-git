/** 文件内容区的「复制所选内容 / 复制全部内容」右键菜单与剪贴板小工具。
 *
 *  文件预览（filesystem/preview-pane）与统一差异（ui/diff-render）共用——两处判断"选区是否在内容里"
 *  的规则必须一致，否则同一段文字在两个视图里的菜单项会不一样。
 *
 *  - 有选区：菜单 =「复制所选内容」+「复制全部内容」
 *  - 无选区：菜单 =「复制全部内容」
 *  - 复制结果统一用全局 toast 提示（成功「已复制」/ 失败「复制失败」）
 */
import React, { useCallback, useRef, useState } from 'react';
import { ContextMenu, type CtxMenuItem } from '../ui/context-menu.js';
import { IconCopy } from '../ui/icons.js';
import { t } from '../../shared/i18n/index.js';

/** 提示回调（与 app.tsx 的 showToast 同签名：msg, err?） */
export type CopyToast = (msg: string, err?: boolean) => void;

/** 写入剪贴板并提示结果。空文本不复制（避免"提示已复制但剪贴板是空的"） */
export function copyText(text: string, onToast?: CopyToast): void {
  if (!text) return;
  void navigator.clipboard
    ?.writeText(text)
    .then(() => onToast?.(t('common.copied')))
    .catch(() => onToast?.(t('common.copyFailed'), true));
}

/** 选区完全落在 el 内且非空 → 返回选中文本；否则空串（右键在内容外 / 只是光标） */
function selectedTextInside(el: HTMLElement): string {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return '';
  const { anchorNode, focusNode } = sel;
  if (!anchorNode || !focusNode) return '';
  if (!el.contains(anchorNode) || !el.contains(focusNode)) return '';
  return sel.toString();
}

/** 内容区右键菜单：openMenu 直接挂到内容的 onContextMenu；menuElement 渲染在组件里（fixed 定位）。
 *  getFullText 在**点击菜单项时**才调用，拿到的永远是最新内容（预览换文件/重新加载后不会复制旧文本）。 */
export function useContentCopyMenu(getFullText: () => string, onToast?: CopyToast) {
  const [menu, setMenu] = useState<{ x: number; y: number; items: CtxMenuItem[] } | null>(null);
  /** 右键按下瞬间的选区：浏览器会在 mousedown 默认动作里清掉"点在外面"的选区，
   *  那样右键时就分不清"用户刚选过文字"了——先记下来，菜单打开时再用。 */
  const selectionAtRightDown = useRef('');
  const captureSelection = useCallback((e: React.MouseEvent) => {
    if (e.button !== 2) return;
    selectionAtRightDown.current = selectedTextInside(e.currentTarget as HTMLElement);
  }, []);
  const openMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const selected = selectedTextInside(e.currentTarget as HTMLElement) || selectionAtRightDown.current;
      selectionAtRightDown.current = '';
      const items: CtxMenuItem[] = [];
      if (selected) {
        // 复制所选内容
        items.push({ icon: <IconCopy />, label: t('common.copySelection'), action: () => copyText(selected, onToast) });
      }
      // 复制全部内容
      items.push({ icon: <IconCopy />, label: t('common.copyAllContent'), action: () => copyText(getFullText(), onToast) });
      setMenu({ x: e.clientX, y: e.clientY, items });
    },
    [getFullText, onToast],
  );
  return {
    openMenu,
    captureSelection,
    menuElement: menu ? (
      <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} mask />
    ) : null,
  };
}
