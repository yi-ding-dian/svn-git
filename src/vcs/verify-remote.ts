/** 获取仓库前的轻量认证预检：只探测「地址可达 + 账号有读权限」，不取任何数据。
 *
 *  为什么需要：原来「获取仓库」是先跑克隆/检出、失败后才回头弹账号框——密码错时
 *  可能已经建了目录、拉了一半数据，白跑一趟（用户实报：等半天才提示认证失败）。
 *
 *  - SVN：`svn info <URL>`（读元数据，秒级）
 *  - Git：`git ls-remote --heads <URL>`（只列引用，不下载对象）
 *
 *  **临时密码一律 --no-auth-cache / 不落盘**：预检失败不能把错密码写进 svn 官方凭据缓存，
 *  否则之后所有 svn 操作都会拿它反复重试——正是 E215004「试太多次」的常见来源。
 */
import { run } from './exec.js';
import { resolveSvnBin } from './svn.js';
import { createAskPass } from './git.js';
import { buildGitSshEnvironment } from './git-ssh.js';
import { classifySvnError, isGitAuthError } from './auth-errors.js';
import { t } from '../shared/i18n/index.js';

export interface VerifyRemoteResult {
  /** true = 可作为远程仓库访问（公开可读也算通过） */
  ok: boolean;
  /** 失败分类：AUTH = 凭据/权限问题（值得弹认证框）；NET = 地址不可达等（弹认证框没用） */
  code?: 'AUTH' | 'NET';
  message?: string;
}

/** 本地路径 / file:// 不需要认证预检（git 可指向本地目录，svn 可用 file://） */
function isLocalTarget(type: 'git' | 'svn', url: string): boolean {
  const u = url.trim();
  if (!u) return true;
  if (/^file:/i.test(u)) return true;
  if (type === 'svn') return false; // svn 远程地址恒带 scheme
  // git：有 scheme → 远程；scp 形式（git@host:path）→ 远程；其余按本地路径处理
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(u)) return false;
  if (/^[^@\s/]+@[^:\s/]+:/.test(u)) return false;
  return true;
}

export async function verifyRemote(
  type: 'git' | 'svn',
  url: string,
  cred: { username?: string; password?: string; trustServerCert?: boolean },
  signal?: AbortSignal,
): Promise<VerifyRemoteResult> {
  const u = url.trim();
  if (isLocalTarget(type, u)) return { ok: true };

  if (type === 'svn') {
    const user = (cred.username ?? '').trim();
    const args = ['info', '--xml', '--non-interactive'];
    if (user) {
      args.push('--username', user, '--password-from-stdin', '--no-auth-cache');
      if (cred.trustServerCert) args.push('--trust-server-cert');
    }
    const res = await run(await resolveSvnBin(), args.concat(u), {
      stdinData: user ? `${cred.password ?? ''}\n` : undefined,
      timeoutMs: 8_000,
      signal,
      decode: 'auto',
    });
    if (res.code === 0) return { ok: true };
    const text = res.stderr + '\n' + res.stdout;
    const d = classifySvnError(text);
    if (d) {
      return {
        ok: false,
        code: 'AUTH',
        message:
          d.kind === 'authz'
            ? t('vcs.authzFailed')
            : d.kind === 'proxy'
              ? t('vcs.proxyAuthFailed')
              : // 获取仓库场景没有当前项目，提示去认证框重新填（不是「按 o 设置」）
                t('srv.verifyAuthFailed'),
      };
    }
    // 非认证类失败：地址错 / 网络不通 / 服务器 5xx——弹认证框没有意义
    return { ok: false, code: 'NET', message: res.stderr.trim().split('\n')[0] || t('srv.verifyConnectFailed') };
  }

  // Git：HTTPS 用配置账号（GIT_ASKPASS），SSH 用 GIT_SSH_COMMAND（默认钥匙/项目私钥由调用方另行处理）
  let ask: { path: string; cleanup: () => void } | null = null;
  try {
    const env = buildGitSshEnvironment('');
    if (cred.username && cred.password) {
      ask = createAskPass({ username: cred.username, password: cred.password });
      env.GIT_ASKPASS = ask.path;
    }
    const res = await run('git', ['ls-remote', '--heads', u], { env, timeoutMs: 8_000, signal, decode: 'auto' });
    if (res.code === 0) return { ok: true };
    const text = (res.stderr + '\n' + res.stdout).trim();
    if (isGitAuthError(text)) return { ok: false, code: 'AUTH', message: t('srv.verifyAuthFailed') };
    return { ok: false, code: 'NET', message: text.split('\n')[0] || t('srv.verifyConnectFailed') };
  } finally {
    ask?.cleanup();
  }
}
