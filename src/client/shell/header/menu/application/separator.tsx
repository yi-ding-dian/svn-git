/** 分隔符（固定菜单项）：按住拖到工具栏任意位置插入分隔线；已插入的分隔符也可拖动/拖到 ⋯ 删除。 */
import React from 'react';
import { t } from '../../../../../shared/i18n/index.js';
import type { FixedMenuEntry } from '../types.js';

export function separatorEntry(ctx: {
  closeMenu: () => void;
  newSeparatorId: () => string;
  beginDrag: (key: string) => (e: React.MouseEvent) => void;
  onToast: (m: string) => void;
}): FixedMenuEntry {
  return {
    icon: '|',
    label: t('shell.toolbar.sep'),
    title: t('shell.toolbar.sepInsertTitle'),
    onMouseDown: ctx.beginDrag(ctx.newSeparatorId()),
    action: () => {
      ctx.closeMenu();
      // 按住「分隔符」拖到工具栏即可插入
      ctx.onToast(t('shell.toolbar.sepHint'));
    },
  };
}
