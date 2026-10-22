/** 分支管理子域共享：纯常量/判断，不依赖 React（容器与各子组件共用，避免重复定义） */
import type { BranchInfo } from '../../shared/api.js';
import type { I18nKey } from '../../../shared/i18n/index.js';

/** 分支操作 → 任务标题 key（**模块级**：同 OP_BUSY_KEY 惯例，避免每次渲染重建） */
export type BranchAction = 'create' | 'switch' | 'delete' | 'merge' | 'push' | 'remote-delete' | 'fetch' | 'update';

export const BRANCH_TITLE_KEY: Record<BranchAction, I18nKey> = {
  create: 'shell.tasks.branchCreate',
  switch: 'shell.tasks.branchSwitch',
  delete: 'shell.tasks.branchDelete',
  merge: 'shell.tasks.branchMerge',
  push: 'shell.tasks.branchPush',
  'remote-delete': 'shell.tasks.branchRemoteDelete',
  fetch: 'shell.tasks.branchFetch',
  update: 'shell.tasks.branchUpdate',
};

/** 主干分支：git main/master、svn trunk（团队稳定版本，禁止删除） */
export const isTrunkName = (name: string) => name === 'main' || name === 'master' || name === 'trunk';

/** 当前位置的可读名称（svn：tags/SCA_HB、branches/xxx；git 原样） */
export function currentLabelOf(data: BranchInfo | null): string {
  if (!data) return '';
  if (data.currentKind === 'tag') return `tags/${data.current}`;
  if (data.currentKind === 'branch') return `branches/${data.current}`;
  return data.current;
}

/** 目录选择请求：ops 域不直接引用 repo 的目录浏览器，由 shell 注入并渲染。
 *  restrictTo=浏览下界（合并范围限制在工作副本内）；allowFiles=允许选中文件（文件级合并） */
export interface PickDirRequest {
  title: string;
  startDir: string;
  restrictTo?: string;
  allowFiles?: boolean;
  onPick: (path: string) => void;
}

/** 分支检出请求：ops 域只描述分支，Git 的克隆来源由 shell 从当前仓库信息补齐 */
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

/** 当前项是否就是分支列表里的某项（tag/other 不在 branches 列表，不能高亮同名项） */
export function isCurrentBranchOf(data: BranchInfo | null, name: string): boolean {
  return name === data?.current && data?.currentKind !== 'tag' && data?.currentKind !== 'other';
}

/** 合并的「目标」：就是当前工作副本所在位置。
 *  SVN 在 tags/独立目录时它不是分支（合并提示里的「当前分支」要改说「当前工作副本」）。 */
export function mergeTargetOf(repoType: 'svn' | 'git', data: BranchInfo | null): { name: string; isWorkCopy: boolean } {
  const isWorkCopy = repoType === 'svn' && (data?.currentKind === 'tag' || data?.currentKind === 'other');
  return { name: data?.current ?? '', isWorkCopy };
}

/** 合并源的路径说明：SVN 分支在 branches/ 下（列表只显示名字），主干行不放 */
export function mergeSourceNoteOf(repoType: 'svn' | 'git', name: string): string | undefined {
  return repoType === 'svn' && name !== 'trunk' ? `branches/${name}` : undefined;
}
