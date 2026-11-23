/** API 底层封装与跨业务域通用类型：各业务分组统一从这里取 api()，不要互相引用。 */
export { CODE_DESC } from '../../../shared/types.js';
import type { ParsedDiff } from '../../../shared/types.js';
import { t } from '../../../shared/i18n/index.js';
export type { ParsedDiff };

/** 非空目录的文件预览（新建仓库二次确认用） */
export interface RepoPreview {
  /** 参与提交的文件数（已排除常见依赖/构建目录） */
  files: number;
  bytes: number;
  /** 匹配敏感文件名的相对路径（最多 20 个） */
  sensitive: string[];
  /** 超过 50MB 的文件（最多 10 个） */
  large: string[];
  /** 目标是否已有 .gitignore */
  hasGitignore: boolean;
  /** 目标已有 .git 且有提交 */
  hasCommit: boolean;
}

export interface RepoCheck {
  /** 目标完整路径（dir/name） */
  target: string;
  /** 目标目录已存在（任意内容） */
  exists: boolean;
  /** 目标目录已存在且非空（克隆/检出到非空目录会失败或产生嵌套） */
  existsNonEmpty: boolean;
  /** 目标非空但只有 .svn（上次检出中断的残骸；检出时会自动清理） */
  onlySvn: boolean;
  /** 目标非空但只有 .git（上次克隆中断的残骸；克隆时会自动清理） */
  onlyGit: boolean;
  /** 目标位于已有仓库/工作副本内（向上查找 .git/.svn 命中） */
  inRepo: { type: 'git' | 'svn'; root: string } | null;
  /** 非空目录的文件预览；空/不存在目录为 null */
  preview?: RepoPreview | null;
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
  /** 作者（package.json author.name）与其主页 */
  author?: string;
  authorUrl?: string;
  /** 项目主页（package.json homepage） */
  homepage?: string;
  /** 开源协议（package.json license） */
  license?: string;
  /** 服务实例标识（进程重启即变）：前端用它判断服务是否重启过（终端历史据此作废，见 terminal.tsx） */
  instanceId?: string;
  /** 项目根有 deploy/release.mjs：⋯ 菜单显示「发布新版本」 */
  canRelease?: boolean;
  /** 项目里有打包脚本（deploy/build.sh 等）：即使没有远程也能打开「发布」弹窗的「本地打包」tab */
  canLocalBuild?: boolean;
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
  /** kind：svn 目录项（整目录新增/删除）；git 只列文件，恒为 file/undefined */
  changed: { action: string; path: string; kind?: 'file' | 'dir' }[];
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
  /** 认证失败类型（github / server / ssh 为 git 推送；svn 为 SVN 检出），前端据此引导认证 */
  authType?: 'github' | 'server' | 'ssh' | 'svn';
  /** 目录还原（svn 反向合并）产生的冲突文件：界面提示并交给冲突视图解决 */
  conflicts?: string[];
  /** 系统回收站不可用（gio / trash-put / PowerShell 均失败）：failedPaths 为未删除的路径，前端据此二次确认（force 重发直接删） */
  trashUnavailable?: boolean;
  failedPaths?: string[];
  trashReason?: string;
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

export class ApiError extends Error {
  authError: boolean;
  /** 用户主动中止（AbortError）。调用方判断「取消 vs 真失败」用这个标志，**不要比较 message 文本**（随界面语言变）。 */
  cancelled: boolean;
  /** 被局域网共享门禁拒绝（白名单/只读/不允许切换项目）：不是业务失败，调用方不要据此标记数据失效 */
  shareDenied: boolean;
  constructor(msg: string, authError = false, cancelled = false, shareDenied = false) {
    super(msg);
    this.authError = authError;
    this.cancelled = cancelled;
    this.shareDenied = shareDenied;
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  return request<T>(path, init, false);
}

/** 实际请求：NO_REPO 自动重试一次。
 *  切项目的竞态、WSL 路径映射/挂载抖动会让服务端瞬时检测不到工作副本，
 *  隔 300ms 的第二次请求通常就恢复了；仍失败才把可操作提示交给用户。 */
async function request<T>(path: string, init: RequestInit | undefined, retried: boolean): Promise<T> {
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
  let data: { error?: string; authError?: boolean; shareDenied?: boolean } | null = null;
  try {
    data = await res.json();
  } catch {
    /* 非 JSON */
  }
  if (!res.ok || data?.error) {
    const msg = data?.error || `HTTP ${res.status}`;
    // 瞬时检测失败：自动重试一次（用户已取消则不重试）
    if (msg === 'NO_REPO' && !retried) {
      if (init?.signal?.aborted) throw new ApiError(t('common.cancelled'), false, true);
      await new Promise((r) => setTimeout(r, 300));
      return request<T>(path, init, true);
    }
    // 仍失败：NO_REPO 换成可操作的中文提示，不再把内部错误码甩给用户
    throw new ApiError(
      msg === 'NO_REPO' ? t('common.noRepo') : msg,
      Boolean(data?.authError),
      false,
      Boolean(data?.shareDenied),
    );
  }
  return data as T;
}

/** 状态码优先级（排序 + 网格目录徽标取前 2 个 + 悬浮卡状态顺序，共用这一张表）。
 *  C 冲突最急；? 未版本化也是"要处理的"（加进版本库或忽略），排在干净文件之前；
 *  X 外部引用与 I 已忽略是"不归这个仓库管"的，给**负权重**沉到干净文件之后（X 比 I 更靠后）。
 *  U 已更新其实不出现在文件列表里（只在更新结果弹窗），留着不影响排序。 */
export const codeRank = (c: string): number =>
  ({ C: 10, '!': 9, D: 8, M: 7, A: 6, R: 5, '~': 4, U: 3, '?': 2, X: -2, I: -1 })[c] ?? 0;

export function json(body: unknown, signal?: AbortSignal): RequestInit {
  return { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal };
}
