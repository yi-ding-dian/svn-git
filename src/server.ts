/** HTTP 服务：REST API（复用 vcs 层）+ 静态文件。只监听 127.0.0.1 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { detectRepo } from './vcs/detect.js';
import { createAskPass, authTypeOf } from './vcs/git.js';
import { loadConfig } from './config.js';
import { run } from './vcs/exec.js';
import { isSafeOrigin, sendJson, readBody, isAuthError, type Ctx } from './routes/util.js';
import { handle as handleConflicts } from './routes/conflicts.js';
import { handle as handleBranch } from './routes/branch.js';
import { handle as handleOps } from './routes/ops.js';
import { handle as handleStage } from './routes/stage.js';
import { handle as handleBrowse } from './routes/browse.js';
import { handle as handleHost } from './routes/host.js';
import { handle as handleHistory } from './routes/history.js';
import { handle as handleRecent } from './routes/recent.js';
import { handle as handleConfig } from './routes/config.js';
import { handle as handleModuleIndex } from './routes/module-index.js';
import { handle as handleUpload } from './routes/upload.js';
import { handle as handleWc } from './routes/wc.js';
import { handle as handleTerminal } from './routes/terminal.js';

/** 前端静态目录：开发 = 项目根/dist/web；打包 = asar 内 dist/web */
const WEB_DIR = path.resolve(import.meta.dirname ?? '.', 'web');

export interface ServerHandle {
  port: number;
  url: string;
  close: () => Promise<void>;
}

/** 系统目录选择器（Electron dialog 注入；纯 node 为 null）：
 * 宿主实现随 /api/pick-dir 端点迁至 routes/misc.ts，此处 re-export 保持 server.js 导出语义（main.tsx 静态导入不受影响） */
export { setPickDirHandler } from './routes/host.js';

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
      // 端点域模块（冲突防护 / 分支标签 / 操作类 / 浏览 / 宿主环境 / 历史 / 最近项目 / 配置 / 上传 / 工作副本 / 终端），按序尝试分发
      {
        const ctx: Ctx = { req, res, url, p };
        if (await handleConflicts(ctx)) return;
        if (await handleBranch(ctx)) return;
        if (await handleOps(ctx)) return;
        if (await handleStage(ctx)) return;
        if (await handleBrowse(ctx)) return;
        if (await handleHost(ctx)) return;
        if (await handleHistory(ctx)) return;
        if (await handleRecent(ctx)) return;
        if (await handleConfig(ctx)) return;
        if (await handleModuleIndex(ctx)) return;
        if (await handleUpload(ctx)) return;
        if (await handleWc(ctx)) return;
        if (await handleTerminal(ctx)) return;
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
        // authError/authType：克隆因认证失败时带给前端，由它引导用户去设置里填 git 凭据
        let result: { ok: boolean; message: string; repoDir?: string; authError?: boolean; authType?: 'github' | 'server' | 'ssh' };
        if (type === 'git') {
          if (url) {
            // 克隆（私有仓库要认证）：先**裸试**一次 —— 公开仓库无需凭据，也避免把凭据白白送出去；
            // 认证失败且**存了凭据**时带 GIT_ASKPASS 重试（与 push 同一套机制）；仍失败则带上
            // authType 交给前端，引导用户去设置里填 git 凭据。
            //
            // **客户端断开要真的停**：用户关掉弹窗（或前端 30s 超时）会 abort 请求，
            // 这里把它接到子进程上 —— 否则 git 会在后台白跑到 10 分钟，还可能凭空建出目录。
            // ⚠ 必须听 **res** 的 close，不能听 req 的：请求体已被 readBody 读完，
            // req 的 'close' 在那时就已经触发过了（挂上去等于空放，实测克隆照样跑满）。
            // res 的 'close' 才是"这条连接没了"（客户端关弹窗/超时断开）。
            const ac = new AbortController();
            const onClose = () => ac.abort();
            res.on('close', onClose);
            /** 克隆上限：网络卡住时别让用户干等（前端同时有 30s 倒计时，两边一致） */
            const CLONE_TIMEOUT_MS = 30_000;
            const isAuthFail = (r: { stderr: string; stdout: string }): boolean =>
              /Authentication failed|could not read Username|terminal prompts disabled|Permission denied \(publickey\)|HTTP 401|HTTP 403|没有那个设备或地址/i.test(r.stderr + r.stdout);
            /** 克隆**开始前**目标是否已存在：
             *  决定失败后能不能清理 —— 只清"这次克隆刚建出来的"，**绝不动用户已有的目录**。
             *  （曾因为不判这个，把用户已有的整个目录连内容一起删了：重复获取同一位置时
             *    clone 报"目标已存在且非空"，那句 cleanup 就把人家目录端了。） */
            const targetExistedBefore = fs.existsSync(target);
            /** 清掉本次克隆失败残留的半截目录（不清的话重试会报"目标已存在且非空"，掩盖真正原因） */
            const cleanupTarget = () => {
              if (targetExistedBefore) return; // 原本就在的东西，一个字节都不许动
              try {
                fs.rmSync(target, { recursive: true, force: true });
              } catch {
                /* 清不掉就照原样继续，让 git 报它自己的错 */
              }
            };
            let r = await run('git', ['clone', url, target], { timeoutMs: CLONE_TIMEOUT_MS, signal: ac.signal });
            let authFail = isAuthFail(r);
            const gitCred = loadConfig().git;
            // 已 abort（用户关闭/超时）就不再重试；失败时先清半截目录再带凭据重试
            if (r.code !== 0 && !r.aborted && authFail && gitCred?.username && gitCred?.password) {
              cleanupTarget();
              const ask = createAskPass(gitCred);
              r = await run('git', ['clone', url, target], { timeoutMs: CLONE_TIMEOUT_MS, signal: ac.signal, env: { GIT_ASKPASS: ask.path } });
              ask.cleanup();
              authFail = isAuthFail(r);
            }
            res.off('close', onClose);
            // ⚠ aborted（客户端断开）与 timedOut（自己到 30s 上限）是两个字段，都要判 ——
            // 只判 aborted 的话，超时会被当成"克隆失败"、把 git 的半截 stderr（"正克隆到…"）当错误抛给用户
            if (r.aborted || r.timedOut) {
              cleanupTarget(); // 收拾可能留下的半截目录
              result = {
                ok: false,
                message: r.timedOut ? `获取超时（超过 ${CLONE_TIMEOUT_MS / 1000} 秒），已停止` : '已取消获取',
              };
            } else if (r.code === 0) {
              result = { ok: true, message: `已克隆到 ${target}`, repoDir: target };
            } else {
              cleanupTarget(); // 失败也别留半个仓库，否则下次重试会撞"目录已存在"
              result = { ok: false, message: r.stderr.trim() || '克隆失败', authError: authFail || undefined, authType: authFail ? authTypeOf(url) : undefined };
            }
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
