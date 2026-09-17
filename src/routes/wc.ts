/** 工作副本诊断端点：树冲突时去服务器核对「这个路径还在不在」。
 *
 *  场景：工作副本里某个目录本地是「已添加」，而服务器上同路径已被删除/移动 —— 这是树冲突。
 *  svn status 在状态列上只用一个 C 表示，用户很容易看漏（实报：界面标着 A，点进去却是空的），
 *  更看不出"到底谁对"。这里替用户去服务器问一句，直接给出结论与来源。
 *
 *  单独一个模块：诊断逻辑（拼 URL + 批量 svn info @HEAD）与文件浏览无关，
 *  且只在检测到冲突时才被调用，塞进已经上千行的 misc.ts 只会更难维护。
 */
import path from 'node:path';
import { XMLParser } from 'fast-xml-parser';
import { sendJson, vcsOf, inRepoRoot, MSG_OUT_OF_SCOPE } from './util.js';
import { run } from '../vcs/exec.js';
import type { Ctx } from './util.js';

/** svn status --xml 解析器（只取本模块要的字段，不引 vcs 层那份带业务映射的） */
const xml = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });

/** 从 status --xml 里挑出树冲突条目（含复制源，XML 的 <commit> 节点已带，无需另跑 svn log） */
function parseConflicts(stdout: string): WcConflictItem[] {
  const doc = xml.parse(stdout) as { status?: { target?: unknown } };
  const targets = doc?.status?.target ?? [];
  const list: WcConflictItem[] = [];
  for (const t of Array.isArray(targets) ? targets : [targets]) {
    const entries = (t as { entry?: unknown })?.entry;
    if (!entries) continue;
    for (const e of Array.isArray(entries) ? entries : [entries]) {
      const wc = (e as { 'wc-status'?: Record<string, unknown> })['wc-status'];
      if (String(wc?.['@_tree-conflicted'] ?? 'false') !== 'true') continue;
      const commit = wc?.commit as Record<string, unknown> | undefined;
      list.push({
        path: String((e as { '@_path'?: string })['@_path'] ?? ''),
        serverMissing: false, // 下面查服务器后再填
        fromRev: String(commit?.['@_revision'] ?? '') || undefined,
        fromAuthor: String(commit?.author ?? '') || undefined,
        fromDate: String(commit?.date ?? '').slice(0, 10) || undefined,
      });
    }
  }
  return list;
}

export interface WcConflictItem {
  /** 相对工作副本根的路径 */
  path: string;
  /** 服务器上该路径已不存在（被删或被移）——树冲突的根源 */
  serverMissing: boolean;
  /** 复制源（该目录是从哪个版本复制来的）；取不到则缺省 */
  fromRev?: string;
  fromAuthor?: string;
  fromDate?: string;
}

export async function handle(ctx: Ctx): Promise<boolean> {
  const { req, res, url, p } = ctx;
  if (p !== '/api/wc-conflicts' || req.method !== 'GET') return false;

  const { vcs, repo } = vcsOf();
  if (repo.type !== 'svn') {
    sendJson(res, 200, { conflicts: [] });
    return true;
  }
  const rel = url.searchParams.get('dir') ?? '';
  const abs = path.join(repo.root, rel);
  if (!inRepoRoot(repo.root, abs)) {
    sendJson(res, 403, { error: MSG_OUT_OF_SCOPE });
    return true;
  }

  // 1) 找出该目录下的树冲突条目（没有就直接返回，不打扰服务器）。
  //    注意必须在**该目录内部**跑：从工作副本根跑 status 时，若根节点是 incomplete（上次操作被中断），
  //    SVN 不会递归下来，这里就会一无所获（实测：从 trunk 跑得 0 个，cd 进 src 跑得 15 个）。
  //    同理也不能走 getStatusCached——它另有缓存键与范围语义。
  const { run: runRaw } = await import('../vcs/exec.js');
  const st = await runRaw('svn', ['status', '--xml', '.'], { cwd: abs, timeoutMs: 120_000 });
  const hit = st.code === 0 ? parseConflicts(st.stdout) : [];
  if (hit.length === 0) {
    sendJson(res, 200, { conflicts: [] });
    return true;
  }

  // 2) 拼服务器 URL：svn info 给的是工作副本根的 URL，条目的 path 也相对根，直接拼
  let baseUrl = '';
  try {
    baseUrl = (await vcs.info?.())?.url ?? '';
  } catch {
    /* 取不到 URL 时下面整体按"未知"处理 */
  }

  const conflicts: WcConflictItem[] = [];
  if (!baseUrl) {
    // 拿不到 URL 就只能回报冲突本身（不猜服务器状态）
    for (const c of hit) conflicts.push({ ...c, serverMissing: false });
    sendJson(res, 200, { conflicts, unchecked: true });
    return true;
  }

  // 3) 一次 svn info 查全部：不存在的路径会以 W170000 警告走 stderr，从里面抠出 URL。
  //    注意 baseUrl 是**工作副本根**的 URL，而条目路径是相对**当前目录**（上面在 abs 里跑的 status），
  //    所以中间要补上 rel 这一段，否则会去查 trunk/xxx 而实际是 trunk/src/xxx（实测踩过，全判成"仍在"）
  const prefix = `${baseUrl.replace(/\/+$/, '')}${rel ? '/' + rel.replace(/^\/+|\/+$/g, '') : ''}`;
  // 键用**不带 @HEAD** 的形式：svn 在 W170000 警告里报的 URL 不含 peg 修正（实测：带 @HEAD 比对永远不中）
  const urlOf = (path: string) => `${prefix}/${path}`;
  const urls = hit.map((c) => `${urlOf(c.path)}@HEAD`);
  let missingUrls = new Set<string>();
  try {
    const r = await run('svn', ['info', ...urls], { cwd: repo.root, timeoutMs: 120_000 });
    missingUrls = new Set(
      // 注意引号：中文环境下 svn 输出的是全角引号 “ ”，按半角匹配会一条也抓不到（实测踩过）
      [...r.stderr.matchAll(/W170000:\s*URL\s*[“"]([^”"]+)[”"]/g)].map((m) => m[1] ?? ''),
    );
  } catch {
    /* 查询失败：按"未知"处理，不改 serverMissing */
  }

  for (let i = 0; i < hit.length; i++) {
    conflicts.push({ ...hit[i]!, serverMissing: missingUrls.has(urlOf(hit[i]!.path)) });
  }
  sendJson(res, 200, { conflicts });
  return true;
}
