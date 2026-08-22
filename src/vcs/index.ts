/** VCS 工厂：按仓库类型创建实例 */
import type { RepoInfo, Vcs } from './types.js';
import type { SvnCred } from './svn.js';
import { SvnVcs } from './svn.js';
import { GitVcs } from './git.js';

export type { RepoInfo, FileStatus, LogEntry, DiffResult, VcsResult, RepoType, Vcs, PreflightResult, BranchListResult } from './types.js';
export { SvnVcs } from './svn.js';
export type { SvnCred } from './svn.js';
export { GitVcs } from './git.js';

/** createVcs 返回统一接口：缺失的接口方法在编译期报错（原先 AnyVcs 联合 + as any 逃逸类型检查） */
export function createVcs(repo: RepoInfo, cred: SvnCred | null): Vcs {
  return repo.type === 'svn' ? new SvnVcs(repo, cred) : new GitVcs(repo);
}
