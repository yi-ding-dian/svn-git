/** 由 shell 统一渲染的弹窗请求：业务域只描述「要弹什么」，不直接引用别的业务域。
 *
 *  - PickDirRequest：目录/文件选择（repo 的目录浏览器由宿主注入）
 *  - BranchCheckoutPayload：分支检出（Git 克隆来源由宿主从当前仓库信息补齐）
 */

/** 目录选择请求：业务域不直接引用 repo 的目录浏览器，由 shell 注入并渲染。
 *  restrictTo=浏览下界（合并范围限制在工作副本内）；allowFiles=允许选中文件（文件级合并） */
export interface PickDirRequest {
  title: string;
  startDir: string;
  restrictTo?: string;
  allowFiles?: boolean;
  onPick: (path: string) => void;
}

/** 分支检出请求：业务域只描述分支，Git 的克隆来源由 shell 从当前仓库信息补齐 */
export interface BranchCheckoutPayload {
  repoType: 'svn' | 'git';
  /** 显示名（远程分支形如 origin/feature；SVN trunk 行传 trunk） */
  name: string;
  /** 本地分支名（远程分支去掉 origin/ 前缀） */
  localName: string;
  /** 是否按远程分支检出（Git 本地已有同名分支时为 false） */
  remote: boolean;
  /** SVN：分支 URL；Git 留空（宿主补 origin / 本地路径） */
  url?: string;
}
