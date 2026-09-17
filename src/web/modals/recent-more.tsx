/** 侧边栏「最近项目」的「…」弹出面板：列出被折叠掉的其余项目。
 *  仿主题气泡（theme-popover）：定位在按钮右侧、点空白或 Esc 关闭。
 *  侧边栏只列前 N 项，剩下的放这里，避免项目多时把侧边栏撑得很长。 */
import React, { useEffect, useRef, useState } from 'react';
import type { HistoryItem } from '../api.js';

interface Props {
  /** 面板锚点（一般取「…」按钮的右侧中点） */
  x: number;
  y: number;
  /** 要展示的项目（调用方已裁掉主列表已显示的那批） */
  items: HistoryItem[];
  /** 当前打开的仓库根：匹配项高亮 */
  currentRoot?: string | null;
  onOpen: (path: string) => void;
  onClose: () => void;
}

export function RecentMorePopover(props: Props) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState({ left: props.x, top: props.y });

  // 越界回退：右/下超出视口时贴边显示（宽度依赖内容，故渲染后再量一次）
  useEffect(() => {
    if (!ref.current) return;
    const r = ref.current.getBoundingClientRect();
    let left = props.x;
    let top = props.y;
    if (left + r.width > window.innerWidth - 8) left = Math.max(8, window.innerWidth - r.width - 8);
    if (top + r.height > window.innerHeight - 8) top = Math.max(8, window.innerHeight - r.height - 8);
    setPos({ left, top });
  }, [props.x, props.y]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') props.onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      {/* 点击面板外任意处关闭（右键也关，避免菜单叠菜单） */}
      <div
        style={{ position: 'fixed', inset: 0, zIndex: 299 }}
        onClick={props.onClose}
        onContextMenu={(e) => {
          e.preventDefault();
          props.onClose();
        }}
      />
      <div ref={ref} className="ctx-menu recent-pop" style={{ left: pos.left, top: pos.top }}>
        <div className="recent-pop-title">其余 {props.items.length} 个最近项目</div>
        {props.items.map((h) => (
          <div
            key={h.path}
            className={`recent-item ${h.path === props.currentRoot ? 'active' : ''}`}
            title={h.path}
            onClick={() => props.onOpen(h.path)}
          >
            <span className={`badge ${h.type}`} style={{ fontSize: 9, padding: '0 5px' }}>
              {h.type.toUpperCase()}
            </span>
            <span className="recent-path">{h.path}</span>
            {h.fav && <span className="fav-star" title="常用项目">★</span>}
          </div>
        ))}
      </div>
    </>
  );
}
