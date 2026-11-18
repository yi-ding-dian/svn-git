/** 任意项目就地更新/拉取：git=pull / svn=update（最近项目侧边栏 ⬇）。 */
import fs from 'node:fs';
import path from 'node:path';
import { detectRepo } from '../../vcs/detect.js';
import { probeProject } from '../../vcs/probe.js';
import { createVcs } from '../../vcs/index.js';
import type { SvnCred } from '../../vcs/svn.js';
import { loadConfig } from '../../config.js';
import { vcsOf } from '../repo-context.js';
import { realpathSafe } from '../path-safety.js';
import { invalidateRemoteProbe } from './probe.js';
import { t } from '../../shared/i18n/index.js';

/** 任意项目"就地更新"（点侧边栏 ⬇）：git=pull / svn=update。
 *  **安全约束**：只更新工作区**干净**（无 tracked 改动/冲突）的项目——在用户没打开的项目里
 *  拉出合并冲突没法处理，直接拒绝并提示先打开处理；未跟踪文件不挡（pull/update 不会覆盖它们）。
 *  成功后失效该项目的远程检查缓存（⬇ 归零由前端做）。
 *  files/warnings 原样带回：前端据此在通知里展示与「手动更新」一致的**完整结果详情**
 *  （文件清单 / svn 警告——点通知弹「更新结果」窗）。 */
export async function pullAny(
  dir: string,
  signal?: AbortSignal,
): Promise<{ ok: boolean; message?: string; files?: { path: string; status: string; code?: string }[]; warnings?: string[] }> {
  try {
    if (!dir || !fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
      // 该项目已打不开（目录不存在或不是工作副本）
      return { ok: false, message: t('shell.recent.probeUnavailable') };
    }
    const repo = detectRepo(dir);
    if (!repo) return { ok: false, message: t('shell.recent.probeUnavailable') };
    const st = await probeProject(dir);
    if ('error' in st) return { ok: false, message: t('shell.recent.probeUnavailable') };
    if (st.changed > 0 || st.conflict > 0) {
      // 该项目有未提交的改动，请先打开处理
      return { ok: false, message: t('shell.recent.pullDirty') };
    }
    const cfg = loadConfig();
    const cred: SvnCred | null = cfg.svn.username
      ? { username: cfg.svn.username, password: cfg.svn.password, trustServerCert: cfg.svn.trustServerCert }
      : null;
    const vcs = createVcs(repo, cred);
    // 条目记录了子项目范围：只更新该范围（svn update <scope>）。git pull 是仓库级（git 固有语义）。
    const scope = path.relative(repo.root, path.resolve(dir));
    const r =
      repo.type === 'git'
        // 当前仓库不支持拉取
        // 通道用前端传来的 dir（不是检测出的 repo.root）：前端按同一个字符串轮询，
        // dir 可能是大仓库的子项目路径，两者不保证相同
        ? ((await vcs.pull?.(signal, `pull:${dir}`)) ?? { ok: false, message: t('srv.pullUnsupported') })
        // 当前仓库不支持更新
        : ((await vcs.update?.(scope || undefined, signal)) ?? { ok: false, message: t('srv.updateUnsupported') });
    if (r.ok) {
      invalidateRemoteProbe(dir); // 拉完重算（缓存失效）
      // 拉的正好是当前打开的仓库：当前会话单例（顶栏 preflight / 侧栏 ⬇ 都读它）的缓存
      // 也失效——本函数用的是临时实例，单例自己没经手这次 update；不清的话前端"拉完立即
      // 重查"会命中旧 behind，⬇ 角标/顶栏横条最多滞后 1 分钟才消失（用户实报）
      try {
        const cur = vcsOf();
        // dir 可能是子项目路径：与当前仓库**根**比较（同一工作副本的任意子项目都算）
        if (realpathSafe(cur.repo.root) === realpathSafe(repo.root)) cur.vcs.invalidatePreflight?.();
      } catch {
        /* 无当前仓库等情况：忽略 */
      }
    }
    return { ok: r.ok, message: r.message, files: 'files' in r ? r.files : undefined, warnings: r.warnings };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}
