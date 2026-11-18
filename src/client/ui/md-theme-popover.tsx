/** md 阅读主题气泡：贴按钮弹出，越界回退视口内（与全局主题气泡同一套 .ctx-menu/.theme-chip 样式）。
 *  从 shared/md-theme 拆出——shared 只放纯逻辑，含 JSX 的通用部件归 ui。 */
import React, { useEffect, useRef, useState } from 'react';
import { t } from '../../shared/i18n/index.js';
import { MD_THEMES, type MdTheme } from '../shared/md-theme.js';

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

  const chip = (th: MdTheme) => (
    <button
      key={th.key}
      className={`theme-chip ${props.current === th.key ? 'active' : ''}`}
      title={t(th.nameKey)}
      onClick={() => props.onPick(th.key)}
    >
      <span
        className="theme-dot"
        style={th.group === 'follow' ? { background: 'var(--bg)', borderColor: 'var(--accent)' } : { background: th.bg, borderColor: th.accent }}
      />
      <span className="theme-chip-name">{t(th.nameKey)}</span>
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
        {/* md 阅读主题 */}
        <div className="theme-pop-group">{t('fs.mdTheme.popTitle')}</div>
        {/* 「跟随界面」单独一行占满：3 列网格里名字会被截成「跟随…」 */}
        <div className="theme-pop-grid" style={{ gridTemplateColumns: '1fr' }}>
          {MD_THEMES.filter((th) => th.group === 'follow').map(chip)}
        </div>
        {/* 浅色 */}
        <div className="theme-pop-group">{t('look.group.light')}</div>
        <div className="theme-pop-grid">{MD_THEMES.filter((th) => th.group === 'light').map(chip)}</div>
        {/* 深色 */}
        <div className="theme-pop-group">{t('look.group.dark')}</div>
        <div className="theme-pop-grid">{MD_THEMES.filter((th) => th.group === 'dark').map(chip)}</div>
      </div>
    </>
  );
}
