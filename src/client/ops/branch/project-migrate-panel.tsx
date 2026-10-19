/** 项目迁移面板（SVN）：把当前工作副本独立成长期开发线或独立项目 */
import React, { useRef, useState } from 'react';
import type { BranchInfo } from '../../shared/api.js';
import { post } from '../../shared/api.js';
import { ConfirmModal } from '../../ui/prompt.js';
import { useTasks } from '../../shared/tasks.js';
import { startTaskDeferred } from '../../shell/bg-defer.js';
import { isImeComposing } from '../../shared/utils.js';
import { t } from '../../../shared/i18n/index.js';
import { currentLabelOf } from './branch-shared.js';

export function ProjectMigratePanel(props: {
  data: BranchInfo;
  onClose: () => void;
  /** 结果写回容器的底部结果行 */
  onResult: (msg: string, err: boolean) => void;
  /** 迁移成功：刷新分支列表/工作区 */
  onChanged: () => void;
  /** 超过 3 秒转后台：收起弹窗、飞线、轻提示（由容器统一处理） */
  onBackground: (title: string, from?: DOMRect) => void;
}) {
  const { data } = props;
  const [mode, setMode] = useState<'devline' | 'project'>('devline');
  const [name, setName] = useState(data.current || '');
  const [switchAfter, setSwitchAfter] = useState(true);
  const [cfm, setCfm] = useState<{ cmd: string; confirmLabel: string; action: () => void } | null>(null);
  const fromRef = useRef<DOMRect | null>(null);
  const bgTasks = useTasks();
  const busy = bgTasks.some((tk) => tk.kind === 'branch' && tk.status === 'running');

  /** 目标路径预览（按模式实时计算） */
  const target = (() => {
    const root = data.projectRoot;
    const n = name.trim();
    if (!root || !n) return '';
    return mode === 'devline' ? `${root}/branches/${n}` : `${root.replace(/\/[^/]+$/, '')}/${n}/trunk`;
  })();

  const runMigrate = (n: string) => {
    const title = t('shell.tasks.projectMigrate', { name: n });
    const from = fromRef.current ?? undefined;
    fromRef.current = null;
    startTaskDeferred({
      kind: 'branch',
      title,
      run: async (signal) => {
        const r = await post.projectMigrate(mode, n, switchAfter, signal);
        props.onResult(r.message, !r.ok);
        if (r.ok) {
          props.onClose();
          props.onChanged();
        }
        return { ok: r.ok, message: r.message };
      },
      onSlow: () => props.onBackground(title, from),
    });
  };

  /** 迁移确认：列出将执行的多步 SVN 命令 */
  const confirmMigrate = () => {
    const n = name.trim();
    const root = data.projectRoot;
    if (!n || !root) return;
    const fromRel = currentLabelOf(data) || data.current || '';
    const newRoot = `${root.replace(/\/[^/]+$/, '')}/${n}`;
    const cmd =
      mode === 'devline'
        ? `svn copy ${data.currentUrl ?? ''} ${root}/branches/${n} -m "${t('vcs.commitMsg.migrateDevline', { name: n, from: fromRel })}"`
        : [
            `svn mkdir --parents ${newRoot}/branches ${newRoot}/tags -m "${t('vcs.commitMsg.migrateProjectSkeleton', { name: n })}"`,
            `svn copy ${data.currentUrl ?? ''} ${newRoot}/trunk -m "${t('vcs.commitMsg.migrateProject', { name: n, from: fromRel })}"`,
          ].join('\n');
    setCfm({ cmd, confirmLabel: t('ops.branch.migrateRun'), action: () => runMigrate(n) });
  };

  return (
    <>
      <div className="migrate-panel" style={{ border: '1px solid var(--line)', borderRadius: 8, padding: '10px 12px', margin: '4px 0 10px' }}>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          {/* 项目迁移 */}
          <strong>{t('ops.branch.migrateTitle')}</strong>
          <button className="mini" onClick={props.onClose}>{t('common.cancel')}</button>
        </div>
        {/* 把当前工作副本独立出去：仍属于原项目的长期开发线，或一个带 trunk/branches/tags 的独立项目。 */}
        <div className="small dim" style={{ margin: '6px 0' }}>{t('ops.branch.migrateIntro')}</div>
        <div className="small mono" style={{ margin: '4px 0', wordBreak: 'break-all' }}>
          {/* 来源：{url} */}
          {t('ops.branch.migrateSource', { url: data.currentUrl ?? '' })}
        </div>
        <label className="row" style={{ alignItems: 'flex-start', gap: 6, cursor: 'pointer', margin: '6px 0' }}>
          <input type="radio" checked={mode === 'devline'} onChange={() => setMode('devline')} style={{ marginTop: 3 }} />
          <span>
            <strong>{t('ops.branch.migrateDevlineTitle')}</strong>
            <span className="small dim" style={{ display: 'block' }}>{t('ops.branch.migrateDevlineDesc')}</span>
          </span>
        </label>
        <label className="row" style={{ alignItems: 'flex-start', gap: 6, cursor: 'pointer', margin: '6px 0' }}>
          <input type="radio" checked={mode === 'project'} onChange={() => setMode('project')} style={{ marginTop: 3 }} />
          <span>
            <strong>{t('ops.branch.migrateProjectTitle')}</strong>
            <span className="small dim" style={{ display: 'block' }}>{t('ops.branch.migrateProjectDesc')}</span>
          </span>
        </label>
        <div className="row" style={{ gap: 6, margin: '8px 0 4px' }}>
          {/* 新名称 */}
          <span className="small">{t('ops.branch.migrateNameLabel')}</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (isImeComposing(e)) return;
              if (e.key === 'Enter' && name.trim()) confirmMigrate();
            }}
            style={{ flex: 1 }}
          />
        </div>
        <div className="small" style={{ wordBreak: 'break-all' }}>
          {/* 目标路径：{target} */}
          {t('ops.branch.migrateTarget', { target: target || '…' })}
        </div>
        <label className="row small" style={{ alignItems: 'center', gap: 6, cursor: 'pointer', margin: '6px 0' }}>
          <input type="checkbox" checked={switchAfter} onChange={(e) => setSwitchAfter(e.target.checked)} />
          {/* 迁移完成后把当前工作副本切换过去 */}
          {t('ops.branch.migrateSwitch')}
        </label>
        <div className="row" style={{ justifyContent: 'flex-end', gap: 6, marginTop: 8 }}>
          <button className="mini" onClick={props.onClose}>{t('common.cancel')}</button>
          <button className="primary" disabled={busy || !name.trim()} onClick={confirmMigrate}>
            {/* 开始迁移 */}
            {t('ops.branch.migrateRun')}
          </button>
        </div>
      </div>
      {cfm && (
        <ConfirmModal
          // 项目迁移
          title={t('ops.branch.migrateTitle')}
          message={
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, whiteSpace: 'normal' }}>
              <div>{t(mode === 'devline' ? 'ops.branch.migrateDevlineConfirm' : 'ops.branch.migrateProjectConfirm', { name: name.trim() })}</div>
              <pre className="mono small" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', margin: 0 }}>{cfm.cmd}</pre>
              {switchAfter && <div className="dim small">{t('ops.branch.migrateSwitchNote')}</div>}
            </div>
          }
          confirmLabel={cfm.confirmLabel}
          onConfirm={(e) => {
            fromRef.current = e.currentTarget.getBoundingClientRect();
            const action = cfm.action;
            setCfm(null);
            action();
          }}
          onCancel={() => setCfm(null)}
        />
      )}
    </>
  );
}
