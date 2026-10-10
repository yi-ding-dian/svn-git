/** 历史域端点：提交历史与仓库只读查询（log/diff/status/remotes/info）。 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isBinaryFile, inRepoRoot, sendJson, getStatusCached, currentScopes, vcsOf, repoInfo, START_DIR, MSG_PATH_OUT_OF_BOUNDS, INSTANCE_ID, type Ctx } from './util.js';

export async function handle(ctx: Ctx): Promise<boolean> {
  const { res, url } = ctx;
  const p = url.pathname;

      if (p === '/api/info') {
        // 版本与构建日期：构建脚本写入 dist/build-info.json（每次 npm run build 更新）
        // package.json 相对 misc 编译产物有 1-2 层（dist 或 dist/routes），逐个候选路径尝试
        let version = '';
        let buildDate = '';
        {
          const base = import.meta.dirname ?? '.';
          for (const rel of ['../package.json', '../../package.json']) {
            try {
              version = JSON.parse(fs.readFileSync(path.resolve(base, rel), 'utf8')).version ?? '';
              break;
            } catch {
              /* 尝试下一个候选 */
            }
          }
          for (const rel of ['../build-info.json', '../../build-info.json']) {
            try {
              buildDate = JSON.parse(fs.readFileSync(path.resolve(base, rel), 'utf8')).buildDate ?? '';
              break;
            } catch {
              /* 尝试下一个候选 */
            }
          }
        }
        const repo = repoInfo();
        if (!repo) {
          sendJson(res, 200, { type: null, root: null, url: null, revOrBranch: null, startDir: START_DIR, home: os.homedir(), version, buildDate, instanceId: INSTANCE_ID });
          return true;
        }
        const { vcs } = vcsOf();
        let url2 = repo.url ?? '';
        let rev = repo.revOrBranch ?? '';
        try {
          if (repo.type === 'svn') {
            const info = await vcs.info?.();
            url2 = info?.url ?? url2;
            rev = info?.revision ? `r${info.revision}` : rev;
          } else {
            const [b, r] = await Promise.all([vcs.branch?.(), vcs.remote?.()]);
            rev = b || rev;
            url2 = r || url2;
          }
        } catch {
          /* 忽略 */
        }
        sendJson(res, 200, {
          type: repo.type,
          root: repo.root,
          url: url2,
          revOrBranch: rev,
          startDir: START_DIR,
          // 当前操作范围(相对仓库根,大仓库子项目场景):浏览起点 + 状态扫描范围
          startRel: currentScopes.get(repo.root) ?? '',
          home: os.homedir(),
          version,
          buildDate,
          instanceId: INSTANCE_ID,
        });
        return true;
      }

      if (p === '/api/git-info') {
        // Git 信息：分支 / 远程 / 上游 / 最近提交
        const { vcs, repo } = vcsOf();
        if (repo.type !== 'git') {
          sendJson(res, 400, { error: '非 Git 仓库' });
          return true;
        }
        sendJson(res, 200, await vcs.gitInfo?.());
        return true;
      }

      if (p === '/api/status') {
        const { repo } = vcsOf();
        const force = url.searchParams.get('force') === '1';
        const items = await getStatusCached(repo, force);
        sendJson(res, 200, { items });
        return true;
      }

      if (p === '/api/log') {
        const { vcs, repo } = vcsOf();
        const pathRel = url.searchParams.get('path') || undefined;
        // 路径越界校验：svn log 会把 ../ 解析到仓库外的其他工作副本
        if (pathRel && !inRepoRoot(repo.root, path.resolve(repo.root, pathRel))) {
          sendJson(res, 400, { error: MSG_PATH_OUT_OF_BOUNDS });
          return true;
        }
        // limit 缺省 200（首屏）；显式 limit=0 → 全量。offset=已加载条数（git --skip 续拉）；afterRev=已加载最老版本（svn -r rev-1:1 续拉）
        const limitRaw = url.searchParams.get('limit');
        const limit = limitRaw === null ? 200 : Number(limitRaw);
        const offset = Number(url.searchParams.get('offset') ?? 0) || 0;
        const afterRev = url.searchParams.get('afterRev') || undefined;
        // 日志（svn 不做总数探测——无轻量接口，全量 -q 会拖慢首次加载；git rev-list 秒级精确）
        const logs = await vcs.log(limit, pathRel, offset, afterRev);
        let total = 0;
        if (repo.type === 'git') {
          try {
            const info = (await vcs.logTotal?.(pathRel)) ?? { count: 0, exact: true };
            total = info.count;
          } catch {
            /* 探测失败不阻断历史列表 */
          }
        }
        const totalGt = false;
        let unpushed: string[] = [];
        if (repo.type === 'git') {
          try {
            unpushed = (await vcs.unpushed?.()) ?? [];
          } catch {
            /* 计算失败不阻断历史列表 */
          }
        }
        sendJson(res, 200, { logs, unpushed, total, totalGt });
        return true;
      }

      if (p === '/api/diff') {
        const { vcs, repo } = vcsOf();
        const pathRel = url.searchParams.get('path') || undefined;
        // 路径越界校验：svn diff 会把 ../ 解析到仓库外的其他工作副本
        if (pathRel && !inRepoRoot(repo.root, path.resolve(repo.root, pathRel))) {
          sendJson(res, 400, { error: MSG_PATH_OUT_OF_BOUNDS });
          return true;
        }
        if (pathRel && isBinaryFile(pathRel)) {
          sendJson(res, 200, { ok: false, output: '', error: `二进制文件（${pathRel}），不支持文本对比` });
          return true;
        }
        const a = url.searchParams.get('a') || undefined;
        const b = url.searchParams.get('b') || undefined;
        const d = await vcs.diff(a, b, pathRel);
        let output = d.output;
        // git 工作区模式：合并暂存区改动（否则已 git add 的修改行不会标记）
        if (repo.type === 'git' && !a && !b) {
          const staged = await vcs.diffStaged?.(pathRel);
          if (staged?.ok && staged.output.trim()) output = output + (output ? '\n' : '') + staged.output;
        }
        sendJson(res, 200, { ...d, output });
        return true;
      }

      if (p === '/api/remotes') {
        const { repo, vcs } = vcsOf();
        if (repo.type !== 'git') {
          sendJson(res, 200, { remotes: [] });
          return true;
        }
        const remotes = (await vcs.remoteList?.()) ?? [];
        sendJson(res, 200, { remotes });
        return true;
      }

  return false;
}
