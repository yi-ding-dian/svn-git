/** 后端 API 封装（barrel）：对 90 个调用方保持 `shared/api.js` 这个导入说明符不变。
 *
 *  实现按业务分组拆在 api/ 目录；这里只做 re-export + 合并 get/post 两个对象。
 *  - core：api()/ApiError/json/codeRank 与跨域通用类型
 *  - 分组模块统一从 ./core.js 取 api()，彼此不引用（避免循环导入）
 */
export { CODE_DESC, type ParsedDiff } from './api/core.js';
export type { RepoPreview, RepoCheck, RepoInfo, FileStatus, LogEntry, DiffResult, VcsResult, MainlinePlan, StashItem, BranchDeleteCheck } from './api/core.js';
export { ApiError, api, codeRank } from './api/core.js';
export type {
  RestorePreview,
  BrowseResult,
  LsResult,
  FsEntry,
  FsData,
  WcConflictItem,
  FilterTreeNode,
  LineScanTick,
  CodeStatsNode,
  CodeStatsTick,
} from './api/filesystem.js';
export { uploadFile } from './api/filesystem.js';
export type { HistoryItem } from './api/history.js';
export type {
  GitHubRepoResult,
  GitHubCreateResult,
  GitHubIdentityResult,
  GitHubMyRepo,
  GitHubMyReposResult,
  RepoSizeTick,
  SvnLayout,
  WorktreeEntry,
  BranchInfo,
  PracticeResult,
  ProjectProbe,
} from './api/repo.js';
export type {
  GitHubReleaseAsset,
  ReleaseDockerImage,
  DockerImageSize,
  DockerImageSizesResult,
  GitHubRelease,
  GitHubReleaseCi,
  GitHubReleasesResult,
  ReleaseCleanupRelease,
  ReleaseCleanupPreview,
  ReleaseInfo,
  LocalBuildDetect,
  LocalBuildArtifact,
  LocalBuildEvent,
  GitHubTag,
} from './api/release.js';

import { getShare } from './api/share.js';
import { getFilesystem } from './api/filesystem.js';
import { getHistory } from './api/history.js';
import { getOps } from './api/ops.js';
import { getRepo } from './api/repo.js';
import { getRelease } from './api/release.js';
import { postShare } from './api/share.js';
import { postFilesystem } from './api/filesystem.js';
import { postHistory } from './api/history.js';
import { postOps } from './api/ops.js';
import { postRepo } from './api/repo.js';
import { postRelease } from './api/release.js';

export const get = {
  ...getShare,
  ...getFilesystem,
  ...getHistory,
  ...getOps,
  ...getRepo,
  ...getRelease,
};

export const post = {
  ...postShare,
  ...postFilesystem,
  ...postHistory,
  ...postOps,
  ...postRepo,
  ...postRelease,
};
