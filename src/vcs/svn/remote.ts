/** 远程 SVN（URL 直连、无工作副本模式）：命令执行、--xml 解析与只读业务。
 *
 *  角色对齐 Tortoise Repo-Browser：`list -v` / `cat` 等只读命令，URL 直连——凭据复用
 *  loadConfig 的 svn 配置。安全：协议白名单 + 命令白名单（只有 list/cat）+ cat 大小上限；
 *  绝不做写操作。HTTP 路由层只做参数校验与响应封装，具体命令与解析都在这里。 */
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { XMLParser } from 'fast-xml-parser';
import { run, runStream, type RunResult } from '../exec.js';
import { resolveSvnBin } from '../svn.js';
import { loadConfig } from '../../config.js';
import { t } from '../../shared/i18n/index.js';

const xml = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });

/** 允许浏览的 URL 协议（只读场景） */
export const URL_OK = /^(svn|https?|file):\/\//i;

/** 配置里的凭据参数（顺序与原实现一致：--username / --password-from-stdin / --non-interactive / --trust-server-cert） */
function configCredArgs(cfg: ReturnType<typeof loadConfig>): string[] {
  const args: string[] = [];
  if (cfg.svn.username) args.push('--username', cfg.svn.username, '--password-from-stdin', '--non-interactive');
  if (cfg.svn.trustServerCert) args.push('--trust-server-cert');
  return args;
}

/** 跑一条只读 svn 命令（URL 直连、无工作副本模式；cwd 用 tmp——这些命令不依赖工作目录） */
export async function svnRun(
  args: string[],
  opt: { timeoutMs?: number; raw?: boolean; maxBuffer?: number } = {},
): Promise<RunResult> {
  const cfg = loadConfig();
  const full = configCredArgs(cfg);
  full.push(...args);
  return run(await resolveSvnBin(), full, {
    cwd: os.tmpdir(),
    stdinData: cfg.svn.username ? cfg.svn.password + '\n' : undefined,
    timeoutMs: opt.timeoutMs ?? 20_000,
    raw: opt.raw,
    maxBuffer: opt.maxBuffer,
  });
}

/** 远程目录条目（svn list -v） */
export interface RepoEntry {
  name: string;
  isDir: boolean;
  size?: number;
  rev?: string;
  author?: string;
  date?: string;
}

/** svn list -v --xml 解析（嵌套容错：单元素时 fast-xml-parser 不返回数组） */
function parseList(stdout: string): RepoEntry[] {
  const doc = xml.parse(stdout);
  const lists = doc?.lists?.list ?? [];
  const out: RepoEntry[] = [];
  for (const l of Array.isArray(lists) ? lists : [lists]) {
    const entries = l?.entry ?? [];
    for (const e of Array.isArray(entries) ? entries : [entries]) {
      const name = String(e?.name ?? '');
      if (!name) continue;
      const commit = e?.commit ?? {};
      out.push({
        name,
        isDir: String(e?.['@_kind'] ?? 'file') === 'dir',
        size: e?.size !== undefined ? Number(e.size) : undefined,
        rev: commit?.['@_revision'] !== undefined ? String(commit['@_revision']) : undefined,
        author: commit?.author !== undefined ? String(commit.author) : undefined,
        date: commit?.date !== undefined ? String(commit.date) : undefined,
      });
    }
  }
  return out;
}

/** 内容级二进制探测：前 8KB 出现 NUL 字节，或非文本控制字符占比过高（>30%）。
 *  兜住"扩展名不在 BINARY_EXTS 表里"的二进制（如 .emmx / 无扩展名）——光看扩展名会漏。
 *  UTF-8 / GBK 的中文多字节都 ≥0x80，不会落进控制字符区间，不误判（只扫前 8KB，微秒级） */
export function looksBinary(buf: Buffer): boolean {
  const n = Math.min(buf.length, 8192);
  let odd = 0;
  for (let i = 0; i < n; i++) {
    const b = buf[i]!;
    if (b === 0) return true; // NUL 一票否决（文本文件不会有）
    if (b < 9 || (b > 13 && b < 32)) odd++; // 允许 \t \n \r；其余控制字符计入
  }
  return n > 0 && odd / n > 0.3;
}

/** 远程目录列表（带修订/作者/时间）。调用方负责 URL 校验与异常兜底。 */
export async function listRemote(
  target: string,
): Promise<{ ok: true; entries: RepoEntry[] } | { ok: false; error: string }> {
  // 注意：--xml 模式本身即详细输出（带 commit/size），不能再加 -v（svn 报"verbose 选项无效"）
  const r = await svnRun(['list', '--xml', target]);
  if (r.code !== 0) return { ok: false, error: r.stderr.trim() || 'svn list failed' };
  // 目录在前、按名序（中文名用 localeCompare；svn 的天然顺序不保证"目录在前"）
  const entries = parseList(r.stdout);
  entries.sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.name.localeCompare(b.name));
  return { ok: true, entries };
}

/** 从工作副本路径取「仓库根 URL」+「工作副本在仓库中的相对路径」（--xml 一条拿全；本地元数据不联网）。
 *  rel 供仓库浏览器的「定位到该项目」用（逐级展开树的路径）。 */
export async function rootInfoRemote(
  wcPath: string,
): Promise<{ ok: true; root: string; rel: string } | { ok: false; error: string }> {
  const bin = await resolveSvnBin();
  const r = await run(bin, ['info', '--xml', wcPath], { cwd: os.tmpdir(), timeoutMs: 15_000 });
  if (r.code !== 0) return { ok: false, error: r.stderr.trim() || 'svn info failed' };
  const doc = xml.parse(r.stdout);
  const entry = doc?.info?.entry ?? {};
  const repoRoot = String(entry?.repository?.root ?? '').trim();
  const relUrl = String(entry?.['relative-url'] ?? '').trim(); // 形如 ^/projects/CWBS-SCA/tags/SCA_HB
  const rel = relUrl.replace(/^\^\//, '');
  if (!repoRoot) return { ok: false, error: 'repos-root-url not found' };
  return { ok: true, root: repoRoot, rel };
}

/** svn cat 原始字节（预览/保存/下载共用）。调用方负责大小/二进制策略。 */
export async function catRemote(
  target: string,
  opt: { timeoutMs?: number; maxBuffer?: number } = {},
): Promise<{ ok: true; buf: Buffer } | { ok: false; error: string }> {
  const r = await svnRun(['cat', target], { raw: true, timeoutMs: opt.timeoutMs, maxBuffer: opt.maxBuffer });
  if (r.code !== 0) return { ok: false, error: r.stderr.trim() || 'svn cat failed' };
  return { ok: true, buf: r.stdoutBuf ?? Buffer.from(r.stdout ?? '', 'utf8') };
}

/** 远程文件保存到本地目录（「下载到…」）：目标已存在则拒绝（V1 不做覆盖询问）。 */
export async function saveRemoteFile(
  target: string,
  dir: string,
): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
  const r = await svnRun(['cat', target], { raw: true, timeoutMs: 120_000 });
  if (r.code !== 0) return { ok: false, error: r.stderr.trim() || 'svn cat failed' };
  const buf = r.stdoutBuf ?? Buffer.from(r.stdout ?? '', 'utf8');
  const name = decodeURIComponent(target.split('/').filter(Boolean).pop() ?? 'file');
  const dest = path.join(dir, name);
  if (fs.existsSync(dest)) return { ok: false, error: t('srv.repoSaveExists', { path: dest }) };
  fs.writeFileSync(dest, buf);
  return { ok: true, path: dest };
}

// ============ 远程递归搜索 ============

/** 单次最多返回的匹配数——也是"匹配够数就早停杀进程"的阈值 */
const SEARCH_LIMIT = 200;
/** 流式搜索时长上限：超时也返回已收集的匹配（结果带 truncated:'time'） */
const SEARCH_TIMEOUT_MS = 20_000;
/** 全量缓存：单目录最多缓存的行数（超过不缓存——下次重新流式搜） */
const CACHE_MAX_LINES = 50_000;
/** 缓存目录数上限（超出淘汰最早放入的） */
const CACHE_DIRS = 8;
/** 缓存有效期（仓库内容可能在别处变化，过期重拉） */
const CACHE_TTL_MS = 10 * 60_000;

/** 递归搜索缓存：目录 URL → svn ls -R 的全量行。只在流**完整跑完**时写入
 *  （早停/超时的那次不完整，不缓存）。命中缓存后同目录搜索是内存过滤，毫秒级。 */
const searchCache = new Map<string, { lines: string[]; at: number }>();

function searchCacheGet(key: string): string[] | null {
  const e = searchCache.get(key);
  if (!e) return null;
  if (Date.now() - e.at > CACHE_TTL_MS) {
    searchCache.delete(key);
    return null;
  }
  return e.lines;
}

function searchCachePut(key: string, lines: string[]): void {
  if (searchCache.size >= CACHE_DIRS) {
    // Map 迭代序 = 插入序：删最早放入的那个
    const oldest = searchCache.keys().next().value;
    if (oldest !== undefined) searchCache.delete(oldest);
  }
  searchCache.set(key, { lines, at: Date.now() });
}

export interface RemoteSearchItem {
  path: string;
  isDir: boolean;
}

export type RemoteSearchResult =
  | { aborted: true }
  | { ok: true; items: RemoteSearchItem[]; truncated?: 'limit' | 'time' }
  | { ok: false; error: string };

/** 远程递归搜索：svn ls -R 流式逐行过滤——匹配够 SEARCH_LIMIT 条**立即杀进程早停**
 *  （大目录不必遍历完，常见词一两秒就有）；单次最多 SEARCH_TIMEOUT_MS，超时返回已收集的。
 *  完整跑完的目录全量缓存：之后同目录搜索是内存过滤，毫秒级（truncated:'limit' 仅是显示截断）。 */
export async function searchRemote(target: string, q: string, signal: AbortSignal): Promise<RemoteSearchResult> {
  const ql = q.toLowerCase();
  /** 行 → 条目（svn ls -R：目录行尾带 /） */
  const toItem = (line: string): RemoteSearchItem =>
    line.endsWith('/') ? { path: line.slice(0, -1), isDir: true } : { path: line, isDir: false };
  /** 缓存命中路径：内存过滤；超上限截断（more = 还有更多匹配没显示） */
  const pick = (lines: string[]): { items: RemoteSearchItem[]; more: boolean } => {
    const items: RemoteSearchItem[] = [];
    for (const l of lines) {
      if (!l.toLowerCase().includes(ql)) continue;
      if (items.length >= SEARCH_LIMIT) return { items, more: true };
      items.push(toItem(l));
    }
    return { items, more: false };
  };
  const cached = searchCacheGet(target);
  if (cached) {
    const { items, more } = pick(cached);
    return more ? { ok: true, items, truncated: 'limit' } : { ok: true, items };
  }
  // 未缓存：流式拉取（凭据同 svnRun；非 --xml 的纯文本模式输出"相对路径行"，可逐行过滤）
  const cfg = loadConfig();
  const args = configCredArgs(cfg);
  args.push('list', '-R', target);
  const items: RemoteSearchItem[] = [];
  const lines: string[] = [];
  /** 行数超缓存上限：不再收集（缓存放弃），流继续跑（匹配与超时规则不变） */
  let overflowed = false;
  /** 早停（匹配满上限杀的进程）：结果不完整，不缓存 */
  let early = false;
  let r: RunResult;
  try {
    r = await runStream(await resolveSvnBin(), args, {
      cwd: os.tmpdir(),
      stdinData: cfg.svn.username ? cfg.svn.password + '\n' : undefined,
      timeoutMs: SEARCH_TIMEOUT_MS,
      signal,
      onLine: (line) => {
        if (!line) return;
        if (!overflowed) {
          if (lines.length >= CACHE_MAX_LINES) {
            overflowed = true;
            lines.length = 0; // 大目录不缓存：尽早把内存还掉
          } else {
            lines.push(line);
          }
        }
        if (line.toLowerCase().includes(ql)) items.push(toItem(line));
        if (items.length >= SEARCH_LIMIT) {
          early = true;
          return true; // 够数：不等它跑完
        }
      },
    });
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
  if (r.aborted) return { aborted: true }; // 前端已断开：响应没处发（svn 已被杀掉）
  if (r.timedOut) return { ok: true, items, truncated: 'time' };
  if (!early && r.code !== 0) return { ok: false, error: r.stderr.trim() || 'svn list failed' };
  if (early) return { ok: true, items, truncated: 'limit' };
  // 完整跑完：缓存全量（超上限的不缓存——下次重新流式搜）
  if (!overflowed) searchCachePut(target, lines);
  return { ok: true, items };
}

// ============ 检出大小检测 ============

/** 检出大小检测缓存：url|include → 累计结果。只在**完整扫完**（无 partial）时写入。
 *  大仓库全扫一次 36~70s，重复点「检测大小」（如勾选前后对比）命中缓存秒出；TTL 同搜索缓存。 */
const SIZE_CACHE_MAX = 32;
const sizeCache = new Map<string, { files: number; dirs: number; bytes: number; at: number }>();

function sizeCacheGet(key: string): { files: number; dirs: number; bytes: number } | null {
  const e = sizeCache.get(key);
  if (!e) return null;
  if (Date.now() - e.at > CACHE_TTL_MS) {
    sizeCache.delete(key);
    return null;
  }
  return { files: e.files, dirs: e.dirs, bytes: e.bytes };
}

function sizeCachePut(key: string, v: { files: number; dirs: number; bytes: number }): void {
  if (sizeCache.size >= SIZE_CACHE_MAX) {
    const oldest = sizeCache.keys().next().value;
    if (oldest !== undefined) sizeCache.delete(oldest);
  }
  sizeCache.set(key, { ...v, at: Date.now() });
}

export interface RemoteSizeProgress {
  files: number;
  dirs: number;
  bytes: number;
}

export type RemoteSizeResult =
  | { aborted: true }
  | { error: string }
  | { done: { files: number; dirs: number; bytes: number; partial: boolean } };

export interface RemoteSizeScan {
  /** 命中缓存：调用方直接返回 {done:true,cached:true,...cached}，不要起进度定时器 */
  cached?: { files: number; dirs: number; bytes: number };
  /** 累计进度（进行中就地被扫描逻辑更新；调用方按 400ms 轮询输出） */
  total: RemoteSizeProgress;
  result: Promise<RemoteSizeResult>;
}

/** 检出大小检测（检出弹窗「检测大小」按钮按需触发）：流式扫描，边扫边把累计写进 `total`。
 *  范围：include（多级相对路径数组）非空 = 只算勾选子树 + 根文件；空 = 整个 URL 全树。
 *  大仓库单进程遍历慢（实测 4 万文件 ~70s）：按一级目录 8 路并行（实测 → 36s；瓶颈是最大
 *  子树自身的遍历耗时，再往深拆收益低）。任一路失败记 partial 不中断。断开（取消/关弹窗）→
 *  signal 杀全部子进程。完整扫完的结果缓存（TTL 同搜索缓存）。 */
export function startRemoteSizeScan(target: string, include: string[], signal: AbortSignal): RemoteSizeScan {
  const cacheKey = `${target}|${[...include].sort().join(',')}`;
  const cached = sizeCacheGet(cacheKey);
  /** 累计（onLine 回调在主线程同步累加，无竞态）；dirs 从 1 起 = 根目录自身 */
  const total: RemoteSizeProgress = { files: 0, dirs: 1, bytes: 0 };
  if (cached) {
    return { cached, total, result: Promise.resolve({ done: { ...cached, partial: false } }) };
  }
  let partial = false;
  const result = (async (): Promise<RemoteSizeResult> => {
    try {
      const bin = await resolveSvnBin();
      const cfg = loadConfig();
      const net: string[] = ['--non-interactive'];
      if (cfg.svn.username) net.push('--username', cfg.svn.username, '--password-from-stdin');
      if (cfg.svn.trustServerCert) net.push('--trust-server-cert');
      const baseOpts = {
        cwd: os.tmpdir(),
        stdinData: cfg.svn.username ? cfg.svn.password + '\n' : undefined,
        signal,
        timeoutMs: 15 * 60_000,
      };
      /** 递归输出行 → 累计（每个文件一行 <size>，每个目录一行 kind="dir"） */
      const count = (line: string) => {
        const sz = /^<size>(\d+)<\/size>$/.exec(line.trim());
        if (sz) {
          total.files += 1;
          total.bytes += Number(sz[1]);
        } else if (line.includes('kind="dir"')) {
          total.dirs += 1;
        }
      };
      // 1) 根级一次 list（非递归、快）：根文件入账；整仓模式的并行任务 = 一级目录（勾选模式不用它）
      const topDirs: string[] = [];
      let lastKind = '';
      await runStream(bin, [...net, 'list', '--xml', target], {
        ...baseOpts,
        timeoutMs: 60_000,
        onLine: (line) => {
          if (line.includes('kind="dir"')) lastKind = 'dir';
          else if (line.includes('kind="file"')) lastKind = 'file';
          else if (/^<size>(\d+)<\/size>$/.test(line.trim())) count(line);
          else if (lastKind === 'dir') {
            const nm = /<name>([\s\S]*?)<\/name>/.exec(line);
            if (nm && include.length === 0) {
              total.dirs += 1;
              topDirs.push(nm[1]!);
            }
          }
        },
      });
      // 2) 并行扫（8 路）：整仓 = 一级目录；勾选 = 勾选路径本身（并补勾选顶级的目录计数）
      if (include.length > 0) total.dirs += new Set(include.map((inc) => inc.split('/')[0])).size;
      const tasks = include.length > 0 ? include.map((inc) => `${target}/${inc}`) : topDirs.map((d) => `${target}/${d}`);
      let next = 0;
      const worker = async () => {
        for (;;) {
          if (signal.aborted) return;
          const i = next++;
          if (i >= tasks.length) return;
          const rr = await runStream(bin, [...net, 'list', '--xml', '-R', tasks[i]!], { ...baseOpts, onLine: count });
          if (rr.aborted) return;
          if (rr.code !== 0) partial = true;
        }
      };
      await Promise.all(Array.from({ length: Math.min(8, Math.max(1, tasks.length)) }, worker));
      if (signal.aborted) return { aborted: true };
      if (!partial) sizeCachePut(cacheKey, { files: total.files, dirs: total.dirs, bytes: total.bytes });
      return { done: { files: total.files, dirs: total.dirs, bytes: total.bytes, partial } };
    } catch (e) {
      return { error: (e as Error).message };
    }
  })();
  return { total, result };
}
