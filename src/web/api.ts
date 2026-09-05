/** 后端 API 封装 */

export interface RepoCheck {
  /** 目标完整路径（dir/name） */
  target: string;
  /** 目标目录已存在（任意内容） */
  exists: boolean;
  /** 目标目录已存在且非空（克隆/检出到非空目录会失败或产生嵌套） */
  existsNonEmpty: boolean;
  /** 目标位于已有仓库/工作副本内（向上查找 .git/.svn 命中） */
  inRepo: { type: 'git' | 'svn'; root: string } | null;
}

export interface RepoInfo {
  type: 'svn' | 'git' | null;
  root: string | null;
  url: string | null;
  revOrBranch: string | null;
  startDir: string;
  /** 当前操作范围(相对仓库根,大仓库中的子项目):浏览起点;空 = 仓库根 */
  startRel?: string;
  /** 用户 home 目录（打开项目默认浏览位置） */
  home?: string;
  version?: string;
}

export interface FileStatus {
  path: string;
  code: string;
  porcelain?: string;
  wcCode?: string;
  isDir: boolean;
}

export interface LogEntry {
  rev: string;
  author: string;
  date: string;
  msg: string;
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
  authError?: boolean;
  /** svn 命令输出警告行（如 W205011 外部定义失败） */
  warnings?: string[];
  /** git 推送认证失败类型（github / server / ssh），前端据此引导认证 */
  authType?: 'github' | 'server' | 'ssh';
}

export interface BrowseResult {
  entries: { name: string; isDir: boolean }[];
  repo: RepoInfo | null;
  dir: string;
}

export interface LsResult {
  items: { name: string; isDir: boolean }[];
  repoType: 'svn' | 'git';
}

/** 最近项目记录（含常用标记） */
export interface HistoryItem {
  path: string;
  type: 'svn' | 'git';
  lastOpened: number;
  fav?: boolean;
}

export interface FsEntry {
  name: string;
  isDir: boolean;
  size: number;
  mtime: string;
  code: string;
  count?: number;
  /** 目录同时发生的操作集合（M/A/D…），无操作或未版本化时为 undefined */
  codes?: string[];
  /** 目录内部未版本化文件数量（'?' 不显示徽标，筛选"仅新文件"时用于提示新文件位置） */
  unversionedCount?: number;
}

export interface FsData {
  dir: string;
  abs: string;
  root: string;
  entries: FsEntry[];
  selfLocked?: string[];
}

export class ApiError extends Error {
  authError: boolean;
  constructor(msg: string, authError = false) {
    super(msg);
    this.authError = authError;
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, init);
  } catch (e) {
    // 用户主动取消（AbortError）
    if ((e as Error).name === 'AbortError') throw new ApiError('已取消', false);
    // 网络层失败：服务进程可能已退出
    throw new ApiError('无法连接服务（服务可能已停止）。请重新启动应用，或检查启动它的终端窗口', false);
  }
  let data: any = null;
  try {
    data = await res.json();
  } catch {
    /* 非 JSON */
  }
  if (!res.ok || data?.error) {
    const msg = data?.error || `HTTP ${res.status}`;
    throw new ApiError(msg, Boolean(data?.authError));
  }
  return data as T;
}

export const get = {
  info: () => api<RepoInfo>('/api/info'),
  status: () => api<{ items: FileStatus[] }>('/api/status'),
  filteredTree: (dir?: string, codes: string[] = []) =>
    api<{ tree: FilterTreeNode[] }>(`/api/filtered-tree?dir=${encodeURIComponent(dir ?? '')}&codes=${encodeURIComponent(codes.join(','))}`),
  /** 目录下（含子目录）该状态文件，按 mtime 降序（角标跳转定位） */
  locate: (dir: string, code: string) =>
    api<{ files: { path: string; mtime: number }[] }>(`/api/locate?dir=${encodeURIComponent(dir)}&code=${encodeURIComponent(code)}`),
  log: (pathRel?: string, limit?: number, offset?: number, afterRev?: string) => {
    const q = new URLSearchParams();
    if (pathRel) q.set('path', pathRel);
    if (limit !== undefined) q.set('limit', String(limit)); // 0 = 全量
    if (offset) q.set('offset', String(offset)); // 续拉：已加载条数
    if (afterRev) q.set('afterRev', afterRev); // svn 续拉：已加载最老版本
    const qs = q.toString();
    return api<{ logs: LogEntry[]; unpushed: string[]; total: number; totalGt?: boolean }>(`/api/log${qs ? `?${qs}` : ''}`);
  },
  diff: (pathRel?: string, a?: string, b?: string) => {
    const q = new URLSearchParams();
    if (pathRel) q.set('path', pathRel);
    if (a) q.set('a', a);
    if (b) q.set('b', b);
    return api<DiffResult>(`/api/diff?${q}`);
  },
  fileVersions: (path: string, a?: string, b?: string) => {
    const q = new URLSearchParams({ path });
    if (a) q.set('a', a);
    if (b) q.set('b', b);
    return api<{ left: string; right: string; leftLabel: string; rightLabel: string }>(`/api/file-versions?${q}`);
  },
  fileMtime: (path: string) => api<{ mtime: number; size: number }>(`/api/file-mtime?path=${encodeURIComponent(path)}`),
  show: (rev: string, pathRel?: string) => {
    const q = new URLSearchParams({ rev });
    if (pathRel) q.set('path', pathRel);
    return api<DiffResult>(`/api/show?${q}`);
  },
  ls: (dir?: string) => api<LsResult>(`/api/ls?dir=${encodeURIComponent(dir ?? '')}`),
  cat: (pathRel: string) => api<DiffResult>(`/api/cat?path=${encodeURIComponent(pathRel)}`),
  browse: (dir?: string) => api<BrowseResult>(`/api/browse?path=${encodeURIComponent(dir ?? '')}`),
  pickDir: () => api<{ path: string | null; unsupported: boolean }>('/api/pick-dir'),
  fs: (dir?: string, force?: boolean) =>
    api<FsData>(`/api/fs?dir=${encodeURIComponent(dir ?? '')}${force ? '&force=1' : ''}`),
  config: () => api<{ username: string; trustServerCert: boolean }>('/api/config'),
  history: () => api<{ items: HistoryItem[] }>('/api/history'),
  search: (query: string, dir = '') =>
    api<{ paths: string[] }>(`/api/search?query=${encodeURIComponent(query)}&dir=${encodeURIComponent(dir)}`),
  envCheck: () => api<{ svn: { installed: boolean; version: string }; git: { installed: boolean; version: string } }>('/api/env-check'),
  /** 远程连通性检测（网络灯）：ok=网络通;reason=认证失败/连接错误说明 */
  netCheck: () => api<{ ok: boolean; reason: string }>('/api/net-check'),
  /** 系统可用字体 family 列表（字体设置：不存在的字体不给选） */
  fonts: () => api<{ families: string[] }>('/api/fonts'),
  /** 系统可用打开方式（按扩展名匹配 .desktop 程序）；chooseOpen(仅 win32) 为「选择其他应用…」哨兵命令 */
  appsFor: (ext: string) =>
    api<{ apps: { name: string; exec: string; icon: string }[]; chooseOpen?: string | null }>(`/api/apps-for?ext=${encodeURIComponent(ext)}`),
  preflight: (signal?: AbortSignal) =>
    api<{
      remoteHasUpdate: boolean;
      behind: number;
      ahead: number;
      conflictRisk: { path: string; lines: number[] }[];
      lockedByOthers: string[];
      updatedFiles: string[];
      /** 远程新提交（按提交分组显示，含作者/时间/消息/变更文件） */
      remoteLogs?: LogEntry[];
    }>('/api/preflight', { signal }),
  conflicts: () =>
    api<{ conflicts: { path: string; ours: string; theirs: string; base: string; work: string }[] }>('/api/conflicts'),
  ignoreRules: (path: string) => api<{ rules: string[] }>(`/api/ignore?path=${encodeURIComponent(path)}`),
  conflictDetail: (path: string) =>
    api<{ path: string; theirsDiff: string; myDiff: string }>(`/api/conflict-detail?path=${encodeURIComponent(path)}`),
  branches: () => api<BranchInfo>('/api/branches'),
  switchCheck: (branch: string) =>
    api<{ changed: number; tracked: number; untracked: number; conflicts: string[] }>(
      `/api/switch-check?branch=${encodeURIComponent(branch)}`,
    ),
  /** 合并预检：git 同 switchCheck + lineConflicts（提交级冲突试算）；svn 额外 outdated 标记 */
  mergeCheck: (branch: string) =>
    api<{ changed: number; tracked: number; untracked: number; conflicts: string[]; lineConflicts?: string[]; outdated?: { wcRev: string; headRev: string } | null }>(
      `/api/merge-check?branch=${encodeURIComponent(branch)}`,
    ),
  tags: () => api<{ tags: string[]; layout?: SvnLayout }>('/api/tags'),
  stash: () => api<{ items: StashItem[] }>('/api/stash'),
  blame: (path: string) => api<{ lines: { rev: string; author: string; date: string; line: number; text: string }[] }>(`/api/blame?path=${encodeURIComponent(path)}`),
  gitClean: () => api<{ files: string[] }>('/api/git-clean'),
  remotes: () => api<{ remotes: { name: string; url: string }[] }>('/api/remotes'),
  gitInfo: () =>
    api<{ branch: string; remote: string; upstream: string; lastCommit: { hash: string; author: string; date: string; msg: string } | null }>(
      '/api/git-info',
    ),
  gitAuth: () => api<{ username: string; hasPassword: boolean }>('/api/git-auth'),
  gitUnpushedCount: () => api<{ count: number }>('/api/git-unpushed-count'),
  gitUnpushed: () => api<{ count: number; unpushed: LogEntry[] }>('/api/git-unpushed'),
};

export interface FilterTreeNode {
  name: string;
  path: string;
  isDir: boolean;
  code: string;
  /** 文件大小（字节,目录为 0）——过滤树悬浮卡片与列表一致性 */
  size?: number;
  /** 文件修改时间（目录为空） */
  mtime?: string;
  children: FilterTreeNode[];
}

/** SVN 仓库布局探测：标准布局 trunk/branches/tags 目录是否存在 */
export interface SvnLayout {
  trunk: boolean;
  branches: boolean;
  tags: boolean;
}

export interface BranchInfo {
  current: string;
  branches: { name: string; remote: boolean }[];
  /** svn 仓库布局探测结果（git 无此概念，不返回） */
  layout?: SvnLayout;
}

export interface StashItem {
  index: number;
  label: string;
}

export const post = {
  open: (dir: string) => api<{ ok: boolean }>('/api/open', json({ path: dir })),
  history: (path: string, type: 'svn' | 'git') => api<{ ok: boolean }>('/api/history', json({ path, type })),
  add: (paths: string[]) => api<VcsResult>('/api/add', json({ paths })),
  commit: (paths: string[], message: string) => api<VcsResult>('/api/commit', json({ paths, message })),
  update: (path?: string, signal?: AbortSignal) =>
    api<VcsResult & { path?: string; files?: { path: string; status: string; code?: string }[] }>('/api/update', json({ path }, signal)),
  revert: (paths: string[]) => api<VcsResult>('/api/revert', json({ paths })),
  delete: (paths: string[], keep = false) => api<VcsResult>('/api/delete', json({ paths, keep })),
  push: (signal?: AbortSignal) => api<VcsResult>('/api/push', json({}, signal)),
  branch: (action: 'create' | 'switch' | 'delete' | 'merge' | 'merge-abort' | 'push' | 'remote-delete', name: string, force = false, signal?: AbortSignal, base?: string) =>
    api<VcsResult>('/api/branch', json({ action, name, force, base }, signal)),
  tag: (action: 'create' | 'delete', name: string) => api<VcsResult>('/api/tag', json({ action, name })),
  stash: (action: 'push' | 'pop' | 'drop', message = '', index = 0, paths?: string[]) =>
    api<VcsResult>('/api/stash', json({ action, message, index, paths })),
  repoCreate: (type: 'git' | 'svn', dir: string, name: string, url = '', standard = true) =>
    api<VcsResult & { repoDir?: string }>('/api/repo-create', json({ type, dir, name, url, standard })),
  /** 创建/获取前置风险检测（目标已存在、位于仓库内等），供二次确认展示 */
  repoCheck: (type: 'git' | 'svn', dir: string, name: string, url = '') =>
    api<RepoCheck>('/api/repo-create/check', json({ type, dir, name, url })),
  svnExtra: (action: 'cleanup' | 'resolve' | 'propset-ignore', path = '', accept = 'working', pattern = '') =>
    api<VcsResult>('/api/svn-extra', json({ action, path, accept, pattern })),
  gitClean: (paths?: string[]) => api<VcsResult>('/api/git-clean', json({ paths })),
  fsDelete: (paths: string[]) => api<VcsResult>('/api/fs-delete', json({ paths })),
  /** 版本化文件/目录重命名/移动（svn move / git mv，提交后生效） */
  move: (from: string, to: string) => api<VcsResult>('/api/move', json({ from, to })),
  /** 未版本化 ? / 忽略 I 文件/目录磁盘改名（不影响版本库） */
  fsMove: (from: string, to: string) => api<VcsResult>('/api/fs-move', json({ from, to })),
  resolveConflict: (path: string, mode: 'ours' | 'theirs' | 'manual', content = '') =>
    api<VcsResult>('/api/resolve-conflict', json({ path, mode, content })),
  textDiff: (left: string, right: string) => api<{ diff: string }>('/api/text-diff', json({ left, right })),
  reveal: (path: string) => api<{ ok: boolean }>('/api/reveal', json({ path })),
  svnLock: (action: 'lock' | 'unlock', path: string, force = false) => api<VcsResult>('/api/svn-lock', json({ action, path, force })),
  ignoreRemove: (path: string, pattern: string) => api<VcsResult>('/api/ignore-remove', json({ path, pattern })),
  ignore: (path: string, pattern: string) => api<VcsResult>('/api/ignore', json({ path, pattern })),
  unignore: (path: string) => api<VcsResult>('/api/unignore', json({ path })),
  config: (cfg: { username: string; password: string; trustServerCert: boolean }) => api<{ ok: boolean }>('/api/config', json(cfg)),
  historyRemove: (path: string) => api<{ ok: boolean; items: HistoryItem[] }>('/api/history-remove', json({ path })),
  historyFav: (path: string, fav: boolean) => api<{ ok: boolean; items: HistoryItem[] }>('/api/history-fav', json({ path, fav })),
  mkdir: (path: string) => api<{ ok: boolean }>('/api/mkdir', json({ path })),
  rename: (from: string, to: string) => api<{ ok: boolean }>('/api/rename', json({ from, to })),
  gitConfig: (remoteUrl: string) => api<VcsResult>('/api/git-config', json({ remoteUrl })),
  gitAuthSave: (username: string, password: string) => api<VcsResult>('/api/git-auth', json({ username, password })),
  gitAmend: (message: string) => api<VcsResult>('/api/git-amend', json({ message })),
  gitReword: (hash: string, message: string) => api<VcsResult>('/api/git-reword', json({ hash, message })),
  gitReset: () => api<VcsResult>('/api/git-reset', json({})),
  shutdown: () => api<{ ok: boolean }>('/api/shutdown', json({})),
  /** 用指定系统程序打开仓库内文件 */
  openWith: (path: string, exec: string) => api<{ ok: boolean; message: string }>('/api/open-with', json({ path, exec })),
};

function json(body: unknown, signal?: AbortSignal): RequestInit {
  return { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal };
}

/** 状态码中文说明 */
export const CODE_DESC: Record<string, string> = {
  M: '已修改',
  A: '已添加',
  D: '已删除',
  '?': '未版本化',
  '!': '缺失',
  C: '冲突',
  R: '已替换/重命名',
  X: '外部引用',
  I: '已忽略',
  U: '已更新',
  '~': '类型变更',
};

/** 状态码优先级（目录聚合） */
export const codeRank = (c: string): number =>
  ({ C: 10, '!': 9, D: 8, M: 7, A: 6, R: 5, '~': 4, U: 3, '?': 2, X: 1, I: 0 })[c] ?? 0;
