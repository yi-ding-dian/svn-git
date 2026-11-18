/** 认证类错误文本判定：git / svn / server 共用的唯一来源。
 *  只做文本匹配，不依赖 server 层——vcs 与 server 都来引用这里。 */

/** git 认证失败的输出特征（pull / push / fetch 共用一套）。
 *  **不要并入 git-ssh.ts 的 isGitAuthenticationError**：那是更宽的 SSH 匹配集
 *  （含 no such identity / Too many authentication failures / 中文文案），
 *  这里逐字保留原 git.ts 三处正则的匹配范围。 */
export function isGitAuthError(text: string): boolean {
  // i18n-ignore: 解析 git 输出的英文报错
  return /Authentication failed|could not read Username|terminal prompts disabled|Permission denied \(publickey\)|HTTP 401|HTTP 403/i.test(text);
}

/** svn 认证类错误的分类结果：code = 最内层错误码（svn 错误是层层包裹的栈，最内层才是根因） */
export interface SvnErrorDetail {
  code?: string;
  /** auth=账号密码错 / authz=账号没有该路径权限 / proxy=代理要求认证 */
  kind: 'auth' | 'authz' | 'proxy';
}

/** 从 svn 输出里识别认证类错误，非认证错误返回 null。
 *  **为什么取最后一个 E 码**：认证失败时 svn 输出的是错误栈——
 *    svn: E170013: Unable to connect to a repository at URL '...'
 *    svn: E215004: No more credentials or we tried too many times.
 *    svn: E170001: Authentication failed
 *  旧实现取第一个码，永远拿到外层 E170013：界面显示「认证失败（E170013）」，
 *  既盖住真正的 E170001/E215004，又让人误以为是网络问题（用户实报）。
 *  按文案先分代理/权限——三者都可能带 E170001，不能只看码。 */
export function classifySvnError(text: string): SvnErrorDetail | null {
  const codes = [...text.matchAll(/E\d{6}/g)].map((m) => m[0]);
  const code = codes.length ? codes[codes.length - 1] : undefined;
  // 代理：407 / Proxy Authentication Required → svn 报 "HTTP proxy authorization failed"
  if (/proxy (?:authorization|authentication) failed|proxy authentication required|HTTP 407/i.test(text)) {
    return { code, kind: 'proxy' };
  }
  // 授权（密码对但没有该路径读权限）必须排在认证前：两种情况都可能报 E170001。
  // E220001 / "Item is not readable"（本地化后是「条目不可读」）是路径无权访问的典型报错
  if (/authorization failed|item is not readable|not readable|条目不可读/i.test(text)) {
    return { code, kind: 'authz' };
  }
  // 认证：E215004（没有更多凭据/试太多次）经常是失败输出的最内层码
  if (/authentication failed|E170001|E215004/i.test(text)) return { code, kind: 'auth' };
  return null;
}

/** server 层认证兜底：中英混合超集（逐字保留 server/errors.ts 原正则的匹配集合）。
 *  权限不足/代理认证也是认证类引导：svn 三种都可能是 E170001。 */
export function isAuthLike(text: string): boolean {
  // 这行是**解析错误文本**的正则（vcs 层抛出的「认证失败…」/ git 英文输出），不是界面文案，禁止翻译。
  // i18n-ignore: 解析用正则，翻了认证识别失效
  return /认证失败|权限不足|代理要求认证|E170001|E215004|Authentication failed|Authorization failed|proxy authentication/i.test(text);
}
