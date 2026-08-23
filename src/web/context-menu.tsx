/** 通用右键菜单：遮罩(可选) + ctx-menu，菜单项支持 图标/危险色/分隔线
 *
 * 用法：
 *   <ContextMenu x={x} y={y} items={items} onClose={close} mask />
 *   - mask：渲染全屏遮罩（点击/右键关闭），适合"最近项目"等简单右键；fs 视图用 window 监听关闭时不传
 *   - onMouseEnter/onMouseLeave：透传给菜单（fs 的"菜单悬停保持/延迟关闭"逻辑）
 */
import React, { useState } from 'react';

export interface CtxMenuItem {
  icon?: React.ReactNode;
  label?: string;
  danger?: boolean;
  /** 分隔线（渲染时忽略其他字段） */
  sep?: boolean;
  /** 命令预览：悬浮该项时在菜单底部显示将执行的命令（教学/透明层） */
  cmd?: string;
  action?: () => void;
  /** 二级子菜单（悬浮/点击右侧展开,如「打开方式」） */
  submenu?: CtxMenuItem[];
}

export function ContextMenu(props: {
  x: number;
  y: number;
  items: CtxMenuItem[];
  onClose: () => void;
  mask?: boolean;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [subMenuPinned, setSubMenuPinned] = useState(false);
  return (
    <>
      {props.mask && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 299 }}
          onClick={props.onClose}
          onContextMenu={(e) => {
            e.preventDefault();
            props.onClose();
          }}
        />
      )}
      <div
        className="ctx-menu"
        style={{ left: props.x, top: props.y }}
        onMouseEnter={props.onMouseEnter}
        onMouseLeave={props.onMouseLeave}
      >
        {props.items.map((it, i) =>
          it.sep ? (
            <div key={i} className="ctx-sep" />
          ) : (
            <div
              key={i}
              className={`ctx-item ${it.danger ? 'danger' : ''} ${it.submenu && hoverIdx === i ? 'submenu-open' : ''}`}
              onClick={() => {
                if (it.submenu) { setHoverIdx(i); return; } // 子菜单项: 点击=展开(与悬浮一致)
                // 先关菜单再执行动作（各调用方原有行为一致：关闭优先）
                props.onClose();
                it.action?.();
              }}
              onMouseEnter={() => setHoverIdx(it.submenu ? i : null)}
              title={it.cmd ?? undefined}
            >
              <span className="ctx-icon">{it.icon}</span>
              <span>{it.label}</span>
              {it.submenu && <span className="ctx-arrow">▶</span>}
            </div>
          )
        )}
        {/* 二级子菜单面板（如「打开方式」: 悬浮显示在菜单右侧） */}
        {props.items.find((it) => it.submenu) &&
          (() => {
            const idx = props.items.findIndex((it) => it.submenu);
            const it = props.items[idx];
            // 子菜单当前显示条件: 悬浮该项 或 点击展开（hoverIdx === idx）
            if (!it.submenu || (hoverIdx !== idx && !subMenuPinned)) return null;
            return (
              <div
                className="ctx-menu ctx-submenu"
                style={{
                  position: 'absolute',
                  left: 'calc(100% - 2px)',
                  top: props.items.slice(0, idx).reduce((y, i) => y + (i.sep ? 9 : 28), 0),
                }}
                onMouseEnter={() => setHoverIdx(idx)}
                onMouseLeave={() => { setHoverIdx(null); setSubMenuPinned(false); }}
              >
                <div className="ctx-item" style={{ cursor: 'default' }}>{'🛠 打开方式'}</div>
                <div className="ctx-sep" style={{ height: 1, background: 'var(--border2)', margin: '4px 8px' }} />
                {it.submenu.map((s, si) => (
                  <div
                    key={si}
                    className={`ctx-item ${s.danger ? 'danger' : ''}`}
                    onClick={() => {
                      props.onClose();
                      s.action?.();
                    }}
                  >
                    <span className="ctx-icon">{s.icon}</span>
                    <span>{s.label}</span>
                  </div>
                ))}
              </div>
            );
          })()}
      </div>
    </>
  );
}
