/** 共享访问门禁：在 API 分发前判断来源 IP、白名单、会话与只读。
 *
 *  规则（按顺序）：
 *   1. 本机（127.0.0.1 / ::1）：全权限，不占名额
 *   2. 远程：IP 必须在共享白名单内（lan = 私网段，custom = allow 列表）
 *   3. 静态资源放行（满员页/等待页本身也要能加载）
 *   4. 加入/心跳/离开/状态这 4 个握手接口放行
 *   5. 其余 API：必须先加入会话；远程一律只读（非 GET 全部 403）
 *
 *  只读是后端硬限制，不依赖前端隐藏按钮。
 */
import type http from 'node:http';
import { loadConfig } from '../config.js';
import type { ShareConfig } from '../shared/share.js';
import { t } from '../shared/i18n/index.js';
import { isLocalIp, ipAllowed, normalizeIp, touchViewer } from './share/session.js';

/** 握手接口：未加入会话也可访问（否则远程页面无法显示满员/等待页） */
const HANDSHAKE_PATHS = new Set(['/api/share/join', '/api/share/heartbeat', '/api/share/leave', '/api/share/access']);

/** 即使开了「可读写」也只允许本机调用的接口：关机、终端、打开/安装类操作。
 *  这些能力等于直接控制本机，不能因为共享权限放宽就暴露给局域网。 */
const LOCAL_ONLY_PATHS = new Set([
  '/api/shutdown',
  '/api/open-url',
  '/api/open-with',
  '/api/open-in-browser',
  '/api/pick-dir',
  '/api/env-install/stream',
  '/api/run-script',
  '/api/app-menu',
  '/api/share',
  '/api/share/restart',
  '/api/share/events',
]);
const LOCAL_ONLY_PREFIXES = ['/api/terminal'];

export interface AccessResult {
  ok: boolean;
  /** 403/401 时返回给前端的状态码 */
  status?: number;
  error?: string;
  local: boolean;
  ip: string;
  readOnly: boolean;
}

/** 配置读取缓存：每个请求都读 config.json 会造成无谓磁盘 IO；保存配置后调用 invalidate */
let cache: { at: number; cfg: ShareConfig } | null = null;

export function shareConfig(): ShareConfig {
  if (cache && Date.now() - cache.at < 1000) return cache.cfg;
  const cfg = loadConfig().share;
  cache = { at: Date.now(), cfg };
  return cfg;
}

/** 配置变更后清缓存，下一次请求立即生效（重启前也保持一致） */
export function invalidateAccessCache(): void {
  cache = null;
}

export function checkAccess(req: http.IncomingMessage, p: string): AccessResult {
  const ip = normalizeIp(req.socket.remoteAddress);
  const local = isLocalIp(ip);
  const cfg = shareConfig();
  if (local) return { ok: true, local, ip, readOnly: false };

  // 远程：先过 IP 白名单
  if (!ipAllowed(ip, cfg)) {
    return { ok: false, status: 403, error: t('share.notAllowed'), local, ip, readOnly: true };
  }
  // 静态资源（页面/JS/CSS/图标）：放行，否则等待页都加载不出来
  if (!p.startsWith('/api/')) return { ok: true, local, ip, readOnly: true };

  // 本机专属能力：远程一律拒绝（与只读/可写配置无关）
  if (LOCAL_ONLY_PATHS.has(p) || LOCAL_ONLY_PREFIXES.some((x) => p.startsWith(x))) {
    return { ok: false, status: 403, error: t('share.localOnly'), local, ip, readOnly: true };
  }

  // 语言包：远程页面在加入会话前就要读取（只放行 GET；POST 改语言仍受只读/会话约束）
  if (p === '/api/lang' && req.method === 'GET') return { ok: true, local, ip, readOnly: true };

  // 切换项目：由共享配置决定；只读模式下也允许（属于浏览行为，不写仓库）
  if (p === '/api/open' && req.method === 'POST') {
    if (!cfg.allowSwitchProject) {
      return { ok: false, status: 403, error: t('share.switchDisabled'), local, ip, readOnly: cfg.readOnly };
    }
    if (!touchViewer(ip)) {
      return { ok: false, status: 401, error: t('share.joinRequired'), local, ip, readOnly: cfg.readOnly };
    }
    return { ok: true, local, ip, readOnly: cfg.readOnly };
  }

  const readOnly = cfg.readOnly;
  // 握手接口放行（join/heartbeat/leave/access）
  if (HANDSHAKE_PATHS.has(p)) return { ok: true, local, ip, readOnly };

  // 其余 API：必须已加入会话（顺带续期，页面有活动就不算超时）
  if (!touchViewer(ip)) {
    return { ok: false, status: 401, error: t('share.joinRequired'), local, ip, readOnly };
  }
  // 远程只读：除 GET/HEAD 外一律拒绝
  if (readOnly && req.method !== 'GET' && req.method !== 'HEAD') {
    return { ok: false, status: 403, error: t('share.readOnlyMode'), local, ip, readOnly };
  }
  return { ok: true, local, ip, readOnly };
}
