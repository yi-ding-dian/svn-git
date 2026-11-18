/** 最近项目域端点：打开过的仓库清单（持久化在 ~/.config/svngit/history.json）。
 *  本文件只做 HTTP 协议转换：持久化在 recent/history-store，远程探测在 recent/probe，
 *  就地更新在 recent/pull。 */

import path from 'node:path';
import { detectRepo } from '../../vcs/detect.js';
import { probeProjectCached } from '../../vcs/probe.js';
import { sendJson, readBody, type Ctx } from '../http/response.js';
import { currentScopes } from '../repo-context.js';
import {
  addHistory,
  loadHistory,
  removeHistoryItem,
  setHistoryFav,
  setHistoryRemark,
  type HistoryItem,
} from '../recent/history-store.js';
import { remoteProbeAny } from '../recent/probe.js';
import { pullAny } from '../recent/pull.js';
import { t } from '../../shared/i18n/index.js';

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
        const scope = dir === r.root ? '' : path.relative(r.root, dir);
        currentScopes.set(r.root, scope);
        // 最近项目同时记住操作范围：下次从侧栏点开直接回到子项目，不用重新逐级选择
        addHistory({ path: r.root, type: r.type, scope: scope || undefined });
        sendJson(res, 200, { ok: true, repo: r });
        return true;
      }
      if (p === '/api/history') {
        if (req.method === 'POST') {
          const body = await readBody(req);
          const hp = String(body.path ?? '');
          const ht = String(body.type ?? '') === 'git' ? 'git' : 'svn';
          if (hp) addHistory({ path: hp, type: ht, scope: currentScopes.get(hp) || undefined });
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
        const hs = String(body.scope ?? '');
        let items: HistoryItem[] = loadHistory();
        if (hp) items = removeHistoryItem(hp, hs);
        sendJson(res, 200, { ok: true, items });
        return true;
      }

      if (p === '/api/history-fav' && req.method === 'POST') {
        // 设置/取消常用项目标记（星号）
        const body = await readBody(req);
        const hp = String(body.path ?? '');
        const hs = String(body.scope ?? '');
        const fav = Boolean(body.fav);
        let items: HistoryItem[] = loadHistory();
        if (hp) items = setHistoryFav(hp, hs, fav);
        sendJson(res, 200, { ok: true, items });
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
        const hs = String(body.scope ?? '');
        // 60 字上限：备注显示在 160px 侧边栏里，再长也只会被截断，别让 history.json 被塞长文本
        const remark = String(body.remark ?? '').trim().slice(0, 60);
        let items: HistoryItem[] = loadHistory();
        if (hp) items = setHistoryRemark(hp, hs, remark);
        sendJson(res, 200, { ok: true, items });
        return true;
      }

  return false;
}
