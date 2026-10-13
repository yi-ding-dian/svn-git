/** SVN 仓库浏览（不 checkout 直接看远程，Tortoise Repo-Browser 的角色）：
 *  `list -v` / `cat` 两条只读命令，URL 直连（无工作副本模式）——凭据复用 loadConfig 的 svn 配置。
 *  安全：协议白名单 + 命令白名单（只有 list/cat）+ cat 大小上限；绝不做写操作。 */
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { XMLParser } from 'fast-xml-parser';
import { run } from '../../vcs/exec.js';
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

  return false;
}
