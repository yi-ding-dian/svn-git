/** API 前置门禁：CSRF/来源校验 + 共享访问控制。
 *  所有 API 请求都必须先过这两道（顺序与拆分前一致）：
 *   1. CSRF 防护：全 API 层拦截带非本机 Origin 的请求（任意网页无法触达含副作用端点，
 *      如 shutdown / open / env-install）
 *   2. 局域网共享门禁：来源 IP / 白名单 / 已加入会话 / 远程只读（所有 API 统一拦截）
 *  返回 false = 已拒绝并写好响应；true = 放行。 */
import type http from 'node:http';
import { isSafeOrigin, sendJson } from './response.js';
import { checkAccess } from '../access-control.js';
import { t } from '../../shared/i18n/index.js';

export function enforceApiAccess(req: http.IncomingMessage, res: http.ServerResponse, p: string): boolean {
  if (p.startsWith('/api/') && !isSafeOrigin(req)) {
    // 拒绝跨站请求
    sendJson(res, 403, { error: t('srv.crossSiteRejected') });
    return false;
  }
  if (p.startsWith('/api/')) {
    const access = checkAccess(req, p);
    if (!access.ok) {
      sendJson(res, access.status ?? 403, { error: access.error, shareDenied: true });
      return false;
    }
  }
  return true;
}
