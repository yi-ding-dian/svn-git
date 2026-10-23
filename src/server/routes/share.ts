/** 局域网共享（垂直域）：配置读写、访问会话（加入/心跳/离开）、网卡地址、重启生效。
 *
 *  安全边界：
 *   - 配置读写与重启只允许本机调用（远程即使已加入会话也一律 403）
 *   - 远程访问前置检查在 access-control.ts；本文件只负责会话与配置接口
 *   - 远程只读（readOnly 固定为 true）由 access-control 统一拦截
 */
import os from 'node:os';
import { spawn } from 'node:child_process';
import { loadConfig, saveConfig } from '../../config.js';
import { DEFAULT_SHARE, type ShareConfig, type ShareMode } from '../../shared/share.js';
import { t } from '../../shared/i18n/index.js';
import { invalidateAccessCache } from '../access-control.js';
import {
  ipAllowed,
  isLocalIp,
  isValidIpRule,
  joinViewer,
  leaveViewer,
  normalizeIp,
  notifyJoin,
  notifyLeave,
  shareEventsSince,
  touchViewer,
  viewerCount,
} from '../share/session.js';
import { readBody, sendJson, type Ctx } from './util.js';

/** 本机可用的局域网 IPv4 地址（只列非回环） */
function lanAddresses(port: number): string[] {
  const out: string[] = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const it of list ?? []) {
      if (it.family === 'IPv4' && !it.internal) out.push(`http://${it.address}:${port}`);
    }
  }
  return out;
}

function parseShare(body: Record<string, unknown>): { cfg: ShareConfig; badRule?: string } {
  const rawMode = String(body.mode ?? 'local');
  const mode: ShareMode = rawMode === 'lan' || rawMode === 'custom' ? rawMode : 'local';
  const allow = (Array.isArray(body.allow) ? body.allow : [])
    .map((v) => String(v).trim())
    .filter(Boolean)
    .slice(0, 64);
  const badRule = allow.find((r) => !isValidIpRule(r));
  const n = Number(body.maxViewers);
  return {
    cfg: {
      mode,
      allow,
      maxViewers: Number.isFinite(n) && n >= 0 ? Math.min(Math.floor(n), 100) : DEFAULT_SHARE.maxViewers,
      // 默认为只读；只有显式传 false 才开放远程写操作
      readOnly: body.readOnly !== false,
      allowSwitchProject: body.allowSwitchProject === true,
    },
    badRule,
  };
}

/** 保存后重启：spawn 自己并退出。延迟 300ms 让当前响应先发出、端口先释放 */
function restartLater(): void {
  setTimeout(() => {
    try {
      const exe = process.env.APPIMAGE ?? process.env.PORTABLE_EXECUTABLE_FILE ?? process.execPath;
      const args = process.argv.slice(1).filter((a) => a !== '-d');
      if (!args.includes('--browser')) args.push('--browser');
      spawn(exe, args, { detached: true, stdio: 'ignore', windowsHide: true }).unref();
      process.exit(0);
    } catch {
      // 启动失败时不让旧进程卡死：保持运行，前端会看到连接断开后重试超时
    }
  }, 300);
}

export async function handle(ctx: Ctx): Promise<boolean> {
  const { req, res, p } = ctx;
  if (!p.startsWith('/api/share')) return false;

  const ip = normalizeIp(req.socket.remoteAddress);
  const local = isLocalIp(ip);
  const cfg = loadConfig().share;
  const access = {
    local,
    readOnly: !local && cfg.readOnly,
    viewers: viewerCount(),
    max: cfg.maxViewers,
    mode: cfg.mode,
    allowSwitchProject: cfg.allowSwitchProject,
  };

  // ---------- 配置读写 / 重启：仅本机 ----------
  if (p === '/api/share') {
    if (!local) {
      sendJson(res, 403, { error: t('share.localOnly') });
      return true;
    }
    if (req.method === 'GET') {
      const port = (req.socket.localPort ?? 0) as number;
      sendJson(res, 200, { ...access, config: cfg, addresses: lanAddresses(port), port });
      return true;
    }
    if (req.method === 'POST') {
      const body = await readBody(req);
      const parsed = parseShare(body as Record<string, unknown>);
      if (parsed.badRule) {
        sendJson(res, 400, { error: t('share.invalidIp', { value: parsed.badRule }) });
        return true;
      }
      const next = loadConfig();
      next.share = parsed.cfg;
      saveConfig(next);
      invalidateAccessCache();
      sendJson(res, 200, { ok: true, config: parsed.cfg });
      return true;
    }
    sendJson(res, 405, { error: t('srv.unsupportedOp') });
    return true;
  }

  if (p === '/api/share/restart') {
    if (!local) {
      sendJson(res, 403, { error: t('share.localOnly') });
      return true;
    }
    if (req.method !== 'POST') {
      sendJson(res, 405, { error: t('srv.unsupportedOp') });
      return true;
    }
    sendJson(res, 202, { ok: true });
    restartLater();
    return true;
  }

  // ---------- 访问会话 ----------
  if (p === '/api/share/access' && req.method === 'GET') {
    sendJson(res, 200, access);
    return true;
  }

  // 本机轮询：远程有人加入时写入「铃铛」通知
  if (p === '/api/share/events' && req.method === 'GET') {
    if (!local) {
      sendJson(res, 403, { error: t('share.localOnly') });
      return true;
    }
    const since = Number(ctx.url.searchParams.get('since') ?? 0) || 0;
    sendJson(res, 200, shareEventsSince(since));
    return true;
  }

  if (p === '/api/share/join' && req.method === 'POST') {
    if (local) {
      sendJson(res, 200, { ok: true, ...access });
      return true;
    }
    if (!ipAllowed(ip, cfg)) {
      sendJson(res, 403, { error: t('share.notAllowed') });
      return true;
    }
    const r = joinViewer(ip, cfg);
    // 新会话才通知本机（同 IP 刷新/重连不重复弹）
    if (r.joined) notifyJoin(ip, cfg);
    sendJson(res, 200, { ok: r.ok, full: r.full, ...access, viewers: viewerCount() });
    return true;
  }

  if (p === '/api/share/heartbeat' && req.method === 'POST') {
    if (local) {
      sendJson(res, 200, { ok: true, ...access });
      return true;
    }
    // 会话已因超时被剔除：尝试重新加入（可能已满）
    const alive = touchViewer(ip);
    const r = alive ? { ok: true, full: false } : joinViewer(ip, cfg);
    sendJson(res, 200, { ok: r.ok, full: r.full, ...access, viewers: viewerCount() });
    return true;
  }

  if (p === '/api/share/leave' && req.method === 'POST') {
    if (!local && leaveViewer(ip)) notifyLeave(ip, cfg);
    sendJson(res, 200, { ok: true });
    return true;
  }

  return false;
}
