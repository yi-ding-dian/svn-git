/** 操作结果提示行（弹窗里的操作反馈，被 ops / repo 多个弹窗共用） */
import React, { useRef, useState } from 'react';
import { IconErr, IconOk } from './icons.js';
import { t } from '../../shared/i18n/index.js';

/** 操作结果提示行：成功绿√ / 失败红×（SVG 图标+文本）+ **右侧 × 可关闭**
 *（用户定稿：这种提示框都要给个关闭按钮；× 只关这一条——msg 变了（新消息）自动重新显示） */
export function ResultLine(props: { msg: string; err?: boolean }) {
  const [dismissed, setDismissed] = useState(false);
  // props 变化即"新一条"：render 阶段派生重置（官方允许的同组件 render-phase update）
  const prevRef = useRef(props.msg);
  if (prevRef.current !== props.msg) {
    prevRef.current = props.msg;
    if (dismissed) setDismissed(false);
  }
  if (!props.msg || dismissed) return null;
  return (
    <div
      className={props.err ? 'error mt8' : 'mt8 small'}
      style={{
        ...(props.err ? {} : { color: 'var(--ok)' }),
        display: 'flex',
        alignItems: 'center',
        gap: 6,
      }}
    >
      {props.err ? <IconErr /> : <IconOk />}
      <span style={{ flex: 1, minWidth: 0 }}>{props.msg}</span>
      {/* ×：关掉这条提示 */}
      <button className="mini" style={{ flexShrink: 0 }} title={t('common.close')} onClick={() => setDismissed(true)}>
        ×
      </button>
    </div>
  );
}
