/** 合回主干面板（SVN）：在主干对应路径的本地工作副本上拉取合并 */
import React, { useEffect, useRef, useState } from 'react';
import type { BranchInfo, MainlinePlan } from '../../shared/api.js';
import { post } from '../../shared/api.js';
import { ConfirmModal } from '../../ui/prompt.js';
import { ModalShell } from '../../shell/modal-shell.js';
import { useTasks } from '../../shared/tasks.js';
import { startTaskDeferred } from '../../shell/bg-defer.js';
import { t } from '../../../shared/i18n/index.js';

export function MergeMainlinePanel(props: {
  data: BranchInfo;
  onClose: () => void;
  onResult: (msg: string, err: boolean) => void;
  onChanged: () => void;
  onBackground: (title: string, from?: DOMRect) => void;
}) {
  const { data } = props;
  const [dir, setDir] = useState('');
  const [scope, setScope] = useState('');
  const [plan, setPlan] = useState<MainlinePlan | null>(null);
  const [autoCommit, setAutoCommit] = useState(true);
  const [checking, setChecking] = useState(false);
  const [conflicts, setConflicts] = useState<string[]>([]);
  const [cfm, setCfm] = useState<{ willCheckout: boolean; dir: string; confirmLabel: string; action: () => void } | null>(null);
  const fromRef = useRef<DOMRect | null>(null);
  const bgTasks = useTasks();
  const busy = bgTasks.some((tk) => tk.kind === 'branch' && tk.status === 'running');

  /** 预检目标目录（空目录 → 后端返回推荐路径）；pathRel 限定范围（目录/文件） */
  const check = async (target: string, pathRel = scope) => {
    setChecking(true);
    try {
      const p = await post.mergeMainlineCheck(target, pathRel.trim() || undefined);
      setPlan(p);
      if (!target) setDir((d) => d || p.suggestion);
    } catch (e) {
      props.onResult((e as Error).message, true);
    } finally {
      setChecking(false);
    }
  };

  // 面板打开即预检一次：拿到主干对应路径与推荐的本地主干工作副本
  useEffect(() => {
    void check('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** 预检状态文案/颜色 */
  const state = (() => {
    if (checking || !plan) return { text: t('ops.branch.mainlineChecking'), color: 'var(--dim)' };
    if (plan.error) return { text: plan.error, color: 'var(--err)' };
    switch (plan.targetState) {
      case 'missing':
        return { text: t('ops.branch.mainlineStateMissing'), color: 'var(--warn)' };
      case 'not-wc':
        return { text: t('ops.branch.mainlineStateNotWc'), color: 'var(--err)' };
      case 'wrong-url':
        return { text: t('ops.branch.mainlineStateWrongUrl', { url: plan.targetUrl ?? '', target: plan.mainlineUrl ?? '' }), color: 'var(--err)' };
      case 'dirty':
        return { text: t('ops.branch.mainlineStateDirty'), color: 'var(--err)' };
      default:
        return { text: t('ops.branch.mainlineStateReady'), color: 'var(--ok)' };
    }
  })();
  const canRun = Boolean(plan && dir.trim() && !plan.error && (plan.targetState === 'missing' || plan.targetState === 'ready'));

  /** 执行合回主干（>3 秒转后台）：在目标工作副本上 svn merge，冲突时不提交 */
  const run = (target: string, commit: boolean) => {
    const title = t('shell.tasks.mergeMainline', { name: data.mainlineRelative ?? '' });
    const from = fromRef.current ?? undefined;
    fromRef.current = null;
    setConflicts([]);
    startTaskDeferred({
      kind: 'branch',
      title,
      run: async (signal) => {
        const r = await post.mergeMainline(target, commit, scope.trim() || undefined, signal);
        props.onResult(r.message, !r.ok);
        if (r.conflicts?.length) setConflicts(r.conflicts);
        if (r.ok) {
          props.onClose();
          props.onChanged();
        }
        // 结果落盘后再预检一次（冲突时面板里能看到目标工作副本的当前状态）
        post.mergeMainlineCheck(target, scope.trim() || undefined).then(setPlan).catch(() => {});
        return { ok: r.ok, message: r.message };
      },
      onSlow: () => props.onBackground(title, from),
    });
  };

  /** 确认：缺失目标时会先检出，合并与提交在任务里执行 */
  const confirm = () => {
    const target = dir.trim();
    if (!target || !plan) return;
    const willCheckout = plan.targetState === 'missing';
    setCfm({
      willCheckout,
      dir: target,
      confirmLabel: willCheckout ? t('ops.branch.mergeMainlineCheckoutRun') : t('ops.branch.mergeMainlineRun'),
      action: () => run(target, autoCommit),
    });
  };

  return (
    <>
      <ModalShell
        // 合并到主干
        title={t('ops.branch.mergeMainlineTitle')}
        width={600}
        onClose={props.onClose}
        foot={
          <div className="row" style={{ justifyContent: 'flex-end', gap: 6 }}>
            <button onClick={props.onClose}>{t('common.cancel')}</button>
            <button className="primary" disabled={busy || !canRun} onClick={confirm}>
              {/* 检出并合并 / 开始合并 */}
              {plan?.targetState === 'missing' ? t('ops.branch.mergeMainlineCheckoutRun') : t('ops.branch.mergeMainlineRun')}
            </button>
          </div>
        }
      >
        {/* 把当前工作副本的已提交改动合并到主干对应路径。SVN 必须站在目标工作副本上拉取合并。 */}
        <div className="small dim" style={{ margin: '6px 0' }}>{t('ops.branch.mergeMainlineIntro')}</div>
        <div className="small mono" style={{ margin: '4px 0', wordBreak: 'break-all' }}>
          {/* 来源：{url} */}
          {t('ops.branch.mergeMainlineSource', { url: data.currentUrl ?? '' })}
        </div>
        <div className="small mono" style={{ margin: '4px 0', wordBreak: 'break-all' }}>
          {/* 主干目标：{path} */}
          {t('ops.branch.mergeMainlineTarget', { path: data.mainlineRelative ?? data.mainlineUrl ?? '' })}
        </div>
        <div className="small" style={{ margin: '8px 0 4px' }}>
          {/* 本地主干工作副本 */}
          {t('ops.branch.mergeMainlineDirLabel')}
        </div>
        <div className="row" style={{ gap: 6 }}>
          <input
            type="text"
            value={dir}
            onChange={(e) => setDir(e.target.value)}
            onBlur={() => void check(dir.trim())}
            title={dir}
            style={{ flex: 1, minWidth: 0 }}
          />
          <button className="mini" disabled={checking || !dir.trim()} onClick={() => void check(dir.trim())}>
            {/* 检查 */}
            {t('ops.branch.mergeMainlineCheck')}
          </button>
        </div>
        <div className="small" style={{ margin: '8px 0 4px' }}>
          {/* 合并范围（可选） */}
          {t('ops.mergeScope.mainlineLabel')}
        </div>
        <input
          type="text"
          value={scope}
          onChange={(e) => setScope(e.target.value)}
          onBlur={() => void check(dir.trim())}
          placeholder={t('ops.mergeScope.placeholder')}
          style={{ width: '100%' }}
        />
        <div className="small dim" style={{ margin: '4px 0' }}>{t('ops.mergeScope.note')}</div>
        <div className="small" style={{ color: state.color, margin: '4px 0', wordBreak: 'break-all' }}>{state.text}</div>
        {conflicts.length > 0 && (
          <div className="small" style={{ color: 'var(--err)', margin: '4px 0' }}>
            {/* 冲突文件（在目标工作副本中处理）：{files} */}
            {t('ops.branch.mergeMainlineConflicts', { files: conflicts.join(t('common.listSep')) })}
          </div>
        )}
        <label className="row small" style={{ alignItems: 'center', gap: 6, cursor: 'pointer', margin: '6px 0' }}>
          <input type="checkbox" checked={autoCommit} onChange={(e) => setAutoCommit(e.target.checked)} />
          {/* 合并无冲突时自动提交 */}
          {t('ops.branch.mergeMainlineAutoCommit')}
        </label>
      </ModalShell>
      {cfm && (
        <ConfirmModal
          // 合回主干
          title={t('ops.branch.mergeMainlineTitle')}
          message={
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, whiteSpace: 'normal' }}>
              <div>
                {cfm.willCheckout
                  ? t('ops.branch.mergeMainlineCheckoutConfirm', { mainline: plan?.mainlineUrl ?? '', dir: cfm.dir, source: data.currentUrl ?? '' })
                  : t('ops.branch.mergeMainlineConfirm', { source: data.currentUrl ?? '', target: cfm.dir })}
              </div>
              <div className="small dim">
                {autoCommit ? t('ops.branch.mergeMainlineAutoNote') : t('ops.branch.mergeMainlinePendingNote')}
              </div>
              {scope.trim() && <div className="small dim">{t('ops.mergeScope.confirmNote', { path: scope.trim() })}</div>}
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
