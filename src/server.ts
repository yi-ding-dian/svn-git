/** HTTP 服务：REST API（复用 vcs 层）+ 静态文件。只监听 127.0.0.1 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { detectRepo } from './vcs/detect.js';
import { run } from './vcs/exec.js';
import { isSafeOrigin, sendJson, readBody, isAuthError, type Ctx } from './routes/util.js';
import { handle as handleConflicts } from './routes/conflicts.js';
import { handle as handleBranch } from './routes/branch.js';
import { handle as handleOps } from './routes/ops.js';
import { handle as handleMisc } from './routes/misc.js';
import { handle as handleConfig } from './routes/config.js';

/** 前端静态目录：开发 = 项目根/dist/web；打包 = asar 内 dist/web */
const WEB_DIR = path.resolve(import.meta.dirname ?? '.', 'web');

export interface ServerHandle {
  port: number;
  url: string;
  close: () => Promise<void>;
}

/** 系统目录选择器（Electron dialog 注入；纯 node 为 null）：
 * 宿主实现随 /api/pick-dir 端点迁至 routes/misc.ts，此处 re-export 保持 server.js 导出语义（main.tsx 静态导入不受影响） */
export { setPickDirHandler } from './routes/misc.js';

/** 静态资源 Content-Type（键带点 = path.extname 产物；仓库内文件的图片 MIME 见 routes/misc.ts 的 IMG_MIME） */
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

export function startServer(): Promise<ServerHandle> {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const p = url.pathname;

    try {
      // ---------- API ----------
      // CSRF 防护:全 API 层拦截带非本机 Origin 的请求(任意网页无法触达含副作用端点,如 shutdown/open/env-install)
      if (p.startsWith('/api/') && !isSafeOrigin(req)) {
        sendJson(res, 403, { error: '拒绝跨站请求' });
        return;
      }
      // 端点域模块（冲突防护 / 分支标签 / 操作类 / 杂项 / 配置），按序尝试分发
      {
        const ctx: Ctx = { req, res, url, p };
        if (await handleConflicts(ctx)) return;
        if (await handleBranch(ctx)) return;
        if (await handleOps(ctx)) return;
        if (await handleMisc(ctx)) return;
        if (await handleConfig(ctx)) return;
      }

      // ---------- 版本管理扩展 API ----------
      if (p === '/api/repo-create/check' && req.method === 'POST') {
        // 创建/获取前的风险检测（供二次确认展示）：目标已存在/非空、目标位于仓库内（嵌套风险）
        const body = await readBody(req);
        const dir = String(body.dir ?? '').trim();
        const name = String(body.name ?? '').trim();
        if (!dir || !name) {
          sendJson(res, 400, { error: '缺少目录或名称' });
          return;
        }
        const target = path.join(dir, name);
        let exists = false;
        let existsNonEmpty = false;
        try {
          exists = fs.existsSync(target);
          if (exists) existsNonEmpty = fs.readdirSync(target).length > 0;
        } catch {
          /* 目标不可读时按不存在处理，不阻断 */
        }
        // 位于仓库/工作副本内（目标自身是已存在的仓库也算，向上查找命中）
        const inRepo = detectRepo(dir) ?? (exists ? detectRepo(target) : null);
        sendJson(res, 200, {
          target,
          exists,
          existsNonEmpty,
          inRepo: inRepo ? { type: inRepo.type, root: inRepo.root } : null,
        });
        return;
      }

      if (p === '/api/repo-create' && req.method === 'POST') {
        // 创建/克隆仓库（不依赖当前打开的仓库）
        const body = await readBody(req);
        const type = String(body.type ?? '');
        const dir = String(body.dir ?? '').trim();
        const url = String(body.url ?? '').trim();
        const name = String(body.name ?? '').trim();
        if (!dir) {
          sendJson(res, 400, { error: '请填写目录路径' });
          return;
        }
        const target = path.join(dir, name);
        let result: { ok: boolean; message: string; repoDir?: string };
        if (type === 'git') {
          if (url) {
            // 克隆
            const r = await run('git', ['clone', url, target], { timeoutMs: 600_000 });
            result = r.code === 0 ? { ok: true, message: `已克隆到 ${target}`, repoDir: target } : { ok: false, message: r.stderr.trim() || '克隆失败' };
          } else {
            // init
            fs.mkdirSync(target, { recursive: true });
            const r = await run('git', ['init', target], { timeoutMs: 60_000 });
            result = r.code === 0 ? { ok: true, message: `已初始化仓库 ${target}`, repoDir: target } : { ok: false, message: r.stderr.trim() || 'git init 失败' };
          }
        } else if (type === 'svn') {
          if (url) {
            // 从远程/本地检出工作副本（成员获取仓库；svn checkout 目标目录名即本地名称）
            const r = await run('svn', ['checkout', '-q', url, target], { timeoutMs: 600_000 });
            result = r.code === 0
              ? { ok: true, message: `已检出 SVN 工作副本 ${target}`, repoDir: target }
              : { ok: false, message: r.stderr.trim() || 'svn checkout 失败' };
          } else {
            // svnadmin create（本地仓库）+ 可选标准布局 + 工作副本
            fs.mkdirSync(target, { recursive: true });
            const r = await run('svnadmin', ['create', target], { timeoutMs: 120_000 });
            if (r.code !== 0) {
              result = { ok: false, message: r.stderr.trim() || 'svnadmin create 失败' };
            } else {
              let wcUrl = `file://${target}`;
              const standard = body.standard !== false;
              if (standard) {
                // 标准布局：创建 trunk/branches/tags（svn 分支机制依赖目录约定）
                const mk = await run(
                  'svn',
                  ['mkdir', '-q', `${wcUrl}/trunk`, `${wcUrl}/branches`, `${wcUrl}/tags`, '-m', '创建标准布局 trunk/branches/tags'],
                  { timeoutMs: 60_000 }
                );
                if (mk.code !== 0) {
                  sendJson(res, 200, { ok: false, message: `标准布局创建失败: ${mk.stderr.trim() || '未知'}`, authError: false });
                  return;
                }
                // 工作副本检出 trunk（根下只有布局目录，检出根会把 branches 全部拖进来）
                wcUrl += '/trunk';
              }
              const wcDir = target + '-wc';
              const c = await run('svn', ['checkout', '-q', wcUrl, wcDir], { timeoutMs: 120_000 });
              result = c.code === 0
                ? { ok: true, message: `已创建 SVN 仓库 ${target}${standard ? '（标准布局，工作副本检出 trunk）' : ''}（工作副本 ${wcDir}）`, repoDir: wcDir }
                : { ok: true, message: `已创建 SVN 仓库 ${target}${standard ? '（标准布局）' : ''}（工作副本检出失败: ${c.stderr.trim() || '未知'}）`, repoDir: wcDir };
            }
          }
        } else {
          sendJson(res, 400, { error: '未知仓库类型' });
          return;
        }
        sendJson(res, 200, { ...result, authError: false });
        return;
      }

      // ---------- 静态文件 ----------
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
    } catch (err) {
      const e = err as Error;
      const auth = isAuthError(e);
      sendJson(res, 500, { error: e.message, authError: auth });
    }
  });

  return new Promise((resolve) => {
    // 固定端口(可预期、便于收藏)，被占用时自动换随机端口
    const DEFAULT_PORT = 23456;
    server.once('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        console.warn(`端口 ${DEFAULT_PORT} 被占用，改用随机端口`);
        server.listen(0, '127.0.0.1', onListen);
      } else {
        throw err;
      }
    });
    const onListen = () => {
      const port = (server.address() as AddressInfo).port;
      resolve({
        port,
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise((r) => server.close(() => r())),
      });
    };
    server.listen(DEFAULT_PORT, '127.0.0.1', onListen);
  });
}
