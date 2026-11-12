/** 环境检测（固定菜单项）：查看 SVN / Git 的安装状态与版本；缺失时可一键安装。 */
import { t } from '../../../../../shared/i18n/index.js';
import type { FixedMenuEntry } from '../types.js';

export function environmentCheckEntry(ctx: { closeMenu: () => void; openEnvironment: () => void }): FixedMenuEntry {
  return {
    icon: '🔍',
    label: t('shell.tool.envCheck'),
    title: t('shell.tool.envCheckTitle'),
    action: () => {
      ctx.closeMenu();
      ctx.openEnvironment();
    },
  };
}
