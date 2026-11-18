/** 仓库 / 分支 / 工作树 / GitHub 仓库相关 API。 */
import { api, json, type LogEntry, type RepoCheck, type RepoInfo, type VcsResult } from './core.js';
import type { TransferPhase, UpdateManifest } from '../../../transfer-progress.js';

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

/** SVN 仓库布局探测：标准布局 trunk/branches/tags 目录是否存在 */
export interface SvnLayout {
  trunk: boolean;
  branches: boolean;
  tags: boolean;
}

export interface WorktreeEntry {
  path: string;
  head: string;
  /** 分支短名（detached 时为空） */
  branch?: string;
  detached: boolean;
  bare: boolean;
  /** 主工作树（当前仓库根） */
  main: boolean;
  /** 当前打开的工作副本（不能移除自己） */
  current: boolean;
  /** 目录已不存在，只剩记录 */
  prunable: boolean;
  /** 锁定原因 */
  locked?: string;
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
  /** svn：主干来源仍在后台追溯（列表已返回，查到后重拉补齐） */
  mainlinePending?: boolean;
  /** 分支时间信息仍在后台查询（列表已返回，查到后重拉补齐悬浮提示） */
  timesPending?: boolean;
  branches: {
    name: string;
    remote: boolean;
    /** git：本地分支相对上游的领先/落后提交数（无 upstream 时不返回）——分支列表 ↑N/↓N 徽标 */
    ahead?: number;
    behind?: number;
    /** git：上游分支名（如 origin/main）——徽标悬浮提示用 */
    upstream?: string;
    /** 分支创建时间（svn：copy 提交时间；git：本地分支 reflog 最早记录，远程分支无） */
    createdAt?: string;
    /** 创建人（svn 有；git 无） */
    createdBy?: string;
    /** 分支内最后一次提交的时间 / 作者 / 版本标识（svn rNNN、git 短 sha） */
    lastCommitAt?: string;
    lastCommitBy?: string;
    lastCommitRef?: string;
  }[];
  /** svn 仓库布局探测结果（git 无此概念，不返回） */
  layout?: SvnLayout;
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

export const getRepo = {
  info: () => api<RepoInfo>('/api/info'),
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
  branches: () => api<BranchInfo>('/api/branches'),
  switchCheck: (branch: string) =>
    api<{ changed: number; tracked: number; untracked: number; conflicts: string[] }>(
      `/api/switch-check?branch=${encodeURIComponent(branch)}`,
    ),
  /** 切换前结构差异摘要（svn）：新增/删除/更新数 + 会被本地未跟踪文件挡住的路径
   *  + 目标删除目录里存在未跟踪文件的路径（会产生树冲突） */
  switchPlan: (branch: string) =>
    api<{ added: number; deleted: number; modified: number; obstructed: string[]; untrackedInDeleted: string[] } | null>(
      `/api/switch-plan?branch=${encodeURIComponent(branch)}`,
    ),
  /** 合并预检：git 同 switchCheck + lineConflicts（提交级冲突试算）；svn 额外 outdated 标记 */
  mergeCheck: (branch: string, pathRel?: string) =>
    api<{ changed: number; tracked: number; untracked: number; conflicts: string[]; lineConflicts?: string[]; outdated?: { wcRev: string; headRev: string } | null }>(
      `/api/merge-check?branch=${encodeURIComponent(branch)}${pathRel ? `&path=${encodeURIComponent(pathRel)}` : ''}`,
    ),
  tags: () =>
    api<{
      tags: string[];
      layout?: SvnLayout;
      baseUrl?: string;
      /** git：标签详情（最后提交 + 附注标签创建信息 + 克隆来源） */
      details?: {
        name: string;
        hash: string;
        subject?: string;
        author?: string;
        date?: string;
        tagAuthor?: string;
        tagDate?: string;
        /** 附注标签的说明正文（发布说明）；轻量标签没有 */
        message?: string;
        source: string;
        localSource: boolean;
      }[];
    }>('/api/tags'),
  /** 分支详情：该分支的最后一次提交（检出分支时展示） */
  branchLog: (name: string) =>
    api<{ ok: boolean; rev?: string; subject?: string; author?: string; date?: string }>(
      `/api/branch-log?name=${encodeURIComponent(name)}`,
    ),
  /** Git 工作树列表 */
  worktrees: () => api<{ worktrees: WorktreeEntry[] }>('/api/worktrees'),
  /** SVN 标签详情：远程 URL 的最后一次提交（提交信息第一行） */
  tagLog: (url: string) =>
    api<{ ok: boolean; rev?: string; subject?: string; author?: string; date?: string }>(
      `/api/tag-log?url=${encodeURIComponent(url)}`,
    ),
  /** 练习仓库：能力探测（缺命令的类型由前端禁用） */
  practiceProbe: () => api<{ git: boolean; svn: boolean; svnadmin: boolean }>('/api/practice/probe'),
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
    api<{
      ok: boolean;
      phase?: TransferPhase;
      bytes?: number;
      speed?: number;
      total?: number;
      files?: number;
      steps?: string[];
      currentStep?: number;
      /** 拉取：已接收/总对象数（无总字节时界面按它画进度条） */
      objectsDone?: number;
      objectsTotal?: number;
      /** 拉取：本次更新文件清单（GitHub 远端预扫描；其它远端没有） */
      manifest?: UpdateManifest;
    }>(
      `/api/transfer-progress?chan=${encodeURIComponent(chan)}`,
    ),
};

export const postRepo = {
  /** 移除工作树 / 清理失效记录 */
  worktreeAction: (action: 'remove' | 'prune', path = '', force = false) =>
    api<VcsResult>('/api/worktree', json({ action, path, force })),
  open: (dir: string) => api<{ ok: boolean; repo?: { root: string; type: 'svn' | 'git' } }>('/api/open', json({ path: dir })),
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
  /** 练习仓库：在指定父目录下生成（成功后前端用 workDir 调用 /api/open 打开） */
  practiceCreate: (
    body: { type: 'git' | 'svn'; parentDir: string; scenarios: { remote?: boolean; conflict?: boolean }; projectLayout?: boolean },
    signal?: AbortSignal,
  ) => api<PracticeResult>('/api/practice/create', json(body, signal)),
  /** 点侧边栏 ⬇ 就地更新该项目（工作区脏则后端拒绝；结果消息直接 toast） */
  pullAny: (dir: string, signal?: AbortSignal) =>
    api<VcsResult & { files?: { path: string; status: string; code?: string }[] }>('/api/pull-any', json({ path: dir }, signal)),
  /** 远程文件保存到本地（「下载到…」）：目标已存在则后端拒绝 */
  repoSave: (url: string, dir: string) => api<{ ok: boolean; path?: string; error?: string }>('/api/repo-save', json({ url, dir })),
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
  repoCreate: (
    type: 'git' | 'svn',
    dir: string,
    name: string,
    url = '',
    standard = true,
    signal?: AbortSignal,
    ref = '',
    depth = 0,
    opts?: {
      checkout?: 'detach' | 'branch';
      mode?: 'clone' | 'worktree';
      repoRoot?: string;
      /** 把目标目录现有文件提交到新仓库（仅 fresh init 生效） */
      commitExisting?: boolean;
      /** commitExisting 时自动生成 .gitignore（目标没有才写） */
      writeGitignore?: boolean;
      /** SVN 本次临时凭据（获取前/认证失败后弹框填写；后端只本次用、不落盘） */
      username?: string;
      password?: string;
    },
  ) =>
    api<
      VcsResult & {
        repoDir?: string;
        authError?: boolean;
        /** SVN 认证失败时本次实际使用的账号（空串 = 匿名） */
        user?: string;
        committed?: boolean;
        commitError?: string;
        gitignoreWritten?: boolean;
      }
    >(
      '/api/repo-create',
      json({ type, dir, name, url, standard, ref, depth, ...opts }, signal),
    ),
  /** 创建/获取前置风险检测（目标已存在、位于仓库内等），供二次确认展示 */
  repoCheck: (type: 'git' | 'svn', dir: string, name: string, url = '') =>
    api<RepoCheck>('/api/repo-create/check', json({ type, dir, name, url })),
};
