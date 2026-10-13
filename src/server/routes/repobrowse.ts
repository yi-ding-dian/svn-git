/** SVN 仓库浏览（不 checkout 直接看远程，Tortoise Repo-Browser 的角色）：
 *  `list -v` / `cat` 两条只读命令，URL 直连（无工作副本模式）——凭据复用 loadConfig 的 svn 配置。
 *  安全：协议白名单 + 命令白名单（只有 list/cat）+ cat 大小上限；绝不做写操作。 */
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { XMLParser } from 'fast-xml-parser';
import { run, type RunResult } from '../../vcs/exec.js';
import { resolveSvnBin } from '../../vcs/svn.js';
import { loadConfig } from '../../config.js';
import { decodeMixedText } from '../../shared/text.js';
import { sendJson, readBody, type Ctx } from './util.js';
import { t } from '../../shared/i18n/index.js';

const xml = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });

/** 允许浏览的 URL 协议（只读场景） */
const URL_OK = /^(svn|https?|file):\/\//i;

/** 跑一条只读 svn 命令（URL 直连、无工作副本模式；cwd 用 tmp——这些命令不依赖工作目录） */
async function svnRun(args: string[], opt: { timeoutMs?: number; raw?: boolean } = {}) {
  const cfg = loadConfig();
  const full: string[] = [];
  if (cfg.svn.username) full.push('--username', cfg.svn.username, '--password-from-stdin', '--non-interactive');
  if (cfg.svn.trustServerCert) full.push('--trust-server-cert');
  full.push(...args);
  return run(await resolveSvnBin(), full, {
    cwd: os.tmpdir(),
    stdinData: cfg.svn.username ? cfg.svn.password + '\n' : undefined,
    timeoutMs: opt.timeoutMs ?? 20_000,
    raw: opt.raw,
  });
}

/** 远程目录条目（svn list -v） */
interface RepoEntry {
  name: string;
  isDir: boolean;
  size?: number;
  rev?: string;
  author?: string;
  date?: string;
}

/** 检出失败/取消后没清干净的半截目录（键即路径）：下次对同一目标检出时开始时先重试清理。
 *  同 index.ts 获取仓库的 leftoverTargets 思路；清不掉**绝不算检出失败**。 */
const coLeftovers = new Set<string>();

/** 清掉本次检出留下的半截目录（Windows 上 svn 刚被 SIGKILL，句柄可能未释放，带重试防 EBUSY/EPERM） */
function cleanCoTarget(target: string): boolean {
  try {
    fs.rmSync(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    coLeftovers.delete(target);
    return true;
  } catch {
    coLeftovers.add(target);
    return false;
  }
}

/** SVN 认证/授权失败判定（解析 svn 输出文本，不是界面文案，禁止翻译）：
 *  E170001 认证/授权被拒、E215004 凭据用完或被拒、本地化消息；宽匹配——
 *  宁可按认证失败处理（前端弹凭据框可重试），也不把用户卡在看不明白的错误里。 */
const SVN_AUTH_FAIL = /E170001|E215004|Authentication failed|Authentication required|authorization failed|Not authorized|认证失败/i; // i18n-ignore: 解析 svn 输出的匹配表

/** svn list -v --xml 解析（嵌套容错：单元素时 fast-xml-parser 不返回数组） */
function parseList(stdout: string): RepoEntry[] {
  const doc = xml.parse(stdout);
  const lists = doc?.lists?.list ?? [];
  const out: RepoEntry[] = [];
  for (const l of Array.isArray(lists) ? lists : [lists]) {
    const entries = l?.entry ?? [];
    for (const e of Array.isArray(entries) ? entries : [entries]) {
      const name = String(e?.name ?? '');
      if (!name) continue;
      const commit = e?.commit ?? {};
      out.push({
        name,
        isDir: String(e?.['@_kind'] ?? 'file') === 'dir',
        size: e?.size !== undefined ? Number(e.size) : undefined,
        rev: commit?.['@_revision'] !== undefined ? String(commit['@_revision']) : undefined,
        author: commit?.author !== undefined ? String(commit.author) : undefined,
        date: commit?.date !== undefined ? String(commit.date) : undefined,
      });
    }
  }
  return out;
}

export async function handle(ctx: Ctx): Promise<boolean> {
  const { req, res, url } = ctx;
  const p = url.pathname;

  if (p === '/api/repo-list' && req.method === 'GET') {
    // 远程目录列表（带修订/作者/时间）
    const target = String(url.searchParams.get('url') ?? '').trim();
    if (!URL_OK.test(target)) {
      // 仓库地址无效（仅支持 svn / http(s) / file）
      sendJson(res, 400, { error: t('srv.badRepoUrl') });
      return true;
    }
    try {
      // 注意：--xml 模式本身即详细输出（带 commit/size），不能再加 -v（svn 报"verbose 选项无效"）
      const r = await svnRun(['list', '--xml', target]);
      if (r.code !== 0) {
        sendJson(res, 200, { ok: false, error: r.stderr.trim() || 'svn list failed' });
        return true;
      }
      // 目录在前、按名序（中文名用 localeCompare；svn 的天然顺序不保证"目录在前"）
      const entries = parseList(r.stdout);
      entries.sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.name.localeCompare(b.name));
      sendJson(res, 200, { ok: true, entries });
    } catch (e) {
      sendJson(res, 200, { ok: false, error: (e as Error).message });
    }
    return true;
  }

  if (p === '/api/repo-cat' && req.method === 'GET') {
    // 远程文件内容（文本预览；raw 搬运后判大小，防大文件拖垮界面）
    const target = String(url.searchParams.get('url') ?? '').trim();
    if (!URL_OK.test(target)) {
      // 仓库地址无效（仅支持 svn / http(s) / file）
      sendJson(res, 400, { error: t('srv.badRepoUrl') });
      return true;
    }
    try {
      const r = await svnRun(['cat', target], { raw: true });
      if (r.code !== 0) {
        sendJson(res, 200, { ok: false, error: r.stderr.trim() || 'svn cat failed' });
        return true;
      }
      const buf = r.stdoutBuf ?? Buffer.from(r.stdout ?? '', 'utf8');
      if (buf.length > 2 * 1024 * 1024) {
        // 文件太大（超过 2MB），请「下载到…」查看
        sendJson(res, 200, { ok: false, error: t('srv.repoFileTooBig') });
        return true;
      }
      sendJson(res, 200, { ok: true, text: decodeMixedText(buf) });
    } catch (e) {
      sendJson(res, 200, { ok: false, error: (e as Error).message });
    }
    return true;
  }

  if (p === '/api/repo-root' && req.method === 'GET') {
    // 从工作副本路径取「仓库根 URL」+「工作副本在仓库中的相对路径」（--xml 一条拿全；本地元数据不联网）。
    // rel 供仓库浏览器的「定位到该项目」用（逐级展开树的路径）。
    const wcPath = String(url.searchParams.get('path') ?? '').trim();
    if (!wcPath) {
      // 缺少路径
      sendJson(res, 400, { error: t('srv.missingPath') });
      return true;
    }
    try {
      const bin = await resolveSvnBin();
      const r = await run(bin, ['info', '--xml', wcPath], { cwd: os.tmpdir(), timeoutMs: 15_000 });
      if (r.code !== 0) {
        sendJson(res, 200, { ok: false, error: r.stderr.trim() || 'svn info failed' });
        return true;
      }
      const doc = xml.parse(r.stdout);
      const entry = doc?.info?.entry ?? {};
      const repoRoot = String(entry?.repository?.root ?? '').trim();
      const relUrl = String(entry?.['relative-url'] ?? '').trim(); // 形如 ^/projects/CWBS-SCA/tags/SCA_HB
      const rel = relUrl.replace(/^\^\//, '');
      if (!repoRoot) {
        sendJson(res, 200, { ok: false, error: 'repos-root-url not found' });
        return true;
      }
      sendJson(res, 200, { ok: true, root: repoRoot, rel });
    } catch (e) {
      sendJson(res, 200, { ok: false, error: (e as Error).message });
    }
    return true;
  }

  if (p === '/api/repo-save' && req.method === 'POST') {
    // 远程文件保存到本地目录（「下载到…」）：目标已存在则拒绝（V1 不做覆盖询问）
    const body = await readBody(req);
    const target = String(body.url ?? '').trim();
    const dir = String(body.dir ?? '').trim();
    if (!URL_OK.test(target) || !dir) {
      // 仓库地址无效（仅支持 svn / http(s) / file）
      sendJson(res, 400, { error: t('srv.badRepoUrl') });
      return true;
    }
    try {
      const r = await svnRun(['cat', target], { raw: true, timeoutMs: 120_000 });
      if (r.code !== 0) {
        sendJson(res, 200, { ok: false, error: r.stderr.trim() || 'svn cat failed' });
        return true;
      }
      const buf = r.stdoutBuf ?? Buffer.from(r.stdout ?? '', 'utf8');
      const name = decodeURIComponent(target.split('/').filter(Boolean).pop() ?? 'file');
      const dest = path.join(dir, name);
      if (fs.existsSync(dest)) {
        // 目标已存在：{path}（未覆盖）
        sendJson(res, 200, { ok: false, error: t('srv.repoSaveExists', { path: dest }) });
        return true;
      }
      fs.writeFileSync(dest, buf);
      sendJson(res, 200, { ok: true, path: dest });
    } catch (e) {
      sendJson(res, 200, { ok: false, error: (e as Error).message });
    }
    return true;
  }

  if (p === '/api/repo-checkout' && req.method === 'POST') {
    // 仓库浏览右键「检出到本地」：URL 直连检出工作副本（不依赖已打开项目）。
    // 凭据：本次请求带的临时凭据优先（**只本次用、绝不落盘**），否则用已保存的 SVN 账号；
    // 两者都没有 = 匿名裸跑。认证失败按 authError 返回（带 user 供前端拼"当前账号无权限"），
    // 由前端弹凭据框重试——"开跑即验"：有权限的人不弹任何框。
    const body = await readBody(req);
    const targetUrl = String(body.url ?? '').trim();
    const dir = String(body.dir ?? '').trim();
    const name = String(body.name ?? '').trim();
    if (!URL_OK.test(targetUrl) || !dir || !name) {
      // 仓库地址无效（仅支持 svn / http(s) / file）
      sendJson(res, 400, { error: t('srv.badRepoUrl') });
      return true;
    }
    const target = path.join(dir, name);
    // 上次同目标的半截检出没清干净（或服务重启丢了记录）：开始时先清一遍
    if (coLeftovers.has(target)) cleanCoTarget(target);
    let existedBefore = fs.existsSync(target);
    if (existedBefore) {
      try {
        const entries = fs.readdirSync(target);
        if (entries.length === 1 && entries[0] === '.svn') {
          // 只有 .svn 一个条目 = 上次检出中断留下的残骸（必然检出失败）；清掉继续
          cleanCoTarget(target);
          existedBefore = false;
        } else if (entries.length > 0) {
          // 目标目录已存在且非空：{path}
          sendJson(res, 200, { ok: false, message: t('srv.coTargetExists', { path: target }) });
          return true;
        }
        // 空目录：留给 svn 检出进去（existedBefore=true → 失败/取消时一个字节都不动）
      } catch {
        /* 读不到就按原样交给 svn，让它报自己的错 */
      }
    }
    // 凭据解析：本次请求带的临时凭据（重试用）优先，否则已保存配置，都没有 = 匿名裸跑。
    // 临时凭据**只用于本次检出**：加 --no-auth-cache，连 svn 自己的 auth 缓存都不写入
    //（非交互模式默认会存——"下次悄悄记住"违背"只本次用"的决策）；配置凭据/匿名沿用 svn 默认。
    const cfg = loadConfig();
    const tempCred =
      typeof body.username === 'string' && body.username
        ? { username: body.username, password: String(body.password ?? '') }
        : null;
    const cred = tempCred ?? (cfg.svn.username ? { username: cfg.svn.username, password: cfg.svn.password } : null);
    // **客户端断开要真的停**：用户点「取消」/关弹窗 → 断开请求 → 这里把 svn 一起杀掉并清半截目录。
    // ⚠ 必须听 **res** 的 close，不能听 req 的：请求体已被 readBody 读完，req 的 'close' 早已触发
    // （挂上去等于空放）——详见 index.ts 克隆段的同款注释。
    const ac = new AbortController();
    const onClose = () => ac.abort();
    res.on('close', onClose);
    /** 失败/取消清半截目录：只清"这次刚建出来的"，原本就存在的（哪怕空的）一个字节都不动 */
    const cleanup = () => {
      if (!existedBefore) cleanCoTarget(target);
    };
    const args = ['checkout', '-q', '--non-interactive'];
    if (cred) args.push('--username', cred.username, '--password-from-stdin');
    if (tempCred) args.push('--no-auth-cache');
    if (cfg.svn.trustServerCert) args.push('--trust-server-cert');
    args.push(targetUrl, target);
    let r: RunResult;
    try {
      r = await run(await resolveSvnBin(), args, {
        cwd: os.tmpdir(),
        stdinData: cred ? cred.password + '\n' : undefined,
        timeoutMs: 600_000, // 与「获取仓库」一致：大仓库首次检出常常要几分钟
        signal: ac.signal,
      });
    } catch (e) {
      res.off('close', onClose);
      cleanup();
      sendJson(res, 200, { ok: false, message: (e as Error).message });
      return true;
    }
    res.off('close', onClose);
    // aborted（用户取消/断开）与 timedOut（到 10 分钟上限）都要判——只判一个会把另一种当普通失败
    if (r.aborted || r.timedOut) {
      cleanup();
      sendJson(res, 200, {
        ok: false,
        // 已取消获取 / 获取超时（超过 {sec} 秒），已停止
        message: r.timedOut ? t('srv.cloneTimeout', { sec: 600 }) : t('srv.cloneCancelled'),
      });
      return true;
    }
    if (r.code === 0) {
      // 已检出 SVN 工作副本 {path}
      sendJson(res, 200, { ok: true, message: t('srv.svnCheckedOut', { path: target }), repoDir: target });
      return true;
    }
    cleanup();
    const auth = SVN_AUTH_FAIL.test(r.stdout + r.stderr);
    sendJson(res, 200, {
      ok: false,
      message: r.stderr.trim() || r.stdout.trim() || 'svn checkout failed',
      // authError 时带 user = 本次实际使用的账号（空串 = 匿名）：前端拼「当前账号[X]没有获取该仓库权限」
      ...(auth ? { authError: true, user: cred?.username ?? '' } : {}),
    });
    return true;
  }

  return false;
}
