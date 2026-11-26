/** 任务详情弹窗（点任务面板里的条目打开）：
 *  面板行太窄，这里给完整一张脸——任务名、状态（进行中·已用 N 秒 / 结果）、目标路径、
 *  实时进度（自己有 chan 就每秒轮询，比列表快照更新）、取消按钮。
 *  由 header 的沙漏入口渲染（打开时先关任务面板——面板层级 299/300 会压住 modal 的 100）。 */
import React, { useEffect, useState } from 'react';
import { ModalShell } from '../ui/modal-shell.js';
import { get } from '../shared/api.js';
import { useTasks, cancelTask, type TaskProgress as TaskProgressInfo } from '../shared/tasks.js';
import { TaskProgress, formatDuration, formatClock } from './task-progress.js';
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
          if (r.ok)
            setProgress({
              phase: r.phase!,
              bytes: r.bytes ?? 0,
              speed: r.speed ?? 0,
              total: r.total ?? 0,
              files: r.files,
              steps: r.steps,
              currentStep: r.currentStep,
              objectsDone: r.objectsDone,
              objectsTotal: r.objectsTotal,
              manifest: r.manifest,
            });
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
    | {
        kind?: string;
        dir?: string;
        files?: { code: string; path: string }[];
        fileTotal?: number;
        warnings?: string[];
        /** 失败时的原始命令输出（获取仓库任务带回；没有就退回 message） */
        errorDetail?: string;
      }
    | undefined;
  const isCheckout = detail?.kind === 'checkout';
  const files = !running && isCheckout ? (detail?.files ?? []) : [];
  const fileTotal = detail?.fileTotal ?? files.length;
  // 警告：检出路径（checkout）与获取仓库（get，如 SVN 外部引用 E205011 同步失败但主体成功）都会带
  const warnings = !running ? (detail?.warnings ?? []) : [];
  /** 状态字母统计（A 新增 / U 更新 / …） */
  const stats = new Map<string, number>();
  for (const f of files) stats.set(f.code, (stats.get(f.code) ?? 0) + 1);
  /** 更新清单（拉取前预扫描）：git 不提供单文件实时进度，这里列的是"这次会下哪些文件" */
  const manifest = progress?.manifest;
  /** 失败原因：优先原始命令输出（克隆的 stderr 含走到哪一步 + 末尾的 fatal 行），
   *  没有就退回归纳后的 message——任务面板行放不下，这里必须给全文 */
  const errorText = task.status === 'error' ? detail?.errorDetail || task.message || '' : '';
  const manifestTotal = manifest ? manifest.counts.A + manifest.counts.M + manifest.counts.D : 0;
  /** 单文件大小：KB/MB/GB（总大小用 TaskProgress 的 size 口径，这里要能显示 3 KB 这种小文件） */
  const fmtFileSize = (n: number) =>
    n >= 1024 * 1024 * 1024
      ? `${(n / 1024 ** 3).toFixed(2)} GB`
      : n >= 1024 * 1024
        ? `${(n / 1024 ** 2).toFixed(2)} MB`
        : n >= 1024
          ? `${Math.round(n / 1024)} KB`
          : `${n} B`;
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
          {/* 拉取通道形如 pull:<仓库根>（仅供轮询区分仓库），显示时去掉前缀只留路径 */}
          <span className="mono" style={{ wordBreak: 'break-all' }}>{task.chan.replace(/^pull:/, '')}</span>
        </div>
      ) : null}
      {/* 失败原因：任务面板行只有一行、且被省略号截断（首行永远是 `Cloning into…`）——
          详情窗必须把真正的原因（末尾的 fatal/error 行）原样露出来 */}
      {errorText && (
        <div className="error" style={{ marginBottom: 10 }}>
          <div className="small" style={{ fontWeight: 600, marginBottom: 6 }}>{t('shell.tasks.detailErrorDetail')}</div>
          <div className="mono small" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: 220, overflow: 'auto', lineHeight: 1.6 }}>
            {errorText}
          </div>
        </div>
      )}
      {/* 无进度的任务（如部分本地操作）不显示进度区；已完成时定格数值（不显"正在…"） */}
      {progress && (
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 8 }}>
          <TaskProgress p={progress} completed={!running} />
          {/* 总耗时放底部：完成/失败后定格；已完成显示完成时间 */}
          <div className="dim small" style={{ marginTop: 6 }}>
            {t('shell.tasks.totalTime', {
              time: formatDuration((task.endedAt ?? Date.now()) - task.startedAt),
            })}
            {task.endedAt && (
              <span> · {t('shell.tasks.completedAt', { time: formatClock(task.endedAt) })}</span>
            )}
          </div>
        </div>
      )}
      {/* 更新清单（拉取前预扫描的"这次会下哪些文件"，GitHub 远端才有）。
          git 的传输协议不提供单文件实时进度，所以这里只列文件与大小，不标"正在下/已完成"——
          总进度在上面的进度条（按对象数）与已下载字节里。 */}
      {manifest && (
        <div style={{ borderTop: '1px solid var(--border)', marginTop: 8, paddingTop: 8 }}>
          <div className="dim small" style={{ marginBottom: 6 }}>
            {t('shell.tasks.manifestTitle', { n: manifestTotal.toLocaleString(), size: fmtFileSize(manifest.totalBytes) })}
            <span className="mono" style={{ marginLeft: 8, color: 'var(--ok)' }}>A {manifest.counts.A}</span>
            <span className="mono" style={{ marginLeft: 8, color: 'var(--accent)' }}>M {manifest.counts.M}</span>
            <span className="mono" style={{ marginLeft: 8, color: 'var(--err)' }}>D {manifest.counts.D}</span>
          </div>
          <div className="vcs-list" style={{ maxHeight: 240, minHeight: 60 }}>
            {manifest.files.map((f) => (
              <div key={`${f.status}:${f.path}`} className="vcs-row" style={{ cursor: 'default' }}>
                <span
                  className="mono small nowrap"
                  style={{
                    width: 30,
                    textAlign: 'center',
                    fontWeight: 700,
                    color: f.status === 'A' ? 'var(--ok)' : f.status === 'D' ? 'var(--err)' : 'var(--accent)',
                  }}
                >
                  {f.status}
                </span>
                <span
                  className="mono small"
                  style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                  title={f.path}
                >
                  {f.path}
                </span>
                <span className="dim mono small nowrap" style={{ marginLeft: 8 }}>
                  {f.status === 'D' ? '—' : fmtFileSize(f.size)}
                </span>
              </div>
            ))}
          </div>
          {manifest.truncated && (
            <div className="dim small" style={{ marginTop: 4 }}>
              {t('shell.tasks.manifestTruncated', { n: manifest.files.length.toLocaleString() })}
            </div>
          )}
          <div className="dim small" style={{ marginTop: 4 }}>
            {t('shell.tasks.manifestNote')}
          </div>
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
