/** md 阅读主题：只染 md 文档区，与界面主题（侧边栏那 16 套）互不影响。
 *
 *  - 「跟随界面」（默认）：不覆盖任何变量，文档跟界面主题走 —— 什么都没有改
 *  - 选了具体主题：把 6 个自选色交给 deriveThemeVars 推导出整套变量（含深色底自动换亮的
 *    代码高亮色），inline 打在预览的滚动容器上，只作用其子树
 *  - 选择持久化在 localStorage（svngit-mdtheme）；键失效自动回退「跟随界面」
 *
 *  为什么不用全局主题：读者常想让界面保持浅色、文档区单独用护眼绿/夜间（反过来也一样）。
 */
import React, { useEffect, useRef, useState } from 'react';
import { deriveThemeVars } from '../modals/theme-popover.js';

/** md 阅读主题 = 6 色（其余变量推导）。key='follow' 表示跟随界面主题 */
export interface MdTheme {
  key: string;
  name: string;
  group: 'follow' | 'light' | 'dark';
  bg: string;
  panel: string;
  border: string;
  text: string;
  dim: string;
  accent: string;
}

/** 内置 md 阅读主题（浅色 / 深色各几套阅读向配色，不做花哨色） */
export const MD_THEMES: MdTheme[] = [
  { key: 'follow', name: '跟随界面', group: 'follow', bg: '', panel: '', border: '', text: '', dim: '', accent: '' },
  // 浅色：白纸 / 暖黄 / 护眼绿 / 报纸灰
  { key: 'md-gh', name: '白纸', group: 'light', bg: '#ffffff', panel: '#f6f8fa', border: '#d0d7de', text: '#1f2328', dim: '#656d76', accent: '#0969da' },
  { key: 'md-parchment', name: '羊皮纸', group: 'light', bg: '#f8f1e0', panel: '#f1e8d4', border: '#ddcfb0', text: '#43382a', dim: '#82735c', accent: '#a0682a' },
  { key: 'md-eyecare', name: '护眼绿', group: 'light', bg: '#c9e8cd', panel: '#bfe2c4', border: '#a3d0aa', text: '#233629', dim: '#4f6f5b', accent: '#1c7a45' },
  { key: 'md-news', name: '报纸', group: 'light', bg: '#f4f2ee', panel: '#eae7e1', border: '#d3cec4', text: '#232323', dim: '#6b675f', accent: '#8a4b2a' },
  // 深色：夜间 / 暗夜蓝 / 高对比
  { key: 'md-night', name: '夜间', group: 'dark', bg: '#0d1117', panel: '#161b22', border: '#30363d', text: '#c9d1d9', dim: '#8b949e', accent: '#58a6ff' },
  { key: 'md-tokyo', name: '暗夜蓝', group: 'dark', bg: '#1a1b26', panel: '#1f2335', border: '#2f334d', text: '#c0caf5', dim: '#737aa2', accent: '#7aa2f7' },
  { key: 'md-contrast', name: '高对比', group: 'dark', bg: '#000000', panel: '#101010', border: '#3a3a3a', text: '#f5f5f5', dim: '#b0b0b0', accent: '#ffd400' },
];

const LS_KEY = 'svngit-mdtheme';

/** 当前 md 主题 key（localStorage 里的失效值回退「跟随界面」） */
export function loadMdTheme(): string {
  try {
    const k = localStorage.getItem(LS_KEY) ?? 'follow';
    return MD_THEMES.some((t) => t.key === k) ? k : 'follow';
  } catch {
    return 'follow';
  }
}

export function saveMdTheme(key: string) {
  try {
    localStorage.setItem(LS_KEY, key);
  } catch {
    /* ignore */
  }
}

/** key → 显示名（工具栏按钮回显当前主题用） */
export function mdThemeName(key: string): string {
  return MD_THEMES.find((t) => t.key === key)?.name ?? '跟随界面';
}

/** key → 打在预览容器上的 inline 变量；「跟随界面」返回 undefined（不覆盖）
 *  另外显式给容器 background/color：容器 CSS 本来就是 `background: var(--panel)`（差异视图要的），
 *  文档区要的是主题的页面色（--bg），且文字不能继续继承界面的色（深色文档 + 浅色界面会看不见字）。 */
export function mdThemeVars(key: string): React.CSSProperties | undefined {
  const t = MD_THEMES.find((x) => x.key === key);
  if (!t || t.group === 'follow') return undefined;
  return { ...deriveThemeVars(t), background: 'var(--bg)', color: 'var(--text)' } as unknown as React.CSSProperties;
}

/** 主题气泡：贴按钮弹出，越界回退视口内（与全局主题气泡同一套 .ctx-menu/.theme-chip 样式） */
export function MdThemePopover(props: { x: number; y: number; current: string; onPick: (key: string) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState({ left: props.x, top: props.y });

  useEffect(() => {
    if (!ref.current) return;
    const r = ref.current.getBoundingClientRect();
    let left = props.x;
    let top = props.y;
    if (left + r.width > window.innerWidth - 8) left = Math.max(8, window.innerWidth - r.width - 8);
    if (top + r.height > window.innerHeight - 8) top = Math.max(8, window.innerHeight - r.height - 8);
    setPos({ left, top });
  }, [props.x, props.y]);

  const chip = (t: MdTheme) => (
    <button
      key={t.key}
      className={`theme-chip ${props.current === t.key ? 'active' : ''}`}
      title={t.name}
      onClick={() => props.onPick(t.key)}
    >
      <span
        className="theme-dot"
        style={t.group === 'follow' ? { background: 'var(--bg)', borderColor: 'var(--accent)' } : { background: t.bg, borderColor: t.accent }}
      />
      <span className="theme-chip-name">{t.name}</span>
    </button>
  );

  return (
    <>
      <div
        style={{ position: 'fixed', inset: 0, zIndex: 299 }}
        onClick={props.onClose}
        onContextMenu={(e) => {
          e.preventDefault();
          props.onClose();
        }}
      />
      <div ref={ref} className="ctx-menu theme-pop" style={{ left: pos.left, top: pos.top }}>
        <div className="theme-pop-group">md 阅读主题</div>
        {/* 「跟随界面」单独一行占满：3 列网格里名字会被截成「跟随…」 */}
        <div className="theme-pop-grid" style={{ gridTemplateColumns: '1fr' }}>
          {MD_THEMES.filter((t) => t.group === 'follow').map(chip)}
        </div>
        <div className="theme-pop-group">浅色</div>
        <div className="theme-pop-grid">{MD_THEMES.filter((t) => t.group === 'light').map(chip)}</div>
        <div className="theme-pop-group">深色</div>
        <div className="theme-pop-grid">{MD_THEMES.filter((t) => t.group === 'dark').map(chip)}</div>
      </div>
    </>
  );
}
