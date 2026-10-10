/** 配置域端点：全局配置与凭据读写（config / git-auth）+ git 远程地址配置（git-config）+ 界面语言（lang）。
 * 读写 ~/.config/svngit/config.json（见 src/config.ts）；git-config 为当前仓库 origin 远程设置（非 VCS 写操作，归本域）。
 * lang 放在本域：它就是 config.json 的一个字段，且改完要立刻生效（setLang 直接改主进程变量，server/vcs/main 同时切）。 */
import { sendJson, readBody, vcsOf } from './util.js';
import { loadConfig, saveConfig } from '../../config.js';
import { t, setLang, getLang, isLang } from '../../shared/i18n/index.js';
import type { Ctx } from './util.js';

export async function handle(ctx: Ctx): Promise<boolean> {
  const { req, res, url } = ctx;
  const p = url.pathname;

  if (p === '/api/lang' && req.method === 'GET') {
    // 前端首次加载且本地无偏好时用它对齐（有偏好则以本地为准，见 client/shared/use-lang.ts）
    sendJson(res, 200, { lang: getLang() });
    return true;
  }

  if (p === '/api/lang' && req.method === 'POST') {
    const body = await readBody(req);
    if (!isLang(body.lang)) {
      // 语言不受支持
      sendJson(res, 400, { error: t('srv.lang.invalid') });
      return true;
    }
    setLang(body.lang); // 先切：后续消息立刻用新语言（含本请求之后的一切响应）
    const cfg = loadConfig();
    cfg.lang = body.lang;
    saveConfig(cfg);
    sendJson(res, 200, { ok: true });
    return true;
  }

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
      // 用户名和密码不能为空
      sendJson(res, 400, { error: t('srv.gitAuthEmpty') });
      return true;
    }
    const cfg = loadConfig();
    cfg.git = { username, password };
    saveConfig(cfg);
    // 推送认证已保存
    sendJson(res, 200, { ok: true, message: t('srv.gitAuthSaved') });
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
      // 远程地址不能为空
      sendJson(res, 400, { error: t('srv.remoteUrlEmpty') });
      return true;
    }
    if (repo.type !== 'git') {
      // 非 Git 仓库
      sendJson(res, 400, { error: t('srv.notGitRepo') });
      return true;
    }
    sendJson(res, 200, await vcs.setRemote?.(url));
    return true;
  }

  return false;
}
