/** 顶栏可定制按钮/菜单项注册表（按功能分组，一组一个目录、一项一个文件）。
 *
 *  顺序 = 默认展示参考（实际顺序由用户布局决定）；新增入口只改本文件一处 + 新建按钮文件。
 *  点击后打开的业务弹窗仍留在各自业务域（ops / repo / share 等），这里只做注册。
 */
import type { ToolDef } from './types.js';
// 仓库接入与信息
import { openProjectTool } from './repository/open-project.js';
import { createLocalRepositoryTool } from './repository/create-local-repository.js';
import { getRepositoryTool } from './repository/get-repository.js';
import { terminalTool } from './repository/terminal.js';
import { gitInfoTool } from './repository/git-info.js';
import { svnInfoTool } from './repository/svn-info.js';
// 版本操作
import { conflictsTool } from './version-control/conflicts.js';
import { pullTool } from './version-control/pull.js';
import { updateTool } from './version-control/update.js';
import { pushTool } from './version-control/push.js';
import { stashTool } from './version-control/stash.js';
import { refreshTool } from './version-control/refresh.js';
import { cleanWorkingCopyTool } from './version-control/clean-working-copy.js';
// 分支与标签
import { branchTool } from './branches-tags/branch.js';
import { tagsTool } from './branches-tags/tags.js';
// GitHub 远程仓库（复杂功能子模块）
import { githubCreateRepositoryTool, githubRepositoryInfoTool, githubForkRepositoryTool } from './github/index.js';
// 发布（复杂功能子模块）
import { releaseCenterTool } from './release/index.js';
// 工具与维护
import { codeStatsTool } from './tools/code-stats.js';
// 外观
import { fontTool } from './appearance/font.js';
// 应用自身
import { exitAppTool } from './application/exit-app.js';

/** 全部可定制按钮/菜单项（顺序仅作默认展示参考，实际顺序由布局决定） */
export const TOOLS: ToolDef[] = [
  conflictsTool, pullTool, updateTool, pushTool, stashTool,
  branchTool, cleanWorkingCopyTool, refreshTool, exitAppTool,
  openProjectTool, createLocalRepositoryTool, getRepositoryTool, tagsTool,
  terminalTool, codeStatsTool, fontTool, gitInfoTool,
  githubCreateRepositoryTool, githubRepositoryInfoTool,
  releaseCenterTool, githubForkRepositoryTool, svnInfoTool,
];
