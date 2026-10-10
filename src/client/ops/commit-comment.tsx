/** 提交注释输入块（提交弹窗共用）：标签 + 多行输入 + Ctrl+Enter 提交 */
import React from 'react';

/** 提交注释输入块（多个提交弹窗共用）：标签 + 多行输入 + Ctrl+Enter 提交 */
export function CommitCommentBox(props: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  rows?: number;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  return (
    <>
      <div className="cmt-label">
        📝 提交注释 <span className="dim" style={{ fontWeight: 400 }}>（必填）</span>
      </div>
      <textarea
        className="cmt-text"
        rows={props.rows ?? 3}
        placeholder={props.placeholder}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') props.onSubmit();
        }}
        autoFocus={props.autoFocus}
        style={{ flexShrink: 0 }}
      />
    </>
  );
}
