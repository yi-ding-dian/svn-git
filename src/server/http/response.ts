/** HTTP 协议层公共能力：请求上下文、JSON 响应、请求体解析、来源校验（无业务依赖）。 */
import http from 'node:http';

/** 路由上下文：req/res 与解析后的 URL 按需传递 */
export interface Ctx {
  req: http.IncomingMessage;
  res: http.ServerResponse;
  url: URL;
  p: string;
}

/** 本机或私网地址：DNS rebinding 的 Host/Origin 是攻击者域名（evil.com），会被拒绝；
 *  局域网共享用的 192.168.x.x / 10.x / 172.16-31.x / IPv6 ULA 仍放行。 */
function isLocalOrPrivateHost(hostname: string): boolean {
  const host = hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return true;
  if (/^10\./.test(host)) return true;
  if (/^192\.168\./.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true;
  if (/^169\.254\./.test(host)) return true;
  if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(host)) return true;
  if (/^f[cd][0-9a-f]{2}:/i.test(host)) return true; // IPv6 ULA fc00::/7
  if (/^fe[89ab][0-9a-f]:/i.test(host)) return true; // IPv6 link-local fe80::/10
  return false;
}

/** 请求来源校验（CSRF / DNS rebinding 防护）：跨站页面请求一律拒绝。
 *  - Electron 窗口 / --browser 页面 / 本地脚本：Origin 为空或本机地址；
 *  - 局域网共享：Origin 与 Host 同源，且 Host 必须是本机或私网地址；
 *  - 攻击者域名解析到 127.0.0.1 时，Origin/Host 是 evil.com，不是 IP，直接拒绝。 */
export function isSafeOrigin(req: http.IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const originUrl = new URL(origin);
    const host = req.headers.host ?? '';
    if (!host || originUrl.host !== host) return false;
    if (!isLocalOrPrivateHost(originUrl.hostname)) return false;
    return isLocalOrPrivateHost(new URL(`http://${host}`).hostname);
  } catch {
    /* 非法 Origin 按跨站处理 */
    return false;
  }
}

export function  sendJson(res: http.ServerResponse, code: number, data: unknown) {
  const body = JSON.stringify(data);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

export function  readBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let data = '';
    let done = false; // 超限后终止接收,防止内存继续累积与 end 事件二次 settle
    req.on('data', (c: Buffer) => {
      if (done) return;
      data += c.toString();
      if (data.length > 10 * 1024 * 1024) {
        done = true;
        req.destroy(); // 客户端若持续发送,立即断开连接而非继续拼接
        reject(new Error('body too large'));
      }
    });
    req.on('end', () => {
      if (done) return;
      done = true;
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        resolve({});
      }
    });
    req.on('error', (e) => {
      if (!done) {
        done = true;
        reject(e);
      }
    });
  });
}
