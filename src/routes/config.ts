/** 配置域端点：全局配置与凭据读写（config / git-auth）+ git 远程地址配置（git-config）。
 * 读写 ~/.config/svnkit/config.json（见 src/config.ts）；git-config 为当前仓库 origin 远程设置（非 VCS 写操作，归本域）。 */
import { sendJson, readBody, vcsOf } from './util.js';
import { loadConfig, saveConfig } from '../config.js';
import type { Ctx } from './util.js';

export async function handle(ctx: Ctx): Promise<boolean> {
  const { req, res, url } = ctx;
  const p = url.pathname;

  if (p === '/api/git-auth' && req.method === 'GET') {
    // Git 推送认证信息（不回传密码本体）
    const cfg = loadConfig();
    sendJson(res, 200, { username: cfg.git?.username ?? '', hasPassword: Boolean(cfg.git?.password) });
    return true;
  }
  if (p === '/api/git-auth' && req.method === 'POST') {
    // 保存 Git 推送认证（GitHub token / 服务器密码），base64 存储 600 权限
    const body = await readBody(req);
    const username = String(body.username ?? '').trim();
    const password = String(body.password ?? '');
    if (!username || !password) {
      sendJson(res, 400, { error: '用户名和密码不能为空' });
      return true;
    }
    const cfg = loadConfig();
    cfg.git = { username, password };
    saveConfig(cfg);
    sendJson(res, 200, { ok: true, message: '推送认证已保存' });
    return true;
  }
  if (p === '/api/config' && req.method === 'GET') {
    const cfg = loadConfig();
    sendJson(res, 200, { username: cfg.svn.username, trustServerCert: cfg.svn.trustServerCert });
    return true;
  }

  if (p === '/api/config' && req.method === 'POST') {
    const body = await readBody(req);
    const cfg = loadConfig();
    cfg.svn.username = String(body.username ?? '');
    cfg.svn.password = String(body.password ?? '');
    cfg.svn.trustServerCert = Boolean(body.trustServerCert ?? cfg.svn.trustServerCert);
    saveConfig(cfg);
    sendJson(res, 200, { ok: true });
    return true;
  }

  if (p === '/api/git-config' && req.method === 'POST') {
    // 配置：设置/修改 origin 远程地址
    const { vcs, repo } = vcsOf();
    const body = await readBody(req);
    const url = String(body.remoteUrl ?? '').trim();
    if (!url) {
      sendJson(res, 400, { error: '远程地址不能为空' });
      return true;
    }
    if (repo.type !== 'git') {
      sendJson(res, 400, { error: '非 Git 仓库' });
      return true;
    }
    sendJson(res, 200, await vcs.setRemote?.(url));
    return true;
  }

  return false;
}
