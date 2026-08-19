/** 通用右键菜单：遮罩(可选) + ctx-menu，菜单项支持 图标/危险色/分隔线
 *
 * 用法：
 *   <ContextMenu x={x} y={y} items={items} onClose={close} mask />
 *   - mask：渲染全屏遮罩（点击/右键关闭），适合"最近项目"等简单右键；fs 视图用 window 监听关闭时不传
 *   - onMouseEnter/onMouseLeave：透传给菜单（fs 的"菜单悬停保持/延迟关闭"逻辑）
 */
import React from 'react';

export interface CtxMenuItem {
  icon?: React.ReactNode;
  label?: string;
  danger?: boolean;
  /** 分隔线（渲染时忽略其他字段） */
  sep?: boolean;
  action?: () => void;
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
              className={`ctx-item ${it.danger ? 'danger' : ''}`}
              onClick={() => {
                // 先关菜单再执行动作（各调用方原有行为一致：关闭优先）
                props.onClose();
                it.action?.();
              }}
            >
              <span className="ctx-icon">{it.icon}</span>
              <span>{it.label}</span>
            </div>
          )
        )}
      </div>
    </>
  );
}
