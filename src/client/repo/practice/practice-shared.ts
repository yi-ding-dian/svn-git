/** 练习仓库弹窗共享：类型与默认场景（容器/表单共用，不依赖 React） */

export type PracticeType = 'git' | 'svn';

export interface PracticeScenarios {
  remote: boolean;
  conflict: boolean;
}

/** 默认全勾：两个场景都不改变基础结构，新手取消勾选就能只要基础分支 */
export const DEFAULT_SCENARIOS: PracticeScenarios = { remote: true, conflict: true };
