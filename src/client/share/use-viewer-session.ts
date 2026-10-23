/** 共享访问会话：页面启动时加入会话，成功后每 10 秒心跳；满员时自动重试。
 *
 *  为什么按 IP 计数：同一台设备刷新/多开标签复用同一会话，不重复占名额。
 *  关闭页面用 sendBeacon 通知服务端立即释放；强杀/断网由服务端 30 秒超时兜底。
 */
import { useEffect, useRef, useState } from 'react';
import { post } from '../shared/api.js';
import type { ShareAccess } from '../../shared/share.js';

export type ViewerState = 'checking' | 'ok' | 'full' | 'denied';

/** 满员时的重试间隔：有人退出后自动进入，无需手动刷新 */
const RETRY_FULL_MS = 10_000;
/** 无法访问/服务重启中：稍快重试，恢复后自动进入 */
const RETRY_DENIED_MS = 5_000;
/** 心跳间隔（服务端 30 秒超时，留足容错） */
const HEARTBEAT_MS = 10_000;

export function useViewerSession(): { state: ViewerState; info: ShareAccess | null } {
  const [state, setState] = useState<ViewerState>('checking');
  const [info, setInfo] = useState<ShareAccess | null>(null);
  const aliveRef = useRef(true);
  const timerRef = useRef<number | null>(null);
  const hbRef = useRef<number | null>(null);

  useEffect(() => {
    aliveRef.current = true;

    const clearTimers = () => {
      if (timerRef.current != null) window.clearTimeout(timerRef.current);
      if (hbRef.current != null) window.clearInterval(hbRef.current);
      timerRef.current = null;
      hbRef.current = null;
    };

    /** 加入成功后开始心跳；心跳返回满员说明会话被挤出（理论上不会），回到等待页 */
    const startHeartbeat = () => {
      if (hbRef.current != null) return;
      hbRef.current = window.setInterval(() => {
        post
          .shareHeartbeat()
          .then((r) => {
            if (!aliveRef.current) return;
            if (r.ok) setInfo(r);
            else {
              setInfo(r);
              setState('full');
              clearTimers();
              scheduleJoin(RETRY_FULL_MS);
            }
          })
          .catch(() => {
            if (!aliveRef.current) return;
            // 服务暂时不可达（重启中/网络抖动）：停止心跳，走重新加入
            clearTimers();
            setState('denied');
            scheduleJoin(RETRY_DENIED_MS);
          });
      }, HEARTBEAT_MS);
    };

    const scheduleJoin = (ms: number) => {
      if (timerRef.current != null) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => void join(), ms);
    };

    const join = async () => {
      try {
        const r = await post.shareJoin();
        if (!aliveRef.current) return;
        setInfo(r);
        if (r.ok) {
          setState('ok');
          startHeartbeat();
        } else {
          setState('full');
          scheduleJoin(RETRY_FULL_MS);
        }
      } catch {
        if (!aliveRef.current) return;
        // IP 不在白名单 / 服务刚重启 / 网络不可达：统一显示无法访问，并继续重试
        setState('denied');
        scheduleJoin(RETRY_DENIED_MS);
      }
    };

    // 关闭页面立即释放名额（sendBeacon 在页面卸载时仍能发出）
    const leave = () => {
      navigator.sendBeacon('/api/share/leave');
    };
    window.addEventListener('pagehide', leave);
    void join();

    return () => {
      aliveRef.current = false;
      clearTimers();
      window.removeEventListener('pagehide', leave);
    };
  }, []);

  return { state, info };
}
