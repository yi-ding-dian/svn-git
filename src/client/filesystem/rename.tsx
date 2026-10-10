/** 重命名/移动弹窗：只输入文件名（自动保留原目录），确认按钮悬浮显示将执行命令 */
import React, { useState } from 'react';
import { t } from '../../shared/i18n/index.js';
import { ResizableModal } from '../shell/modal-shell.js';
import { cmdOfRepo } from '../shared/cmd-preview.js';

/** 重命名/移动弹窗：只输入文件名（自动保留原目录），确认按钮悬浮显示将执行命令。
 * fsMode=true 走磁盘改名（?/I 未版本化文件）；否则 svn move / git mv（提交后生效）。 */
export function RenameModal(props: {
  repoType: 'svn' | 'git';
  from: string;
  fsMode: boolean;
  onConfirm: (to: string) => void;
  onCancel: () => void;
}) {
  // 只编辑文件名（basename），目录部分固定不动：to = 原目录 + 新文件名；提示文本不显示完整路径（避免长路径干扰）
  const dir = props.from.includes('/') ? props.from.slice(0, props.from.lastIndexOf('/')) : '';
  const baseName = props.from.split('/').pop() ?? '';
  const [to, setTo] = useState(baseName);
  const trimmed = to.trim();
  const err = !trimmed
    // 名字不能为空
    ? t('fs.rename.empty')
    : trimmed === baseName
      // 名字未变化
      ? t('fs.rename.unchanged')
      : trimmed.includes('/') || trimmed.includes('\\')
        // 只输入文件名，不用写路径
        ? t('fs.rename.onlyNameErr')
        : '';
  const fullTo = dir ? `${dir}/${trimmed}` : trimmed;
  const cmd = props.fsMode
    // 从磁盘直接改名，不影响版本库（状态保持 ? / I）
    ? t('fs.rename.fsCmd')
    : cmdOfRepo(props.repoType, 'move', { from: baseName, to: trimmed || '…' }) ?? '';
  return (
    <div className="modal-mask">
      <ResizableModal width={440} minWidth={420} onEsc={props.onCancel}>
        {/* 重命名 */}
        <h3>{t('fs.rename.title')}</h3>
        <div className="body">
          <div className="dim small" style={{ marginBottom: 8 }}>
            {/* 未版本化文件，仅改磁盘文件名，不影响版本库 / 本地改名，提交后生效 */}
            {props.fsMode ? t('fs.rename.fsHint') : t('fs.rename.vcsHint')}
          </div>
          <input
            autoFocus
            type="text"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            onFocus={(e) => e.currentTarget.select()}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !err) props.onConfirm(fullTo);
            }}
            style={{ width: '100%', fontFamily: 'var(--mono)' }}
          />
          {err && (
            <div className="small" style={{ marginTop: 8, color: 'var(--err)' }}>
              {err}
            </div>
          )}
          <div className="dim small" style={{ marginTop: 8 }}>
            {/* 只输入文件名，改名后仍在当前目录 */}
            {t('fs.rename.onlyNameHint')}
          </div>
        </div>
        <div className="foot">
          {/* 取消 */}
          <button onClick={props.onCancel}>{t('common.cancel')}</button>
          <button className="primary" disabled={!!err} onClick={() => props.onConfirm(fullTo)} title={cmd}>
            {/* 重命名 */}
            {t('fs.rename.title')}
          </button>
        </div>
      </ResizableModal>
    </div>
  );
}
