/** 合并确认的「源 → 目标」结构化两行（合并确认弹窗 / 合并范围弹窗共用）
 *  比一句话更易扫读：谁合到谁、源在仓库的哪个位置、目标是分支还是工作副本。 */
import React from 'react';
import { t } from '../../../shared/i18n/index.js';

export function MergeSourceTarget(props: {
  source: string;
  /** 源的位置说明（SVN：branches/x）；主干或其他仓库类型不传 */
  sourceNote?: string;
  target: string;
  /** 目标不是分支（SVN 在 tags/独立目录）：标签改说「当前工作副本」 */
  targetIsWorkCopy: boolean;
}) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '2px 10px' }}>
      <span className="dim">{t('ops.branch.mergeSourceLabel')}</span>
      <span style={{ minWidth: 0 }}>
        <span className="mono">{props.source}</span>
        {props.sourceNote && <span className="dim small">{`  ${props.sourceNote}`}</span>}
      </span>
      <span className="dim">{t('ops.branch.mergeTargetLabel')}</span>
      <span style={{ minWidth: 0 }}>
        <span className="mono">{props.target}</span>
        <span className="dim small">{`  ${t(props.targetIsWorkCopy ? 'ops.branch.mergeTargetWorkCopy' : 'ops.branch.mergeTargetBranch')}`}</span>
      </span>
    </div>
  );
}
