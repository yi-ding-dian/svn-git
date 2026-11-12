/** 系统应用菜单集成（固定菜单项，仅 AppImage 显示）：
 *  安装 = 生成系统应用菜单条目（.desktop + 图标）；卸载 = 删除该条目。 */
import React from 'react';
import { post } from '../../../../shared/api.js';
import { t } from '../../../../../shared/i18n/index.js';
import { IconFolder } from '../../../../ui/icons.js';
import type { FixedMenuEntry } from '../types.js';

export function systemAppMenuEntry(ctx: {
  closeMenu: () => void;
  installed: boolean;
  onToast: (m: string, err?: boolean) => void;
  /** 安装/卸载成功或失败后重查状态（宿主传 get.appMenu） */
  onChanged: () => void;
}): FixedMenuEntry {
  const { installed } = ctx;
  return {
    icon: <IconFolder />,
    label: installed ? t('shell.appMenu.uninstall') : t('shell.appMenu.install'),
    title: installed
      // 撤销集成：删除系统应用菜单里本工具条目（.desktop 与图标）
      ? t('shell.appMenu.uninstallTitle')
      // 生成系统应用菜单条目（.desktop + 图标），之后可从系统左上角菜单直接启动本工具（可卸载）
      : t('shell.appMenu.installTitle'),
    action: () => {
      ctx.closeMenu();
      void (installed ? post.appMenuUninstall() : post.appMenuInstall())
        .then((r) => ctx.onToast(r.message, !r.ok))
        .catch((e: Error) => ctx.onToast(e.message, true))
        .finally(ctx.onChanged);
    },
  };
}
