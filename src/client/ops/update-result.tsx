/** 更新结果弹窗 */
import React, { useMemo } from 'react';
import { ResizableModal } from '../shell/modal-shell.js';
import { IconOk, IconErr } from '../ui/icons.js';

/** 更新结果弹窗：显示更新目录/文件详情（不自动消失，用户可仔细查看） */
export function UpdateResultModal(props: {
  dir: string;
  ok: boolean;
  message: string;
  files?: { path: string; status: string; code?: string }[];
  warnings?: string[];
  onClose: () => void;
}) {
  const STATUS_CN: Record<string, string> = {
    updated: '已更新',
    added: '已添加',
    deleted: '已删除',
    conflicted: '冲突',
    merged: '已合并',
    skipped: '已跳过',
  };
  const STATUS_COLOR: Record<string, string> = {
    updated: 'var(--ok)',
    added: 'var(--ok)',
    deleted: 'var(--err)',
    conflicted: 'var(--err)',
    merged: 'var(--accent)',
    skipped: 'var(--dim)',
  };

  // 按状态统计
  const stats = useMemo(() => {
    const m = new Map<string, number>();
    for (const f of props.files ?? []) {
      m.set(f.status, (m.get(f.status) ?? 0) + 1);
    }
    return [...m.entries()].map(([k, n]) => ({ status: k, label: STATUS_CN[k] ?? k, count: n }));
  }, [props.files]);

  return (
    <div className="modal-mask">
      <ResizableModal width={720} onEsc={props.onClose}>
        <h3 style={{ color: props.ok ? 'var(--ok)' : 'var(--err)' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            {props.ok ? <IconOk size={16} /> : <IconErr size={16} />}
            {props.ok ? '更新完成' : '更新失败'}
          </span>
        </h3>
        <div className="body">
          <div className="help-note" style={{ alignItems: 'center', marginBottom: 10 }}>
            <span style={{ flexShrink: 0 }}>📁</span>
            <span style={{ flex: 1, wordBreak: 'break-all' }}>{props.dir || '（仓库根）'}</span>
            {stats.length > 0 && (
              <span className="row" style={{ gap: 8, flexShrink: 0 }}>
                {stats.map((s) => (
                  <span key={s.status} className="small nowrap" style={{ color: STATUS_COLOR[s.status] }}>
                    {s.label} <b>{s.count}</b>
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
                    {f.code ?? STATUS_CN[f.status] ?? f.status}
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
                ⚠ svn 警告（{props.warnings.length} 条）
              </div>
              <div className="mono small" style={{ whiteSpace: 'pre-wrap', maxHeight: 200, overflow: 'auto', color: 'var(--warn)', lineHeight: 1.6 }}>
                {props.warnings.join('\n')}
              </div>
            </div>
          )}
        </div>
        <div className="foot">
          <button className="primary" onClick={props.onClose}>知道了</button>
        </div>
      </ResizableModal>
    </div>
  );
}
