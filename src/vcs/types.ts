/** VCS 统一类型定义 */

export type RepoType = 'svn' | 'git';

export interface RepoInfo {
  type: RepoType;
  /** 工作副本/仓库根目录绝对路径 */
  root: string;
  /** 当前浏览的绝对路径 */
  cwd: string;
  /** 仓库 URL（svn 为版本库 URL，git 为 remote origin） */
  url?: string;
  /** svn: 当前所在版本的 revision；git: 当前分支 */
  revOrBranch?: string;
}

/** 状态条目（svn status / git status 统一化） */
export interface FileStatus {
  /** 相对仓库根的路径 */
  path: string;
  /** 主状态码：M A D ? ! C R X I U ~（svn 语义为主，git 映射） */
  code: string;
  /** git porcelain 两列原文，svn 下为空 */
  porcelain?: string;
  /** git: 第二列工作区状态码 */
  wcCode?: string;
  isDir: boolean;
  absPath: string;
}

/** 提交/版本记录 */
export interface LogEntry {
  /** svn: r123；git: 短 hash abc1234 */
  rev: string;
  author: string;
  date: string;
  msg: string;
  /** 变更文件（svn: svn log -v；git: --name-status） */
  changed: { action: string; path: string }[];
}

export interface DiffResult {
  ok: boolean;
  output: string;
  error?: string;
}

export interface VcsResult {
  ok: boolean;
  message: string;
  stderr?: string;
  /** 结构化错误分类：AUTH=认证失败（服务层据 code 透传 authError,不再靠正则匹配中文文案） */
  code?: 'AUTH' | 'ABORTED' | 'NO_CHANGES';
  /** 命令输出的警告行（如 svn W205011 外部定义失败），原样保留，便于界面展示 */
  warnings?: string[];
}

// 状态码中文说明定义收敛于 src/shared/types.ts（前后端单一来源）
export { CODE_DESC } from '../shared/types.js';

/** SVN 仓库布局探测：标准布局 trunk/branches/tags 目录是否存在 */
export interface SvnLayout {
  trunk: boolean;
  branches: boolean;
  tags: boolean;
}

/** preflight 返回：git/svn 字段略有差异（ahead/lockedByOthers），统一可选化 */
export interface PreflightResult {
  remoteHasUpdate: boolean;
  behind: number;
  ahead?: number;
  /** 行级冲突风险文件（与 BASE 的行冲突） */
  conflictRisk: string[];
  /** svn: 被他人锁定的文件 */
  lockedByOthers?: string[];
  updatedFiles: string[];
  remoteLogs: LogEntry[];
}

/** branchList 返回：svn 多 layout 字段 */
export interface BranchListResult {
  current: string;
  branches: { name: string; remote: boolean }[];
  layout?: SvnLayout;
}

/** 统一 VCS 操作接口：公共方法两实现均实现（必选），平台独有能力可选——server 层按 repo.type 分支或 ?. 调用。 */
export interface Vcs {
  status(pathRel?: string): Promise<FileStatus[]>;
  log(limit?: number, pathRel?: string): Promise<LogEntry[]>;
  diff(a?: string, b?: string, pathRel?: string): Promise<DiffResult>;
  ls(dir: string): Promise<{ name: string; isDir: boolean }[]>;
  add(relPaths: string[]): Promise<VcsResult>;
  commit(relPaths: string[], msg: string): Promise<VcsResult>;
  restoreMissing(): Promise<string[]>;
  revert(relPaths: string[]): Promise<VcsResult>;
  remove(relPaths: string[]): Promise<VcsResult>;
  /** 仅从版本库移除（磁盘保留：git rm --cached / svn delete --keep-local） */
  removeKeep(relPaths: string[]): Promise<VcsResult>;
  preflight(): Promise<PreflightResult>;
  branchList(): Promise<BranchListResult>;
  switchCheck(branch: string): Promise<{ changed: number; tracked: number; untracked: number; conflicts: string[] }>;
  branchCreate(name: string): Promise<VcsResult>;
  branchSwitch(name: string): Promise<VcsResult>;
  branchDelete(name: string, force?: boolean): Promise<VcsResult>;
  merge(name: string): Promise<VcsResult>;
  /** 中止进行中的合并（git 独有：merge --abort；svn 无对应物） */
  mergeAbort?(): Promise<VcsResult>;
  /** 推送指定本地分支到远程（git 独有；首次推送自动 git push -u origin <名字> 建立上游） */
  branchPush?(name: string, signal?: AbortSignal): Promise<VcsResult & { authType?: 'github' | 'server' | 'ssh' }>;
  tagList(): Promise<string[]>;
  tagCreate(name: string, message?: string, rev?: string): Promise<VcsResult>;
  tagDelete(name: string): Promise<VcsResult>;
  blame(pathRel: string): Promise<{ rev: string; author: string; date: string; line: number; text: string }[]>;

  // ---- git 独有（server 层仅在 repo.type === 'git' 时调用）----
  branch?(): Promise<string>;
  remote?(): Promise<string>;
  gitInfo?(): Promise<{ branch: string; remote: string; upstream: string; lastCommit: { hash: string; author: string; date: string; msg: string } | null }>;
  setRemote?(url: string): Promise<VcsResult>;
  unpushed?(): Promise<string[]>;
  unpushedCount?(): Promise<number>;
  unpushedLog?(): Promise<LogEntry[]>;
  amend?(message: string): Promise<VcsResult>;
  reword?(hash: string, message: string): Promise<VcsResult>;
  resetSoft?(): Promise<VcsResult>;
  diffStaged?(pathRel?: string): Promise<DiffResult>;
  show?(rev: string, pathRel?: string): Promise<DiffResult>;
  cat?(pathRel: string): Promise<DiffResult>;
  pull?(signal?: AbortSignal): Promise<VcsResult & { files?: { path: string; status: string; code: string }[] }>;
  push?(signal?: AbortSignal): Promise<VcsResult & { authType?: 'github' | 'server' | 'ssh' }>;
  stashList?(): Promise<{ index: number; label: string }[]>;
  stashPush?(message?: string): Promise<VcsResult>;
  stashPop?(index: number): Promise<VcsResult>;
  stashDrop?(index: number): Promise<VcsResult>;
  cleanList?(): Promise<string[]>;
  clean?(): Promise<VcsResult>;
  ignoreAdd?(pattern: string): Promise<VcsResult>;
  remoteList?(): Promise<{ name: string; url: string }[]>;
  remoteAdd?(name: string, url: string): Promise<VcsResult>;
  remoteRemove?(name: string): Promise<VcsResult>;

  // ---- svn 独有 ----
  info?(): Promise<{ url?: string; revision?: string; relUrl?: string }>;
  layout?(): Promise<SvnLayout>;
  diffUrl?(a: string, b: string, url: string): Promise<DiffResult>;
  catRev?(rev: string, pathRel: string): Promise<DiffResult>;
  update?(pathRel?: string, signal?: AbortSignal): Promise<VcsResult & { files?: { path: string; status: string; code: string }[] }>;
  selfLockedFiles?(): Promise<string[]>;
  cleanup?(): Promise<VcsResult>;
  resolve?(pathRel: string, accept: string): Promise<VcsResult>;
  propSetIgnore?(pathRel: string, pattern: string): Promise<VcsResult>;
  lock?(pathRel: string, force?: boolean): Promise<VcsResult>;
  unlock?(pathRel: string, force?: boolean): Promise<VcsResult>;
}
