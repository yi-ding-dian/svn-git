/** 本地打包（发布弹窗「本地打包」tab 的后端）：
 *  检测仓库里的打包脚本 → 后台执行 → NDJSON 实时日志 → 完成后对比构建前后的产物快照。
 *
 *  安全边界：执行路径只来自服务端的固定白名单（`build-script.ts`，不信任客户端传入的路径），
 *  且必须是仓库内普通文件。「打开任意项目 → 执行项目里的脚本」等价于用户自己运行它，
 *  但绝不能让请求方指定任意命令。 */
import fs from 'node:fs';
import path from 'node:path';
import { run } from '../../vcs/exec.js';
import {
  buildScriptCandidates,
  detectBuildScript,
  resolveBuildScript,
  type BuildScriptError,
  type BuildScriptHit,
} from '../build-script.js';
import { readReleaseArtifacts } from '../release-artifacts.js';
import { readBody, sendJson, vcsOf, type Ctx } from './util.js';
import { t } from '../../shared/i18n/index.js';

/** 产物候选目录（仓库相对）：本项目 deploy/release；my-Agent 用 build/dist-electron；
 *  其余常见 Electron/Python 输出目录。只查直接文件，不递归。 */
const ARTIFACT_DIRS = ['deploy/release', 'build/dist-electron', 'dist', 'out', 'release'];
const MAX_ARTIFACTS = 200;

function fmtMtime(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

interface SnapEntry {
  size: number;
  mtimeMs: number;
  ctimeMs: number;
}

interface Snapshot {
  /** key = 仓库相对路径（如 deploy/release/x.AppImage） */
  files: Map<string, SnapEntry>;
  /** 构建前存在且可读的候选目录 */
  readable: Set<string>;
  /** 构建前存在的候选目录（可能不可读） */
  existing: Set<string>;
}

/** 构建前的产物快照：**差集判断的主依据**。只看 mtime 时间窗会把开始前刚打的旧包误报成新产物，
 *  而旧包在快照里、构建没碰它 → size/mtime/ctime 都不变，正确排除。 */
function snapshotArtifacts(root: string): Snapshot {
  const snap: Snapshot = { files: new Map(), readable: new Set(), existing: new Set() };
  for (const dir of ARTIFACT_DIRS) {
    const absDir = path.join(root, dir);
    if (!fs.existsSync(absDir)) continue;
    snap.existing.add(dir);
    let names: string[];
    try {
      names = fs.readdirSync(absDir);
    } catch {
      continue; // 存在但不可读：构建后整目录跳过，避免误报
    }
    snap.readable.add(dir);
    for (const name of names) {
      const abs = path.join(absDir, name);
      try {
        const st = fs.statSync(abs);
        if (!st.isFile()) continue;
        snap.files.set(`${dir}/${name}`, { size: st.size, mtimeMs: st.mtimeMs, ctimeMs: st.ctimeMs });
      } catch {
        /* 竞态删除：跳过 */
      }
    }
  }
  return snap;
}

function diffArtifacts(
  root: string,
  before: Snapshot,
  after: Snapshot
): { items: { path: string; size: number; mtime: string }[]; truncated: boolean } {
  const items: { path: string; size: number; mtime: string; mtimeMs: number }[] = [];
  for (const [rel, cur] of after.files) {
    const dir = rel.slice(0, rel.lastIndexOf('/'));
    // 构建前目录存在但不可读：无法判断旧文件，整目录跳过
    if (before.existing.has(dir) && !before.readable.has(dir)) continue;
    const old = before.files.get(rel);
    const isNewDir = !before.existing.has(dir);
    // ctime 能捕获"内容被重写但 mtime 被工具保留"的情况（ctime 用户态无法回拨）
    const changed = isNewDir || !old || old.size !== cur.size || old.mtimeMs !== cur.mtimeMs || old.ctimeMs !== cur.ctimeMs;
    if (!changed) continue;
    items.push({ path: rel, size: cur.size, mtime: fmtMtime(cur.mtimeMs), mtimeMs: cur.mtimeMs });
  }
  items.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return {
    items: items.slice(0, MAX_ARTIFACTS).map(({ path: p, size, mtime }) => ({ path: p, size, mtime })),
    truncated: items.length > MAX_ARTIFACTS,
  };
}

/** 构建工具的中间文件：不是用户要的产物（electron-builder 的调试配置、latest 描述等） */
const BUILD_META_RE = [/^builder-.*\.ya?ml$/i, /^latest.*\.ya?ml$/i, /^build-info\.json$/i];

/** 产物过滤：项目声明了 deploy/release-artifacts.json 时按模板取（${version} 视作通配）；
 *  没有配置（或本次没有命中任何模板，如构建失败只出了中间文件）时，
 *  只过滤掉明显的构建元数据，其余照常显示便于排查。 */
function filterArtifacts(
  root: string,
  items: { path: string; size: number; mtime: string }[]
): { path: string; size: number; mtime: string }[] {
  const tpl = readReleaseArtifacts(root).items;
  if (tpl.length > 0) {
    const res = tpl.map((t) => {
      const escaped = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\$\{version\}/g, '.*');
      return new RegExp(`^${escaped}$`);
    });
    const hit = items.filter((a) => {
      const name = a.path.slice(a.path.lastIndexOf('/') + 1);
      return res.some((re) => re.test(name));
    });
    if (hit.length > 0) return hit;
  }
  return items.filter((a) => {
    const name = a.path.slice(a.path.lastIndexOf('/') + 1);
    return !BUILD_META_RE.some((re) => re.test(name));
  });
}

/** 用户指定脚本校验失败的文案 */
function scriptErrorText(e: BuildScriptError): string {
  if (e === 'outside') return t('srv.localBuildScriptOutside');
  if (e === 'extension') return t('srv.localBuildScriptExtension');
  return t('srv.localBuildScriptMissing');
}

type LocalBuildEvent =
  | { type: 'start'; script: string; startedAt: number }
  | { type: 'log'; stream: 'stdout' | 'stderr'; line: string }
  | {
      type: 'done';
      ok: boolean;
      code: number;
      durationMs: number;
      timedOut?: boolean;
      aborted?: boolean;
      truncated?: boolean;
      artifacts: { path: string; size: number; mtime: string }[];
      artifactsTruncated?: boolean;
    }
  | { type: 'error'; message: string };

/** 正在打包的仓库（同一仓库同时只允许一个任务，避免两条命令抢同一批产物） */
const running = new Map<string, AbortController>();

/** 单条构建最多转发多少行日志（超出后仍继续执行，只是不再发 log 事件） */
const MAX_LOG_LINES = 20_000;
/** 单行上限：防止异常输出把一条 NDJSON 撑得过大 */
const MAX_LOG_LINE_BYTES = 16 * 1024;

/** 打包超时：默认 1 小时；环境变量仅供测试（api-test 用短超时验证 timedOut） */
function buildTimeoutMs(): number {
  const n = Number(process.env.SVNGIT_LOCAL_BUILD_TIMEOUT_MS);
  return Number.isFinite(n) && n > 0 ? n : 60 * 60_000;
}

export async function handle(ctx: Ctx): Promise<boolean> {
  const { req, res, url, p } = ctx;

  if (p === '/api/local-build/detect' && req.method === 'GET') {
    const { repo } = vcsOf();
    // 应用内文件浏览弹窗的起始目录：deploy 存在就进 deploy，否则项目根
    const deployDir = path.join(repo.root, 'deploy');
    let startDir = repo.root;
    try {
      if (fs.statSync(deployDir).isDirectory()) startDir = deployDir;
    } catch {
      /* 没有 deploy：用项目根 */
    }
    // script 可选：用户手动选择的脚本（绝对路径或仓库相对路径）
    const raw = url.searchParams.get('script')?.trim() || '';
    const hit = raw ? resolveBuildScript(repo.root, raw) : detectBuildScript(repo.root);
    if (typeof hit === 'string') {
      // 注意：响应体不能带 error 字段——前端 api() 约定「有 error 即抛异常」，
      // 那会把「用户选错文件」变成请求失败，面板状态被清空。
      sendJson(res, 200, {
        found: false,
        reason: scriptErrorText(hit),
        searched: buildScriptCandidates().map((c) => c.rel),
        startDir,
        root: repo.root,
      });
      return true;
    }
    if (!hit) {
      sendJson(res, 200, { found: false, searched: buildScriptCandidates().map((c) => c.rel), startDir, root: repo.root });
      return true;
    }
    sendJson(res, 200, {
      found: true,
      script: hit.rel,
      kind: hit.kind,
      mtime: fmtMtime(hit.mtime),
      startDir,
      root: repo.root,
    });
    return true;
  }

  if (p === '/api/local-build/run' && req.method === 'POST') {
    const { repo } = vcsOf();
    // script 可选：用户手动指定；服务端仍做完整校验（仓库内 / 普通文件 / 平台扩展名）
    const body = await readBody(req).catch(() => ({}) as Record<string, unknown>);
    const raw = typeof body.script === 'string' ? body.script.trim() : '';
    const hit = raw ? resolveBuildScript(repo.root, raw) : detectBuildScript(repo.root);
    if (typeof hit === 'string') {
      sendJson(res, 400, { error: scriptErrorText(hit) });
      return true;
    }
    const found: BuildScriptHit | null = hit;
    if (!found) {
      // 未找到打包脚本
      sendJson(res, 404, { error: t('srv.localBuildNotFound') });
      return true;
    }
    if (running.has(repo.root)) {
      // 已有打包任务在运行
      sendJson(res, 409, { error: t('srv.localBuildRunning') });
      return true;
    }

    const ac = new AbortController();
    running.set(repo.root, ac);
    res.writeHead(200, {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    const gone = () => res.writableEnded || res.destroyed;
    const send = (ev: LocalBuildEvent) => {
      if (gone()) return;
      try {
        res.write(JSON.stringify(ev) + '\n');
      } catch {
        /* 连接已断 */
      }
    };
    // 请求断开（用户关弹窗/取消）→ 杀掉子进程组
    const onClose = () => {
      if (!res.writableEnded) ac.abort();
    };
    res.on('close', onClose);

    const startedAt = Date.now();
    const before = snapshotArtifacts(repo.root);
    send({ type: 'start', script: found.rel, startedAt });
    let logLines = 0;
    let truncated = false;
    const onLine = (stream: 'stdout' | 'stderr') => (line: string) => {
      if (logLines >= MAX_LOG_LINES) {
        truncated = true;
        return;
      }
      logLines++;
      const cut = Buffer.byteLength(line, 'utf8') > MAX_LOG_LINE_BYTES ? `${line.slice(0, MAX_LOG_LINE_BYTES)}…` : line;
      send({ type: 'log', stream, line: cut });
    };

    try {
      const base = {
        cwd: repo.root,
        timeoutMs: buildTimeoutMs(),
        signal: ac.signal,
        decode: 'auto' as const,
        // 构建工具默认会给日志加 ANSI 颜色；前端按纯文本渲染，关掉更干净
        env: { FORCE_COLOR: '0', NO_COLOR: '1' },
        onStdoutLine: onLine('stdout'),
        onStderrLine: onLine('stderr'),
      };
      const r =
        found.kind === 'sh'
          ? await run('bash', [found.abs], base)
          : await run('cmd.exe', ['/c', found.abs], base);
      const after = snapshotArtifacts(repo.root);
      const diff = diffArtifacts(repo.root, before, after);
      const items = filterArtifacts(repo.root, diff.items);
      const artifactsTruncated = diff.truncated;
      send({
        type: 'done',
        ok: r.code === 0 && !r.timedOut && !r.aborted,
        code: r.code,
        durationMs: Date.now() - startedAt,
        ...(r.timedOut ? { timedOut: true } : {}),
        ...(r.aborted ? { aborted: true } : {}),
        ...(truncated ? { truncated: true } : {}),
        ...(artifactsTruncated ? { artifactsTruncated: true } : {}),
        artifacts: items,
      });
    } catch (e) {
      send({ type: 'error', message: (e as Error).message });
    } finally {
      running.delete(repo.root);
      res.off('close', onClose);
      if (!gone()) {
        try {
          res.end();
        } catch {
          /* 已断开 */
        }
      }
    }
    return true;
  }

  return false;
}
