/** 关于（固定菜单项）：有新版本时标签后显示红点（用户明确：关于后面标出来）。 */
import React from 'react';
import { t } from '../../../../../shared/i18n/index.js';
import { IconInfo } from '../../../../ui/icons.js';
import type { FixedMenuEntry } from '../types.js';

export function aboutEntry(ctx: { updateVersion: string | null; openAbout: () => void }): FixedMenuEntry {
  return {
    icon: <IconInfo />,
    label: t('shell.about.title'),
    dot: ctx.updateVersion !== null,
    title: ctx.updateVersion !== null
      ? t('shell.about.updateAvailable', { version: ctx.updateVersion })
      : t('shell.about.menuTitle'),
    action: ctx.openAbout,
  };
}
