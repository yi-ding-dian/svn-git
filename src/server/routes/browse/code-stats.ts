/** 项目代码统计端点（GET /api/code-stats）：对**选中的目录**递归统计文本文件行数，
 *  返回「目录树 + 每目录小计 + 总行数」，供「⋯ → 项目代码统计」弹窗与 md 导出使用。
 *
 *  设计取舍：
 *   - **复用行数过滤那套读取器**（line-scan.ts 的 countFileLines / 进程级行数缓存 /
 *     候选文件收集口径），保证同一个文件在「行数过滤」和「代码统计」里显示的行数完全一致，
 *     且先扫过一次之后同大小同 mtime 的文件直接命中缓存；
 *   - 流式 NDJSON 推进度（大仓库首次统计要几秒，界面不能看起来卡死）+ 客户端断开即中止读取；
 *   - **勾选单位是目录**（与「选择性检出」「常用文件夹」一致）：多个目录按前缀去重，
 *     祖先已选时子目录不再重复扫；
 *   - codeOnly=1 只统计代码扩展名白名单内的文件；否则统计全部文本文件（二进制/空/超大仍跳过）。
 *
 *  行数口径与行数过滤完全一致：按字节数 `\n`、无尾换行 +1；首个 64KB 块含 NUL 判二进制跳过；
 *  >32MB 跳过；不跟随软链。
 */
import fs from 'node:fs';
import path from 'node:path';
import { compareName } from '../../../shared/types.js';
import type { RepoInfo } from '../../../vcs/index.js';
import { t } from '../../../shared/i18n/index.js';
import { MSG_OUT_OF_SCOPE, resolveRepoPath, sendJson, vcsOf, type Ctx } from '../util.js';
import { MAX_FILE_BYTES, cacheGet, cacheSet, collectCandidates, countFileLines } from './line-scan.js';

/** 并发读：与行数过滤保持一致 */
const CONCURRENCY = 16;
/** 单次统计时间上限：超时返回已统计部分（客户端可取消，这里只兜底） */
const MAX_SCAN_MS = 120_000;
/** 进度推送间隔 */
const PROGRESS_INTERVAL_MS = 250;

/** 「仅代码文件」的扩展名白名单（codeOnly=1 时生效）。
 *  故意用白名单而非「非二进制即代码」：日志/构建产物/txt 也算文本，统计进去会把数字撑得没意义。 */
const CODE_EXTS = new Set([
  'ts', 'tsx', 'mts', 'cts', 'js', 'jsx', 'mjs', 'cjs', 'vue', 'svelte',
  'css', 'scss', 'sass', 'less', 'styl',
  'html', 'htm', 'xml', 'svg', 'json', 'jsonc', 'yml', 'yaml', 'toml', 'ini', 'conf', 'properties',
  'md', 'markdown', 'txt',
  'sh', 'bash', 'zsh', 'ps1', 'bat', 'cmd', 'py', 'java', 'kt', 'kts', 'scala', 'groovy',
  'c', 'h', 'cc', 'cpp', 'cxx', 'hpp', 'hh', 'cs', 'm', 'mm', 'go', 'rs', 'rb', 'php',
  'swift', 'lua', 'pl', 'r', 'dart', 'sql', 'gradle', 'cmake', 'mk', 'dockerfile',
]);

interface Candidate {
  abs: string;
  rel: string;
}

interface MatchedFile {
  rel: string;
  lines: number;
  size: number;
}

interface StatNode {
  name: string;
  path: string;
  isDir: boolean;
  /** 目录 = 子树内文件行数合计；文件 = 自身行数 */
  lines: number;
  /** 目录 = 子树内文件数；文件 = 1 */
  files: number;
  children: StatNode[];
}

/** 单个目录前缀的文件判定（'' = 仓库全部） */
function underDir(rel: string, dir: string): boolean {
  return dir === '' || rel === dir || rel.startsWith(dir + '/');
}

function extOf(rel: string): string {
  const name = rel.split('/').pop() ?? '';
  const i = name.lastIndexOf('.');
  return i <= 0 ? '' : name.slice(i + 1).toLowerCase();
}

/** 收集候选文件：git 只跑一次 ls-files 再按前缀过滤；svn / 回退遍历按目录各走一次 */
async function collectForDirs(
  repo: RepoInfo,
  dirs: string[],
  codeOnly: boolean,
  signal: AbortSignal,
): Promise<{ files: Candidate[]; capped: boolean }> {
  const picked: Candidate[] = [];
  let capped = false;
  const accept = (rel: string) => (codeOnly ? CODE_EXTS.has(extOf(rel)) : true);

  if (repo.type === 'git') {
    // git：一次 ls-files 拿到全部候选（天然排除忽略产物），再按选中目录前缀过滤
    const all = await collectCandidates(repo, repo.root, '', signal);
    capped = all.capped;
    const seen = new Set<string>();
    for (const f of all.files) {
      if (capped || signal.aborted) break;
      if (!dirs.some((d) => underDir(f.rel, d))) continue;
      if (!accept(f.rel)) continue;
      if (seen.has(f.rel)) continue;
      seen.add(f.rel);
      picked.push(f);
    }
    return { files: picked, capped };
  }

  for (const dir of dirs) {
    if (capped || signal.aborted) break;
    const abs = dir ? path.join(repo.root, dir) : repo.root;
    const got = await collectCandidates(repo, abs, dir, signal);
    if (got.capped) capped = true;
    for (const f of got.files) if (accept(f.rel)) picked.push(f);
  }
  return { files: picked, capped };
}

/** 命中文件 → 目录树：目录节点的 lines/files 是子树合计（自底向上累加） */
function buildTree(files: MatchedFile[]): StatNode[] {
  const root: StatNode[] = [];
  const map = new Map<string, StatNode>();
  const ensureDir = (rel: string): StatNode => {
    const hit = map.get(rel);
    if (hit) return hit;
    const node: StatNode = { name: rel.split('/').pop() || rel, path: rel, isDir: true, lines: 0, files: 0, children: [] };
    map.set(rel, node);
    const i = rel.lastIndexOf('/');
    if (i < 0) root.push(node);
    else ensureDir(rel.slice(0, i)).children.push(node);
    return node;
  };
  for (const f of files) {
    if (map.has(f.rel)) continue;
    const i = f.rel.lastIndexOf('/');
    const arr = i < 0 ? root : ensureDir(f.rel.slice(0, i)).children;
    const node: StatNode = {
      name: f.rel.split('/').pop() || f.rel,
      path: f.rel,
      isDir: false,
      lines: f.lines,
      files: 1,
      children: [],
    };
    map.set(f.rel, node);
    arr.push(node);
  }
  // 自底向上累加：目录合计 = 子目录合计 + 直属文件
  const sum = (node: StatNode): void => {
    if (!node.isDir) return;
    let lines = 0;
    let count = 0;
    for (const c of node.children) {
      sum(c);
      lines += c.lines;
      count += c.files;
    }
    node.lines = lines;
    node.files = count;
  };
  for (const n of root) sum(n);
  // 排序：目录在前（按子树行数降序，体量大的先看到），文件按行数降序
  const sortNodes = (nodes: StatNode[]): void => {
    for (const n of nodes) if (n.isDir) sortNodes(n.children);
    nodes.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return b.lines - a.lines || compareName(a.name, b.name);
    });
  };
  sortNodes(root);
  return root;
}

export async function handle(ctx: Ctx): Promise<boolean> {
  const { res, url } = ctx;
  if (url.pathname !== '/api/code-stats') return false;
  const { repo } = vcsOf();
  const codeOnly = url.searchParams.get('codeOnly') === '1';
  /** whole=1：整个项目（含仓库根目录下的文件）——**必须显式传**。
   *  历史坑：原先「一个目录都没选」会静默退化成整个仓库，用户点「全不选」后
   *  仍然统计了全部文件（实报 bug）；现在空目录列表一律 400，整个项目要走这支参数。 */
  const whole = url.searchParams.get('whole') === '1';

  // 选中的目录（仓库相对路径）：允许重复/逗号分隔
  const rawDirs = url.searchParams
    .getAll('dirs')
    .flatMap((v) => v.split(','))
    .map((v) => v.replace(/\\/g, '/').replace(/^\/+|\/+$/g, ''))
    .filter((v) => v.length > 0 && v !== '.');
  const dirs: string[] = [];
  if (!whole) {
    for (const dir of rawDirs) {
      if (dir.split('/').some((seg) => seg === '..')) {
        sendJson(res, 403, { error: MSG_OUT_OF_SCOPE() });
        return true;
      }
      const abs = resolveRepoPath(repo, dir);
      if (!abs) {
        sendJson(res, 403, { error: MSG_OUT_OF_SCOPE() });
        return true;
      }
      try {
        if (!(await fs.promises.stat(abs)).isDirectory()) {
          sendJson(res, 404, { error: t('srv.dirNotFound', { path: dir }) });
          return true;
        }
      } catch {
        sendJson(res, 404, { error: t('srv.dirNotFound', { path: dir }) });
        return true;
      }
      if (!dirs.includes(dir)) dirs.push(dir);
    }
    if (dirs.length === 0) {
      // 没指定统计范围：明确拒绝，别静默统计整个仓库
      sendJson(res, 400, { error: t('srv.noStatsDirs') });
      return true;
    }
  }
  // 祖先已选时子目录不再重复扫（勾选树允许"祖先覆盖 + 局部取消"，这里按前缀收敛）
  dirs.sort((a, b) => a.length - b.length || compareName(a, b));
  const scoped: string[] = [];
  for (const dir of dirs) if (!scoped.some((s) => underDir(dir, s))) scoped.push(dir);
  // '' = 仓库根（整个项目）
  if (whole) scoped.push('');

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
      const collected = await collectForDirs(repo, scoped, codeOnly, abort.signal);
      if (closed || abort.signal.aborted) return; // 客户端已断开：不必再起定时器
      const files = collected.files;
      write({ total: files.length, scanned: 0, dirs: scoped });
      progressTimer = setInterval(() => write({ scanned, total: files.length }), PROGRESS_INTERVAL_MS);

      const matched: MatchedFile[] = [];
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
          matched.push({ rel: f.rel, lines, size: st.size });
          scanned++;
        }
      };
      await Promise.all(Array.from({ length: CONCURRENCY }, worker));
      if (closed || abort.signal.aborted) return;

      const tree = buildTree(matched);
      let totalLines = 0;
      for (const m of matched) totalLines += m.lines;
      finish({
        done: true,
        tree,
        lines: totalLines,
        files: matched.length,
        dirs: scoped,
        scanned,
        total: files.length,
        skippedEmpty,
        skippedBinary,
        skippedLarge,
        skippedError,
        capped: collected.capped,
        truncated: timedOut ? 'time' : undefined,
        elapsedMs: Date.now() - startedAt,
      });
    } catch (e) {
      finish({ error: (e as Error).message });
    }
  })();

  return true;
}
