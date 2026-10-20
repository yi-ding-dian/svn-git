/** 合并范围对话框（SVN）：整分支，或只合并其中某个目录/文件（Git 不走这里） */
import React, { useState } from 'react';
import { ConfirmModal } from '../../ui/prompt.js';
import { cmdOfRepo } from '../../shared/cmd-preview.js';
import { isImeComposing } from '../../shared/utils.js';
import { t } from '../../../shared/i18n/index.js';

export function MergeScopeDialog(props: {
  name: string;
  onCancel: () => void;
  /** scope 为空 = 整树 */
  onConfirm: (scope?: string) => void;
}) {
  const [scope, setScope] = useState('');
  const rel = scope.trim().replace(/^\/+|\/+$/g, '');
  return (
    <ConfirmModal
      // 合并范围
      title={t('ops.mergeScope.title')}
      width={480}
      message={
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, whiteSpace: 'normal' }}>
          {/* 确认合并分支 {name} 的改动： */}
          <div>{t('ops.mergeScope.intro', { name: props.name })}</div>
          <input
            type="text"
            autoFocus
            value={scope}
            placeholder={t('ops.mergeScope.placeholder')}
            onChange={(e) => setScope(e.target.value)}
            onKeyDown={(e) => {
              if (isImeComposing(e)) return;
              if (e.key === 'Enter') props.onConfirm(rel || undefined);
            }}
          />
          {/* 目录和文件都支持；文件级合并要求两边有共同历史。 */}
          <div className="dim small">{t('ops.mergeScope.note')}</div>
        </div>
      }
      // 合并
      confirmLabel={t('ops.mergeScope.confirm')}
      confirmCmd={
        rel
          ? cmdOfRepo('svn', 'branch_merge_scope', { name: props.name, path: rel })
          : cmdOfRepo('svn', 'branch_merge', { name: props.name })
      }
      onConfirm={() => props.onConfirm(rel || undefined)}
      onCancel={props.onCancel}
    />
  );
}
