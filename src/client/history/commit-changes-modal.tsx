/** 提交文件变动详情弹窗：左侧变更文件列表，右侧差异（复用 DiffView 的嵌入/只读模式）。
 *
 *  顶部下拉可在已加载的历史里切换提交——列表条目自带 changed，切提交不用再请求文件清单。
 *  提交之间的差异一律相对第一父（合并提交取 `rev^`），与历史行里的文件数口径一致；
 *  根提交没有父，用 Git 空树对象作为"前一版本"（差异表现为整文件新增）。 */
import React, { useMemo, useState } from 'react';
import { ResizableModal } from '../shell/modal-shell.js';
import { DiffView } from './diff.js';
import { isBinaryFile } from '../shared/utils.js';
import { t } from '../../shared/i18n/index.js';
import type { LogEntry } from '../shared/api.js';

/** Git 空树对象（SHA-1）：根提交的左版本。`git show <它>:path` 为空、`git diff <它> rev` 正常 */
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

export function CommitChangesModal(props: {
  /** 已加载的历史列表（下拉选项来源；条目自带 changed） */
  logs: LogEntry[];
  /** 打开时选中的提交 */
  initialRev: string;
  onClose: () => void;
  onToast?: (msg: string, err?: boolean) => void;
}) {
  const [rev, setRev] = useState(props.initialRev);
  const entry = useMemo(() => props.logs.find((l) => l.rev === rev) ?? null, [props.logs, rev]);
  /** 用户点选的文件；切提交后若该路径不在新提交里，自动回退到第一个变更文件 */
  const [picked, setPicked] = useState<string | null>(null);
  const path = entry?.changed.some((c) => c.path === picked) ? picked : (entry?.changed[0]?.path ?? null);
  /** 前一版本：合并提交取第一父；根提交用空树 */
  const before = entry?.isRoot ? EMPTY_TREE : `${rev}^`;
  const binary = Boolean(path && isBinaryFile(path));

  return (
    <div className="modal-mask">
      <ResizableModal width={1180} maxed maxedWidth="98vw" maxedHeight="96vh" onEsc={props.onClose}>
        <div className="row" style={{ alignItems: 'center' }}>
          <h3
            style={{
              flex: 1,
              margin: 0,
              position: 'relative',
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              paddingRight: 46,
            }}
          >
            {/* 文件变动详情 */}
            <span style={{ flexShrink: 0 }}>{t('hist.changes.title')}</span>
            {/* 提交 */}
            <span className="dim small nowrap" style={{ fontWeight: 400 }}>{t('hist.changes.commit')}</span>
            <select
              value={rev}
              onChange={(e) => setRev(e.target.value)}
              style={{
                flex: 1,
                minWidth: 0,
                maxWidth: 620,
                padding: '4px 8px',
                background: 'var(--panel2)',
                color: 'var(--text)',
                border: '1px solid var(--border)',
                borderRadius: 6,
                fontSize: 12,
                fontWeight: 400,
              }}
            >
              {props.logs.map((l) => (
                <option key={l.rev} value={l.rev}>
                  {l.rev} · {l.msg}
                </option>
              ))}
            </select>
            <button className="modal-x" title={t('common.close')} aria-label={t('common.close')} onClick={props.onClose}>
              ✕
            </button>
          </h3>
        </div>
        <div className="body" style={{ display: 'flex', flexDirection: 'column', gap: 10, minHeight: 0, flex: 1 }}>
          {entry ? (
            <>
              <div className="dim small">
                {entry.rev} · {entry.author} · {entry.date}
              </div>
              {/* 提交注释（%s 标题） */}
              <div className="small" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={entry.msg}>
                {entry.msg}
              </div>
            </>
          ) : (
            <div className="dim small">{rev}</div>
          )}
          <div style={{ display: 'flex', flex: 1, minHeight: 0, gap: 12 }}>
            {/* 左：变更文件列表 */}
            <div
              style={{
                width: 300,
                flexShrink: 0,
                display: 'flex',
                flexDirection: 'column',
                minHeight: 0,
                borderRight: '1px solid var(--border)',
                paddingRight: 12,
              }}
            >
              {/* 变更文件（{n}） */}
              <div className="small dim" style={{ marginBottom: 6, flexShrink: 0 }}>
                {t('hist.changes.files', { n: entry?.changed.length ?? 0 })}
              </div>
              <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
                {entry?.changed.map((c) => (
                  <div
                    key={c.path}
                    className={`changed-row${c.path === path ? ' active' : ''}`}
                    style={{ cursor: 'pointer' }}
                    title={c.path}
                    onClick={() => setPicked(c.path)}
                  >
                    <span className={`act ${c.action}`}>{c.action}</span>
                    <span
                      className="mono"
                      style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                    >
                      {c.path}
                    </span>
                  </div>
                ))}
                {/* 无文件变更 */}
                {entry && entry.changed.length === 0 && <div className="dim">{t('hist.noChanged')}</div>}
              </div>
            </div>
            {/* 右：差异 */}
            <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
              {!entry || !path ? (
                // 点击左侧文件查看差异
                <div className="empty">{t('hist.changes.pickFile')}</div>
              ) : binary ? (
                // 该文件为二进制文件（Word 文档 / PDF / 图片等），不支持文本对比
                <div className="dim" style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {t('hist.binaryNoDiff')}
                </div>
              ) : (
                <DiffView
                  target={{ path, a: before, b: rev }}
                  tick={0}
                  active
                  embedded
                  readOnly
                  onBack={() => {}}
                  onToast={props.onToast}
                />
              )}
            </div>
          </div>
        </div>
        <div className="foot" style={{ justifyContent: 'space-between' }}>
          {/* 点击左侧文件切换差异 · Esc 关闭 */}
          <span className="dim small">{t('hist.changes.hint')}</span>
          {/* 关闭 */}
          <button onClick={props.onClose}>{t('common.close')}</button>
        </div>
      </ResizableModal>
    </div>
  );
}
