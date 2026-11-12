/** 恢复默认布局（固定菜单项）：重置工具栏布局，按钮重新按默认顺序显示。 */
import { t } from '../../../../../shared/i18n/index.js';
import type { FixedMenuEntry } from '../types.js';

export function resetLayoutEntry(ctx: {
  closeMenu: () => void;
  resetLayout: () => void;
  onToast: (m: string) => void;
}): FixedMenuEntry {
  return {
    icon: '↺',
    label: t('shell.toolbar.reset'),
    title: t('shell.toolbar.resetTitle'),
    action: () => {
      ctx.closeMenu();
      ctx.resetLayout();
      // 已恢复默认布局
      ctx.onToast(t('shell.toolbar.resetDone'));
    },
  };
}
