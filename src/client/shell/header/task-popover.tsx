/** 后台任务面板：进行中任务列表 + 取消入口（完成结果归铃铛面板留档）。 */
import React, { useEffect, useRef, useState } from 'react';
import { useTasks, cancelTask } from '../../shared/tasks.js';
import { TaskProgress } from '../task-progress.js';
import { t } from '../../../shared/i18n/index.js';
import { IconHourglassRun } from '../../ui/icons.js';

/** 后台任务面板：进行中（沙漏/已用秒/[取消]）——完成结果归铃铛（NoticePopover）留档，不在这里重复。
 *  运行中的"已用 n 秒"每秒刷新（面板开着才 tick）；点空白/Esc…… 面板同 ContextMenu 的 mask 手法 */
export function TaskPopover(props: { x: number; y: number; onClose: () => void; onOpenDetail: (id: number) => void; onRequestCancel: (id: number) => void }) {
  const tasks = useTasks();
  const [, force] = useState(0);
  useEffect(() => {
    const h = window.setInterval(() => force((n) => n + 1), 1000);
    return () => window.clearInterval(h);
  }, []);
  const running = tasks.filter((tk) => tk.status === 'running');
  // 进行中清空（全部完成/取消）→ 自动收起：只剩空态没有留着的意义。
  // 用 prev 判"从有到无"——空闲时打开（running 本来就是 0）不误关
  const prevRunningRef = useRef(running.length);
  useEffect(() => {
    if (prevRunningRef.current > 0 && running.length === 0) props.onClose();
    prevRunningRef.current = running.length;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running.length]);
  const now = Date.now();
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
        style={{ position: 'fixed', right: Math.max(8, window.innerWidth - props.x), top: props.y, minWidth: 300, maxWidth: 380, padding: 8 }}
      >
        {/* 进行中（面板只在有任务时能打开——指示器仅运行中显示；全完成后 prevRef 会把它自动收起） */}
        <div className="dim small" style={{ padding: '2px 6px 4px' }}>{t('shell.tasks.running')}</div>
        {running.map((tk) => (
          // 点击任务行 = 打开详情弹窗（由上层渲染并先关面板：面板层级 299/300 会压住 modal 的 100）
          <div
            key={tk.id}
            className="row"
            style={{ gap: 8, padding: 6, alignItems: 'center', cursor: 'pointer' }}
            // 点击查看任务详情
            title={t('shell.tasks.clickDetail')}
            onClick={() => props.onOpenDetail(tk.id)}
          >
            <IconHourglassRun size={14} />
            <span style={{ flex: 1, minWidth: 0 }}>
              <div className="small" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={tk.title}>{tk.title}</div>
              {/* 已用 {n} 秒 */}
              <div className="dim small">{t('shell.tasks.elapsed', { n: Math.max(0, Math.floor((now - tk.startedAt) / 1000)) })}</div>
              {tk.progress && <TaskProgress p={tk.progress} />}
            </span>
            {/* 取消（不让点击冒泡到"打开详情"）；检出要二次确认（半截目录会被清理）——交上层弹确认 */}
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
          </div>
        ))}
      </div>
    </>
  );
}
