/** 内置主题清单：顶栏主题气泡与侧边栏快捷圆点共用（header 域内数据，不依赖组件）。 */
import type { I18nKey } from '../../../shared/i18n/index.js';

/** 内置主题项（THEMES 的元素类型；theme-popover 的 chip 复用同一结构） */
export type ThemeDef = { key: string; nameKey: I18nKey; color: string; group: 'light' | 'dark' };

/** 内置主题清单。group 供主题气泡分组展示；color 是预览色块（取该主题的面板色）。
 *  前 5 套固定为侧边栏快捷圆点，其余全部在气泡里（见 sidebar.tsx 的 slice）。
 *  ⚠️ 存 `nameKey` 而非文案：模块顶层求值会冻在首次语言，渲染时才 t()（见 i18n/index.ts 头部说明）。 */
export const THEMES: ThemeDef[] = [
  // 浅色
  { key: 'light', nameKey: 'shell.theme.light', color: '#f6f8fa', group: 'light' },
  { key: 'warm', nameKey: 'shell.theme.warm', color: '#f3ede1', group: 'light' },
  { key: 'cool', nameKey: 'shell.theme.cool', color: '#e8eef5', group: 'light' },
  { key: 'lavender', nameKey: 'shell.theme.lavender', color: '#e8e2f7', group: 'light' },
  { key: 'mint', nameKey: 'shell.theme.mint', color: '#dcefe4', group: 'light' },
  { key: 'rose', nameKey: 'shell.theme.rose', color: '#f6e2e6', group: 'light' },
  { key: 'cream', nameKey: 'shell.theme.cream', color: '#f5edd8', group: 'light' },
  { key: 'sky', nameKey: 'shell.theme.sky', color: '#e1eefc', group: 'light' },
  { key: 'matcha', nameKey: 'shell.theme.matcha', color: '#e6efdc', group: 'light' },
  { key: 'lotus', nameKey: 'shell.theme.lotus', color: '#f9e4ea', group: 'light' },
  { key: 'mist', nameKey: 'shell.theme.mist', color: '#e8ecf0', group: 'light' },
  // 深色
  { key: 'night', nameKey: 'shell.theme.night', color: '#1f2228', group: 'dark' },
  { key: 'deepsea', nameKey: 'shell.theme.deepsea', color: '#161b22', group: 'dark' },
  { key: 'forest', nameKey: 'shell.theme.forest', color: '#17241d', group: 'dark' },
  { key: 'violet', nameKey: 'shell.theme.violet', color: '#231f33', group: 'dark' },
  { key: 'charcoal', nameKey: 'shell.theme.charcoal', color: '#25201b', group: 'dark' },
];

/** 侧边栏快捷圆点数量（其余主题在「…」气泡里选） */
export const THEME_PINNED = 5;
