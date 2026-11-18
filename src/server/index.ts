/** HTTP 服务入口：组装路由、前置门禁与静态文件，然后启动监听。只监听 127.0.0.1（共享模式另配）。
 *
 *  拆分后的职责：
 *    - router.ts           API 分发（22 个端点域 + 版本管理扩展 API，顺序敏感）
 *    - http/security.ts    CSRF / 共享门禁（所有 API 统一前置）
 *    - http/static.ts      前端静态文件 + SPA fallback
 *    - boot.ts             监听、端口接管、旧实例识别
 *    - repo-setup/*        仓库获取（git 克隆 / svn 检出）的命令与清理
 *  本文件只保留"组装与启动"，导出名与签名保持不变（test/*.mjs 从 dist/server/index.js 导入 startServer）。 */
import http from 'node:http';
import { rememberRunDir } from './recent/history-store.js';
import { isAuthError } from './errors.js';
import { sendJson } from './http/response.js';
import { enforceApiAccess } from './http/security.js';
import { serveStatic } from './http/static.js';
import { dispatch } from './router.js';
import { listenServer, type ServerHandle } from './boot.js';

// 系统目录选择器（Electron dialog 注入；纯 node 为 null）：
// 宿主实现随 /api/pick-dir 端点迁至 routes/host.ts，此处 re-export 保持 server.js 导出语义
export { setPickDirHandler, setSaveFileHandler } from './routes/host.js';
// 应用自身在线升级：main 注入 electron-updater 处理器（纯 Node 不注入）
export { setAppUpdateHandlers } from './routes/app-update.js';
// 端口接管（回归脚本可直接用临时端口自测）：实现在 boot.ts
export { takeOverPort } from './boot.js';
export type { ServerHandle } from './boot.js';

export function startServer(): Promise<ServerHandle> {
  // WSL 包运行目录记入最近项目（条目按文件夹名显示，点击走目录浏览，不报「不是工作副本」）
  rememberRunDir();
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const p = url.pathname;

    try {
      // ---------- API 前置门禁（CSRF / 共享访问） ----------
      if (!enforceApiAccess(req, res, p)) return;

      // ---------- API 分发 ----------
      if (await dispatch({ req, res, url, p })) return;

      // ---------- 静态文件 ----------
      serveStatic(res, p);
    } catch (err) {
      const e = err as Error;
      // 500 必须留痕：响应体只回 message，服务端不记日志的话线上问题无从排查
      console.error(`[500] ${req.method} ${p} -> ${e.message}`, e.stack ?? '');
      const auth = isAuthError(e);
      sendJson(res, 500, { error: e.message, authError: auth });
    }
  });

  return listenServer(server);
}
