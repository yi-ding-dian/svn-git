/** 版本管理对话框：分支 / 标签 / Stash / 创建仓库（git + svn 通用）
 *  重构说明：各弹窗已拆至 dialogs/ 子目录（common 共享小部件 / branch / clean-stash / tag-git-info / repo-create），
 *  本文件仅保留 re-export 入口，保证 app.tsx / open.tsx 等既有导入路径不变。 */
export { BranchDialog } from './dialogs/branch.js';
export { CleanDialog, StashDialog } from './dialogs/clean-stash.js';
export { TagDialog, GitInfoModal, GitPushAuthModal } from './dialogs/tag-git-info.js';
export { CreateRepoDialog, GetRepoDialog } from './dialogs/repo-create.js';
