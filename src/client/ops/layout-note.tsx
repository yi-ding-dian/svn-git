/** SVN 仓库布局提示条（分支 / 标签弹窗共用） */
import React from 'react';
import type { SvnLayout } from '../shared/api.js';

/** SVN 仓库布局提示条：标准布局绿色确认，非标准布局黄色提醒（分支/标签弹窗共用） */
export function LayoutNote(props: { layout: SvnLayout }) {
  const { trunk, branches, tags } = props.layout;
  if (trunk && branches && tags) {
    return <div className="small" style={{ color: 'var(--ok)', margin: '6px 0' }}>✓ 标准布局（trunk / branches / tags）</div>;
  }
  const missing: string[] = [];
  if (!trunk) missing.push('trunk/');
  if (!branches) missing.push('branches/');
  if (!tags) missing.push('tags/');
  const tips: string[] = [];
  if (!branches) tips.push('分支列表为空，可先「新建分支」自动创建该目录');
  if (!trunk) tips.push('无法切回主干，新建分支将以当前目录为来源');
  if (!tags) tips.push('标签列表为空，可先「创建标签」自动创建该目录');
  return (
    <div className="small" style={{ color: 'var(--warn)', margin: '6px 0' }}>
      ⚠ 仓库缺少 {missing.join('、')}（非标准布局）。{tips.join(' ')}
    </div>
  );
}
