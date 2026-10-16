/** SVN 仓库浏览（不 checkout 直接看远程，Tortoise Repo-Browser 的角色）：
 *  `list -v` / `cat` 两条只读命令，URL 直连（无工作副本模式）——凭据复用 loadConfig 的 svn 配置。
 *  安全：协议白名单 + 命令白名单（只有 list/cat）+ cat 大小上限；绝不做写操作。 */
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { XMLParser } from 'fast-xml-parser';
import { run, runStream, type RunResult } from '../../vcs/exec.js';
import { resolveSvnBin } from '../../vcs/svn.js';
import { loadConfig } from '../../config.js';
import { decodeMixedText } from '../../shared/text.js';
import { sendJson, readBody, isBinaryFile, type Ctx } from './util.js';
import { progressStart, progressDone, progressReport } from '../../transfer-progress.js';
import { t } from '../../shared/i18n/index.js';

const xml = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });

/** 允许浏览的 URL 协议（只读场景） */
const URL_OK = /^(svn|https?|file):\/\//i;

/** 跑一条只读 svn 命令（URL 直连、无工作副本模式；cwd 用 tmp——这些命令不依赖工作目录） */
async function svnRun(args: string[], opt: { timeoutMs?: number; raw?: boolean; maxBuffer?: number } = {}) {
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
    maxBuffer: opt.maxBuffer,
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

/** 递归统计目录下已落盘文件数与字节（跳过 .svn 元数据）。svn 检出没有 --progress，
 *  周期扫盘估算"已检出多少文件 / 多大"用；竞态（文件正写入/刚被清）静默跳过。 */
async function scanDirStat(dir: string): Promise<{ files: number; bytes: number }> {
  let files = 0;
  let bytes = 0;
  const walk = async (d: string): Promise<void> => {
    let ents: fs.Dirent[];
    try {
      ents = await fs.promises.readdir(d, { withFileTypes: true });
    } catch {
      return; // 目录刚被清理/不可读：跳过
    }
    for (const e of ents) {
      if (e.name === '.svn') continue;
      const full = path.join(d, e.name);
      if (e.isDirectory()) {
        await walk(full);
      } else if (e.isFile()) {
        try {
          const st = await fs.promises.stat(full);
          files += 1;
          bytes += st.size;
        } catch {
          /* 正在写入或被删：跳过 */
        }
      }
    }
  };
  await walk(dir);
  return { files, bytes };
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

/** 内容级二进制探测：前 8KB 出现 NUL 字节，或非文本控制字符占比过高（>30%）。
 *  兜住"扩展名不在 BINARY_EXTS 表里"的二进制（如 .emmx / 无扩展名）——光看扩展名会漏。
 *  UTF-8 / GBK 的中文多字节都 ≥0x80，不会落进控制字符区间，不误判（只扫前 8KB，微秒级） */
function looksBinary(buf: Buffer): boolean {
  const n = Math.min(buf.length, 8192);
  let odd = 0;
  for (let i = 0; i < n; i++) {
    const b = buf[i]!;
    if (b === 0) return true; // NUL 一票否决（文本文件不会有）
    if (b < 9 || (b > 13 && b < 32)) odd++; // 允许 \t \n \r；其余控制字符计入
  }
  return n > 0 && odd / n > 0.3;
}

/** 远程搜索：单次最多返回的匹配数——也是"匹配够数就早停杀进程"的阈值 */
const SEARCH_LIMIT = 200;
/** 流式搜索时长上限：超时也返回已收集的匹配（结果带 truncated:'time'） */
const SEARCH_TIMEOUT_MS = 20_000;
/** 全量缓存：单目录最多缓存的行数（超过不缓存——下次重新流式搜） */
const CACHE_MAX_LINES = 50_000;
/** 缓存目录数上限（超出淘汰最早放入的） */
const CACHE_DIRS = 8;
/** 缓存有效期（仓库内容可能在别处变化，过期重拉） */
const CACHE_TTL_MS = 10 * 60_000;

/** 递归搜索缓存：目录 URL → svn ls -R 的全量行。只在流**完整跑完**时写入
 *  （早停/超时的那次不完整，不缓存）。命中缓存后同目录搜索是内存过滤，毫秒级。 */
const searchCache = new Map<string, { lines: string[]; at: number }>();

function searchCacheGet(key: string): string[] | null {
  const e = searchCache.get(key);
  if (!e) return null;
  if (Date.now() - e.at > CACHE_TTL_MS) {
    searchCache.delete(key);
    return null;
  }
  return e.lines;
}

function searchCachePut(key: string, lines: string[]): void {
  if (searchCache.size >= CACHE_DIRS) {
    // Map 迭代序 = 插入序：删最早放入的那个
    const oldest = searchCache.keys().next().value;
    if (oldest !== undefined) searchCache.delete(oldest);
  }
  searchCache.set(key, { lines, at: Date.now() });
}

/** 检出大小检测缓存：url|include → 累计结果。只在**完整扫完**（无 partial）时写入。
 *  大仓库全扫一次 36~70s，重复点「检测大小」（如勾选前后对比）命中缓存秒出；TTL 同搜索缓存。 */
const SIZE_CACHE_MAX = 32;
const sizeCache = new Map<string, { files: number; dirs: number; bytes: number; at: number }>();

function sizeCacheGet(key: string): { files: number; dirs: number; bytes: number } | null {
  const e = sizeCache.get(key);
  if (!e) return null;
  if (Date.now() - e.at > CACHE_TTL_MS) {
    sizeCache.delete(key);
    return null;
  }
  return { files: e.files, dirs: e.dirs, bytes: e.bytes };
}

function sizeCachePut(key: string, v: { files: number; dirs: number; bytes: number }): void {
  if (sizeCache.size >= SIZE_CACHE_MAX) {
    const oldest = sizeCache.keys().next().value;
    if (oldest !== undefined) sizeCache.delete(oldest);
  }
  sizeCache.set(key, { ...v, at: Date.now() });
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

  if (p === '/api/repo-search' && req.method === 'GET') {
    // 远程递归搜索（仓库浏览的"搜索/列出当前目录所有文件"）：svn ls -R 流式逐行过滤——
    // 匹配够 SEARCH_LIMIT 条**立即杀进程早停**（大目录不必遍历完，常见词一两秒就有）；
    // 单次最多 SEARCH_TIMEOUT_MS，超时返回已收集的（truncated:'time'）。
    // 完整跑完的目录全量缓存：之后同目录搜索是内存过滤，毫秒级（truncated:'limit' 仅是显示截断）。
    const target = String(url.searchParams.get('url') ?? '').trim().replace(/\/+$/, '');
    const q = String(url.searchParams.get('q') ?? '').trim();
    if (!URL_OK.test(target)) {
      // 仓库地址无效（仅支持 svn / http(s) / file）
      sendJson(res, 400, { error: t('srv.badRepoUrl') });
      return true;
    }
    if (!q) {
      sendJson(res, 200, { ok: true, items: [] });
      return true;
    }
    const ql = q.toLowerCase();
    /** 行 → 条目（svn ls -R：目录行尾带 /） */
    const toItem = (line: string): { path: string; isDir: boolean } =>
      line.endsWith('/') ? { path: line.slice(0, -1), isDir: true } : { path: line, isDir: false };
    /** 缓存命中路径：内存过滤；超上限截断（more = 还有更多匹配没显示） */
    const pick = (lines: string[]): { items: { path: string; isDir: boolean }[]; more: boolean } => {
      const items: { path: string; isDir: boolean }[] = [];
      for (const l of lines) {
        if (!l.toLowerCase().includes(ql)) continue;
        if (items.length >= SEARCH_LIMIT) return { items, more: true };
        items.push(toItem(l));
      }
      return { items, more: false };
    };
    const cached = searchCacheGet(target);
    if (cached) {
      const { items, more } = pick(cached);
      sendJson(res, 200, { ok: true, items, ...(more ? { truncated: 'limit' } : {}) });
      return true;
    }
    // 未缓存：流式拉取（凭据同 svnRun；非 --xml 的纯文本模式输出"相对路径行"，可逐行过滤）
    const cfg = loadConfig();
    const args: string[] = [];
    if (cfg.svn.username) args.push('--username', cfg.svn.username, '--password-from-stdin', '--non-interactive');
    if (cfg.svn.trustServerCert) args.push('--trust-server-cert');
    args.push('list', '-R', target);
    // 前端断开（清空输入/关弹窗）→ 杀掉 svn（与检出同一套 close→abort 机制）
    const ac = new AbortController();
    const onClose = () => ac.abort();
    res.on('close', onClose);
    const items: { path: string; isDir: boolean }[] = [];
    const lines: string[] = [];
    /** 行数超缓存上限：不再收集（缓存放弃），流继续跑（匹配与超时规则不变） */
    let overflowed = false;
    /** 早停（匹配满上限杀的进程）：结果不完整，不缓存 */
    let early = false;
    let r: RunResult;
    try {
      r = await runStream(await resolveSvnBin(), args, {
        cwd: os.tmpdir(),
        stdinData: cfg.svn.username ? cfg.svn.password + '\n' : undefined,
        timeoutMs: SEARCH_TIMEOUT_MS,
        signal: ac.signal,
        onLine: (line) => {
          if (!line) return;
          if (!overflowed) {
            if (lines.length >= CACHE_MAX_LINES) {
              overflowed = true;
              lines.length = 0; // 大目录不缓存：尽早把内存还掉
            } else {
              lines.push(line);
            }
          }
          if (line.toLowerCase().includes(ql)) items.push(toItem(line));
          if (items.length >= SEARCH_LIMIT) {
            early = true;
            return true; // 够数：不等它跑完
          }
        },
      });
    } catch (e) {
      res.off('close', onClose);
      sendJson(res, 200, { ok: false, error: (e as Error).message });
      return true;
    }
    res.off('close', onClose);
    if (r.aborted) return true; // 前端已断开：响应没处发（svn 已被杀掉）
    if (r.timedOut) {
      sendJson(res, 200, { ok: true, items, truncated: 'time' });
      return true;
    }
    if (!early && r.code !== 0) {
      sendJson(res, 200, { ok: false, error: r.stderr.trim() || 'svn list failed' });
      return true;
    }
    if (early) {
      sendJson(res, 200, { ok: true, items, truncated: 'limit' });
      return true;
    }
    // 完整跑完：缓存全量（超上限的不缓存——下次重新流式搜）
    if (!overflowed) searchCachePut(target, lines);
    sendJson(res, 200, { ok: true, items });
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
    // 二进制判定**优先于**"文件太大"：文档/图片/压缩包无论多大都是"不支持浏览"
    //（用户实报：7.5MB 的 .doc 只提示"文件太大"，没说清是根本没法预览）。
    // 扩展名已知的二进制**连下载都不必**（省一次 7.5MB 的白拉）——先判、直接返回
    if (isBinaryFile(target)) {
      sendJson(res, 200, { ok: true, binary: true });
      return true;
    }
    try {
      const r = await svnRun(['cat', target], { raw: true });
      if (r.code !== 0) {
        sendJson(res, 200, { ok: false, error: r.stderr.trim() || 'svn cat failed' });
        return true;
      }
      const buf = r.stdoutBuf ?? Buffer.from(r.stdout ?? '', 'utf8');
      // 内容探测也在"太大"之前：表外扩展名的二进制（如 .emmx）同样报"不支持浏览"
      if (looksBinary(buf)) {
        sendJson(res, 200, { ok: true, binary: true });
        return true;
      }
      // 走到这里都是**文本**——太大才提示"文件太大"（请用「下载到…」）
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
    // 选择性检出（SVN 深度检出）：前端树勾选的**相对路径**（可多级，如 branches/AnHui）——勾了
    // 则只检出勾选项，未勾选的连空壳都不留（--set-depth exclude），且后续 update 也只更新勾选的
    // （SVN 深度机制的固有行为——"其他目录不检测更新"由此天然成立）。空/缺省 = 完整检出（原行为）。
    // 路径来自前端：逐段校验（每段非空、非 . / ..——防路径穿越）；勾了父又勾子时去掉子（父已覆盖）
    const include = ((): string[] => {
      if (!Array.isArray(body.include)) return [];
      const norm = (body.include as unknown[])
        .map(String)
        .map((s) => s.replace(/\\/g, '/').replace(/^\/+|\/+$/g, ''))
        .map((s) => s.split('/').filter((seg) => seg && seg !== '.' && seg !== '..'))
        .filter((segs) => segs.length > 0)
        .map((segs) => segs.join('/'));
      const uniq = [...new Set(norm)].sort((a, b) => a.split('/').length - b.split('/').length);
      return uniq.filter((p, i) => !uniq.slice(0, i).some((q) => p === q || p.startsWith(q + '/')));
    })();
    /** 每条 svn 命令的公共网络参数（凭据/证书选项与既有检出完全一致）。
     *  -q 由各命令自加：svn list 不接受 -q（实测），不能混进公共组 */
    const svnNet = () => {
      const a = ['--non-interactive'];
      if (cred) a.push('--username', cred.username, '--password-from-stdin');
      if (tempCred) a.push('--no-auth-cache');
      if (cfg.svn.trustServerCert) a.push('--trust-server-cert');
      return a;
    };
    const runOpts = {
      cwd: os.tmpdir(),
      stdinData: cred ? cred.password + '\n' : undefined,
      timeoutMs: 600_000, // 与「获取仓库」一致：大仓库首次检出常常要几分钟
      signal: ac.signal,
    };
    // 进度：登记到传输进度表（chan = target，与「获取仓库」同语义）——svn 检出没有 --progress，
    // 文件数/字节靠周期扫盘已落盘内容估算（1.5s 一次 + 防重叠）；只影响展示，扫不动就跳过
    progressStart(target);
    let scanning = false;
    const scanTimer = setInterval(() => {
      if (scanning) return;
      scanning = true;
      void scanDirStat(target)
        .then(({ files, bytes }) => progressReport(target, files, bytes))
        .catch(() => {
          /* 这一轮扫不动就跳过 */
        })
        .finally(() => {
          scanning = false;
        });
    }, 1500);
    // —— 检出结果收集（任务详情窗展示：文件清单 + svn 警告）——
    const coFiles: { code: string; path: string }[] = [];
    let coTotal = 0;
    const coWarnings: string[] = [];
    /** 收集一条检出命令的输出：stdout 里 `A/U 路径` 行 → 清单（上限 2000 条，路径转相对 target；
     *  超出只计总数）；stderr 非空行 → svn 警告（上限 50 条）。检出命令一律不加 -q——清单就靠这些行。 */
    const collectR = (rr: RunResult): RunResult => {
      for (const raw of rr.stdout.split('\n')) {
        const m = /^([ADUGECR])\s+(.+)$/.exec(raw);
        if (!m) {
          // 非状态行里的"警告类"（Skipped 'path' -- … 等，常见于外部定义失败）：归入警告区
          const s = raw.trim();
          if (s && /^(Skipped|Warning|W\d{6})/i.test(s) && coWarnings.length < 50) coWarnings.push(s);
          continue;
        }
        coTotal += 1;
        if (coFiles.length >= 2000) continue;
        const p = m[2]!;
        // svn 输出的路径是**相对 cwd** 的（cwd=os.tmpdir）——先转绝对再裁成相对 target 的干净路径
        const abs = path.resolve(os.tmpdir(), p);
        coFiles.push({ code: m[1]!, path: abs.startsWith(target + path.sep) ? abs.slice(target.length + 1) : p });
      }
      for (const line of rr.stderr.split('\n')) {
        const s = line.trim();
        // 全收（含 E 错误行）：失败 message 只留第一行摘要，完整多行信息这里是唯一的完整展示位
        if (s && coWarnings.length < 50) coWarnings.push(s);
      }
      return rr;
    };
    let r: RunResult;
    try {
      const bin = await resolveSvnBin();
      /** 检出期跑一条 svn 命令（不加 -q：要 stdout 的文件行做清单） */
      const runCo = async (args: string[]): Promise<RunResult> => collectR(await run(bin, args, runOpts));
      if (include.length === 0) {
        // 完整检出（原行为，单条命令）
        r = await runCo(['checkout', ...svnNet(), targetUrl, target]);
      } else {
        // 稀疏检出：勾选路径可任意深（branches/AnHui/…）。步骤：
        //   1) 空深度检出 → 根文件（files）
        //   2) 根 + 勾选路径的**祖先目录**逐个物化子项（immediates，浅→深）——祖先不出空壳，
        //      深处的 infinity 到不了
        //   3) 勾选目录全量加深（infinity，浅→深）
        //   4) 回到每个物化目录：远程列直接子目录，不在保留集（勾选项 + 祖先链）的**批量** exclude
        //      （空壳也去掉，后续 update 不拉；一条 update 多目标，避免逐个子进程调用）
        // 任一步失败即整体失败（走既有 cleanup 清半截目录）
        r = await runCo(['checkout', '--depth', 'empty', ...svnNet(), targetUrl, target]);
        if (r.code === 0) r = await runCo(['update', '--depth', 'files', ...svnNet(), target]);
        const byDepth = (a: string, b: string) => a.split('/').length - b.split('/').length;
        const ancestors = new Set<string>();
        for (const inc of include) {
          const segs = inc.split('/');
          for (let i = 1; i < segs.length; i++) ancestors.add(segs.slice(0, i).join('/'));
        }
        /** 要保留的目录（相对路径全集）：勾选项 + 其祖先链 */
        const keep = new Set([...include, ...ancestors]);
        /** 需要物化的目录：根（''）+ 祖先链（浅→深，先物化父链） */
        const materialize = ['', ...[...ancestors].sort(byDepth)];
        for (const dir of materialize) {
          if (r.code !== 0) break;
          r = await runCo(['update', '--set-depth', 'immediates', ...svnNet(), dir ? path.join(target, dir) : target]);
        }
        for (const inc of [...include].sort(byDepth)) {
          if (r.code !== 0) break;
          r = await runCo(['update', '--set-depth', 'infinity', ...svnNet(), path.join(target, inc)]);
        }
        // 拼接远程 URL 用去尾斜杠的 base（targetUrl 未规范化过，双斜杠 URL 可能被 svn 拒）
        const baseUrl = targetUrl.replace(/\/+$/, '');
        for (const dir of materialize) {
          if (r.code !== 0) break;
          const dirUrl = dir ? `${baseUrl}/${dir}` : baseUrl;
          // svn list 输出里目录带尾斜杠；列不到就跳过（不致命——该层权限/瞬时网络问题不该毁整次检出）
          const ls = await run(bin, [...svnNet(), 'list', dirUrl], { ...runOpts, timeoutMs: 60_000 });
          if (ls.code !== 0) continue;
          const drops = ls.stdout
            .split('\n')
            .map((s) => s.trim())
            .filter((s) => s.endsWith('/'))
            .map((s) => s.slice(0, -1))
            .filter((name) => !keep.has(dir ? `${dir}/${name}` : name))
            .map((name) => path.join(target, dir, name));
          if (drops.length > 0) r = await run(bin, ['update', '-q', '--set-depth', 'exclude', ...svnNet(), ...drops], runOpts);
        }
      }
    } catch (e) {
      res.off('close', onClose);
      cleanup();
      sendJson(res, 200, { ok: false, message: (e as Error).message, files: coFiles, fileTotal: coTotal, warnings: coWarnings });
      return true;
    } finally {
      // 检出段结束（成功/失败/取消）：停扫盘、撤进度登记
      clearInterval(scanTimer);
      progressDone(target);
    }
    res.off('close', onClose);
    // aborted（用户取消/断开）与 timedOut（到 10 分钟上限）都要判——只判一个会把另一种当普通失败
    if (r.aborted || r.timedOut) {
      cleanup();
      sendJson(res, 200, {
        ok: false,
        // 已取消获取 / 获取超时（超过 {sec} 秒），已停止
        message: r.timedOut ? t('srv.cloneTimeout', { sec: 600 }) : t('srv.cloneCancelled'),
        // 部分结果也带回：详情窗能看到"取消/超时前检到哪了"
        files: coFiles,
        fileTotal: coTotal,
        warnings: coWarnings,
      });
      return true;
    }
    if (r.code === 0) {
      // 已检出 SVN 工作副本 {path}
      sendJson(res, 200, {
        ok: true,
        message: t('srv.svnCheckedOut', { path: target }),
        repoDir: target,
        // 检出结果详情（任务详情窗列清单/警告用；files 超 2000 条截断，fileTotal 是全量数）
        files: coFiles,
        fileTotal: coTotal,
        warnings: coWarnings,
      });
      return true;
    }
    // externals 处理失败（E205011）**不算整体失败**：主内容已完整检出、只是外部引用没拉下来——
    // 工作副本已建立（.svn 在）就按成功返回（✓ + 详情黄框警告）。否则用户看到"工作副本明明可用
    // 却打红✗"，还连带丢掉"收录最近项目 / 降落动画"（都只在成功路径走）——用户实报
    if (/E205011/.test(r.stderr) && fs.existsSync(path.join(target, '.svn'))) {
      sendJson(res, 200, {
        ok: true,
        message: t('srv.svnCheckedOutExternals', { path: target }),
        repoDir: target,
        files: coFiles,
        fileTotal: coTotal,
        warnings: coWarnings,
      });
      return true;
    }
    cleanup();
    const auth = SVN_AUTH_FAIL.test(r.stdout + r.stderr);
    // 失败 message 取**最后一条 E 行**（svn 的总结行；先 W 警告后 E 错误的场景第一行不是根因），
    // 没有 E 行退回第一行；截 300。完整多行 stderr 由 warnings 带回（详情窗统一展示，避免重复）
    const failLines = r.stderr.split('\n').map((s) => s.trim()).filter(Boolean);
    const failLine = [...failLines].reverse().find((l) => /svn: E/.test(l)) ?? failLines[0] ?? r.stdout.trim();
    sendJson(res, 200, {
      ok: false,
      message: failLine.slice(0, 300) || 'svn checkout failed',
      // 失败/认证失败也带回部分结果（详情窗可见检到哪、有什么警告）
      files: coFiles,
      fileTotal: coTotal,
      warnings: coWarnings,
      // authError 时带 user = 本次实际使用的账号（空串 = 匿名）：前端拼「当前账号[X]没有获取该仓库权限」
      ...(auth ? { authError: true, user: cred?.username ?? '' } : {}),
    });
    return true;
  }

  if (p === '/api/repo-size' && req.method === 'GET') {
    // 检出大小检测（检出弹窗「检测大小」按钮按需触发）：**流式 NDJSON**——边扫边推当前累计
    // （每 ~400ms 一行 {files,dirs,bytes}，前端数字实时滚动不显得卡死），最后一行 {done:true,...}。
    // 范围：include（逗号分隔的多级相对路径）非空 = 只算勾选子树 + 根文件；空 = 整个 URL 全树。
    // 大仓库单进程遍历慢（实测 4 万文件 ~70s）：按一级目录 8 路并行（实测 → 36s；瓶颈是最大
    // 子树自身的遍历耗时，再往深拆收益低）。任一路失败记 partial 不中断。断开（取消/关弹窗）→
    // signal 杀全部子进程（与检出同款"断开即停"）。完整扫完的结果缓存（TTL 同搜索缓存）。
    const target = String(url.searchParams.get('url') ?? '').trim().replace(/\/+$/, '');
    if (!URL_OK.test(target)) {
      // 仓库地址无效（仅支持 svn / http(s) / file）
      sendJson(res, 400, { error: t('srv.badRepoUrl') });
      return true;
    }
    const include = String(url.searchParams.get('include') ?? '')
      .split(',')
      .map((s) => {
        try {
          return decodeURIComponent(s);
        } catch {
          return s;
        }
      })
      .map((s) => s.replace(/\\/g, '/').replace(/^\/+|\/+$/g, ''))
      .filter((s) => s && s.split('/').every((seg) => seg && seg !== '.' && seg !== '..'));
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store' });
    const cacheKey = `${target}|${[...include].sort().join(',')}`;
    const cached = sizeCacheGet(cacheKey);
    if (cached) {
      res.end(JSON.stringify({ done: true, cached: true, ...cached }) + '\n');
      return true;
    }
    const ac = new AbortController();
    const onClose = () => ac.abort();
    res.on('close', onClose);
    /** 累计（onLine 回调在主线程同步累加，无竞态）；dirs 从 1 起 = 根目录自身 */
    const total = { files: 0, dirs: 1, bytes: 0 };
    let partial = false;
    /** 定时推当前累计（连接断了 ac 会杀子进程，这里的写静默失败即可） */
    const timer = setInterval(() => {
      if (!res.writableEnded) res.write(JSON.stringify({ ...total }) + '\n');
    }, 400);
    void (async () => {
      const finish = (end: string) => {
        clearInterval(timer);
        res.off('close', onClose);
        if (!res.writableEnded) res.end(end);
      };
      try {
        const bin = await resolveSvnBin();
        const cfg = loadConfig();
        const net: string[] = ['--non-interactive'];
        if (cfg.svn.username) net.push('--username', cfg.svn.username, '--password-from-stdin');
        if (cfg.svn.trustServerCert) net.push('--trust-server-cert');
        const baseOpts = {
          cwd: os.tmpdir(),
          stdinData: cfg.svn.username ? cfg.svn.password + '\n' : undefined,
          signal: ac.signal,
          timeoutMs: 15 * 60_000,
        };
        /** 递归输出行 → 累计（每个文件一行 <size>，每个目录一行 kind="dir"） */
        const count = (line: string) => {
          const sz = /^<size>(\d+)<\/size>$/.exec(line.trim());
          if (sz) {
            total.files += 1;
            total.bytes += Number(sz[1]);
          } else if (line.includes('kind="dir"')) {
            total.dirs += 1;
          }
        };
        // 1) 根级一次 list（非递归、快）：根文件入账；整仓模式的并行任务 = 一级目录（勾选模式不用它）
        const topDirs: string[] = [];
        let lastKind = '';
        await runStream(bin, [...net, 'list', '--xml', target], {
          ...baseOpts,
          timeoutMs: 60_000,
          onLine: (line) => {
            if (line.includes('kind="dir"')) lastKind = 'dir';
            else if (line.includes('kind="file"')) lastKind = 'file';
            else if (/^<size>(\d+)<\/size>$/.test(line.trim())) count(line);
            else if (lastKind === 'dir') {
              const nm = /<name>([\s\S]*?)<\/name>/.exec(line);
              if (nm && include.length === 0) {
                total.dirs += 1;
                topDirs.push(nm[1]!);
              }
            }
          },
        });
        // 2) 并行扫（8 路）：整仓 = 一级目录；勾选 = 勾选路径本身（并补勾选顶级的目录计数）
        if (include.length > 0) total.dirs += new Set(include.map((inc) => inc.split('/')[0])).size;
        const tasks = include.length > 0 ? include.map((inc) => `${target}/${inc}`) : topDirs.map((d) => `${target}/${d}`);
        let next = 0;
        const worker = async () => {
          for (;;) {
            if (ac.signal.aborted) return;
            const i = next++;
            if (i >= tasks.length) return;
            const rr = await runStream(bin, [...net, 'list', '--xml', '-R', tasks[i]!], { ...baseOpts, onLine: count });
            if (rr.aborted) return;
            if (rr.code !== 0) partial = true;
          }
        };
        await Promise.all(Array.from({ length: Math.min(8, Math.max(1, tasks.length)) }, worker));
        if (ac.signal.aborted) return finish('');
        if (!partial) sizeCachePut(cacheKey, { files: total.files, dirs: total.dirs, bytes: total.bytes });
        finish(JSON.stringify({ done: true, partial, ...total }) + '\n');
      } catch (e) {
        finish(JSON.stringify({ error: (e as Error).message }) + '\n');
      }
    })();
    return true;
  }

  if (p === '/api/repo-download' && req.method === 'GET') {
    // 原始文件**全量**下载（「下载」按钮用）：预览 cat 有 2MB 上限，下载不受限——
    // 直接返回二进制流（前端 fetch 后 pipeTo 浏览器原生「另存为」）。
    // 注意失败必须用**非 2xx**（前端按 res.ok 判断——200+JSON 会被当文件内容写进去）。
    const target = String(url.searchParams.get('url') ?? '').trim();
    if (!URL_OK.test(target)) {
      // 仓库地址无效（仅支持 svn / http(s) / file）
      sendJson(res, 400, { error: t('srv.badRepoUrl') });
      return true;
    }
    try {
      // buffer 上限 1GB（本地工具够用；超大文件会被截断——后续可改流式）
      const r = await svnRun(['cat', target], { raw: true, timeoutMs: 600_000, maxBuffer: 1024 * 1024 * 1024 });
      if (r.code !== 0) {
        sendJson(res, 500, { error: r.stderr.trim() || 'svn cat failed' });
        return true;
      }
      const buf = r.stdoutBuf ?? Buffer.from(r.stdout ?? '', 'utf8');
      const name = decodeURIComponent(target.split('/').filter(Boolean).pop() ?? 'file');
      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        // filename*（RFC5987，支持中文名）供浏览器提示；前端用 saveFilePicker 的 suggestedName 为主
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
        'Content-Length': String(buf.length),
        'Cache-Control': 'no-store',
      });
      res.end(buf);
    } catch (e) {
      sendJson(res, 500, { error: (e as Error).message });
    }
    return true;
  }

  return false;
}
