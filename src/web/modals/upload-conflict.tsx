/** 同名冲突确认（拖入上传 / 剪贴板粘贴共用）：让用户定如何处理这一批。
 *  文案保持中性（不说"拖入""粘贴"）——两个入口共用这一个弹窗。
 *
 *  每项右侧可直接改名字（默认预填自动编号 `a (1).txt`）：这样既保留"一键整批重命名"的省事，
 *  又能按用户想要的名字另存。改名不需要后端配合——上传/复制的目标名字本来就是请求里的相对路径。 */
import React, { useState } from 'react';
import { ResizableModal } from './modal-shell.js';
import type { ConflictChoice } from '../fileSystem/use-file-transfer.js';

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
        <h3>⚠ {props.conflicts.length} 项已存在</h3>
        <div className="body">
          <div style={{ lineHeight: 1.7 }}>
            目标目录 {props.dir ? <span className="mono">{props.dir}/</span> : '（仓库根）'} 下已有同名项。
            可直接改下面的名字另存，或整批处理：
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
                <input
                  className="mono small"
                  style={{ flex: 1, minWidth: 0 }}
                  value={names[c] ?? ''}
                  onChange={(e) => setNames((s) => ({ ...s, [c]: e.target.value }))}
                  title="新名字（可带子目录，如 backup/a.txt）；留空则不能按名字放入"
                />
              </div>
            ))}
          </div>
        </div>
        <div className="foot">
          <button onClick={() => props.onChoose(null)}>取消</button>
          <button onClick={() => props.onChoose({ mode: 'skip' })} title="目标目录里已存在的项保持原样，只放入新项">
            跳过已存在
          </button>
          <button
            className="danger"
            onClick={() => props.onChoose({ mode: 'overwrite' })}
            title="目标目录里的同名项会被覆盖（原内容会丢失，不保留副本）"
          >
            覆盖全部
          </button>
          <button
            className="primary"
            disabled={blank.length > 0}
            onClick={() => props.onChoose({ mode: 'rename', renames: names })}
            title={
              blank.length > 0
                ? `有 ${blank.length} 项名字为空：填上名字，或改用「跳过已存在」`
                : '按各自右侧的名字放入（默认已自动编号，可直接改成别的名字）'
            }
          >
            按这些名字放入
          </button>
        </div>
      </ResizableModal>
    </div>
  );
}
