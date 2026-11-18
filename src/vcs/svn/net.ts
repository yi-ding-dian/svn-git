/** SVN 网络命令的公共参数（「获取仓库」的 svn checkout 与仓库浏览的远程检出共用）。
 *
 *  **必须 --non-interactive**：没有凭据时 svn 会尝试交互读账号，而子进程 stdin 已立即关闭，
 *  结果只会是 E215004/E170001（用户实报「没配账号直接报错」）。
 *  临时凭据（本次请求带的）加 --no-auth-cache，连 svn 自己的 auth 缓存都不写入——
 *  「只本次用」不能变成「下次悄悄记住」；已保存配置的凭据则沿用 svn 默认缓存行为。 */
export interface SvnNetOptions {
  /** 本次实际使用的账号（空/未定义 = 匿名） */
  user: string | undefined;
  /** 本次请求携带的临时账号（非空 = 加 --no-auth-cache） */
  tempUser: string;
  /** 信任 https 自签名证书（svn --trust-server-cert） */
  trustServerCert: boolean;
}

export function svnNetArgs(o: SvnNetOptions): string[] {
  const a = ['--non-interactive'];
  if (o.user) a.push('--username', o.user, '--password-from-stdin');
  if (o.tempUser) a.push('--no-auth-cache');
  if (o.trustServerCert) a.push('--trust-server-cert');
  return a;
}
