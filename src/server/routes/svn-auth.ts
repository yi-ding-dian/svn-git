/** SVN 身份与系统凭据缓存端点（薄路由）：验证凭据、显示当前身份、清除缓存条目。
 *  缓存文件格式解析 / host 匹配 / 删除逻辑在 src/vcs/svn/auth-cache.ts。 */
import { loadConfig } from '../../config.js';
import { sendJson, readBody, type Ctx } from '../http/response.js';
import { vcsOf } from '../repo-context.js';
import { t } from '../../shared/i18n/index.js';
import { findCacheCreds, forgetCacheCreds } from '../../vcs/svn/auth-cache.js';

export async function handle(ctx: Ctx): Promise<boolean> {
  const { req, res, url } = ctx;
  const p = url.pathname;

  if (p === '/api/svn-verify' && req.method === 'POST') {
    // 保存 SVN 凭据前验证：用临时账号密码在工作副本根 URL 上跑 `svn log -l 1`（与历史页同命令同路径）。
    // 密码只在本次请求内存里（不落盘、不进日志）；--no-auth-cache 不写系统凭据缓存。
    const { vcs, repo } = vcsOf();
    if (repo.type !== 'svn' || !vcs.verifyCredential) {
      // 非 SVN 仓库没有可验证的凭据：直接放行
      sendJson(res, 200, { ok: true, skipped: true });
      return true;
    }
    const body = await readBody(req);
    sendJson(
      res,
      200,
      await vcs.verifyCredential(
        String(body.username ?? ''),
        String(body.password ?? ''),
        Boolean(body.trustServerCert ?? false),
      ),
    );
    return true;
  }

  if (p === '/api/svn-identity' && req.method === 'GET') {
    // 当前 SVN 身份（只读）：工具配置账号 + 系统凭据缓存账号（按 ?url= 的 host 匹配）
    const targetUrl = String(url.searchParams.get('url') ?? '').trim();
    const cfgUser = loadConfig().svn.username;
    const creds = targetUrl ? findCacheCreds(targetUrl) : [];
    const first = creds[0];
    sendJson(res, 200, {
      ok: true,
      config: cfgUser ? { username: cfgUser } : null,
      cache: first ? { username: first.username, realms: creds.map((c) => c.realm) } : null,
    });
    return true;
  }

  if (p === '/api/svn-forget-cache' && req.method === 'POST') {
    // 清除系统凭据缓存中匹配该 URL host 的条目（「退出登录 / 切换账号」用）。
    // **危险操作**：会影响本机其他 svn 客户端（下次操作需重新登录）——前端必须二次确认后再调。
    const body = await readBody(req);
    const targetUrl = String(body.url ?? '').trim();
    if (!targetUrl) {
      // 缺少路径
      sendJson(res, 400, { error: t('srv.missingPath') });
      return true;
    }
    sendJson(res, 200, { ok: true, cleared: forgetCacheCreds(targetUrl) });
    return true;
  }

  return false;
}
