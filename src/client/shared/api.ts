/** 后端 API 封装 */

// 状态码说明（i18n，值取当前语言）：单一事实源在 src/shared/types.ts（含 ' ' 无变化 键），此处 re-export 保持 web 侧既有导入路径不变
export { CODE_DESC } from '../../shared/types.js';
import type { ParsedDiff } from '../../shared/types.js';
import type { TransferPhase } from '../../transfer-progress.js';
import { t } from '../../shared/i18n/index.js';
import type { Lang } from '../../shared/i18n/index.js';
export type { ParsedDiff };

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
  /** 应用版本（package.json，构建信息） */
  version?: string;
  /** 构建日期（dist/build-info.json，构建脚本写入） */
  buildDate?: string;
  /** 构建提交（短 hash）：这个包打自哪次代码（dist/build-info.json，构建脚本写入） */
  commit?: string;
  /** 构建时工作区是否有未提交的已跟踪改动（同上；有则「关于」里 hash 后带 *） */
  dirty?: boolean;
  /** 服务实例标识（进程重启即变）：前端用它判断服务是否重启过（终端历史据此作废，见 terminal.tsx） */
  instanceId?: string;
}

/** GitHub 仓库信息（/api/github-repo；语言构成为"语言名 → 字节数"） */
export interface GitHubRepoResult {
  ok: boolean;
  /** api = GitHub 官方数据；local = 降级本地统计（error 带原因） */
  source?: 'api' | 'local';
  error?: string;
  remote?: string;
  languages?: Record<string, number> | null;
  repo?: {
    fullName: string;
    description: string | null;
    homepage: string | null;
    stars: number;
    forks: number;
    watchers: number;
    issues: number;
    license: string | null;
    pushedAt: string | null;
    topics: string[];
    defaultBranch: string;
    archived: boolean;
    private: boolean;
    htmlUrl: string;
  };
}

/** GitHub 新建仓库（/api/github-create-repo）：ok 时 origin 已指向新仓库。
 *  hasCommit=本地当前分支已有提交（前端据此决定创建后是否立即推送）；
 *  remoteSet=false 时 remoteMsg 带原因（仓库已建成，仅 origin 没设上，前端提示手动处理）。 */
export interface GitHubCreateResult {
  ok: boolean;
  fullName?: string;
  htmlUrl?: string;
  cloneUrl?: string;
  hasCommit?: boolean;
  remoteSet?: boolean;
  remoteMsg?: string;
  message?: string;
}

/** GitHub 身份（/api/github-identity；顶栏徽标用，只读）。
 *  isGithub=false → origin 不是 GitHub（前端不显示任何标识）；hasAuth=false → 没配凭据，
 *  服务端**没有发请求**（前端不显示徽标）；ok=false 且 hasAuth=true 时只有 blocked=true（404）才显示
 *  「无法访问」——断网/限流/Token 无效一律静默。 */
export interface GitHubIdentityResult {
  ok: boolean;
  isGithub: boolean;
  hasAuth: boolean;
  owner?: string;
  repo?: string;
  fullName?: string;
  /** 凭据对应的 GitHub 登录名（ok 时有值） */
  login?: string;
  /** 本人账号下的仓库（login === owner） */
  isOwn?: boolean;
  /** 有无推送（写）权限；null = GitHub 未返回 permissions */
  canPush?: boolean | null;
  private?: boolean;
  defaultBranch?: string;
  /** 仓库 404（不存在或凭据无权限——GitHub 有意不区分） */
  blocked?: boolean;
}

/** 「我的 GitHub 仓库」列表项（/api/github-my-repos） */
export interface GitHubMyRepo {
  fullName: string;
  name: string;
  private: boolean;
  description: string | null;
  /** 主语言（GitHub Linguist 判定；空仓库/纯文档库可能为 null） */
  language: string | null;
  stars: number;
  /** 最近推送时间 ISO（空仓库退回 updated_at，界面上统一显示成"最近变动"） */
  pushedAt: string | null;
  fork: boolean;
  archived: boolean;
  cloneUrl: string;
  htmlUrl: string;
  defaultBranch: string;
  /** 最近项目里已有本地副本时的本地路径；空 = 本地没有 */
  localPath: string;
}

/** 「我的 GitHub 仓库」列表（/api/github-my-repos）。
 *  hasAuth=false = 没配凭据（服务端**没有发请求**）；ok=false 且 hasAuth=true 时 message 带原因。 */
export interface GitHubMyReposResult {
  ok: boolean;
  hasAuth: boolean;
  repos?: GitHubMyRepo[];
  /** 还有下一页（服务端按 GitHub 的 Link 头判定） */
  hasMore?: boolean;
  message?: string;
}

export interface FileStatus {
  path: string;
  /** 仅重命名（code='R'）有值：从哪个路径移过来的（后端 git status 解析带出，用于提示 + 提交时补全） */
  origPath?: string;
  code: string;
  porcelain?: string;
  wcCode?: string;
  isDir: boolean;
  /** 树冲突：本地已添加/修改，服务器同路径已删除或移动（后端 svn status 已带出，前端此前未声明） */
  treeConflicted?: boolean;
}

export interface LogEntry {
  rev: string;
  author: string;
  date: string;
  msg: string;
  changed: { action: string; path: string }[];
  /** 合并提交（git 多父）：自身无文件变更，界面显示「合并」而非「0 文件」（见 vcs/types.ts） */
  isMerge?: boolean;
  /** 根提交（无父）：历史详情弹窗用空树作为"前一版本"（见 vcs/types.ts） */
  isRoot?: boolean;
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
  /** 结构化错误分类（服务端透传，定义源头在 src/vcs/types.ts）：AUTH=认证失败 / ABORTED=用户取消 /
   *  NO_CHANGES=无变化 / NO_IDENTITY=git 身份未配置（提交被拒 → 前端弹「设置身份」窗） */
  code?: 'AUTH' | 'ABORTED' | 'NO_CHANGES' | 'NO_IDENTITY';
  /** svn 命令输出警告行（如 W205011 外部定义失败） */
  warnings?: string[];
  /** git 推送认证失败类型（github / server / ssh），前端据此引导认证 */
  authType?: 'github' | 'server' | 'ssh';
  /** 系统回收站不可用（gio / trash-put / PowerShell 均失败）：failedPaths 为未删除的路径，前端据此二次确认（force 重发直接删） */
  trashUnavailable?: boolean;
  failedPaths?: string[];
  trashReason?: string;
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
  /** 用户备注（右键「备注」设置）：显示在时间前，过长由 CSS 截断；空/缺省 = 无备注 */
  remark?: string;
}

export interface FsEntry {
  name: string;
  isDir: boolean;
  size: number;
  mtime: string;
  code: string;
  /** 仅重命名（code='R'）有值：从哪个路径移过来的（后端 /api/fs 透传，列表用 tooltip 提示来源） */
  origPath?: string;
  count?: number;
  /** 目录同时发生的操作集合（M/A/D…），无操作或未版本化时为 undefined */
  codes?: string[];
  /** 目录内部未版本化文件数量（'?' 不显示徽标，筛选"仅新文件"时用于提示新文件位置） */
  unversionedCount?: number;
  /** 磁盘上已缺失（svn '!' / git " D"）：磁盘无文件、版本库仍在 → 虚化渲染，右键可还原 */
  miss?: boolean;
  /** 树冲突：本地已添加/修改，服务器同路径已删除或移动。本地 status 就带，无需联网 */
  treeConflicted?: boolean;
  /** 该目录**内部深层**还有树冲突（仅小仓库全量扫描时可能为真；超大工作副本浅扫描拿不到） */
  innerTreeConflict?: boolean;
}

export interface FsData {
  dir: string;
  abs: string;
  root: string;
  entries: FsEntry[];
  selfLocked?: string[];
  /** 当前目录被 SVN 标成「缺失」（磁盘上确实没有） */
  wcBroken?: boolean;
  /** 当前目录被锁定：上次 SVN 操作未正常结束，需先停其他 SVN 程序再 cleanup */
  wcLocked?: boolean;
  /** 工作副本不完整：上次操作中途失败，cleanup 即可修复 */
  wcIncomplete?: boolean;
  /** 树冲突条目数（>0 时前端再去 /api/wc-conflicts 问服务器，确认这些路径还在不在） */
  treeConflicts?: number;
}

/** 树冲突诊断结果（/api/wc-conflicts） */
export interface WcConflictItem {
  path: string;
  /** 服务器上该路径已不存在（被删或被移）——树冲突的根源 */
  serverMissing: boolean;
  /** 复制源（该目录从哪个版本复制来的） */
  fromRev?: string;
  fromAuthor?: string;
  fromDate?: string;
}

export class ApiError extends Error {
  authError: boolean;
  /** 用户主动中止（AbortError）。调用方判断「取消 vs 真失败」用这个标志，**不要比较 message 文本**（随界面语言变）。 */
  cancelled: boolean;
  constructor(msg: string, authError = false, cancelled = false) {
    super(msg);
    this.authError = authError;
    this.cancelled = cancelled;
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, init);
  } catch (e) {
    // 已取消
    if ((e as Error).name === 'AbortError') throw new ApiError(t('common.cancelled'), false, true);
    // 网络层失败：服务进程可能已退出
    // 无法连接服务（服务可能已停止）。请重新启动应用，或检查启动它的终端窗口
    throw new ApiError(t('common.serviceDown'), false);
  }
  // 后端约定的错误体形状；成功时就是 T 的 JSON（下面 `as T` 交还调用方）
  let data: { error?: string; authError?: boolean } | null = null;
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

/** 检出大小检测的流式进度（见 get.repoSize） */
export interface RepoSizeTick {
  files: number;
  dirs: number;
  bytes: number;
  done?: boolean;
  /** 命中服务端缓存（秒出） */
  cached?: boolean;
  /** 部分目录读取失败，结果可能不完整 */
  partial?: boolean;
  error?: string;
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
  /** worktree=true：明确读工作区版本（内容搜索跳转用；git 默认读 HEAD 版，行号会与工作区对不上） */
  cat: (pathRel: string, worktree = false) =>
    api<DiffResult & { encoding?: string; truncated?: boolean }>(
      `/api/cat?path=${encodeURIComponent(pathRel)}${worktree ? '&source=worktree' : ''}`
    ),
  browse: (dir?: string) => api<BrowseResult>(`/api/browse?path=${encodeURIComponent(dir ?? '')}`),
  pickDir: () => api<{ path: string | null; unsupported: boolean }>('/api/pick-dir'),
  fs: (dir?: string, force?: boolean) =>
    api<FsData>(`/api/fs?dir=${encodeURIComponent(dir ?? '')}${force ? '&force=1' : ''}`),
  /** 工作副本树冲突诊断：去服务器核对冲突路径是否还在（只在 /api/fs 报了 treeConflicts 时调用） */
  wcConflicts: (dir: string) =>
    api<{ conflicts: WcConflictItem[]; unchecked?: boolean }>(`/api/wc-conflicts?dir=${encodeURIComponent(dir)}`),
  config: () => api<{ username: string; trustServerCert: boolean }>('/api/config'),
  /** 界面语言（主进程现值）：本地无偏好时用它对齐 */
  lang: () => api<{ lang: string }>('/api/lang'),
  history: () => api<{ items: HistoryItem[] }>('/api/history'),
  search: (query: string, dir = '') =>
    api<{ paths: string[] }>(`/api/search?query=${encodeURIComponent(query)}&dir=${encodeURIComponent(dir)}`),
  /** 文件内容搜索：hits 按发现顺序；truncated='limit'|'time' = 结果/超时被截断（内容模式专用） */
  searchContent: (query: string, dir: string, signal?: AbortSignal) =>
    api<{ hits: { path: string; line: number; text: string }[]; truncated?: 'limit' | 'time' }>(
      `/api/search-content?query=${encodeURIComponent(query)}&dir=${encodeURIComponent(dir)}`,
      { signal }
    ),
  envCheck: () => api<{ svn: { installed: boolean; version: string }; git: { installed: boolean; version: string } }>('/api/env-check'),
  /** 远程连通性检测（网络灯）：ok=网络通;reason=认证失败/连接错误说明 */
  netCheck: () => api<{ ok: boolean; reason: string }>('/api/net-check'),
  /** 系统可用字体 family 列表（字体设置：不存在的字体不给选） */
  fonts: () => api<{ families: string[] }>('/api/fonts'),
  /** 系统可用打开方式（按扩展名匹配 .desktop 程序）；chooseOpen(仅 win32) 为「选择其他应用…」哨兵命令 */
  appsFor: (ext: string) =>
    api<{ apps: { name: string; exec: string; icon: string }[]; chooseOpen?: string | null }>(`/api/apps-for?ext=${encodeURIComponent(ext)}`),
  /** 系统应用菜单集成状态（AppImage 运行方式；installed=已安装到应用菜单） */
  appMenu: () => api<{ appImage: boolean; installed: boolean }>('/api/app-menu'),
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
    api<{
      conflicts: {
        path: string;
        ours: string;
        theirs: string;
        base: string;
        work: string;
        binary?: boolean;
        encoding?: string;
        /** 该侧没有这个文件（一侧删除/未添加的冲突）：采用这一侧 = 删除文件 */
        oursExists?: boolean;
        theirsExists?: boolean;
      }[];
    }>('/api/conflicts'),
  ignoreRules: (path: string) =>
    api<{ rules: string[]; sources?: { pattern: string; where: string }[] }>(`/api/ignore?path=${encodeURIComponent(path)}`),
  /** 忽略预案（仅 svn）：规则最终写到哪个目录、内容是什么 —— 弹窗确认前如实展示 */
  ignorePlan: (path: string) =>
    api<{ target: string; rule: string; degraded: boolean }>(`/api/ignore-plan?path=${encodeURIComponent(path)}`),
  /** 「谁忽略了我」（仅 svn）：本目录无规则却被上层规则忽略时，指出规则在哪一层 */
  ignoreSource: (path: string) =>
    api<{ source: { dir: string; rule: string } | null }>(`/api/ignore-source?path=${encodeURIComponent(path)}`),
  conflictDetail: (path: string) =>
    api<{ path: string; theirsDiff: string; myDiff: string }>(`/api/conflict-detail?path=${encodeURIComponent(path)}`),
  /** 模块索引（md 文件说明注入）：全仓库作用目录→条目；preview=注入前解析预览 */
  moduleIndex: () =>
    api<{ indexes: Record<string, { md: string; entries: { path: string; desc: string }[] }> }>('/api/module-index'),
  moduleIndexPreview: (dir: string, md: string) =>
    api<{ entries: { path: string; desc: string }[] }>(
      `/api/module-index/preview?dir=${encodeURIComponent(dir)}&md=${encodeURIComponent(md)}`,
    ),
  branches: () => api<BranchInfo>('/api/branches'),
  switchCheck: (branch: string) =>
    api<{ changed: number; tracked: number; untracked: number; conflicts: string[] }>(
      `/api/switch-check?branch=${encodeURIComponent(branch)}`,
    ),
  /** 合并预检：git 同 switchCheck + lineConflicts（提交级冲突试算）；svn 额外 outdated 标记 */
  mergeCheck: (branch: string, pathRel?: string) =>
    api<{ changed: number; tracked: number; untracked: number; conflicts: string[]; lineConflicts?: string[]; outdated?: { wcRev: string; headRev: string } | null }>(
      `/api/merge-check?branch=${encodeURIComponent(branch)}${pathRel ? `&path=${encodeURIComponent(pathRel)}` : ''}`,
    ),
  tags: () => api<{ tags: string[]; layout?: SvnLayout }>('/api/tags'),
  /** 练习仓库：能力探测（缺命令的类型由前端禁用） */
  practiceProbe: () => api<{ git: boolean; svn: boolean; svnadmin: boolean }>('/api/practice/probe'),
  stash: () => api<{ items: StashItem[] }>('/api/stash'),
  projectStatus: (dir: string, force?: boolean) => api<ProjectProbe>(`/api/project-status?path=${encodeURIComponent(dir)}${force ? '&force=1' : ''}`),
  /** 远程检查（⬇ 待拉取；后端复用 preflight，自带超时与缓存、异步不阻塞） */
  remoteProbe: (dir: string) => api<{ behind?: number; error?: string }>(`/api/remote-probe?path=${encodeURIComponent(dir)}`),
  // ---- SVN 仓库浏览（不 checkout 直接看远程）----
  repoRoot: (path: string) => api<{ ok: boolean; root?: string; rel?: string; error?: string }>(`/api/repo-root?path=${encodeURIComponent(path)}`),
  repoList: (url: string) =>
    api<{ ok: boolean; entries?: { name: string; isDir: boolean; size?: number; rev?: string; author?: string; date?: string }[]; error?: string }>(
      `/api/repo-list?url=${encodeURIComponent(url)}`,
    ),
  /** 检出大小检测（流式 NDJSON，按需触发）：onTick 每 ~400ms 收一行累计——
   *  {files,dirs,bytes} 进度 / {done:true,...} 完成（cached=缓存命中秒出，partial=部分目录失败）/
   *  {error} 失败。signal 取消（断开即停——后端据此杀 svn 子进程）；Promise 在流结束时 resolve。 */
  repoSize: async (url: string, include: string[], onTick: (s: RepoSizeTick) => void, signal?: AbortSignal): Promise<void> => {
    const inc = include.map((p) => encodeURIComponent(p)).join(',');
    const res = await fetch(`/api/repo-size?url=${encodeURIComponent(url)}${inc ? `&include=${inc}` : ''}`, { signal });
    if (!res.ok || !res.body) {
      let msg = `HTTP ${res.status}`;
      try {
        const j = (await res.json()) as { error?: string };
        if (j.error) msg = j.error;
      } catch {
        /* 非 JSON 响应：保留状态码文案 */
      }
      onTick({ files: 0, dirs: 0, bytes: 0, error: msg });
      return;
    }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const l of lines) {
        if (!l.trim()) continue;
        try {
          onTick(JSON.parse(l) as RepoSizeTick);
        } catch {
          /* 半行/坏行：忽略 */
        }
      }
    }
    if (buf.trim()) {
      try {
        onTick(JSON.parse(buf) as RepoSizeTick);
      } catch {
        /* 尾部残行：忽略 */
      }
    }
  },
  repoCat: (url: string) =>
    api<{ ok: boolean; text?: string; error?: string; /** 二进制文件：不支持文本预览（前端显示"请下载"并隐藏复制） */ binary?: boolean }>(
      `/api/repo-cat?url=${encodeURIComponent(url)}`,
    ),
  /** 远程递归搜索（仓库浏览：搜该目录下所有层级文件；后端流式边搜边停）
   *  truncated：'limit' = 匹配已满上限（仅显示前 N 条）；'time' = 目录大搜索超时（结果可能不全） */
  repoSearch: (url: string, q: string, signal?: AbortSignal) =>
    api<{ ok: boolean; items?: { path: string; isDir: boolean }[]; truncated?: 'limit' | 'time'; error?: string }>(
      `/api/repo-search?url=${encodeURIComponent(url)}&q=${encodeURIComponent(q)}`,
      { signal },
    ),
  /** GitHub 仓库信息（⋯ 菜单，仅 origin 指向 github.com 的 git 项目）。
   *  source='api' 为 GitHub 官方数据；'local' 为降级本地统计（此时 error 带原因）；
   *  force 跳过服务端 30 分钟缓存重新拉 */
  githubRepo: (force?: boolean) => api<GitHubRepoResult>(`/api/github-repo${force ? '?force=1' : ''}`),
  /** origin 仓库的访问权限（推送失败后判「无写权限」用；纯读）。
   *  ok=false 查询失败（原因在 message）；canPush=null 表示无凭据查不了；isGithub=false 表示 origin 不是 GitHub。
   *  前端只在 canPush === false 时引导 Fork（宁可不引导，不误弹）。 */
  githubPermissions: () =>
    api<{
      ok: boolean;
      isGithub: boolean;
      canPush?: boolean | null;
      isOwn?: boolean;
      login?: string;
      owner?: string;
      repo?: string;
      fullName?: string;
      defaultBranch?: string;
      message?: string;
    }>('/api/github-permissions'),
  /** GitHub 身份（顶栏徽标；只读）：进 GitHub 项目自动查一次，服务端带 30 分钟缓存。
   *  没配凭据时服务端直接返回 hasAuth=false 且**不发请求**。 */
  githubIdentity: () => api<GitHubIdentityResult>('/api/github-identity'),
  /** 我的 GitHub 仓库列表（顶栏 GitHub 图标；服务端**不缓存**，每次打开现拉）。page 从 1 起。 */
  githubMyRepos: (page = 1) => api<GitHubMyReposResult>(`/api/github-my-repos?page=${page}`),
  /** 传输进度（任务面板每秒轮询；ok=false = 没在跑，或这种操作没有进度信息——如 SVN 检出/更新）。
   *  chan = 获取的目标目录，或 'push' / 'pull'。 */
  transferProgress: (chan: string) =>
    api<{ ok: boolean; phase?: TransferPhase; bytes?: number; speed?: number; total?: number; files?: number; steps?: string[]; currentStep?: number }>(
      `/api/transfer-progress?chan=${encodeURIComponent(chan)}`,
    ),
  /** SVN 身份（只读）：工具配置账号 + svn 官方凭据缓存账号（cache 按 url 的 host 匹配 realm）。 */
  svnIdentity: (url: string) =>
    api<{ ok: boolean; config: { username: string } | null; cache: { username: string; realms: string[] } | null }>(
      `/api/svn-identity?url=${encodeURIComponent(url)}`,
    ),
  stashFiles: (index: number) => api<{ files: { path: string; code: string }[] }>(`/api/stash?index=${index}`),
  blame: (path: string) => api<{ lines: { rev: string; author: string; date: string; line: number; text: string }[] }>(`/api/blame?path=${encodeURIComponent(path)}`),
  gitClean: () => api<{ files: string[] }>('/api/git-clean'),
  remotes: () => api<{ remotes: { name: string; url: string }[] }>('/api/remotes'),
  gitInfo: () =>
    api<{ branch: string; remote: string; upstream: string; lastCommit: { hash: string; author: string; date: string; msg: string } | null }>(
      '/api/git-info',
    ),
  gitAuth: () => api<{ username: string; hasPassword: boolean }>('/api/git-auth'),
  /** git 身份（user.name / user.email 的有效值 + 作用域）：提交失败弹「设置身份」窗与 Git 信息弹窗回显用 */
  gitIdentity: () => api<{ name: string; email: string; scope: 'repo' | 'global' | '' }>('/api/git-identity'),
  /** 提交完整说明（标题+正文）：改注释弹窗回显用（列表接口只带 %s 标题，不含正文） */
  commitMessage: (rev: string) => api<{ message: string }>(`/api/commit-message?rev=${encodeURIComponent(rev)}`),
  gitUnpushedCount: () => api<{ count: number }>('/api/git-unpushed-count'),
  gitUnpushed: () => api<{ count: number; unpushed: LogEntry[] }>('/api/git-unpushed'),
  /** 单文件的逐块差异（hunk 级部分提交用） */
  diffHunks: (path: string) => api<ParsedDiff>(`/api/diff-hunks?path=${encodeURIComponent(path)}`),
  /** 已在暂存区里的文件（提交弹窗恢复「部分暂存」标记用） */
  stagedFiles: () => api<{ files: string[] }>('/api/staged-files'),
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

/** 合回主干预检（svn）：主干对应路径 + 本地主干工作副本状态 */
export interface MainlinePlan {
  sourceUrl: string;
  mainlineUrl: string | null;
  mainlineRelative?: string;
  targetDir: string;
  suggestion: string;
  targetState: 'missing' | 'not-wc' | 'wrong-url' | 'dirty' | 'ready';
  targetUrl?: string;
  error?: string;
}

export interface BranchInfo {
  current: string;
  /** svn：当前位置类型（trunk/branches/tags/其他） */
  currentKind?: 'trunk' | 'branch' | 'tag' | 'other';
  /** svn：当前工作副本 URL 与项目根 URL（项目迁移弹窗展示用） */
  currentUrl?: string;
  projectRoot?: string;
  /** svn：版本库根 URL（迁移命令预览简写成 ^/…） */
  reposRootUrl?: string;
  /** svn：由 copyfrom 推断出的主干对应 URL/相对路径（tags/SCA_HB → trunk/src） */
  mainlineUrl?: string;
  mainlineRelative?: string;
  branches: {
    name: string;
    remote: boolean;
    /** git：本地分支相对上游的领先/落后提交数（无 upstream 时不返回）——分支列表 ↑N/↓N 徽标 */
    ahead?: number;
    behind?: number;
    /** git：上游分支名（如 origin/main）——徽标悬浮提示用 */
    upstream?: string;
  }[];
  /** svn 仓库布局探测结果（git 无此概念，不返回） */
  layout?: SvnLayout;
}

export interface StashItem {
  index: number;
  label: string;
}

/** 删除分支前的风险信息（/api/branch action=delete-check；git 返回 null） */
export interface BranchDeleteCheck {
  url?: string;
  lastRev?: string;
  lastAuthor?: string;
  lastDate?: string;
  /** 该分支还有多少版本没合并到当前分支；undefined = 无法判断 */
  unmerged?: number | null;
  compareWith?: string;
  /** 当前保存的 SVN 账号（有值才提供"验证密码"选项） */
  username?: string;
  /** 传了 password 时的验证结果（false 时 error 里是原因） */
  passwordOk?: boolean;
  error?: string;
}

/** 练习仓库生成结果（/api/practice/create） */
export interface PracticeResult {
  ok: boolean;
  type?: 'git' | 'svn';
  /** 生成的练习仓库根目录 */
  root?: string;
  /** 生成后要打开的工作副本目录 */
  workDir?: string;
  scenarios?: { remote?: boolean; conflict?: boolean };
  message: string;
}

/** 最近项目仪表盘：单个项目的摘要状态（后端只读探测，30 秒缓存；error 时其余字段缺省） */
export interface ProjectProbe {
  type?: 'git' | 'svn';
  /** git=分支名；svn=工作副本位置（如 trunk） */
  branch?: string;
  ahead?: number;
  /** 待拉取提交数（git，基于本地记录的远端引用，不联网） */
  behind?: number;
  changed?: number;
  untracked?: number;
  conflict?: number;
  error?: string;
}

export const post = {
  open: (dir: string) => api<{ ok: boolean; repo?: { root: string; type: 'svn' | 'git' } }>('/api/open', json({ path: dir })),
  /** 安装到系统应用菜单（POST）；卸载走 DELETE */
  appMenuInstall: () => api<{ ok: boolean; message: string }>('/api/app-menu', json({})),
  appMenuUninstall: () => api<{ ok: boolean; message: string }>('/api/app-menu', { method: 'DELETE' }),
  /** 用系统默认浏览器打开外链（仅 http/https） */
  openUrl: (url: string) => api<{ ok: boolean }>('/api/open-url', json({ url })),
  /** 模块索引注入/更新（included：勾选保留的 path 清单，null/缺省=全保留）；clear=清除作用目录注入 */
  moduleIndexSet: (dir: string, md: string, included: string[] | null) =>
    api<{ ok: boolean; count: number }>('/api/module-index', json({ dir, md, included })),
  moduleIndexClear: (dir: string) => api<{ ok: boolean }>('/api/module-index/clear', json({ dir })),
  history: (path: string, type: 'svn' | 'git') => api<{ ok: boolean }>('/api/history', json({ path, type })),
  add: (paths: string[]) => api<VcsResult>('/api/add', json({ paths })),
  commit: (paths: string[], message: string, stagedOnly: string[] = []) =>
    api<VcsResult>('/api/commit', json({ paths, message, stagedOnly })),
  update: (path?: string, signal?: AbortSignal) =>
    api<VcsResult & { path?: string; files?: { path: string; status: string; code?: string }[] }>('/api/update', json({ path }, signal)),
  revert: (paths: string[]) => api<VcsResult>('/api/revert', json({ paths })),
  /** 还原到指定历史版本（git checkout REV -- path / svn cat -r REV 写回工作区） */
  restoreVersion: (path: string, rev: string) => api<VcsResult>('/api/restore-version', json({ path, rev })),
  delete: (paths: string[], keep = false) => api<VcsResult>('/api/delete', json({ paths, keep })),
  push: (signal?: AbortSignal) => api<VcsResult>('/api/push', json({}, signal)),
  /** GitHub 新建仓库（⋯ 菜单，git 项目且 origin 尚未指向 github.com 时可用）。
   *  服务端用已存凭据调 GitHub API 建空仓库，成功后自动把 origin 指向新仓库。 */
  githubCreateRepo: (name: string, description: string, isPrivate: boolean) =>
    api<GitHubCreateResult>('/api/github-create-repo', json({ name, description, private: isPrivate })),
  /** Fork origin 仓库到自己的账号（贡献开源；服务端顺带把 origin 改指 fork、原仓库记入 upstream）。
   *  isOwn=true 表示 origin 是自己的仓库（无需 Fork）。 */
  githubFork: () =>
    api<{
      ok: boolean;
      isOwn?: boolean;
      forkFullName?: string;
      forkUrl?: string;
      login?: string;
      defaultBranch?: string;
      upstreamUrl?: string;
      remoteSet?: boolean;
      remoteMsg?: string;
      message?: string;
    }>('/api/github-fork', json({})),
  /** GitHub 删除仓库（⋯ 菜单；删除 origin 指向的远程仓库，不可恢复——前端要求输入完整仓库名二次确认）。
   *  凭据用已存 Git 凭据（classic Token 需 delete_repo）；本地 origin 不自动改动。 */
  githubDeleteRepo: (confirm: string, token: string) =>
    api<{ ok: boolean; fullName?: string; message?: string }>('/api/github-delete-repo', json({ confirm, token })),
  branch: (
    action: 'create' | 'switch' | 'delete' | 'merge' | 'merge-abort' | 'push' | 'remote-delete' | 'fetch' | 'update',
    name: string,
    force = false,
    signal?: AbortSignal,
    base?: string,
    pathRel?: string,
    ahead = 0,
    behind = 0,
  ) => api<VcsResult>('/api/branch', json({ action, name, force, base, path: pathRel, ahead, behind }, signal)),
  /** 删除分支前置检查：最后提交 + 未合并版本数（svn；git 返回 null）；带 password 时顺带验证账号 */
  branchDeleteCheck: (name: string, password?: string) =>
    api<BranchDeleteCheck | null>('/api/branch', json({ action: 'delete-check', name, password })),
  /** 创建分支：message 仅 svn（svn copy 立即提交，需要 log message；空则后端用模板） */
  branchCreate: (name: string, base?: string, message?: string, signal?: AbortSignal) =>
    api<VcsResult>('/api/branch', json({ action: 'create', name, base, message }, signal)),
  /** 删除分支：必须带确认用的分支名（服务端二次校验）；password 仅 svn，验证后即用即丢；
   *  message 仅 svn（svn delete 立即提交，空则后端用模板） */
  branchDelete: (name: string, confirmName: string, password?: string, message?: string, signal?: AbortSignal) =>
    api<VcsResult>('/api/branch', json({ action: 'delete', name, confirmName, password, message }, signal)),
  /** 练习仓库：在指定父目录下生成（成功后前端用 workDir 调用 /api/open 打开） */
  practiceCreate: (
    body: { type: 'git' | 'svn'; parentDir: string; scenarios: { remote?: boolean; conflict?: boolean }; projectLayout?: boolean },
    signal?: AbortSignal,
  ) => api<PracticeResult>('/api/practice/create', json(body, signal)),
  /** SVN 项目迁移：当前工作副本独立成长期开发线（devline）或独立项目（project）。
   *  switchAfter=迁移完成后把当前工作副本切到新路径；
   *  trunkSubPath=project 模式下内容放到 trunk 的子目录（空=trunk 根）；extraDirs=trunk 下额外建的空目录。 */
  projectMigrate: (
    mode: 'devline' | 'project',
    name: string,
    switchAfter: boolean,
    signal?: AbortSignal,
    trunkSubPath?: string,
    extraDirs?: string[],
    /** 阶段进度通道（/api/transfer-progress 轮询） */
    chan?: string,
  ) =>
    api<VcsResult & { targetUrl?: string }>('/api/project-migrate', json({ mode, name, switchAfter, trunkSubPath, extraDirs, chan }, signal)),
  /** 合回主干（仅 svn）：precheck 目标工作副本状态 / 在目标 WC 上执行 svn merge（可选自动提交） */
  mergeMainlineCheck: (targetDir: string, pathRel?: string) =>
    api<MainlinePlan>('/api/merge-mainline', json({ action: 'check', targetDir, path: pathRel })),
  mergeMainline: (targetDir: string, autoCommit: boolean, pathRel?: string, signal?: AbortSignal) =>
    api<VcsResult & { targetDir?: string; conflicts?: string[]; committed?: boolean }>(
      '/api/merge-mainline',
      json({ action: 'run', targetDir, autoCommit, path: pathRel }, signal),
    ),
  /** 终端：执行 git / svn 命令（护栏见 routes/terminal.ts）。
   *  confirm=true 表示用户已在确认框里点过"仍要执行"（危险命令第二次调用）。 */
  terminalRun: (cmd: string, dir = '', confirm = false, signal?: AbortSignal) =>
    api<{
      ok: boolean;
      code: number;
      stdout: string;
      stderr: string;
      /** 被 Ctrl+C 中断 */
      aborted?: boolean;
      /** 超过 30 秒被终止 */
      timedOut?: boolean;
      /** 危险命令：后端**没有执行**，等前端确认后带 confirm 重发 */
      needConfirm?: boolean;
      reason?: string;
      error?: string;
    }>('/api/terminal/run', json({ cmd, confirm, dir }, signal)),
  tag: (action: 'create' | 'delete', name: string) => api<VcsResult>('/api/tag', json({ action, name })),
  stash: (action: 'push' | 'pop' | 'drop', message = '', index = 0, paths?: string[]) =>
    api<VcsResult>('/api/stash', json({ action, message, index, paths })),
  /** 点侧边栏 ⬇ 就地更新该项目（工作区脏则后端拒绝；结果消息直接 toast） */
  pullAny: (dir: string, signal?: AbortSignal) =>
    api<VcsResult & { files?: { path: string; status: string; code?: string }[] }>('/api/pull-any', json({ path: dir }, signal)),
  /** 远程文件保存到本地（「下载到…」）：目标已存在则后端拒绝 */
  repoSave: (url: string, dir: string) => api<{ ok: boolean; path?: string; error?: string }>('/api/repo-save', json({ url, dir })),
  /** 清除系统凭据缓存中匹配该 URL 的条目（退出登录/切换账号用；**前端必须二次确认**——影响其他 svn 客户端） */
  svnForgetCache: (url: string) => api<{ ok: boolean; cleared: string[] }>('/api/svn-forget-cache', json({ url })),
  /** 仓库浏览右键「检出到本地」：URL 直连检出工作副本。
   *  cred = 本次临时账号密码（认证失败后重试用；**只用于本次检出、后端不落盘**，缺省用已存配置）。
   *  include = 选择性检出（SVN 深度检出）：只检出这些一级子目录（另含根目录文件），后续更新也只更新它们；
   *  空/缺省 = 完整检出（原行为）。 */
  repoCheckout: (
    url: string,
    dir: string,
    name: string,
    cred?: { username: string; password: string },
    signal?: AbortSignal,
    include?: string[],
  ) =>
    api<{
      ok: boolean;
      message: string;
      repoDir?: string;
      authError?: boolean;
      user?: string;
      /** 检出结果详情（详情窗列清单用）：files 最多 2000 条、fileTotal 是全量数 */
      files?: { code: string; path: string }[];
      fileTotal?: number;
      warnings?: string[];
    }>('/api/repo-checkout', json({ url, dir, name, username: cred?.username, password: cred?.password, include }, signal)),
  repoCreate: (type: 'git' | 'svn', dir: string, name: string, url = '', standard = true, signal?: AbortSignal) =>
    api<VcsResult & { repoDir?: string; authError?: boolean; authType?: 'github' | 'server' | 'ssh' }>(
      '/api/repo-create',
      json({ type, dir, name, url, standard }, signal),
    ),
  /** 创建/获取前置风险检测（目标已存在、位于仓库内等），供二次确认展示 */
  repoCheck: (type: 'git' | 'svn', dir: string, name: string, url = '') =>
    api<RepoCheck>('/api/repo-create/check', json({ type, dir, name, url })),
  svnExtra: (action: 'cleanup' | 'resolve' | 'propset-ignore', path = '', accept = 'working', pattern = '', signal?: AbortSignal) =>
    api<VcsResult>('/api/svn-extra', json({ action, path, accept, pattern }, signal)),
  gitClean: (paths?: string[]) => api<VcsResult>('/api/git-clean', json({ paths })),
  /** 移到回收站；force=true 跳过回收站直接删（仅用于「回收站不可用」弹窗里用户确认后的重发） */
  fsDelete: (paths: string[], force = false) => api<VcsResult>('/api/fs-delete', json({ paths, force })),
  /** 版本化文件/目录重命名/移动（svn move / git mv，提交后生效） */
  move: (from: string, to: string) => api<VcsResult>('/api/move', json({ from, to })),
  /** 未版本化 ? / 忽略 I 文件/目录磁盘改名（不影响版本库） */
  fsMove: (from: string, to: string) => api<VcsResult>('/api/fs-move', json({ from, to })),
  resolveConflict: (path: string, mode: 'ours' | 'theirs' | 'manual', content = '') =>
    api<VcsResult>('/api/resolve-conflict', json({ path, mode, content })),
  textDiff: (left: string, right: string) => api<{ diff: string }>('/api/text-diff', json({ left, right })),
  reveal: (path: string) => api<{ ok: boolean }>('/api/reveal', json({ path })),
  /** 在当前目录打开系统终端（Windows: Windows Terminal / cmd；Linux: 终端模拟器） */
  openTerminal: (path: string) => api<{ ok: boolean; message: string }>('/api/open-terminal', json({ path })),
  svnLock: (action: 'lock' | 'unlock', path: string, force = false) => api<VcsResult>('/api/svn-lock', json({ action, path, force })),
  /** 内联编辑保存：按目标文件原编码写回（后端两道守卫，详见 writeTextKeepEncoding） */
  writeFile: (path: string, content: string) => api<VcsResult>('/api/write-file', json({ path, content })),
  ignoreRemove: (path: string, pattern: string) => api<VcsResult>('/api/ignore-remove', json({ path, pattern })),
  /** 加入忽略：target=gitignore(默认，随仓库分发)/global(仅本机全部仓库)/exclude(仅本机本仓库) */
  ignore: (path: string, pattern: string, target: 'gitignore' | 'global' | 'exclude' = 'gitignore') =>
    api<VcsResult>('/api/ignore', json({ path, pattern, target })),
  unignore: (path: string) => api<VcsResult>('/api/unignore', json({ path })),
  config: (cfg: { username: string; password: string; trustServerCert: boolean }) => api<{ ok: boolean }>('/api/config', json(cfg)),
  /** 切换界面语言：主进程随即 setLang，server / vcs / main 的消息语言一并跟上 */
  lang: (lang: Lang) => api<{ ok: boolean }>('/api/lang', json({ lang })),
  historyRemove: (path: string) => api<{ ok: boolean; items: HistoryItem[] }>('/api/history-remove', json({ path })),
  historyFav: (path: string, fav: boolean) => api<{ ok: boolean; items: HistoryItem[] }>('/api/history-fav', json({ path, fav })),
  /** 设置/清除备注（侧边栏右键菜单）：传空串 = 清除 */
  historyRemark: (path: string, remark: string) => api<{ ok: boolean; items: HistoryItem[] }>('/api/history-remark', json({ path, remark })),
  mkdir: (path: string) => api<{ ok: boolean }>('/api/mkdir', json({ path })),
  /** 仓库内新建文件夹（path 相对仓库根，单级）——与上面那个系统级的 mkdir 是两回事 */
  newDir: (path: string) => api<{ ok: boolean; message?: string }>('/api/new-dir', json({ path })),
  /** 仓库内新建空文件（同 newDir，单级；已存在即失败，不覆盖） */
  newFile: (path: string) => api<{ ok: boolean; message?: string }>('/api/new-file', json({ path })),
  rename: (from: string, to: string) => api<{ ok: boolean }>('/api/rename', json({ from, to })),
  gitConfig: (remoteUrl: string) => api<VcsResult>('/api/git-config', json({ remoteUrl })),
  /** 保存 git 身份（scope=global 写全局配置，repo 只写本仓库）——提交被拒后的「设置身份」窗用 */
  gitIdentitySave: (name: string, email: string, scope: 'repo' | 'global') =>
    api<VcsResult>('/api/git-identity', json({ name, email, scope })),
  gitAuthSave: (username: string, password: string) => api<VcsResult>('/api/git-auth', json({ username, password })),
  gitAmend: (message: string) => api<VcsResult>('/api/git-amend', json({ message })),
  /** 批量提交完整说明（rev → 标题+正文）：提交列表悬浮提示用 */
  commitMessages: (revs: string[]) => api<{ messages: Record<string, string> }>('/api/commit-messages', json({ revs })),
  /** 把选中的块应用到暂存区（hunk 级部分提交） */
  stageHunks: (path: string, hunks: number[], expectBlob?: string) => api<VcsResult>('/api/stage-hunks', json({ path, hunks, expectBlob })),
  gitReword: (hash: string, message: string) => api<VcsResult>('/api/git-reword', json({ hash, message })),
  gitReset: () => api<VcsResult>('/api/git-reset', json({})),
  shutdown: () => api<{ ok: boolean }>('/api/shutdown', json({})),
  /** 用指定系统程序打开仓库内文件 */
  openWith: (path: string, exec: string) => api<{ ok: boolean; message: string }>('/api/open-with', json({ path, exec })),
  /** 在系统外部终端窗口里运行脚本（.bat/.cmd/.sh，右键「终端运行」） */
  runScript: (path: string) => api<{ ok: boolean; message: string }>('/api/run-script', json({ path })),
  /** 拖入上传：冲突预检（只传相对路径列表，不传文件内容；先探路再决定怎么传） */
  uploadCheck: (dir: string, paths: string[]) => api<{ conflicts: string[] }>('/api/upload-check', json({ dir, paths })),
  /** 打包版拖入快路径：源已在磁盘上（Electron 拿到绝对路径），让后端 fs.cp 直接复制。
   *  不走 HTTP 传内容：大文件零拷贝、目录整树复制，且保留权限位（可执行位）与时间戳 */
  copyInto: (dir: string, src: string, rel: string, mode: 'overwrite' | 'rename' | 'skip') =>
    api<{ ok?: boolean; savedAs?: string; skipped?: boolean; message?: string; error?: string }>(
      '/api/copy-into',
      json({ dir, src, path: rel, mode }),
    ),
};

/** 上传单个文件（拖入用）：body 是原始字节，不能走 json() 封装，故单独一个函数。
 *  mode：overwrite 覆盖 / rename 自动改名（a.txt → a (1).txt）/ skip 跳过同名 */
export async function uploadFile(
  dir: string,
  rel: string,
  blob: Blob,
  mode: 'overwrite' | 'rename' | 'skip',
): Promise<{ ok?: boolean; savedAs?: string; skipped?: boolean; message?: string; error?: string }> {
  const qs = `dir=${encodeURIComponent(dir)}&path=${encodeURIComponent(rel)}&mode=${mode}`;
  const r = await fetch(`/api/upload?${qs}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: blob,
  });
  return (await r.json().catch(() => ({}))) as {
    ok?: boolean;
    savedAs?: string;
    skipped?: boolean;
    message?: string;
    error?: string;
  };
}

function json(body: unknown, signal?: AbortSignal): RequestInit {
  return { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal };
}

/** 状态码说明：见文件头 re-export（src/shared/types.ts 单一事实源，值写成函数以跟随语言） */

/** 状态码优先级（排序 + 网格目录徽标取前 2 个 + 悬浮卡状态顺序，共用这一张表）。
 *  C 冲突最急；? 未版本化也是"要处理的"（加进版本库或忽略），排在干净文件之前；
 *  X 外部引用与 I 已忽略是"不归这个仓库管"的，给**负权重**沉到干净文件之后（X 比 I 更靠后）。
 *  U 已更新其实不出现在文件列表里（只在更新结果弹窗），留着不影响排序。 */
export const codeRank = (c: string): number =>
  ({ C: 10, '!': 9, D: 8, M: 7, A: 6, R: 5, '~': 4, U: 3, '?': 2, X: -2, I: -1 })[c] ?? 0;
