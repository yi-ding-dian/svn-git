/** 仓库上下文与状态：当前仓库检测、Vcs 实例单例、状态缓存、写操作统一收口。
 *
 *  **单例唯一性**：vcsInstances / statusCache / currentScopes 都只在本模块存在一份，
 *  所有调用方必须从本模块导入，否则 preflight/remote/status 缓存会分裂成多份。
 */
import { detectRepo } from '../vcs/detect.js';
import { createVcs, type RepoInfo, type VcsResult } from '../vcs/index.js';
import { loadConfig } from '../config.js';
import type { SvnCred } from '../vcs/svn.js';
import type { Ctx } from './http/response.js';
import { sendJson } from './http/response.js';
import { MSG_UNSUPPORTED_OP, authErrorOf } from './errors.js';
import { t } from '../shared/i18n/index.js';

/** 启动目录（Electron 传入） */
export const  START_DIR = process.env.SVNGIT_DIR ?? process.cwd();

export function  repoInfo(): RepoInfo | null {
  const dir = process.env.SVNGIT_REPO_DIR ?? START_DIR;
  const first = detectRepo(dir);
  if (first) return first;
  // 瞬时失败（WSL 路径映射/挂载抖动/切项目竞态）：再检测一次；
  // 仍失败则留一行日志（带上当前项目路径），方便用户反馈时定位是哪条路径/什么环境
  const retry = detectRepo(dir);
  if (!retry) console.warn(t('srv.noRepoDetect', { dir }));
  return retry;
}

/** 按仓库复用 Vcs 实例。preflight / remote 缓存是**实例字段**（svn.ts preflightCache、
 *  git.ts remoteCache）；原先每个请求 new 一个实例，缓存永远不命中——每次刷新/2 分钟轮询
 *  都真跑 `git fetch` / `svn status -u`。按 root+type 缓存，凭据变化时重建。 */
const vcsInstances = new Map<string, { credKey: string; vcs: ReturnType<typeof createVcs> }>();

export function  vcsOf(): { vcs: ReturnType<typeof createVcs>; repo: RepoInfo } {
  const repo = repoInfo();
  if (!repo) throw new Error('NO_REPO');
  const cfg = loadConfig();
  const cred: SvnCred | null = cfg.svn.username
    ? { username: cfg.svn.username, password: cfg.svn.password, trustServerCert: cfg.svn.trustServerCert }
    : null;
  const key = `${repo.type}::${repo.root}`;
  const credKey = cred ? `${cred.username}\u0000${cred.password}\u0000${cred.trustServerCert ? 1 : 0}` : '';
  const hit = vcsInstances.get(key);
  if (hit && hit.credKey === credKey) return { vcs: hit.vcs, repo };
  const vcs = createVcs(repo, cred);
  vcsInstances.set(key, { credKey, vcs });
  return { vcs, repo };
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
  const result = (await op()) ?? { ok: false, message: MSG_UNSUPPORTED_OP() };
  invalidateStatusCache(vcsOf().repo.root);
  sendJson(ctx.res, 200, { ...result, authError: authErrorOf(result) });
  return true;
}

export async function getStatusCached(repo: RepoInfo, force = false, rel?: string): Promise<unknown[]> {
  const scope = currentScopes.get(repo.root) ?? '';
  const { vcs } = vcsOf();
  // 已降级的大仓库：按「当前浏览目录」查（svn status -N 只列直接子项，毫秒级）。
  // 小仓库不这么做——原来返回整个操作范围的状态，/api/fs 要用它判断"祖先是否未版本化"，
  // 缩小到单目录会丢掉祖先信息。
  const huge = vcs.isHugeWc?.() ?? false;
  const dirRel = huge ? rel : undefined;
  const key = `${repo.root}::${scope}::${dirRel ?? ''}`;
  const hit = statusCache.get(key);
  if (!force && hit && Date.now() - hit.time < STATUS_TTL) return hit.items;
  const items = await vcs.status(dirRel !== undefined ? dirRel || undefined : scope || undefined);
  statusCache.set(key, { time: Date.now(), items });
  return items;
}

/** 本次服务进程的标识：模块加载时生成一次，**进程重启即变**（见 /api/info）。
 *  前端拿它判断"服务是不是重启过了" —— 终端的历史是**会话级**的（用户要求"重启服务历史消失、
 *  不要一直堆积"），重启后旧记录作废。 */
export const INSTANCE_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
