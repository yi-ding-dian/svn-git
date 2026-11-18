/** 共享访问状态监听：从 app.tsx 原样抽出。
 *
 *  本机开启局域网共享时轮询远程加入/离开事件（since=-1 首次只记游标，不补发历史事件），
 *  事件写入铃铛通知。返回值是 useShareStatus 的订阅结果（视图渲染也要用）。
 */
import { useEffect } from 'react';
import { get } from '../shared/api.js';
import { addNotice } from '../shared/notices.js';
import { useShareStatus } from '../share/share-context.js';
import { t } from '../../shared/i18n/index.js';

export function useShareWatch() {
  /** 共享访问状态：本机在开启局域网共享时轮询远程加入/离开事件 */
  const shareStatus = useShareStatus();
  const shareLocal = shareStatus?.local ?? true;
  const shareMode = shareStatus?.mode ?? 'local';
  useEffect(() => {
    // 只有本机需要接收远程加入/离开通知
    if (!shareLocal || shareMode === 'local') return;
    // since=-1 表示首次调用：只记录游标，不补发历史事件（避免每次刷新都弹一堆旧通知）
    let since = -1;
    let alive = true;
    const poll = async () => {
      if (!alive) return;
      try {
        const r = await get.shareEvents(since < 0 ? Number.MAX_SAFE_INTEGER : since);
        if (!alive) return;
        if (since < 0) {
          since = r.lastId;
          return;
        }
        if (r.events.length === 0) return;
        since = r.lastId;
        for (const e of r.events) {
          addNotice({
            title: t('share.noticeTitle'),
            message: t(e.type === 'join' ? 'share.noticeJoin' : 'share.noticeLeave', {
              ip: e.ip,
              n: e.viewers,
              max: e.max > 0 ? e.max : '∞',
            }),
            err: false,
          });
        }
      } catch {
        /* 服务重启/网络抖动：下一轮再试 */
      }
    };
    const timer = window.setInterval(() => void poll(), 3000);
    void poll();
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [shareLocal, shareMode]);
  return shareStatus;
}
