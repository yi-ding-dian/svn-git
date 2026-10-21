/** 任务进度块（任务面板行 + 任务详情弹窗共用）——从 header.tsx 抽出以便详情窗复用：
 *  进度条 + 已下载/已上传字节 + 速度 + 预计剩余 + 阶段文案；SVN 检出改显"已检出 N 个文件 · X"。
 *  为什么值得单列：用户实报"一直获取不了"——26 MB 的仓库在 19 KB/s 下要 23 分钟而被 10 分钟上限掐掉，
 *  面板只有"已用 63 秒"，看着和卡死没区别。这里把"在动、多快、还剩多久"直接摆出来。
 *  阶段文案要如实——尤其"正在检出文件…"那段 git 完全静默（没有任何输出），不写出来又成了"不知道什么情况"。 */
import React from 'react';
import { t, type I18nKey } from '../../shared/i18n/index.js';
import type { TaskProgress as TaskProgressInfo } from '../shared/tasks.js';

export function TaskProgress(props: { p: TaskProgressInfo; /** 任务已完成（详情弹窗定格）：不再显示进度条与"正在…"阶段行，只留数值 */ completed?: boolean; /** 紧凑模式（任务面板行）：阶段进度只显示当前一条 */ compact?: boolean }) {
  const p = props.p;
  /** 阶段式进度（项目迁移等无字节/文件进度的长任务）：✓ 已完成 / ⟳ 当前 / ○ 未开始 */
  if (p.steps && p.steps.length > 0) {
    const cur = p.currentStep ?? 0;
    const allDone = Boolean(props.completed) || cur >= p.steps.length;
    if (props.compact) {
      // 面板行只有一行位置：显示当前阶段（全部完成时显示最后一条 + ✓）
      const idx = Math.min(cur, p.steps.length - 1);
      return <div className="dim small">{allDone ? '✓' : '⟳'} {p.steps[idx]}</div>;
    }
    return (
      <div className="small" style={{ margin: '4px 0' }}>
        {p.steps.map((s, i) => {
          const done = allDone || i < cur;
          const active = !allDone && i === cur;
          return (
            <div key={i} style={{ color: done ? 'var(--ok)' : active ? 'var(--accent)' : 'var(--dim)' }}>
              {done ? '✓' : active ? '⟳' : '○'} {s}
            </div>
          );
        })}
      </div>
    );
  }
  /** 百分比按**字节**算（git 自己的百分比是按对象个数，大小极不均匀），没结束前封顶 99% */
  const pct = p.total > 0 ? Math.min(99, Math.round((p.bytes / p.total) * 100)) : null;
  /** 字节 → MB / GB（超过 1 GB 进位——大仓库检出时"1024.0 MB"不如"1.02 GB"直观） */
  const size = (n: number) =>
    n >= 1024 * 1024 * 1024 ? `${(n / 1024 / 1024 / 1024).toFixed(2)} GB` : `${(n / 1024 / 1024).toFixed(1)} MB`;
  const speed = p.speed >= 1024 * 1024 ? `${(p.speed / 1024 / 1024).toFixed(1)} MB` : `${Math.round(p.speed / 1024)} KB`;
  const etaSec = pct !== null && p.speed > 0 && p.bytes < p.total ? Math.round((p.total - p.bytes) / p.speed) : -1;
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
      {(p.bytes > 0 || p.speed > 0) && p.files === undefined && (
        <div className="dim small">
          {pct !== null ? `${pct}% · ` : ''}
          {p.total > 0 ? t('shell.tasks.progressOf', { done: size(p.bytes), total: size(p.total) }) : t(verb, { done: size(p.bytes) })}
          {p.speed > 0 ? ` · ${t('shell.tasks.progressSpeed', { speed })}` : ''}
        </div>
      )}
      {/* 已检出 {n} 个文件 · {size}（SVN 检出：后端周期扫盘上报）；
          切换分支同一条通道只报文件数（没有字节/总大小） */}
      {p.files !== undefined && (
        <div className="dim small">
          {p.phase === 'switch'
            ? t('shell.tasks.switchFiles', { n: p.files.toLocaleString() })
            : t('shell.tasks.checkoutFiles', { n: p.files.toLocaleString(), size: size(p.bytes) })}
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
