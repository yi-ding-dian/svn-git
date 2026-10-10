/** 更新结果弹窗 */
import React, { useMemo } from 'react';
import { ResizableModal } from '../shell/modal-shell.js';
import { IconOk, IconErr } from '../ui/icons.js';
import { t, type I18nKey } from '../../shared/i18n/index.js';

/** svn 更新状态英文码 → i18n key（**模块级**：对象字面量放组件内每次渲染都会重建，
 *  进依赖数组会让 useMemo 每次失效、不进又报 exhaustive-deps）。
 *  ⚠ 存 key、渲染时才 t()：模块顶层 t() 会冻在首次语言（见 i18n/index.ts 头部说明） */
const STATUS_KEY: Record<string, I18nKey> = {
  updated: 'ops.update.status.updated',
  added: 'ops.update.status.added',
  deleted: 'ops.update.status.deleted',
  conflicted: 'ops.update.status.conflicted',
  merged: 'ops.update.status.merged',
  skipped: 'ops.update.status.skipped',
};

/** 状态码 → 界面文案；未收录的码原样显示（svn 以后新增的码直接透出，不至于空白） */
const statusLabel = (code: string): string => {
  const key = STATUS_KEY[code];
  return key ? t(key) : code;
};

/** 更新结果弹窗：显示更新目录/文件详情（不自动消失，用户可仔细查看） */
export function UpdateResultModal(props: {
  dir: string;
  ok: boolean;
  message: string;
  files?: { path: string; status: string; code?: string }[];
  warnings?: string[];
  onClose: () => void;
}) {
  const STATUS_COLOR: Record<string, string> = {
    updated: 'var(--ok)',
    added: 'var(--ok)',
    deleted: 'var(--err)',
    conflicted: 'var(--err)',
    merged: 'var(--accent)',
    skipped: 'var(--dim)',
  };

  // 按状态统计（只算数量，文案渲染时才取 —— 存进 memo 会冻在首次语言）
  const stats = useMemo(() => {
    const m = new Map<string, number>();
    for (const f of props.files ?? []) {
      m.set(f.status, (m.get(f.status) ?? 0) + 1);
    }
    return [...m.entries()].map(([status, count]) => ({ status, count }));
  }, [props.files]);

  return (
    <div className="modal-mask">
      <ResizableModal width={720} onEsc={props.onClose}>
        <h3 style={{ color: props.ok ? 'var(--ok)' : 'var(--err)' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            {props.ok ? <IconOk size={16} /> : <IconErr size={16} />}
            {t(props.ok ? 'ops.update.done' : 'ops.update.failed')}
          </span>
        </h3>
        <div className="body">
          <div className="help-note" style={{ alignItems: 'center', marginBottom: 10 }}>
            <span style={{ flexShrink: 0 }}>📁</span>
            {/* （仓库根） */}
            <span style={{ flex: 1, wordBreak: 'break-all' }}>{props.dir || t('ops.repoRoot')}</span>
            {stats.length > 0 && (
              <span className="row" style={{ gap: 8, flexShrink: 0 }}>
                {stats.map((s) => (
                  <span key={s.status} className="small nowrap" style={{ color: STATUS_COLOR[s.status] }}>
                    {statusLabel(s.status)} <b>{s.count}</b>
                  </span>
                ))}
              </span>
            )}
          </div>
          {props.files && props.files.length > 0 ? (
            // 终端式文件列表：状态字母 + 路径；文件多时滚动
            <div className="vcs-list" style={{ minHeight: 120 }}>
              {props.files.map((f, i) => (
                <div key={i} className="vcs-row" style={{ cursor: 'default' }}>
                  <span className="mono small nowrap" style={{ width: 30, textAlign: 'center', fontWeight: 700, color: STATUS_COLOR[f.status] }}>
                    {f.code ?? statusLabel(f.status)}
                  </span>
                  <span className="mono small" style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={f.path}>
                    {f.path}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="mt8" style={{ whiteSpace: 'pre-wrap', maxHeight: 220, overflow: 'auto', fontSize: '1.08em', color: props.ok ? 'var(--ok)' : 'var(--err)' }}>
              {props.message}
            </div>
          )}
          {/* svn 警告（如外部定义失败 W205011/W175013…）：有什么提示什么 */}
          {props.warnings && props.warnings.length > 0 && (
            <div
              style={{
                marginTop: 10,
                background: 'rgba(212,167,50,.10)',
                border: '1px solid var(--warn)',
                borderRadius: 8,
                padding: '8px 12px',
              }}
            >
              <div className="small" style={{ color: 'var(--warn)', fontWeight: 600, marginBottom: 6 }}>
                {/* ⚠ svn 警告（{n} 条） */}
                {t('ops.update.warnings', { n: props.warnings.length })}
              </div>
              <div className="mono small" style={{ whiteSpace: 'pre-wrap', maxHeight: 200, overflow: 'auto', color: 'var(--warn)', lineHeight: 1.6 }}>
                {props.warnings.join('\n')}
              </div>
            </div>
          )}
        </div>
        <div className="foot">
          {/* 知道了 */}
          <button className="primary" onClick={props.onClose}>{t('ui.modal.gotIt')}</button>
        </div>
      </ResizableModal>
    </div>
  );
}
