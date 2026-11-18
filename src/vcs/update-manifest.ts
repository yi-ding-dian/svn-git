/** 拉取前的「更新清单」预扫描：算出这次 pull 会涉及哪些文件、各有多大。
 *
 *  ⚠ 为什么需要单独算：git 的传输协议（upload-pack）在下载过程中**不报文件名、不报总大小、
 *  也没有单文件进度**——它只给 `Receiving objects: 45% (159/352), 1.2 MiB | 25 KiB/s`。
 *  所以任务面板分两层：
 *   - 传输进度：直接用 git 的数字（对象数、字节、速度），见 transfer-progress.ts；
 *   - 文件清单与大小：下载前用「远端树 vs 本地树」比对出来（本文件）。
 *
 *  远端树只有 GitHub 能一次拿全（tree API 返回 path/sha/size；本仓库约 141 KB）。
 *  其它远端拿不到大小与清单，静默跳过——预扫描是锦上添花，绝不能影响 pull 本身：
 *  所有失败一律返回 null，调用方只显示传输进度。
 *
 *  ⚠ 口径：清单里的 size 是**远端文件未压缩大小**，不等于传输字节（pack 是压缩的，
 *  文本压缩率高、PNG/GIF 几乎不压缩）；单文件"下载中/已完成"状态也拿不到，不做假标记。 */
import { GITHUB_UA } from '../shared/github.js';
import type { UpdateManifest, UpdateManifestFile } from '../transfer-progress.js';

export interface RemoteTreeEntry {
  path: string;
  sha: string;
  type: string;
  /** blob 大小；子模块（type=commit）为 0 */
  size: number;
}

/** tree API 超时：慢网下 141 KB 约 6 秒，给足余量；拉取结束/取消时外层 signal 也会中止 */
const TREE_TIMEOUT_MS = 20_000;
/** 远端树条目上限：超大仓库（十万文件）的清单既没人看也撑爆轮询响应，直接放弃 */
const MAX_TREE_ENTRIES = 20_000;
/** 清单最多带 500 条：详情弹窗每秒轮询一次，响应不能太大；计数与总大小仍按全量算 */
export const MANIFEST_MAX_FILES = 500;

const GITHUB_API = 'https://api.github.com';

/** 拉 GitHub 仓库某提交的完整树（一次请求拿 path/sha/size）。失败/被截断/超限 → null。 */
export async function fetchGithubTree(
  owner: string,
  repo: string,
  sha: string,
  token: string,
  signal: AbortSignal,
): Promise<RemoteTreeEntry[] | null> {
  // 外层 signal（拉取结束/取消）与本地超时合并：任一触发都中止请求
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TREE_TIMEOUT_MS);
  const onAbort = () => ctl.abort();
  if (signal.aborted) ctl.abort();
  else signal.addEventListener('abort', onAbort, { once: true });
  try {
    const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/git/trees/${sha}?recursive=1`, {
      signal: ctl.signal,
      headers: {
        'User-Agent': GITHUB_UA,
        Accept: 'application/vnd.github+json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      tree?: { path?: unknown; sha?: unknown; type?: unknown; size?: unknown }[];
      truncated?: boolean;
    };
    // truncated：GitHub 对超大树的截断（这种情况下清单不完整，宁可不显示）
    if (data.truncated) return null;
    const tree = data.tree ?? [];
    if (tree.length > MAX_TREE_ENTRIES) return null;
    return tree
      .filter((e) => e.type === 'blob' || e.type === 'commit')
      .map((e) => ({
        path: String(e.path ?? ''),
        sha: String(e.sha ?? ''),
        type: String(e.type ?? 'blob'),
        size: Number(e.size ?? 0) || 0,
      }));
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', onAbort);
  }
}

/** `git ls-tree -r -l -z HEAD` 输出 → path → { sha, size }。
 *  格式（-z）：`<mode> <type> <sha> <size>\t<path>\0`；-z 下路径原样（不做八进制转义），
 *  中文/空格/制表符都安全；子模块的 size 列是 `-`，按 0 处理。 */
export function parseLsTreeOutput(stdout: string): Map<string, { sha: string; size: number }> {
  const out = new Map<string, { sha: string; size: number }>();
  for (const rec of stdout.split('\0')) {
    if (!rec) continue;
    const tab = rec.indexOf('\t');
    if (tab < 0) continue;
    const meta = rec.slice(0, tab).trim().split(/\s+/);
    const filePath = rec.slice(tab + 1);
    if (meta.length < 4 || !filePath) continue;
    const size = Number(meta[3]);
    out.set(filePath, { sha: meta[2] ?? '', size: Number.isFinite(size) ? size : 0 });
  }
  return out;
}

/** 本地树（HEAD）与远端树比对 → 更新清单。没有差异返回 null。
 *  状态口径与 git 一致：A 远端新增 / M 内容（或类型）变了 / D 远端删除。 */
export function buildUpdateManifest(
  local: Map<string, { sha: string; size: number }>,
  remote: RemoteTreeEntry[],
): UpdateManifest | null {
  const remotePaths = new Set<string>();
  const all: UpdateManifestFile[] = [];
  let added = 0;
  let modified = 0;
  let deleted = 0;
  let totalBytes = 0;
  for (const e of remote) {
    remotePaths.add(e.path);
    const l = local.get(e.path);
    if (l && l.sha === e.sha) continue; // 未变化：不进清单，也不算大小
    if (l) {
      modified += 1;
    } else {
      added += 1;
    }
    totalBytes += e.size;
    all.push({ path: e.path, status: l ? 'M' : 'A', size: e.size });
  }
  for (const p of local.keys()) {
    if (!remotePaths.has(p)) {
      deleted += 1;
      all.push({ path: p, status: 'D', size: 0 });
    }
  }
  if (all.length === 0) return null;
  // 按大小降序（用户最关心的是那个 2.29 MB 的 GIF）；同大小按路径稳定排序
  all.sort((a, b) => b.size - a.size || a.path.localeCompare(b.path));
  return {
    files: all.slice(0, MANIFEST_MAX_FILES),
    counts: { A: added, M: modified, D: deleted },
    totalBytes,
    ...(all.length > MANIFEST_MAX_FILES ? { truncated: true } : {}),
  };
}
