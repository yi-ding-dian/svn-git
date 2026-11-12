/** 顶部工具按钮（图标 + 文字，统一样式；mousedown 可启动拖拽定制） */
import React from 'react';

export function ToolBtn(props: {
  icon: React.ReactNode;
  label: React.ReactNode;
  title?: string;
  onClick: () => void;
  disabled?: boolean;
  /** 危险操作：红色强调（防误触,如退出应用） */
  danger?: boolean;
  /** 命令预览：悬浮按钮时显示将执行的命令（title 追加） */
  cmd?: string;
  /** 拖拽定制：唯一键 + 拖拽状态 */
  dndKey?: string;
  /** 布局项唯一 id（插入线计算用） */
  itemKey?: string;
  onMouseDown?: (e: React.MouseEvent) => void;
  isDragging?: boolean;
  isDropBefore?: boolean;
}) {
  return (
    <button
      className="tool-btn"
      title={props.cmd ? `${props.title ?? ''}\n${props.cmd}` : props.title}
      data-tool-key={props.dndKey}
      data-item-key={props.itemKey}
      onMouseDown={props.onMouseDown}
      onClick={props.onClick}
      disabled={props.disabled}
      style={{
        ...(props.danger ? { color: 'var(--err)' } : undefined),
        ...(props.isDragging ? { opacity: 0.4 } : undefined),
        ...(props.isDropBefore ? { boxShadow: '0 0 0 2px var(--accent) inset' } : undefined),
      }}
    >
      {props.icon} {props.label}
    </button>
  );
}
