/** 通用小组件：使用说明块 / 表单行（多个弹窗共用） */
import React from 'react';

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
