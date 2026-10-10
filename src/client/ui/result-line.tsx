/** 操作结果提示行（弹窗里的操作反馈，被 ops / repo 多个弹窗共用） */
import React from 'react';
import { IconErr, IconOk } from './icons.js';

/** 操作结果提示行：成功绿√ / 失败红×（SVG 图标+文本，样式不变只加图标） */
export function ResultLine(props: { msg: string; err?: boolean }) {
  if (!props.msg) return null;
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
      <span>{props.msg}</span>
    </div>
  );
}
