/** 局域网共享配置（固定菜单项）：仅本机显示（远程访问只读，且配置接口只允许本机调用）。 */
import React from 'react';
import { t } from '../../../../../shared/i18n/index.js';
import { IconShare } from '../../../../ui/icons.js';
import type { FixedMenuEntry } from '../types.js';

export function shareConfigEntry(ctx: { closeMenu: () => void; openShare: () => void }): FixedMenuEntry {
  return {
    icon: <IconShare size={14} />,
    label: t('share.title'),
    title: t('share.title'),
    action: () => {
      ctx.closeMenu();
      ctx.openShare();
    },
  };
}
