/** Git SSH 私钥解析与传输环境：GitVcs.exec 与 /api/net-check 共用一份。
 *
 *  **为什么单独成模块**：应用推拉能成功、顶栏网络灯却报 `Permission denied (publickey)`——
 *  因为净检裸跑 `git ls-remote`，没带配置里的私钥。-i 的解析规则必须在两处一致，
 *  所以路径解析 / 环境变量 / 认证判定都收敛到这里，别在各调用点各写一份。 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from '../config.js';

/** origin 是否为 GitHub（只有 GitHub 才注入项目私钥） */
export function isGithubRemoteAddress(origin: string): boolean {
  return /^(?:ssh:\/\/)?(?:[^@/\s]+@)?github\.com[:/]/i.test(origin);
}

/** 配置里的私钥路径 → 可直接使用的绝对路径；未配置或文件不存在返回空串。
 *
 *  解析规则（源码运行、双击、安装包都一致——基准恒为**当前仓库根**，与应用的启动目录/安装目录无关）：
 *  - `~` / `~/x` 展开到用户主目录（安装包用户的常见写法）；
 *  - 绝对路径原样使用；
 *  - 相对路径相对当前仓库根（gen-ssh-key 生成的 `.git-ssh/id_ed25519` 就靠这条，
 *    仓库搬到别的盘、别人 clone 到自己路径后都不用改配置）。
 *
 *  文件不存在时返回空串而不是把路径交给 ssh：ssh 只会打一句
 *  `Identity file ... not accessible` 然后回落到默认钥匙，配错了也看不出问题。 */
export function resolveSshPrivateKeyPath(repoRoot: string): string {
  const raw = loadConfig().git?.sshKeyPath?.trim();
  if (!raw) return '';
  let p = raw;
  if (p === '~') p = os.homedir();
  else if (p.startsWith('~/') || p.startsWith('~\\')) p = path.join(os.homedir(), p.slice(2));
  const absolute = path.isAbsolute(p) ? p : path.resolve(repoRoot, p);
  return fs.existsSync(absolute) ? absolute : '';
}

/** GitHub 远程 + 配置了存在的私钥 → `` ` -i "<路径>"` ``；否则空串。
 *  路径统一正斜杠：GIT_SSH_COMMAND 经 shell 解析，Windows 反斜杠会被当转义符；
 *  双引号容纳空格，保存接口已拒绝换行/引号，这里再兜底去掉引号。 */
export function githubSshKeyArgument(repoRoot: string, origin: string): string {
  if (!isGithubRemoteAddress(origin)) return '';
  const keyPath = resolveSshPrivateKeyPath(repoRoot);
  if (!keyPath) return '';
  return ` -i "${keyPath.replace(/\\/g, '/').replace(/"/g, '')}"`;
}

/** git 传输环境：禁终端交互 + SSH 非交互，并附带私钥参数。
 *  GIT_TERMINAL_PROMPT=0：不让 git 卡在 “Username for …”（后台净检/无终端场景会一直挂着）；
 *  BatchMode：SSH 不交互（不卡主机指纹/密码），认证失败快速返回。 */
export function buildGitSshEnvironment(keyArgument: string, extra?: Record<string, string>): Record<string, string> {
  return {
    GIT_TERMINAL_PROMPT: '0',
    GIT_SSH_COMMAND: `ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new${keyArgument}`,
    ...extra,
  };
}

/** git 输出是否为“认证类失败”：连接已通，只是凭据/私钥没通过。
 *  用于区分“网络断”“无权限”与“需引导用户去配置认证”。 */
export function isGitAuthenticationError(text: string): boolean {
  // i18n-ignore: 解析 git 输出的匹配表，不是界面文案
  return /Authentication failed|could not read Username|terminal prompts disabled|Permission denied \(publickey\)|no such identity|Too many authentication failures|HTTP 401|HTTP 403|没有那个设备或地址/i.test(text);
}
