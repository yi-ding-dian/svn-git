/** 服务层共享工具：路由模块与 server.ts 复用（路径校验/响应/状态缓存等，无外部框架依赖） */
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { detectRepo } from '../vcs/detect.js';
import { createVcs, type RepoInfo, type VcsResult } from '../vcs/index.js';
import { loadConfig } from '../config.js';
import { BINARY_EXTS } from '../shared/types.js';
import type { SvnCred } from '../vcs/svn.js';

/** 路由上下文：req/res 与解析后的 URL 按需传递 */
export interface Ctx {
  req: http.IncomingMessage;
  res: http.ServerResponse;
  url: URL;
  p: string;
}

/** VCS 写操作兜底文案：仓库类型/实现不支持该操作（routes 多文件共用，收敛于此） */
export const MSG_UNSUPPORTED_OP = '当前仓库不支持该操作';
/** 路径越界校验统一文案（防 ../ 穿越；routes 多文件共用，收敛于此） */
export const MSG_PATH_OUT_OF_BOUNDS = '路径越界';
/** 路径超出工作副本范围校验文案（403 域；与 MSG_PATH_OUT_OF_BOUNDS 同族不同字面，分别收敛保持响应文本不变） */
export const MSG_OUT_OF_SCOPE = '超出工作副本范围';

/** 二进制文件判断：常量来自 shared（单一来源），与前端 utils.isBinaryFile 一致 */
export function isBinaryFile(p: string): boolean {
  const name = p.split('/').pop() ?? '';
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : '';
  return BINARY_EXTS.has(ext);
}

/** 启动目录（Electron 传入） */
export const  START_DIR = process.env.SVNKIT_DIR ?? process.cwd();

export function  repoInfo(): RepoInfo | null {
  const dir = process.env.SVNKIT_REPO_DIR ?? START_DIR;
  return detectRepo(dir);
}

export function  vcsOf(): { vcs: ReturnType<typeof createVcs>; repo: RepoInfo } {
  const repo = repoInfo();
  if (!repo) throw new Error('NO_REPO');
  const cfg = loadConfig();
  const cred: SvnCred | null = cfg.svn.username
    ? { username: cfg.svn.username, password: cfg.svn.password, trustServerCert: cfg.svn.trustServerCert }
    : null;
  return { vcs: createVcs(repo, cred), repo };
}

/** 认证失败错误码 */
export function  isAuthError(err: Error): boolean {
  return /认证失败|E170001|Authentication failed/i.test(err.message);
}

/** 统一认证判定：结构化 code 优先（P1-5），正则仅兜底 throw 型异常与未迁移路径 */
export function authErrorOf(r: { code?: string; message: string }): boolean {
  return r.code === 'AUTH' || isAuthError(new Error(r.message));
}

/** 请求来源校验（CSRF 防护）:跨站页面请求一律拒绝。
 * 同源页面（Electron 窗口 / --browser 模式）/ 本地脚本（curl 等）不带 Origin 或 Origin 为 127.0.0.1;
 * 浏览器任意网页发起的跨站请求必带站点 Origin。 */
export function  isSafeOrigin(req: http.IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin) return true;
  // 127.0.0.1 / localhost / [::1] 均视为本机来源（用户手输 localhost 地址打开页面时同源请求也带 Origin）
  return /^https?:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/.test(origin);
}

export function  sendJson(res: http.ServerResponse, code: number, data: unknown) {
  const body = JSON.stringify(data);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

export function  readBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let data = '';
    let done = false; // 超限后终止接收,防止内存继续累积与 end 事件二次 settle
    req.on('data', (c: Buffer) => {
      if (done) return;
      data += c.toString();
      if (data.length > 10 * 1024 * 1024) {
        done = true;
        req.destroy(); // 客户端若持续发送,立即断开连接而非继续拼接
        reject(new Error('body too large'));
      }
    });
    req.on('end', () => {
      if (done) return;
      done = true;
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        resolve({});
      }
    });
    req.on('error', (e) => {
      if (!done) {
        done = true;
        reject(e);
      }
    });
  });
}

/** 工作副本状态缓存（5 秒） */
export const  statusCache = new Map<string, { time: number; items: unknown[] }>();

export const  STATUS_TTL = 30_000;

// 当前操作范围：大仓库中打开的子项目(相对仓库根路径)。状态扫描限定在该范围内,避免全仓库扫描卡顿
export const  currentScopes = new Map<string, string>();

/** 写操作成功后失效该仓库的状态缓存（add/commit/update/revert/delete 等会改变状态码,30s 缓存会显示旧状态） */
export function invalidateStatusCache(root: string): void {
  for (const key of statusCache.keys()) {
    if (key.startsWith(root + '::')) statusCache.delete(key);
  }
}

/** VCS 动作统一收口：兜底"不支持"文案 + 状态缓存失效 + authError 提取与发送（响应 JSON 形状与各端点原实现一致）。
 * op 执行：返回 undefined（实现缺失）→ 发送兜底"当前仓库不支持该操作"；
 * 成功与失败均失效状态缓存（写操作后状态集必然变化；失败时多一次重扫无害）；
 * op 抛异常不在此吞掉——与收口前一致，由 server 层 catch 统一转 500。 */
export async function runVcs(ctx: Ctx, op: () => VcsResult | undefined | Promise<VcsResult | undefined>): Promise<boolean> {
  const result = (await op()) ?? { ok: false, message: MSG_UNSUPPORTED_OP };
  invalidateStatusCache(vcsOf().repo.root);
  sendJson(ctx.res, 200, { ...result, authError: authErrorOf(result) });
  return true;
}

export async function getStatusCached(repo: RepoInfo, force = false): Promise<unknown[]> {
  const scope = currentScopes.get(repo.root) ?? '';
  const key = `${repo.root}::${scope}`;
  const hit = statusCache.get(key);
  if (!force && hit && Date.now() - hit.time < STATUS_TTL) return hit.items;
  const { vcs } = vcsOf();
  const items = await vcs.status(scope || undefined);
  statusCache.set(key, { time: Date.now(), items });
  return items;
}

/** realpath 安全解析：路径不存在（如待创建的 mkdir/rename 目标）时逐级向上解析最长存在前缀再拼接 */
export function  realpathSafe(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    const parent = path.dirname(p);
    if (parent === p) return p; // 逐级到根仍不存在的极端情况,原样返回
    return path.join(realpathSafe(parent), path.basename(p));
  }
}

/** 校验绝对路径是否位于仓库根内（防止 ../git-repo-2 这类前缀匹配绕过）。
 * 两侧均 realpath 解析：仓库内 symlink 指向仓库外时（repo/link -> /etc），
 * 字符串比较无法发现，必须与真实目标比较。 */
export function  inRepoRoot(root: string, abs: string): boolean {
  const realRoot = realpathSafe(root);
  const realAbs = realpathSafe(abs);
  const rel = path.relative(realRoot, realAbs);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/** 文本读取上限：超过则 statSync 预检后跳过全量读（防超大日志/数据文件 OOM 服务进程） */
export const  MAX_READ_BYTES = 5 * 1024 * 1024;

/** 读取文本文件：>MAX_READ_BYTES 时读前拦截,返回占位提示,不整读入内存 */
export function  readTextFile(abs: string): string {
  try {
    if (fs.statSync(abs).size > MAX_READ_BYTES) return '（文件过大，未读取全文）';
    return fs.readFileSync(abs, 'utf8');
  } catch {
    return '';
  }
}
