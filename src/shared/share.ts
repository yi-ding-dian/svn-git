/** 共享访问配置与状态（server / client 共用类型）。
 *
 *  局域网共享的安全模型：
 *   - 本机（127.0.0.1 / ::1）：永远全权限，不占访问名额
 *   - 远程：先通过 IP 白名单（custom）或私网段（lan），再加入会话；远程一律只读
 *   - 人数按 IP 计：同一 IP 刷新/多标签复用同一个会话
 */

export type ShareMode = 'local' | 'lan' | 'custom';

export interface ShareConfig {
  /** local = 仅本机；lan = 局域网（自动放行私网段）；custom = 仅 allow 列表 */
  mode: ShareMode;
  /** 允许访问的 IP 或 CIDR 网段（仅 custom 模式使用） */
  allow: string[];
  /** 远程同时访问人数上限；0 = 不限。默认 1 */
  maxViewers: number;
  /** 远程是否只读。当前产品只支持只读，保留字段便于以后扩展 */
  readOnly: boolean;
  /** 允许远程切换当前项目（默认 false：访客固定看主机当前项目）。
   *  开启后服务端唯一的「当前项目」会被访客切换，主机界面也会跟着变。 */
  allowSwitchProject: boolean;
}

export const DEFAULT_SHARE: ShareConfig = {
  mode: 'local',
  allow: [],
  // 本机不占名额；默认只允许 1 个远程访问者（按 IP 计）
  maxViewers: 1,
  readOnly: true,
  allowSwitchProject: false,
};

/** 本机通知事件：远程有人加入/离开时产生，本机前端轮询后写入「铃铛」通知 */
export interface ShareEvent {
  id: number;
  type: 'join' | 'leave';
  ip: string;
  viewers: number;
  max: number;
  at: number;
}

/** 当前访问者看到的共享状态（GET /api/share/access） */
export interface ShareAccess {
  /** 是否本机访问（本机永远全权限、不占名额） */
  local: boolean;
  /** 远程只读（本机恒 false） */
  readOnly: boolean;
  /** 当前远程在线人数（不含本机） */
  viewers: number;
  /** 人数上限；0 = 不限 */
  max: number;
  mode: ShareMode;
  /** 远程是否允许切换当前项目 */
  allowSwitchProject: boolean;
}

/** 共享配置弹窗数据（GET /api/share，仅本机） */
export interface ShareSettings extends ShareAccess {
  config: ShareConfig;
  /** 本机可用的局域网访问地址（http://ip:port） */
  addresses: string[];
  /** 当前监听端口 */
  port: number;
}
