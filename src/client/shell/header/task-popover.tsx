/** 后台任务面板：进行中 + 已完成任务。
 *  完成/失败的任务保留在这里（直到用户点「清除已完成」），阶段耗时和总耗时都能回看；
 *  铃铛通知仍单独保留。 */
import React, { useEffect, useState } from 'react';
import { useTasks, cancelTask, removeTask, type BgTask } from '../../shared/tasks.js';
import { TaskProgress, formatDuration, formatClock } from '../task-progress.js';
import { t } from '../../../shared/i18n/index.js';
import { IconHourglassRun } from '../../ui/icons.js';

export function TaskPopover(props: { x: number; y: number; onClose: () => void; onOpenDetail: (id: number) => void; onRequestCancel: (id: number) => void }) {
  const tasks = useTasks();
  const [, force] = useState(0);
  useEffect(() => {
    const h = window.setInterval(() => force((n) => n + 1), 1000);
    return () => window.clearInterval(h);
  }, []);
  const running = tasks.filter((tk) => tk.status === 'running');
  // 已完成按结束时间倒序（最近完成的在上）；少于 3 个时默认展开阶段
  const finished = tasks
    .filter((tk) => tk.status !== 'running')
    .sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0));
  const defaultExpanded = finished.length < 3;
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  const now = Date.now();

  const statusIcon = (tk: BgTask) => {
    if (tk.status === 'running') return <IconHourglassRun size={14} />;
    if (tk.status === 'done') return <span style={{ color: 'var(--ok)' }}>✓</span>;
    if (tk.status === 'error') return <span style={{ color: 'var(--err)' }}>✗</span>;
    return <span className="dim">—</span>;
  };

  const row = (tk: BgTask) => {
    const open = tk.status !== 'running' && (expanded[tk.id] ?? defaultExpanded);
    const toggle = () => {
      if (tk.status === 'running') {
        props.onOpenDetail(tk.id);
        return;
      }
      setExpanded((prev) => ({ ...prev, [tk.id]: !(prev[tk.id] ?? defaultExpanded) }));
    };
    return (
      <div
        key={tk.id}
        className="row"
        style={{ gap: 8, padding: 6, alignItems: 'center', cursor: 'pointer' }}
        title={
          tk.status === 'running'
            ? t('shell.tasks.clickDetail')
            : open
              ? t('shell.tasks.collapseSteps')
              : t('shell.tasks.expandSteps')
        }
        onClick={toggle}
      >
        {statusIcon(tk)}
        <span style={{ flex: 1, minWidth: 0 }}>
          <div className="small" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={tk.title}>
            {tk.status !== 'running' && (
              <span className="dim" style={{ marginRight: 4 }}>{open ? '▾' : '▸'}</span>
            )}
            {tk.title}
          </div>
          {tk.message && (
            <div className="dim small" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={tk.message}>
              {tk.message}
            </div>
          )}
          {/* 运行中始终展开；已完成少于 3 个默认展开，否则点击任务行展开 */}
          {tk.progress && (tk.status === 'running' || open) && (
            <TaskProgress p={tk.progress} compact={!tk.progress.steps} completed={tk.status !== 'running'} />
          )}
          {/* 总耗时：运行中实时递增，完成后定格；已完成再补完成时间 */}
          <div className="dim small" style={{ marginTop: 2 }}>
            {t('shell.tasks.totalTime', { time: formatDuration((tk.endedAt ?? now) - tk.startedAt) })}
            {tk.endedAt && (
              <span> · {t('shell.tasks.completedAt', { time: formatClock(tk.endedAt) })}</span>
            )}
          </div>
        </span>
        {tk.status === 'running' ? (
          <button
            className="mini"
            onClick={(e) => {
              e.stopPropagation();
              if (tk.kind === 'checkout') props.onRequestCancel(tk.id);
              else cancelTask(tk.id);
            }}
          >
            {t('common.cancel')}
          </button>
        ) : (
          <button
            className="mini"
            onClick={(e) => {
              e.stopPropagation();
              props.onOpenDetail(tk.id);
            }}
          >
            {t('shell.tasks.detail')}
          </button>
        )}
      </div>
    );
  };

  return (
    <>
      {/* 点击面板外关闭（右键也关，避免菜单叠菜单） */}
      <div
        style={{ position: 'fixed', inset: 0, zIndex: 299 }}
        onClick={props.onClose}
        onContextMenu={(ev) => {
          ev.preventDefault();
          props.onClose();
        }}
      />
      <div
        className="ctx-menu"
        style={{ position: 'fixed', right: Math.max(8, window.innerWidth - props.x), top: props.y, minWidth: 320, maxWidth: 420, padding: 8, maxHeight: '70vh', overflow: 'auto' }}
      >
        {running.length > 0 && (
          <>
            <div className="dim small" style={{ padding: '2px 6px 4px' }}>{t('shell.tasks.running')}</div>
            {running.map(row)}
          </>
        )}
        {finished.length > 0 && (
          <>
            <div className="dim small" style={{ padding: '6px 6px 4px', borderTop: running.length > 0 ? '1px solid var(--border)' : undefined }}>
              {t('shell.tasks.finished')}
            </div>
            {finished.map(row)}
            <div style={{ padding: '6px 6px 2px' }}>
              <button
                className="mini"
                onClick={() => finished.forEach((tk) => removeTask(tk.id))}
              >
                {t('shell.tasks.clearFinished')}
              </button>
            </div>
          </>
        )}
      </div>
    </>
  );
}
