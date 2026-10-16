/** 任务详情弹窗（点任务面板里的条目打开）：
 *  面板行太窄，这里给完整一张脸——任务名、状态（进行中·已用 N 秒 / 结果）、目标路径、
 *  实时进度（自己有 chan 就每秒轮询，比列表快照更新）、取消按钮。
 *  由 header 的沙漏入口渲染（打开时先关任务面板——面板层级 299/300 会压住 modal 的 100）。 */
import React, { useEffect, useState } from 'react';
import { ModalShell } from './modal-shell.js';
import { get } from '../shared/api.js';
import { useTasks, cancelTask, type TaskProgress as TaskProgressInfo } from '../shared/tasks.js';
import { TaskProgress } from './task-progress.js';
import { CancelCheckoutConfirm } from '../repo/checkout-task.js';
import { t } from '../../shared/i18n/index.js';

export function TaskDetailModal(props: { taskId: number; onClose: () => void }) {
  const tasks = useTasks();
  const task = tasks.find((tk) => tk.id === props.taskId);
  /** 实时进度（弹窗自轮询；任务快照里的 progress 是列表渲染时的旧值） */
  const [progress, setProgress] = useState<TaskProgressInfo | undefined>(task?.progress);
  /** 取消检出的二次确认（半截目录会被清理） */
  const [confirmCancel, setConfirmCancel] = useState(false);
  const chan = task?.chan;
  const running = task?.status === 'running';
  useEffect(() => {
    if (!chan || !running) return;
    const timer = setInterval(() => {
      void get
        .transferProgress(chan)
        .then((r) => {
          if (r.ok) setProgress({ phase: r.phase!, bytes: r.bytes ?? 0, speed: r.speed ?? 0, total: r.total ?? 0, files: r.files });
        })
        .catch(() => {
          /* 轮询失败不打扰：保持上一次的进度 */
        });
    }, 1000);
    return () => clearInterval(timer);
  }, [chan, running]);
  /** 已用秒数每秒刷新（进行中）；结束的任务取固定值 */
  const [, force] = useState(0);
  useEffect(() => {
    if (!running) return;
    const h = window.setInterval(() => force((n) => n + 1), 1000);
    return () => window.clearInterval(h);
  }, [running]);
  if (!task) return null; // 任务对象没了（理论上不会——快照保留已完成的任务）
  const elapsed = Math.max(0, Math.floor(((task.endedAt ?? Date.now()) - task.startedAt) / 1000));
  // 检出结果详情（后端随任务带回，kind='checkout'）：完成后像「更新结果」窗一样列文件清单 + svn 警告
  const detail = task.data as
    | { kind?: string; dir?: string; files?: { code: string; path: string }[]; fileTotal?: number; warnings?: string[] }
    | undefined;
  const isCheckout = detail?.kind === 'checkout';
  const files = !running && isCheckout ? (detail?.files ?? []) : [];
  const fileTotal = detail?.fileTotal ?? files.length;
  const warnings = !running && isCheckout ? (detail?.warnings ?? []) : [];
  /** 状态字母统计（A 新增 / U 更新 / …） */
  const stats = new Map<string, number>();
  for (const f of files) stats.set(f.code, (stats.get(f.code) ?? 0) + 1);
  const status =
    task.status === 'running'
      ? // 进行中 · 已用 {n} 秒
        t('shell.tasks.detailRunning', { n: elapsed })
      : task.status === 'done'
        ? // 已完成
          t('shell.tasks.detailDone')
        : task.status === 'cancelled'
          ? // 已取消
            t('shell.tasks.detailCancelled')
          : // 失败
            t('shell.tasks.detailError');
  return (
    <ModalShell
      icon="⏳"
      // 任务详情
      title={t('shell.tasks.detailTitle')}
      onClose={props.onClose}
      // 有检出清单时宽一点（路径长，像「更新结果」窗的宽度惯例）
      width={files.length > 0 || warnings.length > 0 ? 640 : 420}
      closeIcon
      foot={
        running ? (
          <>
            <button onClick={props.onClose}>{t('common.close')}</button>
            <button
              className="primary"
              onClick={() => {
                // 检出要二次确认（半截目录会被清理）；其余任务（推拉等）直接取消
                if (task.kind === 'checkout') {
                  setConfirmCancel(true);
                  return;
                }
                cancelTask(task.id);
                props.onClose();
              }}
            >
              {t('common.cancel')}
            </button>
          </>
        ) : (
          <button className="primary" onClick={props.onClose}>
            {t('common.close')}
          </button>
        )
      }
    >
      <div className="small" style={{ marginBottom: 6 }}>
        <span className="dim">{t('shell.tasks.detailTask')}：</span>
        {task.title}
      </div>
      <div className="small" style={{ marginBottom: 6 }} title={task.status === 'error' ? task.message : undefined}>
        <span className="dim">{t('shell.tasks.detailStatus')}：</span>
        {status}
        {/* 失败时不在状态行重复 message（完整多行内容在下面的 svn 警告/错误区；此处悬停看摘要） */}
        {task.message && task.status !== 'error' ? <span className="dim"> — {task.message}</span> : null}
      </div>
      {task.chan ? (
        <div className="small" style={{ marginBottom: 10 }}>
          <span className="dim">{t('shell.tasks.detailTarget')}：</span>
          <span className="mono" style={{ wordBreak: 'break-all' }}>{task.chan}</span>
        </div>
      ) : null}
      {/* 无进度的任务（如部分本地操作）不显示进度区；已完成时定格数值（不显"正在…"） */}
      {progress && (
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 8 }}>
          <TaskProgress p={progress} completed={!running} />
        </div>
      )}
      {/* 检出文件清单（像「更新结果」窗：状态字母 + 路径；超 2000 条只显示前段） */}
      {files.length > 0 && (
        <div style={{ borderTop: '1px solid var(--border)', marginTop: 8, paddingTop: 8 }}>
          <div className="dim small" style={{ marginBottom: 6 }}>
            {/* 检出文件（共 {n} 个） */}
            {t('shell.tasks.detailFiles', { n: fileTotal.toLocaleString() })}
            {[...stats.entries()].map(([c, n]) => (
              <span key={c} className="mono" style={{ marginLeft: 8, color: c === 'A' ? 'var(--ok)' : 'var(--accent)' }}>
                {c} {n}
              </span>
            ))}
          </div>
          <div className="vcs-list" style={{ maxHeight: 240, minHeight: 60 }}>
            {files.map((f, i) => (
              <div key={i} className="vcs-row" style={{ cursor: 'default' }}>
                <span className="mono small nowrap" style={{ width: 30, textAlign: 'center', fontWeight: 700, color: f.code === 'A' ? 'var(--ok)' : 'var(--accent)' }}>
                  {f.code}
                </span>
                <span className="mono small" style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={f.path}>
                  {f.path}
                </span>
              </div>
            ))}
          </div>
          {fileTotal > files.length && (
            <div className="dim small" style={{ marginTop: 4 }}>
              {/* （仅显示前 {m} 条） */}
              {t('shell.tasks.detailFilesMore', { m: files.length })}
            </div>
          )}
        </div>
      )}
      {/* svn 警告（stderr 带回的原文，如外部定义失败 W205011…）：有什么提示什么 */}
      {warnings.length > 0 && (
        <div style={{ marginTop: 10, background: 'rgba(212,167,50,.10)', border: '1px solid var(--warn)', borderRadius: 8, padding: '8px 12px' }}>
          <div className="small" style={{ color: 'var(--warn)', fontWeight: 600, marginBottom: 6 }}>
            {/* ⚠ svn 警告（{n} 条） */}
            {t('shell.tasks.detailWarnings', { n: warnings.length })}
          </div>
          <div className="mono small" style={{ whiteSpace: 'pre-wrap', maxHeight: 160, overflow: 'auto', color: 'var(--warn)', lineHeight: 1.6 }}>
            {warnings.join('\n')}
          </div>
        </div>
      )}
      {/* 取消检出二次确认（叠在本窗上；确认后取消任务并关本窗） */}
      {confirmCancel && (
        <CancelCheckoutConfirm
          onKeep={() => setConfirmCancel(false)}
          onCancel={() => {
            cancelTask(task.id);
            props.onClose();
          }}
        />
      )}
    </ModalShell>
  );
}
