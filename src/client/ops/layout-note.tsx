/** SVN 仓库布局提示条（分支 / 标签弹窗共用） */
import React from 'react';
import type { SvnLayout } from '../shared/api.js';
import { t } from '../../shared/i18n/index.js';

/** SVN 仓库布局提示条：标准布局绿色确认，非标准布局黄色提醒（分支/标签弹窗共用） */
export function LayoutNote(props: { layout: SvnLayout }) {
  const { trunk, branches, tags } = props.layout;
  if (trunk && branches && tags) {
    // ✓ 标准布局（trunk / branches / tags）
    return <div className="small" style={{ color: 'var(--ok)', margin: '6px 0' }}>{t('ops.layout.standard')}</div>;
  }
  const missing: string[] = [];
  if (!trunk) missing.push('trunk/');
  if (!branches) missing.push('branches/');
  if (!tags) missing.push('tags/');
  const tips: string[] = [];
  // 分支列表为空，可先「新建分支」自动创建该目录
  if (!branches) tips.push(t('ops.layout.tipBranches'));
  // 无法切回主干，新建分支将以当前目录为来源
  if (!trunk) tips.push(t('ops.layout.tipTrunk'));
  // 标签列表为空，可先「创建标签」自动创建该目录
  if (!tags) tips.push(t('ops.layout.tipTags'));
  return (
    <div className="small" style={{ color: 'var(--warn)', margin: '6px 0' }}>
      {/* ⚠ 仓库缺少 {dirs}（非标准布局）。 */}
      {t('ops.layout.missing', { dirs: missing.join(t('common.listSep')) })}{tips.join(' ')}
    </div>
  );
}
