/** 共享访问的会话与 IP 判定（共享域内部，无 HTTP 依赖）。
 *
 *  远程访问按 **IP** 计数：同一 IP 刷新/多标签复用同一个会话，不重复占名额；
 *  页面每 10 秒心跳一次，30 秒无心跳自动剔除（强杀/断网也能释放名额）。
 *  本机（127.0.0.1 / ::1）永远放行且不占名额。
 */
import type { ShareConfig, ShareEvent } from '../../shared/share.js';

/** 会话超时：超过这个时间没有心跳就视为已离开 */
const VIEWER_TTL_MS = 30_000;
/** 清理周期 */
const PRUNE_INTERVAL_MS = 10_000;

/** ip -> 最后心跳时间 */
const viewers = new Map<string, number>();

/** IPv4-mapped IPv6（::ffff:192.168.1.2）统一成 IPv4，便于白名单/网段比较 */
export function normalizeIp(ip: string | undefined): string {
  const v = (ip ?? '').trim();
  return v.startsWith('::ffff:') ? v.slice('::ffff:'.length) : v;
}

export function isLocalIp(ip: string): boolean {
  return ip === '127.0.0.1' || ip === '::1' || ip === 'localhost';
}

/** 私网段：10/8、172.16/12、192.168/16（以及 CGNAT 100.64/10，常见于容器网络） */
export function isPrivateIp(ip: string): boolean {
  if (ip.startsWith('10.')) return true;
  if (ip.startsWith('192.168.')) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return true;
  if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(ip)) return true;
  return false;
}

/** 单条白名单：精确 IP，或 IPv4 CIDR（如 192.168.1.0/24） */
export function ipMatchesRule(ip: string, rule: string): boolean {
  const r = rule.trim();
  if (!r) return false;
  if (!r.includes('/')) return ip === r;
  const [base = '', bitsRaw = ''] = r.split('/');
  const bits = Number(bitsRaw);
  if (!isIpv4(base) || !isIpv4(ip) || !Number.isInteger(bits) || bits < 0 || bits > 32) return false;
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (ipv4ToInt(base) & mask) === (ipv4ToInt(ip) & mask);
}

function isIpv4(v: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(v) && v.split('.').every((n) => Number(n) <= 255);
}

function ipv4ToInt(v: string): number {
  return v.split('.').reduce((acc, n) => ((acc << 8) | Number(n)) >>> 0, 0) >>> 0;
}

/** 校验白名单条目的格式（保存配置时用）：单个 IPv4 或 IPv4 CIDR */
export function isValidIpRule(rule: string): boolean {
  const r = rule.trim();
  if (!r) return false;
  if (!r.includes('/')) return isIpv4(r);
  const [base = '', bitsRaw = ''] = r.split('/');
  const bits = Number(bitsRaw);
  return Boolean(base && isIpv4(base) && Number.isInteger(bits) && bits >= 0 && bits <= 32);
}

/** 远程来源是否允许访问：lan 自动放行私网段；custom 按白名单 */
export function ipAllowed(ip: string, cfg: ShareConfig): boolean {
  if (cfg.mode === 'lan') return isPrivateIp(ip);
  if (cfg.mode === 'custom') return cfg.allow.some((rule) => ipMatchesRule(ip, rule));
  return false;
}

function prune(): void {
  const now = Date.now();
  for (const [ip, at] of viewers) if (now - at > VIEWER_TTL_MS) viewers.delete(ip);
}

// 定时清理：unref 让它不阻止进程退出
setInterval(prune, PRUNE_INTERVAL_MS).unref();

export function viewerCount(): number {
  prune();
  return viewers.size;
}

/** 加入（或复用同一 IP 的会话）。满员返回 full；joined 表示这次是**新**会话（用于通知本机） */
export function joinViewer(ip: string, cfg: ShareConfig): { ok: boolean; full: boolean; joined: boolean } {
  prune();
  if (viewers.has(ip)) {
    viewers.set(ip, Date.now());
    return { ok: true, full: false, joined: false };
  }
  if (cfg.maxViewers > 0 && viewers.size >= cfg.maxViewers) return { ok: false, full: true, joined: false };
  viewers.set(ip, Date.now());
  return { ok: true, full: false, joined: true };
}

/** 心跳：会话已因超时被剔除时返回 false，前端据此重新 join */
export function touchViewer(ip: string): boolean {
  if (!viewers.has(ip)) return false;
  viewers.set(ip, Date.now());
  return true;
}

export function leaveViewer(ip: string): boolean {
  return viewers.delete(ip);
}

/** 本机通知事件队列：远程有人加入时记录，本机前端轮询后写入「铃铛」通知 */
const events: ShareEvent[] = [];
let seq = 0;

/** 远程新会话加入：记一条事件（同 IP 刷新/心跳重连不重复通知） */
export function notifyJoin(ip: string, cfg: ShareConfig): void {
  events.push({ id: ++seq, type: 'join', ip, viewers: viewerCount(), max: cfg.maxViewers, at: Date.now() });
  if (events.length > 50) events.shift();
}

/** 远程主动离开（关闭页面/退出）：记一条事件，带上离开后的在线人数 */
export function notifyLeave(ip: string, cfg: ShareConfig): void {
  events.push({ id: ++seq, type: 'leave', ip, viewers: viewerCount(), max: cfg.maxViewers, at: Date.now() });
  if (events.length > 50) events.shift();
}

/** 本机轮询：取 since 之后的事件 + 最新游标 */
export function shareEventsSince(since: number): { events: ShareEvent[]; lastId: number } {
  return { events: events.filter((e) => e.id > since), lastId: seq };
}

/** 测试用：清空会话 */
export function resetViewers(): void {
  viewers.clear();
}
