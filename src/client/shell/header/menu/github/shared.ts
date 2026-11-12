/** GitHub 相关菜单项共用的可见性判定。 */
import { parseGithub } from '../../../../../shared/github.js';
import type { ToolCtx } from '../types.js';

/** origin 是否指向 github.com（GitHub 新建仓库与仓库信息互补：一个在没有时出现，一个在有时出现） */
export const isGithubRemote = (c: ToolCtx) => /github\.com/i.test(c.repoUrl ?? '');

/** 是否应该提供 Fork：origin 指向 github.com 且 owner 不是本人（自己账号的仓库无需 Fork）。
 *  gitUser 未知（未配 git 凭据）时也返回 true——宁多显勿漏显，进弹窗后服务端判定归属兜底。 */
export const shouldOfferFork = (c: ToolCtx) =>
  isGithubRemote(c) && (!c.gitUser || parseGithub(c.repoUrl ?? '')?.owner.toLowerCase() !== c.gitUser.toLowerCase());
