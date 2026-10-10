/** 备注弹窗（最近项目右键「备注」） */
import React, { useState } from 'react';
import { ResizableModal } from '../shell/modal-shell.js';

/** 备注弹窗（最近项目右键「备注」）：给项目写一句自己的话，侧边栏显示在时间前面。
 *  打开时预填现有备注并全选——多半是来改的，直接打字即替换；清空后保存 = 删除备注 */
export function RemarkModal(props: {
  /** 项目名（只给 basename：长路径塞进弹窗反而看不清在给谁写备注） */
  projectName: string;
  /** 现有备注；没有则传空串 */
  current: string;
  onConfirm: (remark: string) => void;
  onCancel: () => void;
}) {
  const MAX = 60;
  const [text, setText] = useState(props.current);
  const trimmed = text.trim();
  // 本来就没备注、输入又是空 → 保存无事可做（避免按钮显示成「删除备注」却什么也没删）
  const noop = !trimmed && !props.current;
  const submit = () => props.onConfirm(trimmed.slice(0, MAX));
  return (
    <div className="modal-mask">
      <ResizableModal width={440} minWidth={420} onEsc={props.onCancel}>
        <h3>备注</h3>
        <div className="body">
          <div className="dim small" style={{ marginBottom: 8 }}>
            给「{props.projectName}」写一句备注，显示在最近项目的时间前面
            （侧边栏窄，过长会被截断成「…」，悬浮该项可看全文）
          </div>
          <input
            autoFocus
            type="text"
            value={text}
            maxLength={MAX}
            placeholder="例如：客户演示用 / 主要开发仓库…"
            onChange={(e) => setText(e.target.value)}
            onFocus={(e) => e.currentTarget.select()}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !noop) submit();
            }}
            style={{ width: '100%' }}
          />
          <div className="dim small" style={{ marginTop: 8, display: 'flex' }}>
            <span>清空后保存 = 删除备注</span>
            <span style={{ marginLeft: 'auto' }}>
              {trimmed.length}/{MAX}
            </span>
          </div>
        </div>
        <div className="foot">
          <button onClick={props.onCancel}>取消</button>
          <button className="primary" disabled={noop} onClick={submit} title={noop ? '还没有输入备注' : ''}>
            {trimmed ? '保存备注' : '删除备注'}
          </button>
        </div>
      </ResizableModal>
    </div>
  );
}
