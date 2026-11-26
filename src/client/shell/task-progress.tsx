/** 任务进度块（任务面板行 + 任务详情弹窗共用）——从 header.tsx 抽出以便详情窗复用：
 *  进度条 + 已下载/已上传字节 + 速度 + 预计剩余 + 阶段文案；SVN 检出改显"已检出 N 个文件 · X"。
 *  为什么值得单列：用户实报"一直获取不了"——26 MB 的仓库在 19 KB/s 下要 23 分钟而被 10 分钟上限掐掉，
 *  面板只有"已用 63 秒"，看着和卡死没区别。这里把"在动、多快、还剩多久"直接摆出来。
 *  阶段文案要如实——尤其"正在检出文件…"那段 git 完全静默（没有任何输出），不写出来又成了"不知道什么情况"。
 *  阶段式任务（发布）还要显示每个阶段的耗时：完成阶段定格、当前阶段每秒递增。 */
import React, { useEffect, useState } from 'react';
import { t, type I18nKey } from '../../shared/i18n/index.js';
import type { TaskProgress as TaskProgressInfo } from '../shared/tasks.js';

/** 毫秒 → 12s / 1m 5s / 1h 2m（任务阶段耗时、总耗时共用） */
export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

/** 时间戳 → 14:05 / 昨天 14:05 / 11-05 14:05（任务完成时间） */
export function formatClock(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) return `${hh}:${mm}`;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (
    d.getFullYear() === yesterday.getFullYear() &&
    d.getMonth() === yesterday.getMonth() &&
    d.getDate() === yesterday.getDate()
  ) {
    return `昨天 ${hh}:${mm}`;
  }
  if (d.getFullYear() === now.getFullYear()) {
    return `${d.getMonth() + 1}-${String(d.getDate()).padStart(2, '0')} ${hh}:${mm}`;
  }
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${hh}:${mm}`;
}

/** 旋转的 ⟳（用全局 spin 关键帧；static 显示会让人以为卡住） */
function Spinner() {
  return <span style={{ display: 'inline-block', animation: 'spin .8s linear infinite' }}>⟳</span>;
}

export function TaskProgress(props: { p: TaskProgressInfo; /** 任务已完成（详情弹窗定格）：不再显示进度条与"正在…"阶段行，只留数值 */ completed?: boolean; /** 紧凑模式（任务面板行）：阶段进度只显示当前一条 */ compact?: boolean }) {
  const p = props.p;
  /** 阶段耗时每秒刷新（只在有未完成阶段时跑；完成/失败后定格） */
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const cur = p.currentStep ?? 0;
    if (!p.steps?.length || props.completed || cur >= p.steps.length) return;
    const h = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(h);
  }, [p.steps, p.currentStep, props.completed]);

  /** 第 i 个阶段的耗时文案：已完成用下一阶段开始时间，当前阶段用 now */
  const stepTime = (i: number, cur: number, allDone: boolean): string => {
    const started = p.stepStartedAt;
    const start = started?.[i];
    if (start === undefined) return '';
    const end = started?.[i + 1] ?? (i < cur || allDone ? undefined : now);
    if (end === undefined) return '';
    return formatDuration(Math.max(0, end - start));
  };

  /** 阶段式进度（项目迁移、发布等无字节/文件进度的长任务）：✓ 已完成 / ⟳ 当前 / ○ 未开始 */
  if (p.steps && p.steps.length > 0) {
    const cur = p.currentStep ?? 0;
    const allDone = Boolean(props.completed) || cur >= p.steps.length;
    if (props.compact) {
      // 面板行只有一行位置：显示当前阶段（全部完成时显示最后一条 + ✓ + 耗时）
      const idx = Math.min(cur, p.steps.length - 1);
      const dur = stepTime(idx, cur, allDone);
      return (
        <div className="dim small">
          {allDone ? '✓' : <Spinner />} {p.steps[idx]}
          {dur ? ` · ${dur}` : ''}
        </div>
      );
    }
    return (
      <div className="small" style={{ margin: '4px 0' }}>
        {p.steps.map((s, i) => {
          const done = allDone || i < cur;
          const active = !allDone && i === cur;
          const dur = stepTime(i, cur, allDone);
          return (
            <div
              key={i}
              style={{
                color: done ? 'var(--ok)' : active ? 'var(--accent)' : 'var(--dim)',
                display: 'flex',
                gap: 6,
                alignItems: 'baseline',
              }}
            >
              <span style={{ width: 12, flex: '0 0 12px' }}>{done ? '✓' : active ? <Spinner /> : '○'}</span>
              <span style={{ flex: 1 }}>{s}</span>
              {dur && <span className="dim" style={{ whiteSpace: 'nowrap' }}>{dur}</span>}
            </div>
          );
        })}
      </div>
    );
  }

  /** 进度条口径：有总字节（克隆/检出，GitHub API 查到的）按字节算；**拉取没有总字节**，
   *  按 git 报的对象个数画——对象数是 git 明说的，单调且不会因为一个 20 MB 的大文件长时间不动。
   *  没结束前封顶 99% */
  const bytePct = p.total > 0 ? Math.min(99, Math.round((p.bytes / p.total) * 100)) : null;
  const objectPct =
    p.objectsTotal && p.objectsDone !== undefined ? Math.min(99, Math.round((p.objectsDone / p.objectsTotal) * 100)) : null;
  const pct = bytePct ?? objectPct;
  /** 总大小估算（拉取）：已收字节 × 总对象数 ÷ 已完成对象数。对象大小不均匀，只能算"约"；
   *  前 3 个对象样本太少，比例没有意义，不估 */
  const estTotal =
    p.total > 0
      ? p.total
      : p.objectsTotal && p.objectsDone !== undefined && p.objectsDone >= 3
        ? Math.round((p.bytes * p.objectsTotal) / p.objectsDone)
        : 0;
  /** 字节 → MB / GB（超过 1 GB 进位——大仓库检出时"1024.0 MB"不如"1.02 GB"直观） */
  const size = (n: number) =>
    n >= 1024 * 1024 * 1024 ? `${(n / 1024 / 1024 / 1024).toFixed(2)} GB` : `${(n / 1024 / 1024).toFixed(1)} MB`;
  const speed = p.speed >= 1024 * 1024 ? `${(p.speed / 1024 / 1024).toFixed(1)} MB` : `${Math.round(p.speed / 1024)} KB`;
  const etaSec = estTotal > 0 && p.speed > 0 && p.bytes < estTotal ? Math.round((estTotal - p.bytes) / p.speed) : -1;
  const phaseKey = {
    counting: 'shell.tasks.phaseCounting',
    compressing: 'shell.tasks.phaseCompressing',
    receiving: 'shell.tasks.phaseReceiving',
    uploading: 'shell.tasks.phaseUploading',
    waiting: 'shell.tasks.phaseWaiting',
    resolving: 'shell.tasks.phaseResolving',
    checkout: 'shell.tasks.phaseCheckout',
    switch: 'shell.tasks.phaseSwitch',
  }[p.phase] as I18nKey;
  /** 上传类阶段说"已上传"，其余说"已下载"（同一串字节，方向不同） */
  const verb = p.phase === 'uploading' || p.phase === 'waiting' ? 'shell.tasks.uploaded' : 'shell.tasks.downloaded';
  return (
    <>
      {pct !== null && !props.completed && (
        <div style={{ height: 4, background: 'var(--panel2)', borderRadius: 2, margin: '4px 0 3px', overflow: 'hidden' }}>
          <div style={{ width: `${pct}%`, height: '100%', background: 'var(--accent)', transition: 'width .3s' }} />
        </div>
      )}
      {/* 字节/速度行：**还没拿到数值就不显示**——git 在"统计/压缩"阶段不报字节，推送快时
          中间几行也不带，硬显示就是"已上传 0.0 MB"这种看着像卡住的东西。
          SVN 检出（files 有值）让位给下面的"文件数"行（没有总大小、不画进度条） */}
      {(p.bytes > 0 || p.speed > 0 || (p.objectsDone ?? 0) > 0) && p.files === undefined && (
        <div className="dim small">
          {pct !== null ? `${pct}% · ` : ''}
          {/* 拉取的总大小是估算（git 不报），标"约"；算不出来就只说已下载 */}
          {estTotal > p.bytes
            ? t(p.total > 0 ? 'shell.tasks.progressOf' : 'shell.tasks.progressOfEst', { done: size(p.bytes), total: size(estTotal) })
            : t(verb, { done: size(p.bytes) })}
          {p.speed > 0 ? ` · ${t('shell.tasks.progressSpeed', { speed })}` : ''}
          {/* 对象数：拉取的进度条就是按它画的，写出来让用户能对上 */}
          {p.objectsTotal ? ` · ${t('shell.tasks.progressObjects', { done: (p.objectsDone ?? 0).toLocaleString(), total: p.objectsTotal.toLocaleString() })}` : ''}
        </div>
      )}
      {/* 已检出 {n} 个文件 · {size}（SVN 检出：后端按输出行实时计数，字节由扫盘补）；
          切换分支同一条通道只报文件数（没有字节/总大小）。
          字节还没扫到（检出早期 / svn install 前工作目录为空）时只显示文件数，不显示 "0.0 MB" */}
      {p.files !== undefined && (
        <div className="dim small">
          {p.phase === 'switch'
            ? t('shell.tasks.switchFiles', { n: p.files.toLocaleString() })
            : p.bytes > 0
              ? t('shell.tasks.checkoutFiles', { n: p.files.toLocaleString(), size: size(p.bytes) })
              : t('shell.tasks.checkoutFilesNoSize', { n: p.files.toLocaleString() })}
        </div>
      )}
      {/* 本次更新文件清单的摘要（拉取前预扫描；只有 GitHub 远端有）。完整清单在任务详情弹窗 */}
      {p.manifest && (
        <div className="dim small">
          {t('shell.tasks.manifestSummary', {
            n: (p.manifest.counts.A + p.manifest.counts.M + p.manifest.counts.D).toLocaleString(),
            size: size(p.manifest.totalBytes),
          })}
        </div>
      )}
      {!props.completed && (
        <div className="dim small">
          {t(phaseKey)}
          {etaSec >= 60 ? ` · ${t('shell.tasks.etaMin', { n: Math.ceil(etaSec / 60) })}` : etaSec >= 0 ? ` · ${t('shell.tasks.etaSec')}` : ''}
        </div>
      )}
    </>
  );
}
