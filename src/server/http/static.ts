/** 前端静态文件服务 + SPA fallback（未知路径回 index.html）。 */
import fs from 'node:fs';
import path from 'node:path';
import type http from 'node:http';
import { sendJson } from './response.js';

/** 前端静态目录：开发 = 项目根/dist/client；打包 = asar 内 dist/client。
 *  编译产物在 dist/server/http/static.js，所以要**先回两级**再进 client（dirname 是 dist/server/http/） */
const WEB_DIR = path.resolve(import.meta.dirname ?? '.', '..', '..', 'client');

/** 静态资源 Content-Type（键带点 = path.extname 产物；仓库内文件的图片 MIME 见 routes/misc.ts 的 IMG_MIME） */
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

export function serveStatic(res: http.ServerResponse, p: string): void {
  // 未知 API 路径和 favicon 返回明确 404（不能落到 SPA fallback 返回 HTML）
  if (p.startsWith('/api/') || p === '/favicon.ico') {
    sendJson(res, 404, { error: 'not found' });
    return;
  }
  let filePath = p === '/' ? path.join(WEB_DIR, 'index.html') : path.join(WEB_DIR, p);
  if (!filePath.startsWith(WEB_DIR)) {
    sendJson(res, 403, { error: 'forbidden' });
    return;
  }
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(WEB_DIR, 'index.html');
  }
  if (!fs.existsSync(filePath)) {
    sendJson(res, 404, { error: 'not found' });
    return;
  }
  const ext = path.extname(filePath);
  const st = fs.statSync(filePath);
  res.writeHead(200, {
    'Content-Type': MIME[ext] ?? 'application/octet-stream',
    'Cache-Control': 'no-store',
    'Last-Modified': st.mtime.toUTCString(),
  });
  res.end(fs.readFileSync(filePath));
}
