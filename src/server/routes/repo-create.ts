/** 仓库创建/获取端点：POST /api/repo-create/check（风险检测）与 POST /api/repo-create（git / svn）。
 *
 *  本模块只做协议转换：字段解析与校验、响应封装；命令执行、认证、取消、进度、半截目录清理
 *  在 server/repo-setup/ 下。请求体字段、响应字段、错误文案、状态码与拆分前完全一致。 */
import fs from 'node:fs';
import path from 'node:path';
import { detectRepo } from '../../vcs/detect.js';
import { run } from '../../vcs/exec.js';
import { verifyRemote } from '../../vcs/verify-remote.js';
import { loadConfig } from '../../config.js';
import { t } from '../../shared/i18n/index.js';
import { sendJson, readBody, type Ctx } from '../http/response.js';
import { createGitRepo, type RepoCreateResult } from '../repo-setup/clone.js';
import { createSvnRepo } from '../repo-setup/checkout.js';
import {
  hasLeftoverTarget,
  removeLeftoverTarget,
  cleanRemnantIfVcsMetaOnly,
} from '../repo-setup/leftover.js';

export async function handle(ctx: Ctx): Promise<boolean> {
  const { req, res, p } = ctx;

  if (p === '/api/repo-create/check' && req.method === 'POST') {
    // 创建/获取前的风险检测（供二次确认展示）：目标已存在/非空、目标位于仓库内（嵌套风险）
    const body = await readBody(req);
    const dir = String(body.dir ?? '').trim();
    const name = String(body.name ?? '').trim();
    if (!dir || !name) {
      // 缺少目录或名称
      sendJson(res, 400, { error: t('srv.missingDirOrName') });
      return true;
    }
    const target = path.join(dir, name);
    let exists = false;
    let existsNonEmpty = false;
    let onlySvn = false;
    let onlyGit = false;
    try {
      exists = fs.existsSync(target);
      if (exists) {
        const entries = fs.readdirSync(target);
        existsNonEmpty = entries.length > 0;
        // 只有 .svn = 上次检出中断的残骸：检出时会自动清理重来，前端不应按"非空"拦截
        onlySvn = entries.length === 1 && entries[0] === '.svn';
        onlyGit = entries.length === 1 && entries[0] === '.git';
      }
    } catch {
      /* 目标不可读时按不存在处理，不阻断 */
    }
    // 位于仓库/工作副本内（目标自身是已存在的仓库也算，向上查找命中）
    const inRepo = detectRepo(dir) ?? (exists ? detectRepo(target) : null);
    // 非空目录：给二次确认提供文件预览（敏感/大文件警告），不在这一步做任何写操作
    let preview: {
      files: number;
      bytes: number;
      sensitive: string[];
      large: string[];
      hasGitignore: boolean;
      hasCommit: boolean;
    } | null = null;
    if (exists && existsNonEmpty) {
      let files = 0;
      let bytes = 0;
      const sensitive: string[] = [];
      const large: string[] = [];
      const sensitiveRe =
        /(^|\/)(\.env|\.env\.local|\.env\.[^/]+\.local|.*\.(pem|key|p12|pfx)|id_rsa|id_ed25519|credentials.*|secrets.*)$/i;
      // 常见依赖/构建目录不参与统计（.gitignore 模板也会排除）
      const skipDirs = new Set([
        '.git',
        '.svn',
        'node_modules',
        '.venv',
        'venv',
        '__pycache__',
        '.pytest_cache',
        'dist',
        'build',
        'target',
      ]);
      const stack: { dir: string; rel: string; depth: number }[] = [
        { dir: target, rel: '', depth: 0 },
      ];
      while (stack.length > 0 && files < 2000) {
        const cur = stack.pop()!;
        let entries: fs.Dirent[] = [];
        try {
          entries = fs.readdirSync(cur.dir, { withFileTypes: true });
        } catch {
          continue;
        }
        for (const e of entries) {
          if (files >= 2000) break;
          const rel = cur.rel ? `${cur.rel}/${e.name}` : e.name;
          if (e.isDirectory()) {
            if (!skipDirs.has(e.name) && cur.depth < 8) {
              stack.push({ dir: path.join(cur.dir, e.name), rel, depth: cur.depth + 1 });
            }
          } else if (e.isFile()) {
            files++;
            try {
              const st = fs.statSync(path.join(cur.dir, e.name));
              bytes += st.size;
              if (st.size > 50 * 1024 * 1024) large.push(rel);
            } catch {
              /* 读不到大小：只计数 */
            }
            if (sensitiveRe.test(rel)) sensitive.push(rel);
          }
        }
      }
      let hasCommit = false;
      if (fs.existsSync(path.join(target, '.git'))) {
        const rr = await run('git', ['-C', target, 'rev-parse', '--verify', 'HEAD'], {
          timeoutMs: 5_000,
        });
        hasCommit = rr.code === 0;
      }
      preview = {
        files,
        bytes,
        sensitive: sensitive.slice(0, 20),
        large: large.slice(0, 10),
        hasGitignore: fs.existsSync(path.join(target, '.gitignore')),
        hasCommit,
      };
    }
    sendJson(res, 200, {
      target,
      exists,
      existsNonEmpty,
      onlySvn,
      onlyGit,
      inRepo: inRepo ? { type: inRepo.type, root: inRepo.root } : null,
      preview,
    });
    return true;
  }

  if (p === '/api/verify-repo' && req.method === 'POST') {
    // 获取仓库前的轻量认证预检（不依赖当前打开的仓库，也不写任何东西）：
    // 通过才真正克隆/检出，密码错时不用白跑一趟。临时密码只在本次请求内存里。
    const body = await readBody(req);
    const type = String(body.type ?? '');
    const url = String(body.url ?? '').trim();
    if (type !== 'git' && type !== 'svn') {
      // 未知仓库类型
      sendJson(res, 400, { error: t('srv.unknownRepoType') });
      return true;
    }
    if (!url) {
      // 仓库地址不合法
      sendJson(res, 400, { error: t('srv.badRepoUrl') });
      return true;
    }
    const cfg = loadConfig();
    // 本次填的临时账号优先；没填用已保存配置（与检出时的取用口径一致）
    const user = String(body.username ?? '').trim() || (type === 'svn' ? cfg.svn.username : (cfg.git?.username ?? ''));
    const pass = String(body.password ?? '') || (type === 'svn' ? cfg.svn.password : (cfg.git?.password ?? ''));
    sendJson(
      res,
      200,
      await verifyRemote(type, url, {
        username: user,
        password: pass,
        trustServerCert: type === 'svn' ? cfg.svn.trustServerCert : false,
      }),
    );
    return true;
  }

  if (p === '/api/repo-create' && req.method === 'POST') {
    // 创建/克隆仓库（不依赖当前打开的仓库）
    const body = await readBody(req);
    const type = String(body.type ?? '');
    const dir = String(body.dir ?? '').trim();
    const url = String(body.url ?? '').trim();
    const name = String(body.name ?? '').trim();
    // 标签/分支检出（git）：ref = 完整引用（refs/tags/x）或分支名（feature / origin/feature）
    const ref = String(body.ref ?? '').trim();
    const depth = Number(body.depth ?? 0) > 0 ? Math.floor(Number(body.depth)) : 0;
    const mode = body.mode === 'worktree' ? 'worktree' : 'clone';
    const repoRoot = String(body.repoRoot ?? '').trim();
    // ref 会被拼进 checkout/fetch refspec：禁止空白与 ref 特殊字符
    if (ref && (ref.includes('..') || /[\s:~^?*[\]\\]/.test(ref) || !/^(refs\/(tags|heads|remotes)\/)?[^\s]+$/.test(ref))) {
      sendJson(res, 400, { error: t('srv.badRepoUrl') });
      return true;
    }
    // 检出方式：标签默认 detach；分支默认 checkout 本地分支
    const checkout =
      body.checkout === 'detach' || body.checkout === 'branch'
        ? body.checkout
        : ref.startsWith('refs/tags/')
          ? 'detach'
          : 'branch';
    if (!dir) {
      // 请填写目录路径
      sendJson(res, 400, { error: t('srv.fillDirPath') });
      return true;
    }
    const target = path.join(dir, name);
    // ---------- 拿目录之前先把残骸处理掉 ----------
    // 上次同目标的半截克隆没清干净（见 repo-setup/leftover.ts）→ 这次开始时再清一遍，
    // 否则 git/svn 会直接报「目标已存在且非空」，而用户手上根本没有文件（用户实报）。
    if (hasLeftoverTarget(target)) removeLeftoverTarget(target);
    // 目标目录里**只有** `.git` / `.svn` 一个条目 = 上次获取中断留下的残骸；清掉继续并在结果里说明
    const cleanedRemnant = cleanRemnantIfVcsMetaOnly(target);
    let result: RepoCreateResult;
    if (type === 'git') {
      result = await createGitRepo({ body, target, url, ref, depth, mode, repoRoot, checkout, cleanedRemnant }, res);
    } else if (type === 'svn') {
      result = await createSvnRepo({ body, target, url, cleanedRemnant }, res);
    } else {
      // 未知仓库类型
      sendJson(res, 400, { error: t('srv.unknownRepoType') });
      return true;
    }
    // authError 只在认证失败时为 true / 其余 undefined→false；**不能无条件写 false**
    // （否则 git 克隆/SVN 检出的认证失败标志会被吞掉，前端永远不弹认证框）
    sendJson(res, 200, { ...result, authError: result.authError ?? false });
    return true;
  }

  return false;
}
