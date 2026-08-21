/** 侧边栏：视图导航 + 最近项目列表（右键删除/设常用）+ 版本号 */
import React, { useState } from 'react';
import { IconClock, IconFolder } from './icons.js';
// import { IconDiff } from './icons.js'; // 差异入口隐藏，恢复时连同 NAV 项一起打开
import { ContextMenu } from './context-menu.js';
import { THEMES } from './header.js';
import type { HistoryItem } from './api.js';

/** 主视图类型（侧边栏导航目标） */
export type View = 'log' | 'diff' | 'browse';

export function Sidebar(props: {
  view: View;
  history: HistoryItem[];
  version?: string;
  /** 当前打开的仓库根：匹配的最近项目高亮选中，标明正在操作的项目 */
  currentRoot?: string | null;
  onNav: (v: View) => void;
  onOpenHistory: (h: { path: string }) => void;
  onRemoveHistory: (path: string) => void;
  /** 设置/取消常用项目（星号标记，启动时优先打开） */
  onSetFav: (path: string, fav: boolean) => void;
  /** 外观区：主题色块（位于最近项目上方；字体设置在顶栏 ⋯ 菜单） */
  theme: string;
  setTheme: (t: string) => void;
}) {
  // 最近项目右键菜单（设常用 / 删除 / 取消）
  const [rmMenu, setRmMenu] = useState<{ x: number; y: number; path: string; fav: boolean } | null>(null);

  const NAV = [
    { key: 'log' as View, label: '历史', icon: <IconClock size={16} /> },
    // 差异入口隐藏：提交弹窗双击文件/冲突界面仍可进入差异视图
    // { key: 'diff' as View, label: '差异', icon: <IconDiff size={16} /> },
    { key: 'browse' as View, label: '文件夹', icon: <IconFolder size={16} /> },
  ];

  return (
    <div className="sidebar" style={{ display: props.view === 'diff' ? 'none' : undefined }}>
      {NAV.map((n) => (
        <div
          key={n.key}
          className={`item ${props.view === n.key ? 'active' : ''}`}
          onClick={() => props.onNav(n.key)}
        >
          <span style={{ display: 'flex', width: 20, justifyContent: 'center' }}>{n.icon}</span>
          <span>{n.label}</span>
        </div>
      ))}
      <div style={{ flex: 1 }} />
      {/* 外观区：主题色块（无标题，简洁一排；字体设置在顶栏 ⋯ 菜单） */}
      <div className="row small dim nowrap" style={{ gap: 5, padding: '2px 20px 4px' }} title="切换主题">
        {THEMES.map((t) => (
          <button
            key={t.key}
            className={`theme-btn ${props.theme === t.key ? 'active' : ''}`}
            title={t.name}
            style={{ background: t.color, width: 18, height: 18 }}
            onClick={() => props.setTheme(t.key)}
          />
        ))}
      </div>
      {/* 最近项目：底部区域（版本号上方） */}
      {props.history.length > 0 && (
        <>
          <div className="sidebar-title">最近项目</div>
          <div className="history-list">
            {props.history.map((h) => (
              <div
                key={h.path}
                className={`history-item ${h.path === props.currentRoot ? 'active' : ''}`}
                title={`${h.path}${h.path === props.currentRoot ? '\n（当前操作的项目）' : ''}${h.fav ? '\n（常用项目）' : ''}\n点击打开 · 右键删除/设常用`}
                onClick={() => props.onOpenHistory(h)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setRmMenu({ x: e.clientX, y: e.clientY, path: h.path, fav: Boolean(h.fav) });
                }}
              >
                <span className={`badge ${h.type}`} style={{ fontSize: 9, padding: '0 5px' }}>
                  {h.type.toUpperCase()}
                </span>
                <span className="history-path">{h.path.split('/').filter(Boolean).pop()}</span>
                {h.fav && <span className="fav-star" title="常用项目（启动时优先打开）">★</span>}
              </div>
            ))}
            {/* 右键菜单：设为常用 / 删除 / 取消 */}
            {rmMenu && (
              <ContextMenu
                x={rmMenu.x}
                y={rmMenu.y}
                mask
                onClose={() => setRmMenu(null)}
                items={[
                  {
                    icon: rmMenu.fav ? '★' : '☆',
                    label: rmMenu.fav ? '取消常用' : '设为常用',
                    action: () => props.onSetFav(rmMenu.path, !rmMenu.fav),
                  },
                  { icon: '🗑', label: '删除', danger: true, action: () => props.onRemoveHistory(rmMenu.path) },
                  { icon: '✕', label: '取消' },
                ]}
              />
            )}
          </div>
        </>
      )}
      <div className="small dim" style={{ padding: '14px 20px 10px', borderTop: '1px solid var(--border)', marginTop: 8 }}>
        v{props.version ?? '1.0.0'}
      </div>
    </div>
  );
}
