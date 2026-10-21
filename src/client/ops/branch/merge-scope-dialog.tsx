/** 合并范围对话框（SVN）：整分支，或只合并其中某个目录/文件（Git 不走这里） */
import React, { useState } from 'react';
import { ConfirmModal } from '../../ui/prompt.js';
import { cmdOfRepo } from '../../shared/cmd-preview.js';
import { isImeComposing } from '../../shared/utils.js';
import { t } from '../../../shared/i18n/index.js';
import { mergeSourceNoteOf, type PickDirRequest } from './branch-shared.js';
import { MergeScopeField } from './merge-scope-field.js';
import { MergeSourceTarget } from './merge-source-target.js';

export function MergeScopeDialog(props: {
  name: string;
  /** 合并目标 = 当前工作副本位置 */
  target: string;
  targetIsWorkCopy: boolean;
  /** 当前工作副本本地根（范围目录浏览起点与相对路径基准） */
  workDir: string;
  /** 目录选择弹窗注入（shell 提供） */
  onPickDir?: (req: PickDirRequest) => void;
  onCancel: () => void;
  /** scope 为空 = 整树 */
  onConfirm: (scope?: string) => void;
}) {
  const [scope, setScope] = useState('');
  const [notice, setNotice] = useState('');
  const rel = scope.trim().replace(/^\/+|\/+$/g, '');
  return (
    <ConfirmModal
      // 合并范围
      title={t('ops.mergeScope.title')}
      width={480}
      message={
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, whiteSpace: 'normal' }}>
          {/* 结构化「源 → 目标」：谁合到谁一目了然 */}
          <MergeSourceTarget
            source={props.name}
            sourceNote={mergeSourceNoteOf('svn', props.name)}
            target={props.target}
            targetIsWorkCopy={props.targetIsWorkCopy}
          />
          {/* 可选只合并其中某个目录或文件： */}
          <div>{t('ops.mergeScope.intro')}</div>
          <MergeScopeField
            value={scope}
            onChange={(v) => {
              setScope(v);
              setNotice('');
            }}
            workDir={props.workDir}
            onPickDir={props.onPickDir}
            onOutside={() => setNotice(t('ops.branch.mergeScopeBrowseOutside'))}
            autoFocus
            onKeyDown={(e) => {
              if (isImeComposing(e)) return;
              if (e.key === 'Enter') props.onConfirm(rel || undefined);
            }}
          />
          {notice && <div className="small" style={{ color: 'var(--err)' }}>{notice}</div>}
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
