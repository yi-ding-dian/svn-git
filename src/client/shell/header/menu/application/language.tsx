/** 语言（固定菜单项，不参与拖拽定制）：工具栏按钮语义是"点击即执行"，
 *  而语言是"展开选一个"，拖过去会变成语义怪异的按钮。 */
import React from 'react';
import { LANGS, t, type Lang } from '../../../../../shared/i18n/index.js';
import { IconGlobe, IconOk } from '../../../../ui/icons.js';
import type { FixedMenuEntry } from '../types.js';

export function languageEntry(ctx: { lang: Lang; changeLang: (key: Lang) => void }): FixedMenuEntry {
  return {
    icon: <IconGlobe />,
    label: t('lang.title'),
    title: t('lang.hint'),
    noArrow: true, // 不显示右侧 ▶（用户要求）：展开选择是这一项的唯一用途，箭头多余
    submenu: LANGS.map((l) => ({
      icon: ctx.lang === l.key ? <IconOk /> : undefined,
      label: t(l.labelKey),
      action: () => ctx.changeLang(l.key),
    })),
  };
}
