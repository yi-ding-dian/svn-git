/** 分支管理子域共享：纯常量/判断，不依赖 React（容器与各子组件共用，避免重复定义） */
import type { BranchInfo } from '../../shared/api.js';
import type { I18nKey } from '../../../shared/i18n/index.js';

/** 分支操作 → 任务标题 key（**模块级**：同 OP_BUSY_KEY 惯例，避免每次渲染重建） */
export type BranchAction = 'create' | 'switch' | 'delete' | 'merge' | 'push' | 'remote-delete';

export const BRANCH_TITLE_KEY: Record<BranchAction, I18nKey> = {
  create: 'shell.tasks.branchCreate',
  switch: 'shell.tasks.branchSwitch',
  delete: 'shell.tasks.branchDelete',
  merge: 'shell.tasks.branchMerge',
  push: 'shell.tasks.branchPush',
  'remote-delete': 'shell.tasks.branchRemoteDelete',
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

/** 当前项是否就是分支列表里的某项（tag/other 不在 branches 列表，不能高亮同名项） */
export function isCurrentBranchOf(data: BranchInfo | null, name: string): boolean {
  return name === data?.current && data?.currentKind !== 'tag' && data?.currentKind !== 'other';
}
