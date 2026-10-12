/** 最近项目仪表盘：只读探测任意工作副本的摘要状态（**不切换当前仓库**）。
 *  git 用一条 `status --porcelain=v1 -b` 拿全（分支 / ahead / 改动 / 冲突）；
 *  svn 用 status + info 两条（都跑本地元数据、不联网——远端是否有更新不查，避免列表转半天）。
 *  供 server 的 /api/project-status 使用；probeProjectCached 带 30 秒缓存（侧边栏刷新会重复请求）。
 *  注意 decode：status 带路径输出必须按 utf8（exec.ts 头注释的口径），不要传 decode: 'auto'。 */
import fs from 'node:fs';
import { XMLParser } from 'fast-xml-parser';
import { detectRepo } from './detect.js';
import { run } from './exec.js';

export interface ProjectProbe {
  type: 'git' | 'svn';
  /** git=分支名（detached 显示 HEAD）；svn=工作副本位置（relative-url 去掉 ^/，如 trunk） */
  branch: string;
  /** 未推送提交数（git；无上游时 0）；svn 恒 0 */
  ahead: number;
  /** 待拉取提交数（git，**基于本地记录的远端引用**——上次 fetch/pull 之后别人的新推送；不联网）；
   *  svn 恒 0（远端更新要 `svn status -u` 联网，探测里不做） */
  behind: number;
  changed: number;
  untracked: number;
  conflict: number;
}

export type ProbeResult = ProjectProbe | { error: string };

const xml = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '' });

/** git porcelain 两字母冲突码 */
const CONFLICT = new Set(['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU']);

/** 探测一次（不吃缓存）：路径不存在 / 非工作副本 → { error } */
export async function probeProject(dir: string): Promise<ProbeResult> {
  // 先判"路径本身"存在（不能只靠 detectRepo：目录没了的深路径会向上找到不相干的父仓库）
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return { error: 'unavailable' };
  const repo = detectRepo(dir);
  if (!repo) return { error: 'unavailable' };
  return repo.type === 'git' ? probeGit(repo.root) : probeSvn(repo.root);
}

async function probeGit(root: string): Promise<ProbeResult> {
  // maxBuffer 兜底超大仓库的海量变更输出（超限命令失败 → 前端显示"不可用"，不至于拖垮服务）
  const res = await run('git', ['-c', 'core.quotepath=false', 'status', '--porcelain=v1', '-b'], {
    cwd: root,
    timeoutMs: 15_000,
    maxBuffer: 4 * 1024 * 1024,
  });
  if (res.code !== 0) return { error: res.stderr.trim() || 'unavailable' };
  let branch = '';
  let ahead = 0;
  let behind = 0;
  let changed = 0;
  let untracked = 0;
  let conflict = 0;
  for (const line of res.stdout.split('\n')) {
    if (!line) continue;
    if (line.startsWith('## ')) {
      // "## main...origin/main [ahead 2, behind 1]" / "## main" / "## HEAD (no branch)" / "## No commits yet on main"
      const head = line.slice(3);
      const m = head.match(/\[ahead (\d+)/);
      if (m) ahead = Number(m[1]);
      const mb = head.match(/behind (\d+)/);
      if (mb) behind = Number(mb[1]);
      if (/^HEAD \(no branch\)/.test(head)) branch = 'HEAD';
      else if (head.startsWith('No commits yet on ')) branch = head.slice('No commits yet on '.length);
      else branch = head.split('...')[0]!.split(' ')[0]!;
      continue;
    }
    const xy = line.slice(0, 2);
    if (xy === '??') untracked += 1;
    else if (CONFLICT.has(xy)) conflict += 1;
    else changed += 1;
  }
  return { type: 'git', branch, ahead, behind, changed, untracked, conflict };
}

async function probeSvn(root: string): Promise<ProbeResult> {
  const [st, info] = await Promise.all([
    run('svn', ['status', '--xml'], { cwd: root, timeoutMs: 20_000, maxBuffer: 4 * 1024 * 1024 }),
    run('svn', ['info', '--xml'], { cwd: root, timeoutMs: 20_000 }),
  ]);
  if (st.code !== 0) return { error: st.stderr.trim() || 'unavailable' };
  let changed = 0;
  let untracked = 0;
  let conflict = 0;
  try {
    const doc = xml.parse(st.stdout);
    const targets = doc?.status?.target ?? [];
    for (const tg of Array.isArray(targets) ? targets : [targets]) {
      const entries = tg?.entry ?? [];
      for (const e of Array.isArray(entries) ? entries : [entries]) {
        const item = String(e?.['wc-status']?.item ?? '');
        if (item === 'conflicted') conflict += 1;
        else if (item === 'unversioned') untracked += 1;
        // normal/none/ignored/external 不算改动
        else if (item && item !== 'normal' && item !== 'none' && item !== 'ignored' && item !== 'external') changed += 1;
      }
    }
  } catch {
    /* 解析失败按 0 计（状态行只少徽标，不阻塞） */
  }
  // 位置：relative-url（^/trunk → trunk；^/ → /）。info 失败（少见）则留空
  let branch = '';
  if (info.code === 0) {
    try {
      const d = xml.parse(info.stdout);
      const entry = d?.info?.entry ?? [];
      const first = Array.isArray(entry) ? entry[0] : entry;
      const rel = String(first?.['relative-url'] ?? '');
      if (rel) branch = rel.replace(/^\^\//, '') || '/';
    } catch {
      /* 忽略 */
    }
  }
  return { type: 'svn', branch, ahead: 0, behind: 0, changed, untracked, conflict };
}

/** 30 秒缓存：侧边栏每次刷新都会对同一批项目重复请求，缓存挡住重复的子进程开销 */
const cache = new Map<string, { at: number; data: ProbeResult }>();
export async function probeProjectCached(dir: string, ttlMs = 30_000): Promise<ProbeResult> {
  const hit = cache.get(dir);
  if (hit && Date.now() - hit.at < ttlMs) return hit.data;
  const data = await probeProject(dir);
  // 防无界增长：项目数实际就十几个，超 64 直接清空重建
  if (cache.size > 64) cache.clear();
  cache.set(dir, { at: Date.now(), data });
  return data;
}
