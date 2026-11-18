/** 远程摘要探测（最近项目 ⬇ 待拉取）：任意项目的 preflight 结果与 30s 级缓存。 */
import fs from 'node:fs';
import path from 'node:path';
import { detectRepo } from '../../vcs/detect.js';
import { createVcs, type RepoInfo } from '../../vcs/index.js';
import type { SvnCred } from '../../vcs/svn.js';
import { loadConfig } from '../../config.js';
import { realpathSafe } from '../path-safety.js';

/** 任意项目的远程检查（最近项目 ⬇ 待拉取）：detectRepo → 临时 VCS 实例 → preflight。
 *  preflight 自带超时（git fetch 15s / svn status -u 20s）与失败快速返回 — 不会卡请求；
 *  缓存：成功 60s / 失败 20s（打开侧边栏会成批请求，挡住重复联网）。 */
const remoteCheckCache = new Map<string, { at: number; ok: boolean; behind: number }>();

/** 缓存代次号（按目录）：invalidateRemoteProbe 时 +1。只清缓存挡不住**已经在跑**的探测——
 *  它算完会无条件写回，用更新前的 behind 把缓存重新撑满 60s（拉取期间正好有一次探测在跑，
 *  侧栏 ⬇ 就一直停在旧数字，用户实报）。探测开始时记代次，算完代次变了就不写缓存并重算一次。 */
const remoteCheckEpoch = new Map<string, number>();

/** 失效某项目的远程检查缓存（更新 / 切分支 / 合并成功后调用）。
 *  这些操作会让 remoteProbeAny 再算出的 behind 与缓存不一致；不清的话侧边栏 ⬇ 角标
 *  最多要等 60s 缓存过期才归零（用户实报"更新完仍显示 ⬇12"）。
 *  按 realpath 比对键值：历史里存的是打开时的目录，可能是仓库根的上级/子目录。 */
export function invalidateRemoteProbe(dir: string): void {
  const real = realpathSafe(dir);
  const bump = (key: string) => {
    remoteCheckCache.delete(key);
    remoteCheckEpoch.set(key, (remoteCheckEpoch.get(key) ?? 0) + 1);
  };
  bump(dir); // 目录本身也记一代：此刻可能还没有缓存条目、但已有探测在跑
  for (const key of remoteCheckCache.keys()) {
    if (realpathSafe(key) === real) bump(key);
  }
}

/** 取任意项目的远程检查结果：探测期间被更新失效过就重算一次（同 git.ts remoteCheck） */
export async function remoteProbeAny(dir: string): Promise<{ behind?: number; error?: string }> {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return { error: 'unavailable' };
  const repo = detectRepo(dir);
  if (!repo) return { error: 'unavailable' };
  let r = await remoteProbeOnce(dir, repo);
  if (r.stale) r = await remoteProbeOnce(dir, repo);
  return r.value;
}

async function remoteProbeOnce(
  dir: string,
  repo: RepoInfo,
): Promise<{ value: { behind?: number; error?: string }; stale: boolean }> {
  const epoch = remoteCheckEpoch.get(dir) ?? 0;
  const hit = remoteCheckCache.get(dir);
  if (hit && Date.now() - hit.at < (hit.ok ? 60_000 : 20_000)) {
    return { value: hit.ok ? { behind: hit.behind } : { error: 'check-failed' }, stale: false };
  }
  // 凭据复用当前会话配置（同账号场景；失败快速返回，由前端标"检查失败"）
  const cfg = loadConfig();
  const cred: SvnCred | null = cfg.svn.username
    ? { username: cfg.svn.username, password: cfg.svn.password, trustServerCert: cfg.svn.trustServerCert }
    : null;
  const stale = () => epoch !== (remoteCheckEpoch.get(dir) ?? 0);
  try {
    const vcs = createVcs(repo, cred);
    // 只检查打开的项目位置（子项目条目）：大工作副本不因侧栏自动检查被全量联网扫描
    const scope = path.relative(repo.root, path.resolve(dir));
    const pf = await vcs.preflight(scope || undefined);
    const isStale = stale();
    if (!isStale) remoteCheckCache.set(dir, { at: Date.now(), ok: true, behind: pf.behind });
    return { value: { behind: pf.behind }, stale: isStale };
  } catch {
    const isStale = stale();
    if (!isStale) remoteCheckCache.set(dir, { at: Date.now(), ok: false, behind: 0 });
    return { value: { error: 'check-failed' }, stale: isStale };
  }
}
