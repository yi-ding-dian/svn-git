/** 通用小组件：使用说明块 / 表单行 / 跟随鼠标提示（多个弹窗共用） */
import React, { useEffect } from 'react';

/** 使用说明块（跟随主题） */
export function HelpNote(props: { children: React.ReactNode }) {
  return (
    <div className="help-note">
      <span style={{ flexShrink: 0 }}>💡</span>
      <div className="small">{props.children}</div>
    </div>
  );
}

/** 表单行：label + 内容（input/按钮组等） */
export function FormRow(props: { label: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="form-row">
      <label>{props.label}</label>
      {props.children}
    </div>
  );
}

/** 跟随鼠标提示：显示在指定坐标（点击处），duration 毫秒后自动隐藏 */
export function ClickTip(props: {
  /** 显示位置（鼠标点击坐标） */
  x: number;
  y: number;
  msg: string;
  /** 显示时长 ms（默认 1500） */
  duration?: number;
  /** 到时自动调用，父组件清 state */
  onHide: () => void;
}) {
  useEffect(() => {
    const t = setTimeout(props.onHide, props.duration ?? 1500);
    return () => clearTimeout(t);
  }, [props.msg]); // msg 变化时重新计时
  return (
    <div
      className="toast-tip"
      style={{
        left: Math.min(props.x, window.innerWidth - 220),
        top: Math.max(8, props.y - 26),
      }}
    >
      {props.msg}
    </div>
  );
}
