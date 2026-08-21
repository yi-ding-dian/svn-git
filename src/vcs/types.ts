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
  /** 命令输出的警告行（如 svn W205011 外部定义失败），原样保留，便于界面展示 */
  warnings?: string[];
}

/** 状态码 -> 中文说明 */
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
  ' ': '无变化',
};

/** SVN 仓库布局探测：标准布局 trunk/branches/tags 目录是否存在 */
export interface SvnLayout {
  trunk: boolean;
  branches: boolean;
  tags: boolean;
}
