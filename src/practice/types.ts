/** 练习仓库生成：对外类型（业务模块，不依赖 HTTP/前端） */

export type PracticeType = 'git' | 'svn';

/** 可选场景：基础分支永远包含，remote / conflict 按需叠加 */
export interface PracticeScenarios {
  /** 制造远程同步场景（仅 Git）：↓落后、↑领先、分叉 */
  remote?: boolean;
  /** 制造可复现的合并冲突 */
  conflict?: boolean;
}

export interface PracticeRequest {
  type: PracticeType;
  /** 用户选择的父目录（必须已存在且可写） */
  parentDir: string;
  scenarios?: PracticeScenarios;
  /** SVN：多项目布局——版本库内 projects/demo-project/{trunk,branches,tags}，
   *  项目根不再是版本库根，便于练习项目迁移/多项目管理 */
  projectLayout?: boolean;
}

export interface PracticeResult {
  ok: boolean;
  type?: PracticeType;
  /** 本次生成的练习仓库根目录（清理/提示用） */
  root?: string;
  /** 生成后应打开的工作副本目录 */
  workDir?: string;
  scenarios?: PracticeScenarios;
  message: string;
}

/** 生成能力探测：缺命令的类型在前端禁用 */
export interface PracticeProbe {
  git: boolean;
  svn: boolean;
  svnadmin: boolean;
}
