/** VCS 工厂：按仓库类型创建实例 */
import type { RepoInfo } from './types.js';
import type { SvnCred } from './svn.js';
import { SvnVcs } from './svn.js';
import { GitVcs } from './git.js';

export type { RepoInfo, FileStatus, LogEntry, DiffResult, VcsResult, RepoType } from './types.js';
export { SvnVcs } from './svn.js';
export type { SvnCred } from './svn.js';
export { GitVcs } from './git.js';

export type AnyVcs = SvnVcs | GitVcs;

export function createVcs(repo: RepoInfo, cred: SvnCred | null): AnyVcs {
  return repo.type === 'svn' ? new SvnVcs(repo, cred) : new GitVcs(repo);
}
