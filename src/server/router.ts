/** API 路由表：端点域模块按序分发。
 *
 *  **顺序即响应归属**：多个 handler 可能都对同一路径返回 true，先匹配的先返回——调整顺序会
 *  改变响应（与拆分前 index.ts 的 if 链逐条对应，22 个域模块 + 版本管理扩展 API）。
 *  安全门禁不在这里：由 http/security.ts 在分发前统一执行。 */
import type { Ctx } from './http/response.js';
import { handle as handleConflicts } from './routes/conflicts.js';
import { handle as handleBranch } from './routes/branch.js';
import { handle as handleWorktree } from './routes/worktree.js';
import { handle as handleOps } from './routes/ops/index.js';
import { handle as handleStage } from './routes/stage.js';
import { handle as handleBrowse } from './routes/browse/index.js';
import { handle as handleHost } from './routes/host.js';
import { handle as handleHistory } from './routes/history.js';
import { handle as handleRecent } from './routes/recent.js';
import { handle as handlePractice } from './routes/practice.js';
import { handle as handleRepoBrowse } from './routes/repobrowse/index.js';
import { handle as handleGithub } from './routes/github/index.js';
import { handle as handleSvnAuth } from './routes/svn-auth.js';
import { handle as handleConfig } from './routes/config.js';
import { handle as handleAppUpdate } from './routes/app-update.js';
import { handle as handleRelease } from './routes/release.js';
import { handle as handlePackaging } from './routes/packaging.js';
import { handle as handleModuleIndex } from './routes/module-index.js';
import { handle as handleUpload } from './routes/upload.js';
import { handle as handleWc } from './routes/wc.js';
import { handle as handleTerminal } from './routes/terminal.js';
import { handle as handleShare } from './routes/share.js';
import { handle as handleRepoCreate } from './routes/repo-create.js';
import { handle as handleTransfer } from './routes/transfer.js';

/** 端点域模块（冲突防护 / 分支标签 / 工作树 / 操作类 / 浏览 / 宿主环境 / 历史 / 最近项目 /
 *  配置 / 上传 / 工作副本 / 终端 / 共享），按序尝试分发。 */
const HANDLERS: ReadonlyArray<(ctx: Ctx) => Promise<boolean>> = [
  handleConflicts,
  handleBranch,
  handleWorktree,
  handleOps,
  handleStage,
  handleBrowse,
  handleHost,
  handleHistory,
  handleRecent,
  handlePractice,
  handleRepoBrowse,
  handleGithub,
  handleSvnAuth,
  handleConfig,
  handleAppUpdate,
  handleRelease,
  handlePackaging,
  handleModuleIndex,
  handleUpload,
  handleWc,
  handleTerminal,
  handleShare,
];

export async function dispatch(ctx: Ctx): Promise<boolean> {
  for (const handle of HANDLERS) {
    if (await handle(ctx)) return true;
  }
  // ---------- 版本管理扩展 API ----------
  // repo-create 覆盖 /api/repo-create/check 与 /api/repo-create；transfer 只认 /api/transfer-progress，
  // 两者路径不相交，谁先谁后不改变响应。
  if (await handleRepoCreate(ctx)) return true;
  if (await handleTransfer(ctx)) return true;
  return false;
}
