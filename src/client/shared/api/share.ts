/** 局域网共享（本机配置 / 加入会话）相关 API。 */
import { api, json } from './core.js';
import type { ShareAccess, ShareConfig, ShareEvent, ShareSettings } from '../../../shared/share.js';

export const getShare = {
  /** 共享配置（仅本机调用） */
  share: () => api<ShareSettings>('/api/share'),
  /** 当前访问者状态（本机/远程、只读、在线人数） */
  shareAccess: () => api<ShareAccess>('/api/share/access'),
  /** 本机：远程加入事件（共享通知） */
  shareEvents: (since: number) =>
    api<{ events: ShareEvent[]; lastId: number }>(`/api/share/events?since=${since}`),
};

export const postShare = {
  /** 保存共享配置（仅本机） */
  shareSave: (config: ShareConfig) => api<{ ok: boolean; config: ShareConfig }>('/api/share', json(config)),
  /** 保存后重启服务（仅本机） */
  shareRestart: () => api<{ ok: boolean }>('/api/share/restart', json({})),
  /** 加入共享会话：满员时 ok=false / full=true（不是 HTTP 错误） */
  shareJoin: (signal?: AbortSignal) =>
    api<{ ok: boolean; full?: boolean } & ShareAccess>('/api/share/join', json({}, signal)),
  /** 心跳：会话过期时服务端会尝试重新加入，返回 ok=false 表示已满 */
  shareHeartbeat: () => api<{ ok: boolean; full?: boolean } & ShareAccess>('/api/share/heartbeat', json({})),
};
