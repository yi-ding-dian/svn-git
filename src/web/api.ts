/** 后端 API 封装 */

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
  log: (pathRel?: string) =>
    api<{ logs: LogEntry[]; unpushed: string[] }>(`/api/log${pathRel ? `?path=${encodeURIComponent(pathRel)}` : ''}`),
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
  tags: () => api<{ tags: string[] }>('/api/tags'),
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
  children: FilterTreeNode[];
}

export interface BranchInfo {
  current: string;
  branches: { name: string; remote: boolean }[];
}

export interface StashItem {
  index: number;
  label: string;
}

export const post = {
  open: (dir: string) => api(`/api/open?path=${encodeURIComponent(dir)}`),
  history: (path: string, type: 'svn' | 'git') => api<{ ok: boolean }>('/api/history', json({ path, type })),
  add: (paths: string[]) => api<VcsResult>('/api/add', json({ paths })),
  commit: (paths: string[], message: string) => api<VcsResult>('/api/commit', json({ paths, message })),
  update: (path?: string, signal?: AbortSignal) =>
    api<VcsResult & { path?: string; files?: { path: string; status: string; code?: string }[] }>('/api/update', json({ path }, signal)),
  revert: (paths: string[]) => api<VcsResult>('/api/revert', json({ paths })),
  delete: (paths: string[]) => api<VcsResult>('/api/delete', json({ paths })),
  push: (signal?: AbortSignal) => api<VcsResult>('/api/push', json({}, signal)),
  branch: (action: 'create' | 'switch' | 'delete' | 'merge', name: string, force = false) =>
    api<VcsResult>('/api/branch', json({ action, name, force })),
  tag: (action: 'create' | 'delete', name: string) => api<VcsResult>('/api/tag', json({ action, name })),
  stash: (action: 'push' | 'pop' | 'drop', message = '', index = 0) =>
    api<VcsResult>('/api/stash', json({ action, message, index })),
  repoCreate: (type: 'git' | 'svn', dir: string, name: string, url = '') =>
    api<VcsResult & { repoDir?: string }>('/api/repo-create', json({ type, dir, name, url })),
  svnExtra: (action: 'cleanup' | 'resolve' | 'propset-ignore', path = '', accept = 'working', pattern = '') =>
    api<VcsResult>('/api/svn-extra', json({ action, path, accept, pattern })),
  gitClean: () => api<VcsResult>('/api/git-clean', json({})),
  resolveConflict: (path: string, mode: 'ours' | 'theirs' | 'manual', content = '') =>
    api<VcsResult>('/api/resolve-conflict', json({ path, mode, content })),
  textDiff: (left: string, right: string) => api<{ diff: string }>('/api/text-diff', json({ left, right })),
  reveal: (path: string) => api<{ ok: boolean }>('/api/reveal', json({ path })),
  svnLock: (action: 'lock' | 'unlock', path: string, force = false) => api<VcsResult>('/api/svn-lock', json({ action, path, force })),
  ignoreRemove: (path: string, pattern: string) => api<VcsResult>('/api/ignore-remove', json({ path, pattern })),
  ignore: (path: string, pattern: string) => api<VcsResult>('/api/ignore', json({ path, pattern })),
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
