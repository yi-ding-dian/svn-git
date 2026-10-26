/** 行数过滤端点：按「行数 ≥ / > / < N」扫描指定目录（含子目录）下的文本文件。
 *
 *  与内容搜索共用同一套候选文件口径（git ls-files / 目录遍历、跳过隐藏与 node_modules），
 *  但读取目的不同：内容搜索命中就早停，这里必须把每个候选文件读完才能得出精确行数。
 *  因此：
 *   - 流式 NDJSON 推进度（大仓库首次扫描要几秒，不能让界面看起来卡死）；
 *   - 行数按「路径 + 大小 + mtime」缓存，改阈值/重复扫描直接命中缓存；
 *   - 客户端断开即停止所有在途读取（AbortSignal 销毁流）。
 *
 *  行数口径：按字节数 `\n`，无尾换行 +1；空文件 0 行（不参与筛选）；
 *  首个 64KB 块含 NUL → 二进制跳过；>32MB 跳过；不跟随软链（避免循环与越界读取）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { run } from '../../../vcs/exec.js';
import type { RepoInfo } from '../../../vcs/index.js';
import { compareName, type LineOperator } from '../../../shared/types.js';
import { t } from '../../../shared/i18n/index.js';
import {
  getStatusCached,
  resolveRepoPath,
  sendJson,
  vcsOf,
  MSG_OUT_OF_SCOPE,
  type Ctx,
} from '../util.js';

/** 单文件读取上限：超过不读（大日志/生成物行数没有「大代码文件」的排查价值） */
export const MAX_FILE_BYTES = 32 * 1024 * 1024;
/** 候选文件上限：防极端目录把内存拉爆（超出会标记 capped） */
const MAX_CANDIDATES = 100_000;
/** 返回给前端的匹配上限：超过只保留最相关的前 N 个（≥/> 取最大，< 取最小） */
const MAX_RESULTS = 2000;
/** 并发读：与内容搜索一致 */
const CONCURRENCY = 16;
/** 单次扫描时间上限：超时返回已扫描部分（客户端可取消，这里只兜底） */
const MAX_SCAN_MS = 120_000;
/** 进度推送间隔 */
const PROGRESS_INTERVAL_MS = 250;
/** 行数缓存条目上限：超出按插入顺序淘汰最老的 */
const MAX_CACHE_ENTRIES = 200_000;

interface LineCacheEntry {
  size: number;
  mtimeMs: number;
  lines: number;
}

/** 进程级行数缓存：同一文件在多次扫描/多档阈值间复用；大小或 mtime 变了就重读 */
const lineCountCache = new Map<string, LineCacheEntry>();

/** 修改时间格式化: "2026/8/23 11:17"（与 directory-list.ts 的行格式保持一致） */
function fmtMtime(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

interface Candidate {
  abs: string;
  rel: string;
}

interface MatchedFile {
  rel: string;
  lines: number;
  size: number;
  mtimeMs: number;
}

interface TreeNode {
  name: string;
  path: string;
  isDir: boolean;
  code: string;
  size?: number;
  mtime?: string;
  lines?: number;
  children: TreeNode[];
}

type CountResult =
  | { ok: true; lines: number }
  | { ok: false; reason: 'binary' | 'error' | 'aborted' };

/** 字节流数 `\n`：不 split 成字符串，避免大文件把内存/GC 拖垮。
 *  首个块检测 NUL 判二进制（UTF-16 文本也会被当二进制——项目里的源码不是这种编码）。
 *  **export**：项目代码统计（code-stats.ts）复用同一套计数口径，两处行数才不会打架。 */
export function countFileLines(abs: string, signal: AbortSignal): Promise<CountResult> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve({ ok: false, reason: 'aborted' });
      return;
    }
    const stream = fs.createReadStream(abs, { highWaterMark: 64 * 1024 });
    let newlines = 0;
    let lastByte = -1;
    let firstChunk = true;
    let settled = false;
    const finish = (result: CountResult) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      if (!stream.destroyed) stream.destroy();
      resolve(result);
    };
    const onAbort = () => finish({ ok: false, reason: 'aborted' });
    signal.addEventListener('abort', onAbort, { once: true });
    stream.on('data', (chunk: string | Buffer) => {
      const buf = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
      if (buf.length === 0) return;
      if (firstChunk) {
        firstChunk = false;
        if (buf.includes(0)) {
          finish({ ok: false, reason: 'binary' });
          return;
        }
      }
      for (let i = 0; i < buf.length; i++) {
        if (buf[i] === 0x0a) newlines++;
      }
      lastByte = buf[buf.length - 1]!;
    });
    stream.on('end', () => {
      // 无尾换行的最后一行也算一行；空文件在调用处已跳过
      const lines = newlines + (lastByte !== -1 && lastByte !== 0x0a ? 1 : 0);
      finish({ ok: true, lines });
    });
    stream.on('error', () => finish({ ok: false, reason: 'error' }));
  });
}

/** 候选文件收集：git 走 ls-files（天然排除忽略产物），svn / 失败回退遍历。
 *  软链一律跳过：不跟随才不会有环、也不会读到仓库外的内容。
 *  **export**：项目代码统计复用（同一套「哪些文件算候选」口径）。 */
export async function collectCandidates(
  repo: RepoInfo,
  startAbs: string,
  startRel: string,
  signal: AbortSignal,
): Promise<{ files: Candidate[]; capped: boolean }> {
  const files: Candidate[] = [];
  let capped = false;
  const dirPrefix = startRel ? startRel.replace(/\/+$/, '') + '/' : '';
  const skipRel = (rel: string) =>
    rel.split('/').some((seg) => seg === 'node_modules' || seg.startsWith('.'));

  if (repo.type === 'git') {
    try {
      const r = await run('git', ['ls-files', '-co', '--exclude-standard', '-z'], {
        cwd: repo.root,
        timeoutMs: 15_000,
        signal,
      });
      if (r.code === 0) {
        for (const rel of r.stdout.split('\0')) {
          if (!rel) continue;
          if (signal.aborted) return { files, capped };
          if (startRel && !rel.startsWith(dirPrefix)) continue;
          if (skipRel(rel)) continue;
          if (files.length >= MAX_CANDIDATES) {
            capped = true;
            break;
          }
          files.push({ abs: path.join(repo.root, rel), rel });
        }
        return { files, capped };
      }
    } catch {
      /* 回退遍历 */
    }
  }

  const walk = async (absDir: string, relDir: string, depth: number): Promise<void> => {
    if (capped || signal.aborted || depth > 12) return;
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(absDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (capped || signal.aborted) return;
      const name = e.name;
      if (name === '.svn' || name === '.git' || name === 'node_modules' || name.startsWith('.')) continue;
      // Dirent.isDirectory() 不跟随软链；这里直接跳过软链，避免读仓库外/成环
      if (e.isSymbolicLink()) continue;
      const abs = path.join(absDir, name);
      const rel = relDir ? `${relDir}/${name}` : name;
      if (e.isDirectory()) {
        await walk(abs, rel, depth + 1);
      } else if (e.isFile()) {
        if (files.length >= MAX_CANDIDATES) {
          capped = true;
          return;
        }
        files.push({ abs, rel });
      }
    }
  };
  await walk(startAbs, startRel, 0);
  return { files, capped };
}

/** 缓存读写：大小 + mtime 完全一致才算命中（mtime 精度到毫秒，编辑器保存后必然变化）。
 *  **export**：项目代码统计复用同一份进程级行数缓存（先统计过一次，再按条件统计几乎秒出）。 */
export function cacheGet(abs: string, st: fs.Stats): number | null {
  const hit = lineCountCache.get(abs);
  if (hit && hit.size === st.size && hit.mtimeMs === st.mtimeMs) return hit.lines;
  return null;
}

export function cacheSet(abs: string, st: fs.Stats, lines: number): void {
  if (lineCountCache.size >= MAX_CACHE_ENTRIES) {
    const oldest = lineCountCache.keys().next().value;
    if (oldest !== undefined) lineCountCache.delete(oldest);
  }
  lineCountCache.set(abs, { size: st.size, mtimeMs: st.mtimeMs, lines });
}

function matchesCondition(lines: number, op: LineOperator, value: number): boolean {
  if (op === 'gte') return lines >= value;
  if (op === 'gt') return lines > value;
  return lines < value;
}

/** 匹配文件 → 目录树（只含命中文件及其祖先目录），并按「最相关」排序：
 *  ≥/> 时目录按子树最大行数降序、文件按行数降序；< 时全部反向（最少行数优先）。 */
function buildTree(matches: MatchedFile[], op: LineOperator, codeMap: Map<string, string>): TreeNode[] {
  const descendants = op !== 'lt';
  const root: TreeNode[] = [];
  const map = new Map<string, TreeNode>();
  const ensureDir = (rel: string): TreeNode => {
    let node = map.get(rel);
    if (!node) {
      node = {
        name: rel.split('/').pop() || rel,
        path: rel,
        isDir: true,
        code: codeMap.get(rel) ?? '',
        children: [],
      };
      map.set(rel, node);
      const i = rel.lastIndexOf('/');
      if (i < 0) root.push(node);
      else ensureDir(rel.slice(0, i)).children.push(node);
    }
    return node;
  };
  for (const m of matches) {
    const i = m.rel.lastIndexOf('/');
    const parent = i < 0 ? null : ensureDir(m.rel.slice(0, i));
    const arr = parent ? parent.children : root;
    if (map.has(m.rel)) continue;
    const node: TreeNode = {
      name: m.rel.split('/').pop() || m.rel,
      path: m.rel,
      isDir: false,
      code: codeMap.get(m.rel) ?? '',
      size: m.size,
      mtime: fmtMtime(m.mtimeMs),
      lines: m.lines,
      children: [],
    };
    map.set(m.rel, node);
    arr.push(node);
  }

  // 目录的「子树极值」：排序用，单独放 Map，避免把内部字段写进响应
  const extreme = new Map<TreeNode, number>();
  const computeExtreme = (node: TreeNode): number => {
    if (!node.isDir) return node.lines ?? 0;
    let v = descendants ? -1 : Number.MAX_SAFE_INTEGER;
    for (const child of node.children) {
      const x = computeExtreme(child);
      v = descendants ? Math.max(v, x) : Math.min(v, x);
    }
    if (node.children.length === 0) v = 0;
    extreme.set(node, v);
    return v;
  };
  const sortNodes = (nodes: TreeNode[]): void => {
    for (const node of nodes) {
      if (!node.isDir) continue;
      computeExtreme(node);
      sortNodes(node.children);
    }
    nodes.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      if (a.isDir) {
        const av = extreme.get(a) ?? 0;
        const bv = extreme.get(b) ?? 0;
        return (descendants ? bv - av : av - bv) || compareName(a.name, b.name);
      }
      const al = a.lines ?? 0;
      const bl = b.lines ?? 0;
      return (descendants ? bl - al : al - bl) || compareName(a.name, b.name);
    });
  };
  sortNodes(root);
  return root;
}

export async function handle(ctx: Ctx): Promise<boolean> {
  const { res, url } = ctx;
  if (url.pathname !== '/api/line-scan') return false;

  const { repo } = vcsOf();
  const rawDir = url.searchParams.get('dir') ?? '';
  const startRel = rawDir.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  if (startRel.split('/').some((seg) => seg === '..')) {
    sendJson(res, 403, { error: MSG_OUT_OF_SCOPE() });
    return true;
  }
  const startAbs = resolveRepoPath(repo, startRel);
  if (!startAbs) {
    sendJson(res, 403, { error: MSG_OUT_OF_SCOPE() });
    return true;
  }
  try {
    if (!(await fs.promises.stat(startAbs)).isDirectory()) {
      sendJson(res, 404, { error: t('srv.dirNotFound', { path: startRel || '.' }) });
      return true;
    }
  } catch {
    sendJson(res, 404, { error: t('srv.dirNotFound', { path: startRel || '.' }) });
    return true;
  }

  const opParam = url.searchParams.get('op') ?? 'gte';
  const op: LineOperator | null = opParam === 'gte' || opParam === 'gt' || opParam === 'lt' ? opParam : null;
  const value = Number(url.searchParams.get('value'));
  if (!op || !Number.isSafeInteger(value) || value < 1) {
    sendJson(res, 400, { error: t('srv.badLineCondition') });
    return true;
  }

  res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store' });
  let closed = false;
  const abort = new AbortController();
  let progressTimer: ReturnType<typeof setInterval> | null = null;
  const onClose = () => {
    closed = true;
    abort.abort();
    if (progressTimer) clearInterval(progressTimer);
  };
  res.on('close', onClose);
  const write = (data: unknown) => {
    if (!closed && !res.writableEnded) res.write(JSON.stringify(data) + '\n');
  };

  void (async () => {
    const startedAt = Date.now();
    const deadline = startedAt + MAX_SCAN_MS;
    let scanned = 0;
    let skippedEmpty = 0;
    let skippedBinary = 0;
    let skippedLarge = 0;
    let skippedError = 0;
    let timedOut = false;

    const finish = (data: unknown) => {
      if (progressTimer) clearInterval(progressTimer);
      res.off('close', onClose);
      if (!closed && !res.writableEnded) res.end(JSON.stringify(data) + '\n');
    };

    try {
      const collected = await collectCandidates(repo, startAbs, startRel, abort.signal);
      if (closed || abort.signal.aborted) return; // 收集阶段客户端已断开：不必再查状态/起定时器
      const files = collected.files;
      write({ total: files.length, scanned: 0 });
      progressTimer = setInterval(() => write({ scanned, total: files.length }), PROGRESS_INTERVAL_MS);

      // 状态码只为行内徽标服务；取不到不影响行数统计
      const codeMap = new Map<string, string>();
      try {
        const items = (await getStatusCached(repo, false)) as { path: string; code: string; isDir: boolean }[];
        for (const item of items) if (item.path) codeMap.set(item.path, item.code);
      } catch {
        /* 状态缓存不可用时仍返回行数结果，只是不显示修改徽标 */
      }

      const matches: MatchedFile[] = [];
      let next = 0;
      const worker = async (): Promise<void> => {
        for (;;) {
          if (closed || abort.signal.aborted) return;
          if (Date.now() > deadline) {
            timedOut = true;
            return;
          }
          const i = next++;
          if (i >= files.length) return;
          const f = files[i]!;
          let st: fs.Stats;
          try {
            st = await fs.promises.lstat(f.abs);
          } catch {
            skippedError++;
            scanned++;
            continue;
          }
          if (!st.isFile()) {
            scanned++;
            continue;
          }
          if (st.size === 0) {
            skippedEmpty++;
            scanned++;
            continue;
          }
          if (st.size > MAX_FILE_BYTES) {
            skippedLarge++;
            scanned++;
            continue;
          }
          let lines = cacheGet(f.abs, st);
          if (lines === null) {
            const counted = await countFileLines(f.abs, abort.signal);
            if (!counted.ok) {
              if (counted.reason === 'aborted') return;
              if (counted.reason === 'binary') skippedBinary++;
              else skippedError++;
              scanned++;
              continue;
            }
            lines = counted.lines;
            cacheSet(f.abs, st, lines);
          }
          if (matchesCondition(lines, op, value)) {
            matches.push({ rel: f.rel, lines, size: st.size, mtimeMs: st.mtimeMs });
          }
          scanned++;
        }
      };
      await Promise.all(Array.from({ length: CONCURRENCY }, worker));
      if (closed || abort.signal.aborted) return;

      const descendants = op !== 'lt';
      matches.sort((a, b) =>
        descendants ? b.lines - a.lines || compareName(a.rel, b.rel) : a.lines - b.lines || compareName(a.rel, b.rel),
      );
      const totalMatched = matches.length;
      const shown = matches.slice(0, MAX_RESULTS);
      const tree = buildTree(shown, op, codeMap);
      finish({
        done: true,
        tree,
        matched: totalMatched,
        shown: shown.length,
        scanned,
        total: files.length,
        skippedEmpty,
        skippedBinary,
        skippedLarge,
        skippedError,
        capped: collected.capped,
        truncated: timedOut ? 'time' : totalMatched > MAX_RESULTS ? 'limit' : undefined,
        elapsedMs: Date.now() - startedAt,
      });
    } catch (e) {
      finish({ error: (e as Error).message });
    }
  })();

  return true;
}
