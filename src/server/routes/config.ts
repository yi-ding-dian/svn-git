/** 配置域端点：全局配置与凭据读写（config / git-auth）+ git 远程地址配置（git-config）+ git 身份（git-identity）+ 界面语言（lang）。
 * 读写 ~/.config/svngit/config.json（见 src/config.ts）；git-config / git-identity 为当前仓库的 git 配置（非 VCS 写操作，归本域）。
 * lang 放在本域：它就是 config.json 的一个字段，且改完要立刻生效（setLang 直接改主进程变量，server/vcs/main 同时切）。 */
import { sendJson, readBody, vcsOf, MSG_UNSUPPORTED_OP } from './util.js';
import { loadConfig, saveConfig } from '../../config.js';
import { syncTerminalSshConfig } from '../../ssh-config.js';
import { getGithubInsteadOf, setGithubInsteadOf } from '../../git-config.js';
import { secureClean } from '../../secure-clean.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { clearGithubIdentityCache } from './github.js';
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
    // 保留 SSH 私钥配置：这里只换推送凭据，不能把用户配好的私钥路径顺手抹掉
    cfg.git = {
      username,
      password,
      sshKeyPath: cfg.git?.sshKeyPath ?? '',
      sshUseForTerminal: Boolean(cfg.git?.sshUseForTerminal),
    };
    saveConfig(cfg);
    // 凭据变了，顶栏身份缓存作废（用户名不变只换 Token 时缓存键不变，不清会拿旧身份顶 30 分钟）
    clearGithubIdentityCache();
    // 推送认证已保存
    sendJson(res, 200, { ok: true, message: t('srv.gitAuthSaved') });
    return true;
  }
  if (p === '/api/git-ssh-key' && req.method === 'GET') {
    // SSH 私钥路径 + 是否同时用于终端 git（不进凭据弹窗：它是本机文件路径，不是账号密码）
    const cfg = loadConfig();
    sendJson(res, 200, { path: cfg.git?.sshKeyPath ?? '', useForTerminal: Boolean(cfg.git?.sshUseForTerminal) });
    return true;
  }
  if (p === '/api/git-ssh-key' && req.method === 'POST') {
    // 保存 SSH 私钥路径：空串 = 清除（走系统默认 ~/.ssh）；非空必须是存在的文件。
    // 路径会拼进 GIT_SSH_COMMAND，换行/引号一律拒绝，避免被当成额外的 ssh 参数。
    // useForTerminal：同时写入 ~/.ssh/config 的受管段，让终端 git 也能用这把私钥。
    const body = await readBody(req);
    const raw = String(body.path ?? '').trim();
    const useForTerminal = Boolean(body.useForTerminal);
    let keyPath = raw;
    if (keyPath.startsWith('~')) keyPath = path.join(os.homedir(), keyPath.slice(1));
    if (keyPath && /[\r\n"]/.test(keyPath)) {
      // 私钥路径不能包含换行或引号
      sendJson(res, 400, { error: t('srv.gitSshKeyInvalid') });
      return true;
    }
    if (keyPath && !fs.existsSync(keyPath)) {
      // 找不到私钥文件：{path}
      sendJson(res, 400, { error: t('srv.gitSshKeyNotFound', { path: keyPath }) });
      return true;
    }
    if (!keyPath && useForTerminal) {
      // 请先填写 SSH 私钥路径，再开启「终端 git 也使用此私钥」
      sendJson(res, 400, { error: t('srv.gitSshKeyNoPath') });
      return true;
    }
    // 先同步终端配置：写失败就不保存，避免应用内显示已开启但终端实际没生效
    const sync = syncTerminalSshConfig(keyPath, useForTerminal);
    if (!sync.ok) {
      // 写入 ~/.ssh/config 失败：{msg}
      sendJson(res, 500, { error: t('srv.gitSshKeySyncFailed', { msg: sync.error ?? '' }) });
      return true;
    }
    const cfg = loadConfig();
    cfg.git = {
      username: cfg.git?.username ?? '',
      password: cfg.git?.password ?? '',
      sshKeyPath: keyPath,
      sshUseForTerminal: useForTerminal,
    };
    saveConfig(cfg);
    // 已保存，并写入 ~/.ssh/config / 已保存
    sendJson(res, 200, { ok: true, message: useForTerminal ? t('srv.gitSshKeySavedWithTerminal') : t('srv.gitSshKeySaved') });
    return true;
  }

  if (p === '/api/git-github-ssh' && req.method === 'GET') {
    // GitHub 地址自动走 SSH 的开关状态（直接读全局 git 配置）
    sendJson(res, 200, { enabled: getGithubInsteadOf() });
    return true;
  }
  if (p === '/api/git-github-ssh' && req.method === 'POST') {
    // 开关：写入/删除全局 url.git@github.com:.insteadOf，所有 GitHub 项目自动走 SSH
    const body = await readBody(req);
    const enabled = Boolean(body.enabled);
    const r = setGithubInsteadOf(enabled);
    if (!r.ok) {
      // 写入全局 git 配置失败：{msg}
      sendJson(res, 500, { error: t('srv.gitGithubSshFailed', { msg: r.error ?? '' }) });
      return true;
    }
    // GitHub 地址自动走 SSH 已开启 / 已关闭
    sendJson(res, 200, { ok: true, enabled, message: enabled ? t('srv.gitGithubSshOn') : t('srv.gitGithubSshOff') });
    return true;
  }

  if (p === '/api/secure-clean' && req.method === 'POST') {
    // 安全清理（离职/交接前）：按勾选项删除本机凭据与私钥配置，不可恢复。
    // 结果里的 publicKey 供前端提示用户去 GitHub 手动删对应公钥。
    const body = await readBody(req);
    sendJson(
      res,
      200,
      secureClean({
        removeKey: Boolean(body.removeKey),
        removeSshConfig: Boolean(body.removeSshConfig),
        removeInsteadOf: Boolean(body.removeInsteadOf),
        clearGithubToken: Boolean(body.clearGithubToken),
        clearSvnPassword: Boolean(body.clearSvnPassword),
        clearHistory: Boolean(body.clearHistory),
      }),
    );
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

  if (p === '/api/git-identity') {
    // git 身份（user.name / user.email）：提交被 git 以「Author identity unknown」拒绝时，
    // 前端弹「设置身份」窗——GET 回显当前值与作用域，POST 写全局或仅本仓库
    const { vcs, repo } = vcsOf();
    if (repo.type !== 'git') {
      // 非 Git 仓库
      sendJson(res, 400, { error: t('srv.notGitRepo') });
      return true;
    }
    if (req.method === 'GET') {
      sendJson(res, 200, (await vcs.identity?.()) ?? { name: '', email: '', scope: '' });
      return true;
    }
    if (req.method === 'POST') {
      const body = await readBody(req);
      const name = String(body.name ?? '').trim();
      const email = String(body.email ?? '').trim();
      // 姓名不能为空 / 邮箱不能为空
      if (!name) {
        sendJson(res, 400, { error: t('srv.identityNameEmpty') });
        return true;
      }
      if (!email) {
        sendJson(res, 400, { error: t('srv.identityEmailEmpty') });
        return true;
      }
      // 只有明确 global 才写全局——缺省一律只写本仓库（少动全局配置，出错影响面小）
      const scope = body.scope === 'global' ? 'global' : 'repo';
      sendJson(res, 200, (await vcs.setIdentity?.(name, email, scope)) ?? { ok: false, message: MSG_UNSUPPORTED_OP() });
      return true;
    }
  }

  return false;
}
