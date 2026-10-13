/** 最近项目域端点：打开过的仓库清单（持久化在 ~/.config/svngit/history.json）。
 *  dedupeHistory 由启动流程调用（main.tsx），不只是 HTTP 端点。 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { detectRepo } from '../../vcs/detect.js';
import { probeProject, probeProjectCached } from '../../vcs/probe.js';
import { createVcs } from '../../vcs/index.js';
import type { SvnCred } from '../../vcs/svn.js';
import { loadConfig } from '../../config.js';
import { sendJson, readBody, currentScopes, type Ctx } from './util.js';
import { t } from '../../shared/i18n/index.js';

/** 最近打开的项目历史（服务端持久化：浏览器端口随机，localStorage 不可靠） */
const HISTORY_PATH = path.join(os.homedir(), '.config', 'svngit', 'history.json');
const HISTORY_MAX = 20;

export interface HistoryItem {
  path: string;
  type: 'svn' | 'git';
  lastOpened: number;
  /** 常用项目标记（星号，启动时优先打开） */
  fav?: boolean;
  /** 用户备注（侧边栏右键「备注」设置）：侧边栏显示在时间前，过长由前端 CSS 截断；空/缺省 = 无备注 */
  remark?: string;
}

function loadHistory(): HistoryItem[] {
  try {
    if (fs.existsSync(HISTORY_PATH)) {
      const list = JSON.parse(fs.readFileSync(HISTORY_PATH, 'utf8')) as HistoryItem[];
      if (Array.isArray(list)) return list;
    }
  } catch {
    /* 损坏则重置 */
  }
  return [];
}

/** 历史记录的项目身份键：**按 inode 归一，不能按路径字符串**。
 *  同一个目录可以有多个路径——bind mount（如 /data/home/x 与 /home/x，实测 inode 完全相同）、
 *  软链接、结尾斜杠等，按字符串比会当成两个项目，列表里就出现一模一样的条目（用户实报：
 *  最近项目里两个 svn-git，一个带星一个不带）。realpath 对 bind mount 无效（它只解析软链），
 *  所以必须看 dev:ino。取不到（目录已删/无权限）时退回字面路径，只归并完全相同的字符串。 */
function historyKey(p: string): string {
  try {
    const st = fs.statSync(p);
    return `${st.dev}:${st.ino}`;
  } catch {
    return path.resolve(p);
  }
}

/** 启动时清理历史里的重复项：同一目录只留最近打开的那条路径，常用标记合并上去
 *  （星号不能因为去重丢了）。返回清理掉的条数，0 = 本来就干净（不写文件）。 */
export function dedupeHistory(): number {
  try {
    const list = loadHistory();
    const byKey = new Map<string, HistoryItem>();
    for (const h of list) {
      const key = historyKey(h.path);
      const prev = byKey.get(key);
      if (!prev) {
        byKey.set(key, h);
        continue;
      }
      const [keep, drop] = (h.lastOpened ?? 0) > (prev.lastOpened ?? 0) ? [h, prev] : [prev, h];
      // fav 做「或」合并、备注取先有的那个：同一目录的两条别名记录，用户只在其中一条上设过星号/备注，
      // 归并时必须留下，不能因为"保留的那条恰好没有"就并没了
      byKey.set(key, { ...keep, fav: Boolean(keep.fav || drop.fav), remark: keep.remark ?? drop.remark });
    }
    if (byKey.size === list.length) return 0;
    const out = [...byKey.values()].sort((a, b) => (b.lastOpened ?? 0) - (a.lastOpened ?? 0));
    fs.mkdirSync(path.dirname(HISTORY_PATH), { recursive: true });
    fs.writeFileSync(HISTORY_PATH, JSON.stringify(out, null, 2));
    fs.chmodSync(HISTORY_PATH, 0o600);
    return list.length - out.length;
  } catch {
    return 0; // 清理失败不影响启动
  }
}

function addHistory(entry: { path: string; type: 'svn' | 'git' }): void {
  try {
    const key = historyKey(entry.path);
    const existed = loadHistory().find((h) => historyKey(h.path) === key);
    const list = loadHistory().filter((h) => historyKey(h.path) !== key); // 同一目录的别名路径一并去掉，不留重复
    // 记录被整个重新构造，**用户自己设的两样东西都得显式带过来**，否则打开一次项目就没了：
    // 常用标记（不丢星号）+ 备注（用户实报：「更新时间后就不见了，备注」）
    list.unshift({ ...entry, lastOpened: Date.now(), fav: existed?.fav, remark: existed?.remark });
    fs.mkdirSync(path.dirname(HISTORY_PATH), { recursive: true });
    fs.writeFileSync(HISTORY_PATH, JSON.stringify(list.slice(0, HISTORY_MAX), null, 2));
    fs.chmodSync(HISTORY_PATH, 0o600); // 与 config 一致，仅本人可读写
  } catch {
    /* 忽略写失败 */
  }
}

/** 任意项目的远程检查（最近项目 ⬇ 待拉取）：detectRepo → 临时 VCS 实例 → preflight。
 *  preflight 自带超时（git fetch 15s / svn status -u 20s）与失败快速返回 — 不会卡请求；
 *  缓存：成功 60s / 失败 20s（打开侧边栏会成批请求，挡住重复联网）。 */
const remoteCheckCache = new Map<string, { at: number; ok: boolean; behind: number }>();
async function remoteProbeAny(dir: string): Promise<{ behind?: number; error?: string }> {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return { error: 'unavailable' };
  const repo = detectRepo(dir);
  if (!repo) return { error: 'unavailable' };
  const hit = remoteCheckCache.get(dir);
  if (hit && Date.now() - hit.at < (hit.ok ? 60_000 : 20_000)) {
    return hit.ok ? { behind: hit.behind } : { error: 'check-failed' };
  }
  // 凭据复用当前会话配置（同账号场景；失败快速返回，由前端标"检查失败"）
  const cfg = loadConfig();
  const cred: SvnCred | null = cfg.svn.username
    ? { username: cfg.svn.username, password: cfg.svn.password, trustServerCert: cfg.svn.trustServerCert }
    : null;
  try {
    const vcs = createVcs(repo, cred);
    const pf = await vcs.preflight();
    remoteCheckCache.set(dir, { at: Date.now(), ok: true, behind: pf.behind });
    return { behind: pf.behind };
  } catch {
    remoteCheckCache.set(dir, { at: Date.now(), ok: false, behind: 0 });
    return { error: 'check-failed' };
  }
}

/** 任意项目"就地更新"（点侧边栏 ⬇）：git=pull / svn=update。
 *  **安全约束**：只更新工作区**干净**（无 tracked 改动/冲突）的项目——在用户没打开的项目里
 *  拉出合并冲突没法处理，直接拒绝并提示先打开处理；未跟踪文件不挡（pull/update 不会覆盖它们）。
 *  成功后失效该项目的远程检查缓存（⬇ 归零由前端做）。 */
async function pullAny(dir: string, signal?: AbortSignal): Promise<{ ok: boolean; message?: string }> {
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
    // pull 自带 600s 超时与友好错误；svn update 无参数 = 整个工作副本。
    // signal：前端断开（后台任务面板「取消」）→ 一并终止 git pull / svn update 子进程
    const r =
      repo.type === 'git'
        // 当前仓库不支持拉取
        ? ((await vcs.pull?.(signal)) ?? { ok: false, message: t('srv.pullUnsupported') })
        // 当前仓库不支持更新
        : ((await vcs.update?.(undefined, signal)) ?? { ok: false, message: t('srv.updateUnsupported') });
    if (r.ok) remoteCheckCache.delete(dir); // 拉完重算（缓存失效）
    return { ok: r.ok, message: r.message };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

export async function handle(ctx: Ctx): Promise<boolean> {
  const { req, res, url } = ctx;
  const p = url.pathname;

      if (p === '/api/open' && req.method === 'POST') {
        // 打开指定仓库（前端浏览到仓库后点击进入）；POST-only：切换仓库属有副作用操作，不接受 GET
        const body = await readBody(req);
        const dir = String(body.path ?? '');
        if (!dir) {
          // 缺少路径
          sendJson(res, 400, { error: t('srv.missingPath') });
          return true;
        }
        const r = detectRepo(dir);
        if (!r) {
          // {dir} 不是 SVN/Git 工作副本
          sendJson(res, 400, { error: t('srv.notWc', { dir }) });
          return true;
        }
        process.env.SVNGIT_REPO_DIR = r.root;
        // 记录操作范围：打开的目录相对仓库根(子项目);打开根目录则为空(全仓库)
        currentScopes.set(r.root, dir === r.root ? '' : path.relative(r.root, dir));
        addHistory({ path: r.root, type: r.type }); // 记录到最近项目
        sendJson(res, 200, { ok: true, repo: r });
        return true;
      }
      if (p === '/api/history') {
        if (req.method === 'POST') {
          const body = await readBody(req);
          const hp = String(body.path ?? '');
          const ht = String(body.type ?? '') === 'git' ? 'git' : 'svn';
          if (hp) addHistory({ path: hp, type: ht });
          sendJson(res, 200, { ok: true });
          return true;
        }
        sendJson(res, 200, { items: loadHistory() });
        return true;
      }

      if (p === '/api/history-remove' && req.method === 'POST') {
        // 删除一条最近项目记录
        const body = await readBody(req);
        const hp = String(body.path ?? '');
        if (hp) {
          const list = loadHistory().filter((h) => h.path !== hp);
          try {
            fs.mkdirSync(path.dirname(HISTORY_PATH), { recursive: true });
            fs.writeFileSync(HISTORY_PATH, JSON.stringify(list, null, 2));
            fs.chmodSync(HISTORY_PATH, 0o600);
          } catch {
            /* 忽略写失败 */
          }
        }
        sendJson(res, 200, { ok: true, items: loadHistory() });
        return true;
      }

      if (p === '/api/history-fav' && req.method === 'POST') {
        // 设置/取消常用项目标记（星号）
        const body = await readBody(req);
        const hp = String(body.path ?? '');
        const fav = Boolean(body.fav);
        if (hp) {
          const list = loadHistory().map((h) => (h.path === hp ? { ...h, fav } : h));
          try {
            fs.mkdirSync(path.dirname(HISTORY_PATH), { recursive: true });
            fs.writeFileSync(HISTORY_PATH, JSON.stringify(list, null, 2));
            fs.chmodSync(HISTORY_PATH, 0o600);
          } catch {
            /* 忽略写失败 */
          }
        }
        sendJson(res, 200, { ok: true, items: loadHistory() });
        return true;
      }

      if (p === '/api/project-status' && req.method === 'GET') {
        // 最近项目仪表盘：探测任意项目的摘要状态（只读、不切当前仓库；30s 缓存）。
        // force=1（顶栏刷新的"当前项目"）：绕过缓存，刚提交/改文件后角标立刻准
        const dir = String(url.searchParams.get('path') ?? '').trim();
        if (!dir) {
          // 缺少路径参数
          sendJson(res, 400, { error: t('srv.missingPath') });
          return true;
        }
        sendJson(res, 200, await probeProjectCached(dir, { force: url.searchParams.get('force') === '1' }));
        return true;
      }

      if (p === '/api/pull-any' && req.method === 'POST') {
        // 点侧边栏 ⬇ 就地更新该项目（git pull / svn update；工作区脏则拒绝，见 pullAny）。
        // 前端断开（后台任务面板「取消」/关页）→ 一并终止子进程（同 update 手法）
        const body = await readBody(req);
        const dir = String(body.path ?? '').trim();
        if (!dir) {
          // 缺少路径参数
          sendJson(res, 400, { error: t('srv.missingPath') });
          return true;
        }
        const ac = new AbortController();
        res.on('close', () => {
          if (!res.writableEnded) ac.abort();
        });
        sendJson(res, 200, await pullAny(dir, ac.signal));
        return true;
      }

      if (p === '/api/remote-probe' && req.method === 'GET') {
        // 任意项目的"远程检查"（⬇ 待拉取）：复用 preflight（自带 15s/20s 超时 + 失败快速返回，
        // 全程异步不阻塞界面）。缓存：成功 60s / 失败 20s——打开侧边栏会成批请求，挡住重复联网。
        const dir = String(url.searchParams.get('path') ?? '').trim();
        if (!dir) {
          // 缺少路径参数
          sendJson(res, 400, { error: t('srv.missingPath') });
          return true;
        }
        sendJson(res, 200, await remoteProbeAny(dir));
        return true;
      }

      if (p === '/api/history-remark' && req.method === 'POST') {
        // 设置/清除最近项目的备注（侧边栏右键菜单）。空串 = 清除：把字段删掉，不留空串
        const body = await readBody(req);
        const hp = String(body.path ?? '');
        // 60 字上限：备注显示在 160px 侧边栏里，再长也只会被截断，别让 history.json 被塞长文本
        const remark = String(body.remark ?? '').trim().slice(0, 60);
        if (hp) {
          const list = loadHistory().map((h) => {
            if (h.path !== hp) return h;
            const next: HistoryItem = { ...h };
            if (remark) next.remark = remark;
            else delete next.remark;
            return next;
          });
          try {
            fs.mkdirSync(path.dirname(HISTORY_PATH), { recursive: true });
            fs.writeFileSync(HISTORY_PATH, JSON.stringify(list, null, 2));
            fs.chmodSync(HISTORY_PATH, 0o600);
          } catch {
            /* 忽略写失败 */
          }
        }
        sendJson(res, 200, { ok: true, items: loadHistory() });
        return true;
      }

  return false;
}
