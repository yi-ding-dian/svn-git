/** 任务通知面板（铃铛）：完成/失败通知列表 + 详情入口。 */
import React, { useEffect, useState } from 'react';
import { useNotices, markAllRead, removeNotice } from '../../shared/notices.js';
import { UpdateResultModal, type UpdateResultDetail } from '../../ops/update-result.js';
import { InfoModal } from '../../ui/prompt.js';
import { t } from '../../../shared/i18n/index.js';
import { IconOk, IconErr } from '../../ui/icons.js';

/** 通知里的「更新结果」详情判别：detail 由任务 data 透传（app 的完成观察者），
 *  带 kind='update' 的通知行才可点开「更新结果」窗；其余通知行不可点 */
function asUpdateDetail(d: unknown): UpdateResultDetail | null {
  const o = d as { kind?: string } | null;
  return o && o.kind === 'update' ? (d as UpdateResultDetail) : null;
}

/** 任务通知面板（铃铛）：完成/失败通知列表——✓/✗ + 标题 + 消息 + 时间 + [×]逐条关闭；
 *  带更新详情的行可点开「更新结果」窗（文件清单/警告——更新不再自动弹，详情从这里看）；
 *  打开即全部已读（红点消失）；全部关掉 → 铃铛随之消失（父层条件渲染），面板自动收起 */
export function NoticePopover(props: { x: number; y: number; onClose: () => void; onOpenTaskDetail: (id: number) => void }) {
  const notices = useNotices();
  /** 打开的「更新结果」详情窗（点面板里带「详情 ▸」的通知行） */
  const [detail, setDetail] = useState<UpdateResultDetail | null>(null);
  /** 「全文」小窗（无更新详情的通知——消息被两行截断后，点开看完整内容） */
  const [fullMsg, setFullMsg] = useState<{ title: string; message: string } | null>(null);
  // 打开即已读（放 effect 里，避免渲染期改 store）
  useEffect(() => {
    markAllRead();
  }, []);
  // 全部关闭（铃铛消失）→ 面板自动收起
  useEffect(() => {
    if (notices.length === 0) props.onClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notices.length]);
  /** HH:MM（通知面板的时间戳；数字格式不入 i18n） */
  const hm = (at: number) => {
    const d = new Date(at);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
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
        // maxHeight + 滚动：通知多了不顶出屏幕（用户定稿：列表超出加滚动）
        style={{ position: 'fixed', right: Math.max(8, window.innerWidth - props.x), top: props.y, minWidth: 320, maxWidth: 430, padding: 8, maxHeight: 'min(70vh, 480px)', overflowY: 'auto' }}
      >
        {notices.map((n) => {
          const ud = asUpdateDetail(n.detail);
          // 检出完成的通知（detail.kind='checkout' 且带来源任务）→ 点开「任务详情」窗（列检出文件清单/警告）
          const coTaskId = n.taskId != null && (n.detail as { kind?: string } | null)?.kind === 'checkout' ? n.taskId : null;
          // 更新详情 → 「更新结果」窗；检出详情 → 「任务详情」窗；否则有消息就点开「全文」小窗；都没有 = 不可点
          const clickable = Boolean(ud || coTaskId !== null || n.message);
          return (
            <div
              key={n.id}
              className="row"
              style={{ gap: 8, padding: 6, alignItems: 'flex-start', cursor: clickable ? 'pointer' : undefined }}
              title={clickable ? t('shell.notify.detailTip') : undefined}
              onClick={clickable ? () => (ud ? setDetail(ud) : coTaskId !== null ? props.onOpenTaskDetail(coTaskId) : setFullMsg({ title: n.title, message: n.message })) : undefined}
            >
              <span style={{ flexShrink: 0, display: 'inline-flex', marginTop: 2, color: n.err ? 'var(--err)' : 'var(--ok)' }}>
                {n.err ? <IconErr /> : <IconOk />}
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <div className="row" style={{ gap: 6, alignItems: 'baseline' }}>
                  <span className="small" style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={n.title}>{n.title}</span>
                  <span className="dim small nowrap" style={{ marginLeft: 'auto', flexShrink: 0 }}>{hm(n.at)}</span>
                </div>
                {n.message && (
                  // 消息**最多两行**（超出截断成 …）——想细看点行开弹窗（用户定稿）
                  <div
                    className={n.err ? 'small' : 'dim small'}
                    style={{
                      color: n.err ? 'var(--err)' : undefined,
                      marginTop: 1,
                      display: '-webkit-box',
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical',
                      overflow: 'hidden',
                      wordBreak: 'break-all',
                    }}
                    title={n.message}
                  >
                    {n.message}
                  </div>
                )}
              </span>
              <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
                {/* 详情（点击查看更新文件清单/警告 或 检出文件清单） */}
                {(ud || coTaskId !== null) && <span className="dim small nowrap">{t('shell.notify.detail')} ▸</span>}
                {/* 关闭这条通知（stopPropagation：行可点时点 × 不应打开详情） */}
                <button className="mini" title={t('shell.notify.removeTip')} onClick={(e) => { e.stopPropagation(); removeNotice(n.id); }}>×</button>
              </span>
            </div>
          );
        })}
      </div>
      {/* 更新结果详情窗（从面板点开；关闭后回到面板） */}
      {detail && <UpdateResultModal {...detail} onClose={() => setDetail(null)} />}
      {/* 通知全文小窗（消息两行截断后的完整内容；zIndex 460 高于面板与气泡） */}
      {fullMsg && (
        <InfoModal
          title={fullMsg.title}
          message={<span style={{ wordBreak: 'break-all' }}>{fullMsg.message}</span>}
          onClose={() => setFullMsg(null)}
          zIndex={460}
        />
      )}
    </>
  );
}
