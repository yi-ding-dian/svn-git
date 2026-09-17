/** 拖入上传的同名冲突确认：让用户定一个策略，应用到整批。
 *  只给整批策略（不做逐个勾选）——冲突通常是成批出现的，逐个选反而更慢。 */
import React from 'react';
import { ResizableModal } from './modal-shell.js';
import type { ConflictMode } from '../fileSystem/use-drop-upload.js';

export function UploadConflictModal(props: {
  /** 已存在的目标相对路径（相对落点目录） */
  conflicts: string[];
  /** 落点目录（'' = 仓库根），让用户确认传到哪 */
  dir: string;
  onChoose: (mode: ConflictMode | null) => void;
}) {
  return (
    <div className="modal-mask">
      <ResizableModal width={520} minWidth={420} onEsc={() => props.onChoose(null)}>
        <h3>⚠ {props.conflicts.length} 个文件已存在</h3>
        <div className="body">
          <div style={{ lineHeight: 1.7 }}>
            目标目录 {props.dir ? <span className="mono">{props.dir}/</span> : '（仓库根）'} 下已有同名文件，
            请选择如何处理这一批：
          </div>
          <div className="vcs-list" style={{ maxHeight: 220, overflow: 'auto', marginTop: 8 }}>
            {props.conflicts.map((c) => (
              <div key={c} className="vcs-row" style={{ cursor: 'default' }}>
                <span
                  className="mono small"
                  style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                  title={c}
                >
                  {c}
                </span>
              </div>
            ))}
          </div>
        </div>
        <div className="foot">
          <button onClick={() => props.onChoose(null)}>取消</button>
          <button onClick={() => props.onChoose('skip')} title="目标目录里已存在的文件保持原样，只放入新文件">
            跳过已存在
          </button>
          <button onClick={() => props.onChoose('rename')} title="已存在的自动改名：a.txt → a (1).txt，不丢任何一边">
            重命名全部
          </button>
          <button
            className="danger"
            onClick={() => props.onChoose('overwrite')}
            title="用拖入的文件覆盖目标目录里的同名文件（原内容会丢失）"
          >
            覆盖全部
          </button>
        </div>
      </ResizableModal>
    </div>
  );
}
