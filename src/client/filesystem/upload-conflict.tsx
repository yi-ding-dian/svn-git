/** 同名冲突确认（拖入上传 / 剪贴板粘贴共用）：让用户定如何处理这一批。
 *  文案保持中性（不说"拖入""粘贴"）——两个入口共用这一个弹窗。
 *
 *  每项右侧可直接改名字（默认预填自动编号 `a (1).txt`）：这样既保留"一键整批重命名"的省事，
 *  又能按用户想要的名字另存。改名不需要后端配合——上传/复制的目标名字本来就是请求里的相对路径。 */
import React, { useState } from 'react';
import { t } from '../../shared/i18n/index.js';
import { ResizableModal } from '../shell/modal-shell.js';
import type { ConflictChoice } from './use-file-transfer.js';

/** 冲突项的默认新名字：a.txt → a (1).txt（想自定义就直接改输入框） */
function autoNewName(name: string): string {
  const i = name.lastIndexOf('.');
  return i > 0 ? `${name.slice(0, i)} (1)${name.slice(i)}` : `${name} (1)`;
}

export function UploadConflictModal(props: {
  /** 已存在的目标相对路径（相对落点目录） */
  conflicts: string[];
  /** 落点目录（'' = 仓库根），让用户确认传到哪 */
  dir: string;
  onChoose: (choice: ConflictChoice | null) => void;
}) {
  /** 每个冲突项的新名字（默认自动编号，用户可逐个改） */
  const [names, setNames] = useState<Record<string, string>>(() =>
    Object.fromEntries(props.conflicts.map((c) => [c, autoNewName(c)])),
  );
  const blank = props.conflicts.filter((c) => !(names[c] ?? '').trim());

  return (
    <div className="modal-mask">
      <ResizableModal width={560} minWidth={440} onEsc={() => props.onChoose(null)}>
        {/* ⚠ {n} 项已存在 */}
        <h3>⚠ {t('fs.upload.title', { n: props.conflicts.length })}</h3>
        <div className="body">
          <div style={{ lineHeight: 1.7 }}>
            {/* 目标目录 / （仓库根） / 下已有同名项。可直接改下面的名字另存，或整批处理： */}
            {t('fs.upload.targetPre')} {props.dir ? <span className="mono">{props.dir}/</span> : t('fs.repoRoot')} {t('fs.upload.targetPost')}
          </div>
          <div className="vcs-list" style={{ maxHeight: 220, overflow: 'auto', marginTop: 8 }}>
            {props.conflicts.map((c) => (
              <div key={c} className="vcs-row" style={{ cursor: 'default', gap: 8, alignItems: 'center' }}>
                <span
                  className="mono small"
                  style={{ flex: '0 1 auto', maxWidth: '42%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                  title={c}
                >
                  {c}
                </span>
                <span className="dim small" style={{ flexShrink: 0 }}>
                  →
                </span>
                {/* type="text" 必须有：全局输入框样式挂在 input[type=text] 上，不写就落成浏览器默认样式
                    （白底 / 2px inset 灰边框 / 无内边距 / 12px 字 18px 高 —— 又小又土，且聚焦时那条 2px
                    边框会被 input:focus 染成主题色，看着像个错误框）。small 类同理会被 input[type=text]
                    的字号覆盖，索性不写（与终端输入框同一套写法） */}
                <input
                  type="text"
                  className="mono"
                  style={{ flex: 1, minWidth: 0 }}
                  value={names[c] ?? ''}
                  onChange={(e) => setNames((s) => ({ ...s, [c]: e.target.value }))}
                  // 新名字（可带子目录，如 backup/a.txt）；留空则不能按名字放入
                  title={t('fs.upload.nameTip')}
                />
              </div>
            ))}
          </div>
        </div>
        <div className="foot">
          {/* 取消 */}
          <button onClick={() => props.onChoose(null)}>{t('common.cancel')}</button>
          {/* 目标目录里已存在的项保持原样，只放入新项 */}
          <button onClick={() => props.onChoose({ mode: 'skip' })} title={t('fs.upload.skipTitle')}>
            {/* 跳过已存在 */}
            {t('fs.upload.skip')}
          </button>
          <button
            className="danger"
            onClick={() => props.onChoose({ mode: 'overwrite' })}
            // 目标目录里的同名项会被覆盖（原内容会丢失，不保留副本）
            title={t('fs.upload.overwriteTitle')}
          >
            {/* 覆盖全部 */}
            {t('fs.upload.overwrite')}
          </button>
          <button
            className="primary"
            disabled={blank.length > 0}
            onClick={() => props.onChoose({ mode: 'rename', renames: names })}
            title={
              blank.length > 0
                // 有 {n} 项名字为空：填上名字，或改用「跳过已存在」
                ? t('fs.upload.blankHint', { n: blank.length })
                // 按各自右侧的名字放入（默认已自动编号，可直接改成别的名字）
                : t('fs.upload.byNameTitle')
            }
          >
            {/* 按这些名字放入 */}
            {t('fs.upload.byName')}
          </button>
        </div>
      </ResizableModal>
    </div>
  );
}
