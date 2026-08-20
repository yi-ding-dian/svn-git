/** HTTP 服务：REST API（复用 vcs 层）+ 静态文件。只监听 127.0.0.1 */
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import type { AddressInfo } from 'node:net';
import { detectCwd, detectRepo } from './vcs/detect.js';
import { createVcs, type RepoInfo, type VcsResult } from './vcs/index.js';
import { run } from './vcs/exec.js';
import { loadConfig, saveConfig } from './config.js';
import type { SvnCred } from './vcs/svn.js';

/** 前端静态目录：开发 = 项目根/dist/web；打包 = asar 内 dist/web */
const WEB_DIR = path.resolve(import.meta.dirname ?? '.', 'web');
/** 启动目录（Electron 传入） */
const START_DIR = process.env.SVNKIT_DIR ?? process.cwd();

export interface ServerHandle {
  port: number;
  url: string;
  close: () => Promise<void>;
}

/** 系统目录选择器（Electron dialog 注入；纯 node 为 null） */
let pickDirHandler: (() => Promise<string | null>) | null = null;
export function setPickDirHandler(fn: () => Promise<string | null>): void {
  pickDirHandler = fn;
}

/** 最近打开的项目历史（服务端持久化：浏览器端口随机，localStorage 不可靠） */
const HISTORY_PATH = path.join(os.homedir(), '.config', 'svnkit', 'history.json');
const HISTORY_MAX = 20;

export interface HistoryItem {
  path: string;
  type: 'svn' | 'git';
  lastOpened: number;
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

function addHistory(entry: { path: string; type: 'svn' | 'git' }): void {
  try {
    const list = loadHistory().filter((h) => h.path !== entry.path);
    list.unshift({ ...entry, lastOpened: Date.now() });
    fs.mkdirSync(path.dirname(HISTORY_PATH), { recursive: true });
    fs.writeFileSync(HISTORY_PATH, JSON.stringify(list.slice(0, HISTORY_MAX), null, 2));
    fs.chmodSync(HISTORY_PATH, 0o600); // 与 config 一致，仅本人可读写
  } catch {
    /* 忽略写失败 */
  }
}

function repoInfo(): RepoInfo | null {
  const dir = process.env.SVNKIT_REPO_DIR ?? START_DIR;
  return detectRepo(dir);
}

function vcsOf(): { vcs: ReturnType<typeof createVcs>; repo: RepoInfo } {
  const repo = repoInfo();
  if (!repo) throw new Error('NO_REPO');
  const cfg = loadConfig();
  const cred: SvnCred | null = cfg.svn.username
    ? { username: cfg.svn.username, password: cfg.svn.password, trustServerCert: cfg.svn.trustServerCert }
    : null;
  return { vcs: createVcs(repo, cred), repo };
}

/** 认证失败错误码 */
function isAuthError(err: Error): boolean {
  return /认证失败|E170001|Authentication failed/i.test(err.message);
}

function sendJson(res: http.ServerResponse, code: number, data: unknown) {
  const body = JSON.stringify(data);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

function readBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c: Buffer) => {
      data += c.toString();
      if (data.length > 10 * 1024 * 1024) {
        reject(new Error('body too large'));
      }
    });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        resolve({});
      }
    });
    req.on('error', reject);
  });
}

/** 工作副本状态缓存（5 秒） */
const statusCache = new Map<string, { time: number; items: unknown[] }>();

// ---------- svn:ignore 全量规则缓存 ----------
// 逐目录 propget 太慢(每目录一次 svn 进程 ~30ms)。改为一次 `svn propget svn:ignore -R .`
// 递归拉取全仓库规则(输出格式:<路径> - <规则> 块,空行分隔),缓存 60s,之后所有目录查内存 Map(0 命令)
const SVN_IGNORE_MAP_TTL = 60_000;
const svnIgnoreMapCache = new Map<string, { time: number; map: Map<string, string[]> }>();
const svnIgnoreMapInflight = new Map<string, Promise<Map<string, string[]>>>();
/** 拉取（带缓存）仓库全部 svn:ignore 规则：dir -> rules[] */
function getSvnIgnoreMap(root: string): Promise<Map<string, string[]>> {
  const hit = svnIgnoreMapCache.get(root);
  if (hit && Date.now() - hit.time < SVN_IGNORE_MAP_TTL) return Promise.resolve(hit.map);
  const inflight = svnIgnoreMapInflight.get(root);
  if (inflight) return inflight;
  const p = run('svn', ['propget', 'svn:ignore', '-R', '.'], { cwd: root, timeoutMs: 60_000 }).then((r) => {
    const map = new Map<string, string[]>();
    if (r.code === 0) {
      // 输出:每条目 "<相对路径> - <规则1>\n<规则2>...",块之间空行分隔
      let curPath: string | null = null;
      const rules: string[] = [];
      for (const line of r.stdout.split('\n')) {
        if (!line.trim()) {
          if (curPath) map.set(curPath, rules.slice());
          curPath = null;
          rules.length = 0;
          continue;
        }
        const m = line.match(/^(\S.*?) - (.*)$/);
        if (m && curPath === null) {
          curPath = m[1]!;
          if (m[2]!.trim()) rules.push(m[2]!.trim());
        } else if (curPath !== null) {
          rules.push(line.trim());
        }
      }
      if (curPath) map.set(curPath, rules.slice());
    }
    svnIgnoreMapCache.set(root, { time: Date.now(), map });
    return map;
  });
  svnIgnoreMapInflight.set(root, p);
  void p.finally(() => svnIgnoreMapInflight.delete(root));
  return p;
}
const STATUS_TTL = 30_000;

async function getStatusCached(repo: RepoInfo, force = false): Promise<unknown[]> {
  const key = repo.root;
  const hit = statusCache.get(key);
  if (!force && hit && Date.now() - hit.time < STATUS_TTL) return hit.items;
  const { vcs } = vcsOf();
  const items = await vcs.status();
  statusCache.set(key, { time: Date.now(), items });
  return items;
}

/** 校验绝对路径是否位于仓库根内（防止 ../git-repo-2 这类前缀匹配绕过） */
function inRepoRoot(root: string, abs: string): boolean {
  const rel = path.relative(root, abs);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/** 解析 unified diff 中 BASE 侧的变更位置：del=被删除/修改的行号，ins=插入位置（+ 行对应的 BASE 行号） */
function diffChangedLines(diffText: string): { del: Set<number>; ins: Set<number> } {
  const del = new Set<number>();
  const ins = new Set<number>();
  let cur = 0;
  for (const raw of diffText.split('\n')) {
    const h = raw.match(/^@@ -(\d+)(?:,\d+)?/);
    if (h && h[1]) {
      cur = Number(h[1]);
      continue;
    }
    // 跳过文件头行（svn 的 "--- xxx (版本 34)" / git 的 "--- a/xxx" 与 "+++ b/xxx"）
    // +++ 行以 + 开头，若不跳过会被误判为插入行（且此时行号 cur=0 → 恒误报"文件开头冲突"）
    if (raw.startsWith('---') || raw.startsWith('+++')) continue;
    if (raw.startsWith('-')) {
      del.add(cur);
      cur += 1;
    } else if (raw.startsWith('+')) {
      ins.add(cur); // 在该 BASE 行位置之后插入
    } else if (raw.startsWith(' ')) {
      cur += 1;
    }
  }
  return { del, ins };
}

/** 目录浏览（打开仓库页用）：列目录 + 仓库识别 */
function browseDirs(dir: string): { entries: { name: string; isDir: boolean }[]; repo: RepoInfo | null } {
  const out: { name: string; isDir: boolean }[] = [];
  const cur = path.resolve(dir);
  let entries: string[];
  try {
    entries = fs.readdirSync(cur);
  } catch (err) {
    throw new Error(`无法读取目录: ${(err as Error).message}`);
  }
  if (cur !== '/') out.push({ name: '..', isDir: true });
  const dirs: string[] = [];
  const files: string[] = [];
  for (const n of entries) {
    if (n.startsWith('.')) continue; // 隐藏目录默认过滤
    let isDir = false;
    try {
      isDir = fs.statSync(path.join(cur, n)).isDirectory();
    } catch {
      continue;
    }
    if (isDir) dirs.push(n);
    else files.push(n);
  }
  dirs.sort((a, b) => a.localeCompare(b));
  files.sort((a, b) => a.localeCompare(b));
  for (const d of dirs) out.push({ name: d, isDir: true });
  for (const f of files) out.push({ name: f, isDir: false });
  return { entries: out, repo: detectRepo(cur) };
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

export function startServer(): Promise<ServerHandle> {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const p = url.pathname;

    try {
      // ---------- API ----------
      if (p === '/api/info') {
        let version = '';
        try {
          version = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname ?? '.', '../package.json'), 'utf8')).version ?? '';
        } catch {
          /* ignore */
        }
        const repo = repoInfo();
        if (!repo) {
          sendJson(res, 200, { type: null, root: null, url: null, revOrBranch: null, startDir: START_DIR, home: os.homedir(), version });
          return;
        }
        const { vcs } = vcsOf();
        let url2 = repo.url ?? '';
        let rev = repo.revOrBranch ?? '';
        try {
          if (repo.type === 'svn') {
            const info = await (vcs as any).info();
            url2 = info.url ?? url2;
            rev = info.revision ? `r${info.revision}` : rev;
          } else {
            const [b, r] = await Promise.all([(vcs as any).branch(), (vcs as any).remote()]);
            rev = b || rev;
            url2 = r || url2;
          }
        } catch {
          /* 忽略 */
        }
        sendJson(res, 200, { type: repo.type, root: repo.root, url: url2, revOrBranch: rev, startDir: START_DIR, home: os.homedir(), version });
        return;
      }

      if (p === '/api/browse') {
        const dir = String(url.searchParams.get('path') ?? START_DIR);
        const result = browseDirs(dir);
        sendJson(res, 200, { ...result, dir });
        return;
      }

      if (p === '/api/search') {
        // 文件名搜索：仅搜索指定目录（dir 相对仓库根，默认根目录），深度限制 + 结果上限
        const { repo } = vcsOf();
        const query = url.searchParams.get('query') ?? '';
        const dirRel = url.searchParams.get('dir') ?? '';
        if (!query.trim()) {
          sendJson(res, 200, { paths: [] });
          return;
        }
        const start = path.join(repo.root, dirRel);
        if (!inRepoRoot(repo.root, start)) {
          sendJson(res, 403, { error: '超出工作副本范围' });
          return;
        }
        const q = query.toLowerCase();
        const out: string[] = [];
        const LIMIT = 100;
        const walk = (dir: string, depth: number) => {
          if (depth > 12 || out.length >= LIMIT) return;
          let entries: string[];
          try {
            entries = fs.readdirSync(dir);
          } catch {
            return;
          }
          for (const n of entries) {
            if (n === '.svn' || n === '.git' || n.startsWith('.')) continue;
            const p = path.join(dir, n);
            let st: fs.Stats;
            try {
              st = fs.statSync(p);
            } catch {
              continue;
            }
            if (n.toLowerCase().includes(q)) out.push(path.relative(repo.root, p));
            if (st.isDirectory() && out.length < LIMIT) walk(p, depth + 1);
          }
        };
        walk(start, 0);
        sendJson(res, 200, { paths: out });
        return;
      }

      if (p === '/api/history') {
        if (req.method === 'POST') {
          const body = await readBody(req);
          const hp = String(body.path ?? '');
          const ht = String(body.type ?? '') === 'git' ? 'git' : 'svn';
          if (hp) addHistory({ path: hp, type: ht });
          sendJson(res, 200, { ok: true });
          return;
        }
        sendJson(res, 200, { items: loadHistory() });
        return;
      }

      if (p === '/api/git-info') {
        // Git 信息：分支 / 远程 / 上游 / 最近提交
        const { vcs, repo } = vcsOf();
        if (repo.type !== 'git') {
          sendJson(res, 400, { error: '非 Git 仓库' });
          return;
        }
        sendJson(res, 200, await (vcs as any).gitInfo());
        return;
      }
      if (p === '/api/git-config' && req.method === 'POST') {
        // 配置：设置/修改 origin 远程地址
        const { vcs, repo } = vcsOf();
        const body = await readBody(req);
        const url = String(body.remoteUrl ?? '').trim();
        if (!url) {
          sendJson(res, 400, { error: '远程地址不能为空' });
          return;
        }
        if (repo.type !== 'git') {
          sendJson(res, 400, { error: '非 Git 仓库' });
          return;
        }
        sendJson(res, 200, await (vcs as any).setRemote(url));
        return;
      }
      if (p === '/api/mkdir' && req.method === 'POST') {
        // 目录选择器：新建文件夹
        const body = await readBody(req);
        const dir = String(body.path ?? '');
        if (!dir) {
          sendJson(res, 400, { error: '路径为空' });
          return;
        }
        try {
          fs.mkdirSync(dir);
          sendJson(res, 200, { ok: true });
        } catch (e) {
          sendJson(res, 500, { error: (e as Error).message });
        }
        return;
      }
      if (p === '/api/rename' && req.method === 'POST') {
        // 目录选择器：重命名文件夹
        const body = await readBody(req);
        const from = String(body.from ?? '');
        const to = String(body.to ?? '');
        if (!from || !to) {
          sendJson(res, 400, { error: '路径为空' });
          return;
        }
        try {
          fs.renameSync(from, to);
          sendJson(res, 200, { ok: true });
        } catch (e) {
          sendJson(res, 500, { error: (e as Error).message });
        }
        return;
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
        return;
      }

      if (p === '/api/pick-dir') {
        // 系统目录选择对话框（Electron 打包版可用；纯 node 返回不支持）
        if (!pickDirHandler) {
          sendJson(res, 200, { path: null, unsupported: true });
          return;
        }
        const picked = await pickDirHandler();
        sendJson(res, 200, { path: picked, unsupported: false });
        return;
      }

      if (p === '/api/open') {
        // 打开指定仓库（前端浏览到仓库后点击进入）
        const dir = String(url.searchParams.get('path') ?? '');
        if (!dir) {
          sendJson(res, 400, { error: '缺少路径' });
          return;
        }
        const r = detectRepo(dir);
        if (!r) {
          sendJson(res, 400, { error: `${dir} 不是 SVN/Git 工作副本` });
          return;
        }
        process.env.SVNKIT_REPO_DIR = r.root;
        addHistory({ path: r.root, type: r.type }); // 记录到最近项目
        sendJson(res, 200, { ok: true, repo: r });
        return;
      }

      if (p === '/api/status') {
        const { repo } = vcsOf();
        const force = url.searchParams.get('force') === '1';
        const items = await getStatusCached(repo, force);
        sendJson(res, 200, { items });
        return;
      }

      if (p === '/api/new-files') {
        // 目录及所有子目录中的未版本化文件（'?' 条目；目录条目递归展开内部文件）。
        // 用于筛选"仅新文件"时平铺列出全部新文件，双击跳转定位
        const { repo } = vcsOf();
        const dir = url.searchParams.get('dir') || '';
        const prefix = dir ? dir + '/' : '';
        const items = (await getStatusCached(repo, false)) as { path: string; code: string; isDir: boolean }[];
        const files: { path: string }[] = [];
        const seen = new Set<string>();
        const walkDir = (relDir: string) => {
          let names: string[];
          try {
            names = fs.readdirSync(path.join(repo.root, relDir));
          } catch {
            return;
          }
          for (const n of names) {
            if (n === '.svn' || n === '.git') continue;
            const base = relDir.replace(/\/+$/, ''); // 防御性去尾斜杠（如 "?? dir/"）
            const rel = base ? `${base}/${n}` : n;
            if (seen.has(rel)) continue;
            const abs = path.join(repo.root, rel);
            let st: fs.Stats;
            try {
              st = fs.statSync(abs);
            } catch {
              continue;
            }
            seen.add(rel);
            if (st.isDirectory()) walkDir(rel);
            else files.push({ path: rel });
          }
        };
        for (const it of items) {
          if (it.code !== '?' || !it.path.startsWith(prefix) || seen.has(it.path)) continue;
          seen.add(it.path);
          if (it.isDir) walkDir(it.path);
          else files.push({ path: it.path });
        }
        files.sort((a, b) => a.path.localeCompare(b.path));
        sendJson(res, 200, { files });
        return;
      }

      if (p === '/api/filtered-tree') {
        // 过滤后的树：目录及子目录中，状态码匹配的条目按目录层级构建树（'?' 目录展开内部全部文件）。
        // 供"仅修改/仅新文件/仅删除"过滤在树视图展示
        const { repo } = vcsOf();
        const dir = url.searchParams.get('dir') || '';
        const codes = new Set((url.searchParams.get('codes') || '').split(',').filter(Boolean));
        const prefix = dir ? dir + '/' : '';
        const items = (await getStatusCached(repo, false)) as { path: string; code: string; isDir: boolean }[];
        interface TNode {
          name: string;
          path: string;
          isDir: boolean;
          code: string;
          children: TNode[];
        }
        const root: TNode[] = [];
        const map = new Map<string, TNode>();
        const ensureDir = (rel: string): TNode => {
          let n = map.get(rel);
          if (!n) {
            n = { name: rel.split('/').pop() || rel, path: rel, isDir: true, code: '', children: [] };
            map.set(rel, n);
            const i = rel.lastIndexOf('/');
            if (i < 0) root.push(n);
            else ensureDir(rel.slice(0, i)).children.push(n);
          }
          return n;
        };
        const pushFile = (rel: string, code: string) => {
          const i = rel.lastIndexOf('/');
          const parent = i < 0 ? null : ensureDir(rel.slice(0, i));
          const arr = parent ? parent.children : root;
          if (!map.has(rel)) {
            const n = { name: rel.split('/').pop() || rel, path: rel, isDir: false, code, children: [] };
            map.set(rel, n);
            arr.push(n);
          }
        };
        // '?' 目录：递归展开内部全部文件（未版本化目录内的所有内容都是新文件）
        const walkUnversionedDir = (relDir: string) => {
          let names: string[];
          try {
            names = fs.readdirSync(path.join(repo.root, relDir));
          } catch {
            return;
          }
          for (const n of names) {
            if (n === '.svn' || n === '.git') continue;
            const base = relDir.replace(/\/+$/, '');
            const rel = base ? `${base}/${n}` : n;
            const abs = path.join(repo.root, rel);
            let st: fs.Stats;
            try {
              st = fs.statSync(abs);
            } catch {
              continue;
            }
            if (st.isDirectory()) walkUnversionedDir(rel);
            else pushFile(rel, '?');
          }
        };
        for (const it of items) {
          if (!it.path.startsWith(prefix) || !codes.has(it.code)) continue;
          if (it.code === '?' && it.isDir) {
            walkUnversionedDir(it.path);
          } else if (it.isDir) {
            ensureDir(it.path);
          } else {
            pushFile(it.path, it.code);
          }
        }
        // 排序：目录在前，名称排序
        const sortTree = (nodes: TNode[]) => {
          nodes.sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.name.localeCompare(b.name));
          for (const n of nodes) sortTree(n.children);
        };
        sortTree(root);
        sendJson(res, 200, { tree: root });
        return;
      }

      if (p === '/api/fs') {
        // 工作副本文件夹浏览：磁盘目录 + 状态匹配
        const { vcs, repo } = vcsOf();
        const rel = url.searchParams.get('dir') ?? '';
        const force = url.searchParams.get('force') === '1';
        const abs = path.join(repo.root, rel);
        if (!inRepoRoot(repo.root, abs)) {
          sendJson(res, 403, { error: '超出工作副本范围' });
          return;
        }
        const items = (await getStatusCached(repo, force)) as { path: string; code: string; isDir: boolean }[];
        const entries: { name: string; isDir: boolean; size: number; mtime: string; code: string; count?: number; codes?: string[]; unversionedCount?: number }[] = [];
        // 目录多状态徽标显示顺序：修改 / 添加 / 删除 / 冲突 / 替换 / 缺失 / 更新 / 类型变更
        const CODES_ORDER = ['M', 'A', 'D', 'C', 'R', '!', 'U', '~'];
        let names: string[];
        try {
          names = fs.readdirSync(abs);
        } catch (err) {
          sendJson(res, 500, { error: `无法读取目录: ${(err as Error).message}` });
          return;
        }
        // 目录本身或其任一祖先未版本化 → 内部全部未版本化
        // （svn status 对嵌套未版本化目录可能只标记最外层，深层需沿祖先链判断）
        let unversionedAncestor = false;
        {
          const parts = rel.split('/');
          let acc = '';
          for (const p of parts) {
            acc = acc ? `${acc}/${p}` : p;
            const anc = items.find((i) => i.path === acc);
            if (anc && anc.code === '?') {
              unversionedAncestor = true;
              break;
            }
          }
        }
        const dirSelf = unversionedAncestor || items.find((i) => i.path === rel && i.code === '?');

        // 忽略规则检测：status 无条目的磁盘文件/目录，若被 svn:ignore / .gitignore 匹配则标记 'I'
        let gitignoreRules: string[] | null = null;
        const getIgnoreRules = async (dirRel: string): Promise<string[]> => {
          if (repo.type === 'git') {
            if (gitignoreRules) return gitignoreRules;
            const g = path.join(repo.root, '.gitignore');
            gitignoreRules = fs.existsSync(g)
              ? fs
                  .readFileSync(g, 'utf8')
                  .split('\n')
                  .map((s) => s.trim())
                  .filter((s) => s && !s.startsWith('#'))
              : [];
            return gitignoreRules;
          }
          // svn:ignore：一次 `-R` 全量拉取缓存后，所有目录直接查内存 Map（不再逐目录跑 svn 进程）
          const map = await getSvnIgnoreMap(repo.root);
          return map.get(dirRel) ?? [];
        };
        const isIgnoredByRules = (rules: string[], name: string): boolean => {
          for (const rule of rules) {
            const r = rule.trim().replace(/\/+$/, '');
            if (!r) continue;
            if (r.includes('*')) {
              const re = new RegExp('^' + r.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
              if (re.test(name)) return true;
            } else if (r === name) {
              return true;
            }
          }
          return false;
        };
        // 祖先链上有被忽略目录（如 .gitignore 的 node_modules/）→ 内部所有内容都算忽略（I）
        // （被忽略目录不在 status 条目里，需逐级用忽略规则匹配祖先目录名）
        let ignoredAncestor = false;
        {
          const parts = rel.split('/');
          let acc = '';
          for (let i = 0; i < parts.length; i++) {
            const part = parts[i]!;
            acc = acc ? `${acc}/${part}` : part;
            const parentOf = path.dirname(acc);
            const rules = await getIgnoreRules(parentOf === '.' ? '.' : parentOf);
            if (rules.length && isIgnoredByRules(rules, part)) {
              ignoredAncestor = true;
              break;
            }
          }
        }
        const prefix = rel ? rel + '/' : '';
        const dirs: string[] = [];
        const files: string[] = [];
        for (const n of names) {
          const p = path.join(abs, n);
          let st: fs.Stats;
          try {
            st = fs.statSync(p);
          } catch {
            continue;
          }
          (st.isDirectory() ? dirs : files).push(n);
        }
        dirs.sort((a, b) => a.localeCompare(b));
        files.sort((a, b) => a.localeCompare(b));
        for (const d of dirs) {
          const relDir = prefix + d;
          let code = dirSelf ? '?' : '';
          let count: number | undefined;
          let codes: string[] | undefined;
          let unversionedCount = 0;
          // 目录自身在 status 中的条目（如 svn/git 的 '?' 未版本化目录）优先采用
          const self = items.find((i) => i.path === relDir);
          if (self && self.code !== 'none') code = self.code;
          // 无条目且非未版本化：祖先被忽略（如 node_modules 内）→ 直接 I；否则按忽略规则判断
          if (!code && !self) {
            if (ignoredAncestor) code = 'I';
            else {
              const rules = await getIgnoreRules(path.dirname(relDir) === '.' ? '.' : path.dirname(relDir));
              if (rules.length && isIgnoredByRules(rules, d)) code = 'I';
            }
          }
          const sub = items.filter((i) => i.path.startsWith(relDir + '/'));
          if (sub.length > 0) {
            let best = ' ';
            for (const s of sub) {
              const rk = { C: 10, '!': 9, D: 8, M: 7, A: 6, R: 5, '~': 4, U: 3, '?': 2 }[s.code] ?? 0;
              if (rk > ({ C: 10, '!': 9, D: 8, M: 7, A: 6, R: 5, '~': 4, U: 3, '?': 2 }[code] ?? 0)) code = s.code;
            }
            // 变更数只统计已版本化条目（未版本化 '?' 未纳入版本控制，不计数）
            count = sub.filter((s) => s.code !== '?').length;
            // 内部未版本化数量（'?' 不在徽标显示，但筛选"仅新文件"时需要提示新文件在哪）
            unversionedCount = sub.filter((s) => s.code === '?').length;
            // 目录操作集合：同时显示 M/A/D 等全部操作标识；排除未版本化 '?' 与无变更 ' '
            codes = [...new Set(sub.map((s) => s.code).filter((c) => c && c !== '?' && c !== ' ' && c !== 'none'))];
            codes.sort((a, b) => CODES_ORDER.indexOf(a) - CODES_ORDER.indexOf(b));
          }
          // 目录自身被忽略(I)：子级无操作时徽标也应显示 I（避免被误显示为干净的 √）
          if (code === 'I' && !codes) codes = ['I'];
          // 目录在磁盘上存在就总是显示（svn/git status 对干净目录无条目，不 push 会丢失目录）
          entries.push({ name: d, isDir: true, size: 0, mtime: '', code, count, codes, unversionedCount: unversionedCount || undefined });
        }
        for (const f of files) {
          const p = path.join(abs, f);
          let st: fs.Stats;
          try {
            st = fs.statSync(p);
          } catch {
            continue;
          }
          const relFile = prefix + f;
          const it = items.find((i) => i.path === relFile);
          let code = dirSelf ? '?' : it?.code ?? '';
          // 无条目且非未版本化：祖先被忽略（如 node_modules 内）→ 直接 I；否则按忽略规则判断
          if (!code && !it) {
            if (ignoredAncestor) code = 'I';
            else {
              const rules = await getIgnoreRules(path.dirname(relFile) === '.' ? '.' : path.dirname(relFile));
              if (rules.length && isIgnoredByRules(rules, f)) code = 'I';
            }
          }
          entries.push({
            name: f,
            isDir: false,
            size: st.size,
            mtime: new Date(st.mtime).toLocaleString('zh-CN', { hour12: false }).slice(0, 16),
            code,
          });
        }
        // 合并 status 中磁盘已删除(D/R)的条目：磁盘不存在但版本库有删除记录 → 显示删除标识
        for (const it of items) {
          if (it.isDir || it.path === rel || !it.path.startsWith(prefix)) continue;
          const name = it.path.slice(prefix.length);
          if (!name || name.includes('/')) continue; // 只处理当前目录直接子项
          if (it.code !== 'D' && it.code !== 'R') continue;
          if (fs.existsSync(path.join(abs, name))) continue; // 磁盘存在已由 files 处理
          entries.push({ name, isDir: false, size: 0, mtime: '', code: it.code });
        }
        // SVN：自己锁定的文件列表（显示锁图标）
        let selfLocked: string[] = [];
        if (repo.type === 'svn') {
          try {
            selfLocked = await (vcs as any).selfLockedFiles();
          } catch {
            /* ignore */
          }
        }
        sendJson(res, 200, { dir: rel, abs, root: repo.root, entries, selfLocked });
        return;
      }

      if (p === '/api/log') {
        const { vcs, repo } = vcsOf();
        const pathRel = url.searchParams.get('path') || undefined;
        const limit = Number(url.searchParams.get('limit') ?? 200);
        const logs = await vcs.log(limit, pathRel);
        // git:附带未推送提交 hash 列表(历史视图绿灯标记);svn 无此概念
        let unpushed: string[] = [];
        if (repo.type === 'git') {
          try {
            unpushed = await (vcs as any).unpushed();
          } catch {
            /* 计算失败不阻断历史列表 */
          }
        }
        sendJson(res, 200, { logs, unpushed });
        return;
      }

      if (p === '/api/file-mtime') {
        // 工作区文件指纹（检测外部更新）
        const { repo } = vcsOf();
        const rel = url.searchParams.get('path') ?? '';
        const abs = path.join(repo.root, rel);
        if (!inRepoRoot(repo.root, abs)) {
          sendJson(res, 403, { error: '超出工作副本范围' });
          return;
        }
        if (!fs.existsSync(abs)) {
          sendJson(res, 404, { error: '文件不存在' });
          return;
        }
        const st = fs.statSync(abs);
        sendJson(res, 200, { mtime: st.mtimeMs, size: st.size });
        return;
      }

      if (p === '/api/file-versions') {
        // 并排对比：左右版本文件内容（无 a/b：左=BASE/HEAD 右=工作区；有 a/b：两版本）
        const { vcs, repo } = vcsOf();
        const rel = url.searchParams.get('path') || '';
        const a = url.searchParams.get('a') || undefined;
        const b = url.searchParams.get('b') || undefined;
        const abs = path.join(repo.root, rel);
        if (!inRepoRoot(repo.root, abs)) {
          sendJson(res, 403, { error: '超出工作副本范围' });
          return;
        }
        // 工作区模式且文件不存在（路径错误）→ 明确报错，避免空白对比
        if (!a && !b && !fs.existsSync(abs)) {
          sendJson(res, 404, { error: `文件不存在: ${rel}` });
          return;
        }
        let left = '';
        let right = '';
        let leftLabel = '';
        let rightLabel = '';
        const gitShow = async (rev: string, r: string): Promise<string> => {
          const out = await (vcs as any).show(`${rev}:${r}`);
          return out.ok ? out.output : '';
        };
        const svnCat = async (rev: string, r: string): Promise<string> => {
          const out = await (vcs as any).catRev(rev, r);
          return out.ok ? out.output : '';
        };
        if (repo.type === 'git') {
          leftLabel = a ? a : 'HEAD（原版）';
          rightLabel = b ? b : '工作区（当前）';
          left = await gitShow(a ?? 'HEAD', rel);
          right = b ? await gitShow(b, rel) : fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : '';
        } else {
          leftLabel = a ? `r${a}` : 'BASE（原版）';
          rightLabel = b ? `r${b}` : '工作区（当前）';
          left = await svnCat(a ?? 'BASE', rel);
          right = b ? await svnCat(b, rel) : fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : '';
        }
        // 截断超大文件
        const MAX = 200_000;
        if (left.length > MAX) left = left.slice(0, MAX) + '\n…（文件过大已截断）';
        if (right.length > MAX) right = right.slice(0, MAX) + '\n…（文件过大已截断）';
        sendJson(res, 200, { left, right, leftLabel, rightLabel, rel });
        return;
      }

      if (p === '/api/diff') {
        const { vcs, repo } = vcsOf();
        const pathRel = url.searchParams.get('path') || undefined;
        const a = url.searchParams.get('a') || undefined;
        const b = url.searchParams.get('b') || undefined;
        const d = await vcs.diff(a, b, pathRel);
        let output = d.output;
        // git 工作区模式：合并暂存区改动（否则已 git add 的修改行不会标记）
        if (repo.type === 'git' && !a && !b) {
          const staged = await (vcs as any).diffStaged(pathRel);
          if (staged?.ok && staged.output.trim()) output = output + (output ? '\n' : '') + staged.output;
        }
        sendJson(res, 200, { ...d, output });
        return;
      }

      if (p === '/api/show') {
        const { vcs, repo } = vcsOf();
        const rev = url.searchParams.get('rev') || '';
        const pathRel = url.searchParams.get('path') || undefined;
        if (repo.type === 'git') {
          const s = await (vcs as any).show(rev, pathRel);
          sendJson(res, 200, s);
        } else {
          const n = Number(rev);
          // svn log -v 的变更路径是仓库内路径（相对 repository root，如 /projects/CWBS-SCA/tags/SCA_HB/...），
          // 不能直接当工作副本相对路径用（会报 E155007 不是工作副本）。
          // 转换：取 wc URL path 的最长后缀 Y（wc 在仓库内的位置），pathRel 以它开头则截掉 → wc 相对路径
          let rel = pathRel;
          let y = '';
          if (pathRel && repo.url) {
            try {
              const urlPath = new URL(repo.url).pathname;
              const segs = urlPath.split('/').filter(Boolean);
              for (let i = segs.length - 1; i >= 1; i--) {
                const cand = segs.slice(i).join('/');
                if (cand.length > y.length && pathRel.startsWith(`/${cand}`)) y = cand;
              }
              if (y) rel = pathRel.slice(('/' + y).length + 1) || '';
            } catch {
              /* URL 解析失败保持原样 */
            }
          }
          // 转换失败（提交路径不属于当前工作副本，如其他分支/标签的提交）→ 明确提示，避免原始 E155007
          if (pathRel && y === '') {
            sendJson(res, 200, { ok: false, output: '', error: `该文件不在当前工作副本中，无法查看差异：${pathRel}` });
            return;
          }
          const d = await vcs.diff(String(n - 1), rev, rel);
          sendJson(res, 200, d);
        }
        return;
      }

      if (p === '/api/ls') {
        const { vcs, repo } = vcsOf();
        const dir = url.searchParams.get('dir') || '';
        const list = await vcs.ls(dir);
        sendJson(res, 200, { items: list, repoType: repo.type });
        return;
      }

      if (p === '/api/cat') {
        const { vcs, repo } = vcsOf();
        const rel = url.searchParams.get('path') || '';
        let out: { ok: boolean; output: string; error?: string };
        if (repo.type === 'git') {
          out = await (vcs as any).cat(rel);
        } else {
          // svn 工作副本直接读本地文件
          const abs = path.join(repo.root, rel);
          if (!fs.existsSync(abs)) {
            sendJson(res, 404, { ok: false, output: '', error: '文件不存在' });
            return;
          }
          out = { ok: true, output: fs.readFileSync(abs, 'utf8') };
        }
        sendJson(res, 200, out);
        return;
      }

      if (p === '/api/git-auth' && req.method === 'GET') {
        // Git 推送认证信息（不回传密码本体）
        const cfg = loadConfig();
        sendJson(res, 200, { username: cfg.git?.username ?? '', hasPassword: Boolean(cfg.git?.password) });
        return;
      }
      if (p === '/api/git-auth' && req.method === 'POST') {
        // 保存 Git 推送认证（GitHub token / 服务器密码），base64 存储 600 权限
        const body = await readBody(req);
        const username = String(body.username ?? '').trim();
        const password = String(body.password ?? '');
        if (!username || !password) {
          sendJson(res, 400, { error: '用户名和密码不能为空' });
          return;
        }
        const cfg = loadConfig();
        cfg.git = { username, password };
        saveConfig(cfg);
        sendJson(res, 200, { ok: true, message: '推送认证已保存' });
        return;
      }
      if (p === '/api/config' && req.method === 'GET') {
        const cfg = loadConfig();
        sendJson(res, 200, { username: cfg.svn.username, trustServerCert: cfg.svn.trustServerCert });
        return;
      }

      if (p === '/api/config' && req.method === 'POST') {
        const body = await readBody(req);
        const cfg = loadConfig();
        cfg.svn.username = String(body.username ?? '');
        cfg.svn.password = String(body.password ?? '');
        cfg.svn.trustServerCert = Boolean(body.trustServerCert ?? cfg.svn.trustServerCert);
        saveConfig(cfg);
        sendJson(res, 200, { ok: true });
        return;
      }

      if (p === '/api/shutdown') {
        sendJson(res, 200, { ok: true });
        setTimeout(() => process.exit(0), 200);
        return;
      }

      // 操作类 POST
      if (req.method === 'POST' && ['/api/add', '/api/commit', '/api/update', '/api/revert', '/api/delete', '/api/push'].includes(p)) {
        const { vcs, repo } = vcsOf();
        const body = await readBody(req);
        const paths = (body.paths as string[]) ?? [];
        const msg = String(body.message ?? '');
        let result: { ok: boolean; message: string };
        const v = vcs as any;
        if (p === '/api/add') result = await v.add(paths);
        else if (p === '/api/commit') result = await v.commit(paths, msg);
        else if (p === '/api/update') {
          const dir = String(body.path ?? '');
          // 前端取消更新（请求断开）→ 终止 svn/git 子进程
          const ac = new AbortController();
          req.on('aborted', () => ac.abort());
          result = repo.type === 'git' ? await v.pull(ac.signal) : await v.update(dir || undefined, ac.signal);
          // 更新成功后自动恢复缺失文件（磁盘删除但版本库还在 → 拉回，消除 ! 标识）
          if (result.ok) {
            try {
              const missing = await (v as any).restoreMissing();
              if (missing.length > 0) {
                result = { ...result, message: `${result.message}；已恢复 ${missing.length} 个缺失文件` };
              }
            } catch {
              /* 恢复失败不阻断更新结果 */
            }
          }
        } else if (p === '/api/revert') result = await v.revert(paths);
        else if (p === '/api/delete') result = await v.remove(paths);
        else result = await v.push();
        sendJson(res, 200, {
          ...(result as object),
          path: p === '/api/update' ? String(body.path ?? '') : undefined,
          authError: isAuthError(new Error(result.message)),
        });
        return;
      }

      // ---------- 版本管理扩展 API ----------
      if (p === '/api/branches') {
        const { vcs } = vcsOf();
        const r = await (vcs as any).branchList();
        sendJson(res, 200, r);
        return;
      }

      if (p === '/api/branch' && req.method === 'POST') {
        const { vcs } = vcsOf();
        const body = await readBody(req);
        const action = String(body.action ?? '');
        const name = String(body.name ?? '');
        let result: VcsResult;
        const v = vcs as any;
        if (action === 'create') result = await v.branchCreate(name);
        else if (action === 'switch') result = await v.branchSwitch(name);
        else if (action === 'delete') result = await v.branchDelete(name, Boolean(body.force));
        else if (action === 'merge') result = await v.merge(name);
        else {
          sendJson(res, 400, { error: '未知操作' });
          return;
        }
        sendJson(res, 200, { ...result, authError: isAuthError(new Error(result.message)) });
        return;
      }

      if (p === '/api/git-amend' && req.method === 'POST') {
        // 修改最近一次提交注释（仅 git）
        const { vcs, repo } = vcsOf();
        if (repo.type !== 'git') {
          sendJson(res, 400, { error: '仅 git 仓库支持' });
          return;
        }
        const body = await readBody(req);
        const message = String(body.message ?? '').trim();
        if (!message) {
          sendJson(res, 400, { error: '注释不能为空' });
          return;
        }
        const result = await (vcs as any).amend(message);
        sendJson(res, 200, { ...result, authError: isAuthError(new Error(result.message)) });
        return;
      }

      if (p === '/api/git-unpushed-count') {
        // 未推送提交数量（推送按钮角标，仅 git）
        const { vcs, repo } = vcsOf();
        if (repo.type !== 'git') {
          sendJson(res, 200, { count: 0 });
          return;
        }
        const count = await (vcs as any).unpushedCount();
        sendJson(res, 200, { count });
        return;
      }

      if (p === '/api/git-unpushed') {
        // 未推送提交完整列表（含变更文件，推送确认弹窗，仅 git）
        const { vcs, repo } = vcsOf();
        if (repo.type !== 'git') {
          sendJson(res, 200, { count: 0, unpushed: [] });
          return;
        }
        const unpushed = await (vcs as any).unpushedLog();
        sendJson(res, 200, { count: unpushed.length, unpushed });
        return;
      }

      if (p === '/api/git-reset' && req.method === 'POST') {
        // 撤销最近一次提交（--soft 保留修改，仅 git）
        const { vcs, repo } = vcsOf();
        if (repo.type !== 'git') {
          sendJson(res, 400, { error: '仅 git 仓库支持' });
          return;
        }
        const result = await (vcs as any).resetSoft();
        sendJson(res, 200, { ...result, authError: isAuthError(new Error(result.message)) });
        return;
      }

      if (p === '/api/tags') {
        const { vcs } = vcsOf();
        const tags = await (vcs as any).tagList();
        sendJson(res, 200, { tags });
        return;
      }

      if (p === '/api/tag' && req.method === 'POST') {
        const { vcs } = vcsOf();
        const body = await readBody(req);
        const action = String(body.action ?? '');
        const name = String(body.name ?? '');
        let result: VcsResult;
        const v = vcs as any;
        if (action === 'create') result = await v.tagCreate(name);
        else if (action === 'delete') result = await v.tagDelete(name);
        else {
          sendJson(res, 400, { error: '未知操作' });
          return;
        }
        sendJson(res, 200, { ...result, authError: isAuthError(new Error(result.message)) });
        return;
      }

      if (p === '/api/stash') {
        const { vcs, repo } = vcsOf();
        if (repo.type !== 'git') {
          sendJson(res, 200, { ok: false, message: 'SVN 不支持 Stash 功能' });
          return;
        }
        if (req.method === 'GET') {
          const list = await (vcs as any).stashList();
          sendJson(res, 200, { items: list });
          return;
        }
        const body = await readBody(req);
        const action = String(body.action ?? '');
        const v = vcs as any;
        let result: VcsResult;
        if (action === 'push') result = await v.stashPush(String(body.message ?? ''));
        else if (action === 'pop') result = await v.stashPop(Number(body.index ?? 0));
        else if (action === 'drop') result = await v.stashDrop(Number(body.index ?? 0));
        else {
          sendJson(res, 400, { error: '未知操作' });
          return;
        }
        sendJson(res, 200, { ...result, authError: isAuthError(new Error(result.message)) });
        return;
      }

      if (p === '/api/repo-create' && req.method === 'POST') {
        // 创建/克隆仓库（不依赖当前打开的仓库）
        const body = await readBody(req);
        const type = String(body.type ?? '');
        const dir = String(body.dir ?? '').trim();
        const url = String(body.url ?? '').trim();
        const name = String(body.name ?? '').trim();
        if (!dir) {
          sendJson(res, 400, { error: '请填写目录路径' });
          return;
        }
        const target = path.join(dir, name);
        let result: { ok: boolean; message: string; repoDir?: string };
        if (type === 'git') {
          if (url) {
            // 克隆
            const r = await run('git', ['clone', url, target], { timeoutMs: 600_000 });
            result = r.code === 0 ? { ok: true, message: `已克隆到 ${target}`, repoDir: target } : { ok: false, message: r.stderr.trim() || '克隆失败' };
          } else {
            // init
            fs.mkdirSync(target, { recursive: true });
            const r = await run('git', ['init', target], { timeoutMs: 60_000 });
            result = r.code === 0 ? { ok: true, message: `已初始化仓库 ${target}`, repoDir: target } : { ok: false, message: r.stderr.trim() || 'git init 失败' };
          }
        } else if (type === 'svn') {
          // svnadmin create（本地仓库）+ 可选工作副本
          fs.mkdirSync(target, { recursive: true });
          const r = await run('svnadmin', ['create', target], { timeoutMs: 120_000 });
          if (r.code !== 0) {
            result = { ok: false, message: r.stderr.trim() || 'svnadmin create 失败' };
          } else {
            // 自动 checkout 一个工作副本目录
            const wcDir = target + '-wc';
            const c = await run('svn', ['checkout', '-q', `file://${target}`, wcDir], { timeoutMs: 120_000 });
            result = c.code === 0
              ? { ok: true, message: `已创建 SVN 仓库 ${target}（工作副本 ${wcDir}）`, repoDir: wcDir }
              : { ok: true, message: `已创建 SVN 仓库 ${target}（工作副本检出失败: ${c.stderr.trim() || '未知'}）`, repoDir: wcDir };
          }
        } else {
          sendJson(res, 400, { error: '未知仓库类型' });
          return;
        }
        sendJson(res, 200, { ...result, authError: false });
        return;
      }

      if (p === '/api/svn-extra' && req.method === 'POST') {
        const { vcs } = vcsOf();
        const body = await readBody(req);
        const action = String(body.action ?? '');
        const v = vcs as any;
        let result: VcsResult;
        if (action === 'cleanup') result = await v.cleanup();
        else if (action === 'resolve') result = await v.resolve(String(body.path ?? ''), String(body.accept ?? 'working'));
        else if (action === 'propset-ignore') result = await v.propSetIgnore(String(body.path ?? ''), String(body.pattern ?? ''));
        else {
          sendJson(res, 400, { error: '未知操作' });
          return;
        }
        sendJson(res, 200, { ...result, authError: isAuthError(new Error(result.message)) });
        return;
      }

      if (p === '/api/conflicts') {
        // 冲突文件 + 三方内容（git: :1/:2/:3；svn: .mine/.r 文件）
        const { vcs, repo } = vcsOf();
        const items = (await vcs.status()) as { code: string; path: string }[];
        const conflictPaths = items.filter((i) => i.code === 'C').map((i) => i.path);
        const read = (p: string) => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '');
        const out: { path: string; ours: string; theirs: string; base: string; work: string }[] = [];
        for (const rel of conflictPaths) {
          const abs = path.join(repo.root, rel);
          let ours = '';
          let theirs = '';
          let base = '';
          let work = read(abs);
          if (repo.type === 'git') {
            const show = async (stage: string): Promise<string> => {
              const r = await run('git', ['show', `:${stage}:${rel}`], { cwd: repo.root, timeoutMs: 30_000 });
              return r.code === 0 ? r.stdout : '';
            };
            base = await show('1');
            ours = await show('2');
            theirs = await show('3');
          } else {
            // svn 冲突文件：xxx.mine（本地）、xxx.r<新>（对方）、xxx.r<旧>（基础）
            const dir = path.dirname(abs);
            const basename = path.basename(abs);
            let rnums: number[] = [];
            try {
              rnums = fs
                .readdirSync(dir)
                .filter((n) => n.startsWith(basename + '.r'))
                .map((n) => Number(n.slice(basename.length + 2)))
                .filter((n) => !Number.isNaN(n))
                .sort((a, b) => a - b);
            } catch {
              /* ignore */
            }
            ours = read(abs + '.mine');
            theirs = rnums.length > 0 ? read(abs + '.r' + rnums[rnums.length - 1]!) : '';
            base = rnums.length > 1 ? read(abs + '.r' + rnums[0]!) : '';
          }
          out.push({ path: rel, ours, theirs, base, work });
        }
        sendJson(res, 200, { conflicts: out });
        return;
      }

      if (p === '/api/conflict-detail') {
        // 冲突风险文件详情：对方的改动 diff + 我的改动 diff
        const { vcs, repo } = vcsOf();
        const rel = url.searchParams.get('path') ?? '';
        if (!rel) {
          sendJson(res, 400, { error: '缺少路径' });
          return;
        }
        let theirsDiff = '';
        let myDiff = '';
        if (repo.type === 'git') {
          const branch = await (vcs as any).branch();
          const t = await (vcs as any).diff('HEAD', `origin/${branch}`, rel);
          theirsDiff = t.ok ? t.output : '';
          const m = await (vcs as any).diff(undefined, undefined, rel);
          myDiff = m.ok ? m.output : '';
        } else {
          const t = await (vcs as any).diff('BASE', 'HEAD', rel);
          theirsDiff = t.ok ? t.output : '';
          const m = await (vcs as any).diff(undefined, undefined, rel);
          myDiff = m.ok ? m.output : '';
        }
        sendJson(res, 200, { path: rel, theirsDiff, myDiff });
        return;
      }

      if (p === '/api/reveal' && req.method === 'POST') {
        // 打开文件所在文件夹（Linux: xdg-open 目录；Windows: explorer 定位文件）
        const { repo } = vcsOf();
        const body = await readBody(req);
        const rel = String(body.path ?? '');
        const abs = path.join(repo.root, rel);
        if (!inRepoRoot(repo.root, abs)) {
          sendJson(res, 403, { error: '超出工作副本范围' });
          return;
        }
        if (!fs.existsSync(abs)) {
          sendJson(res, 404, { error: '文件不存在' });
          return;
        }
        if (process.platform === 'win32') {
          await run('explorer', ['/select,', abs], { timeoutMs: 10_000 });
        } else {
          await run('xdg-open', [path.dirname(abs)], { timeoutMs: 10_000 });
        }
        sendJson(res, 200, { ok: true });
        return;
      }

      if (p === '/api/text-diff' && req.method === 'POST') {
        // 任意两段文本的 unified diff（git diff --no-index，跨平台；冲突解决器用）
        const body = await readBody(req);
        const left = String(body.left ?? '');
        const right = String(body.right ?? '');
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'svnkit-diff-'));
        const f1 = path.join(tmpDir, 'ours.txt');
        const f2 = path.join(tmpDir, 'theirs.txt');
        try {
          fs.writeFileSync(f1, left);
          fs.writeFileSync(f2, right);
          const r = await run('git', ['diff', '--no-index', '--', f1, f2], { timeoutMs: 30_000 });
          // 退出码：0=无差异，1=有差异（正常），>1=错误
          sendJson(res, 200, { diff: r.code <= 1 ? r.stdout : '' });
        } finally {
          fs.rmSync(tmpDir, { recursive: true, force: true });
        }
        return;
      }

      if (p === '/api/resolve-conflict' && req.method === 'POST') {
        const { vcs, repo } = vcsOf();
        const body = await readBody(req);
        const rel = String(body.path ?? '');
        const mode = String(body.mode ?? 'ours');
        const content = String(body.content ?? '');
        const abs = path.join(repo.root, rel);
        // 防误操作：非冲突状态执行 ours/theirs 会静默覆盖本地修改
        if (repo.type === 'git' && mode !== 'manual') {
          const u = await run('git', ['ls-files', '-u', rel], { cwd: repo.root, timeoutMs: 15_000 });
          if (u.code !== 0 || !u.stdout.trim()) {
            sendJson(res, 200, { ok: false, message: `${rel} 当前不是冲突状态，无法采用本地/对方` });
            return;
          }
        }
        let result: VcsResult;
        if (repo.type === 'git') {
          if (mode === 'manual') {
            fs.writeFileSync(abs, content);
          } else {
            const side = mode === 'ours' ? '--ours' : '--theirs';
            const co = await run('git', ['checkout', side, rel], { cwd: repo.root, timeoutMs: 30_000 });
            if (co.code !== 0) {
              sendJson(res, 200, { ok: false, message: co.stderr.trim() || '取用失败' });
              return;
            }
          }
          result = await (vcs as any).add([rel]);
          if (result.ok) result = { ok: true, message: `已解决: ${rel}（${mode === 'ours' ? '采用本地' : mode === 'theirs' ? '采用对方' : '手动编辑'}）` };
        } else {
          if (mode === 'manual') fs.writeFileSync(abs, content);
          const accept = mode === 'ours' ? 'mine-full' : mode === 'theirs' ? 'theirs-full' : 'working';
          result = await (vcs as any).resolve(rel, accept);
        }
        sendJson(res, 200, { ...result, authError: false });
        return;
      }

      if (p === '/api/preflight') {
        // 提交/推送前检查：服务器版本对比 + 行级冲突检测 + 锁定
        const { vcs, repo } = vcsOf();
        const r = await (vcs as any).preflight();
        // 行级冲突：对每个风险文件对比 对方改动行 ∩ 我的改动行
        const clash: { path: string; lines: number[] }[] = [];
        const branch = repo.type === 'git' ? await (vcs as any).branch() : '';
        for (const path of (r.conflictRisk ?? []) as string[]) {
          const theirs = repo.type === 'git'
            ? await (vcs as any).diff('HEAD', `origin/${branch}`, path)
            : await (vcs as any).diff('BASE', 'HEAD', path);
          const mine = await (vcs as any).diff(undefined, undefined, path);
          const tL = diffChangedLines(theirs.ok ? theirs.output : '');
          const mL = diffChangedLines(mine.ok ? mine.output : '');
          // 行冲突 = 删除行交集 ∪ 插入位置交集
          const clashSet = new Set<number>();
          for (const l of tL.del) if (mL.del.has(l)) clashSet.add(l);
          for (const l of tL.ins) if (mL.ins.has(l)) clashSet.add(l);
          const lines = [...clashSet].sort((a, b) => a - b);
          if (lines.length > 0) clash.push({ path, lines });
        }
        sendJson(res, 200, { ...r, conflictRisk: clash });
        return;
      }

      // ---------- Blame / 清理 / 锁定 / 忽略 / 远程 ----------
      if (p === '/api/blame') {
        const { vcs } = vcsOf();
        const pathRel = url.searchParams.get('path') ?? '';
        try {
          const lines = await (vcs as any).blame(pathRel);
          sendJson(res, 200, { lines });
        } catch (e) {
          sendJson(res, 500, { error: (e as Error).message });
        }
        return;
      }

      if (p === '/api/git-clean') {
        const { repo, vcs } = vcsOf();
        if (repo.type !== 'git') {
          sendJson(res, 400, { error: '仅 Git 仓库支持' });
          return;
        }
        if (req.method === 'GET') {
          const files = await (vcs as any).cleanList();
          sendJson(res, 200, { files });
          return;
        }
        const r = await (vcs as any).clean();
        sendJson(res, 200, { ...r, authError: false });
        return;
      }

      if (p === '/api/svn-lock' && req.method === 'POST') {
        const { repo, vcs } = vcsOf();
        if (repo.type !== 'svn') {
          sendJson(res, 400, { error: '仅 SVN 仓库支持' });
          return;
        }
        const body = await readBody(req);
        const action = String(body.action ?? '');
        const pathRel = String(body.path ?? '');
        const force = Boolean(body.force);
        const r = action === 'lock' ? await (vcs as any).lock(pathRel, force) : await (vcs as any).unlock(pathRel, force);
        sendJson(res, 200, { ...r, authError: isAuthError(new Error(r.message)) });
        return;
      }

      if (p === '/api/ignore' && req.method === 'GET') {
        // 读取忽略规则（svn: svn:ignore 属性 / git: .gitignore）
        const { repo } = vcsOf();
        const pathRel = url.searchParams.get('path') ?? '';
        let rules: string[] = [];
        if (repo.type === 'svn') {
          const r = await run('svn', ['propget', 'svn:ignore', pathRel || '.'], { cwd: repo.root, timeoutMs: 30_000 });
          if (r.code === 0 && r.stdout.trim()) rules = r.stdout.split('\n').map((s) => s.trim()).filter(Boolean);
        } else {
          const g = path.join(repo.root, '.gitignore');
          if (fs.existsSync(g)) {
            rules = fs
              .readFileSync(g, 'utf8')
              .split('\n')
              .map((s) => s.trim())
              .filter((s) => s && !s.startsWith('#'));
          }
        }
        sendJson(res, 200, { rules });
        return;
      }

      if (p === '/api/ignore-remove' && req.method === 'POST') {
        // 删除单条忽略规则
        const { repo } = vcsOf();
        const body = await readBody(req);
        const pathRel = String(body.path ?? '');
        const pattern = String(body.pattern ?? '');
        if (repo.type === 'svn') {
          // propget → 过滤 → propset 回写
          const getRes = await run('svn', ['propget', 'svn:ignore', pathRel || '.'], { cwd: repo.root, timeoutMs: 30_000 });
          const remaining = getRes.stdout
            .split('\n')
            .map((s) => s.trim())
            .filter((s) => s && s !== pattern);
          const setRes = await run('svn', ['propset', 'svn:ignore', remaining.join('\n'), pathRel || '.'], { cwd: repo.root, timeoutMs: 30_000 });
          if (setRes.code !== 0) {
            sendJson(res, 200, { ok: false, message: setRes.stderr.trim() || '删除失败' });
            return;
          }
        } else {
          const g = path.join(repo.root, '.gitignore');
          if (fs.existsSync(g)) {
            const content = fs.readFileSync(g, 'utf8');
            fs.writeFileSync(g, content.split('\n').filter((l) => l.trim() !== pattern).join('\n'));
          }
        }
        sendJson(res, 200, { ok: true, message: `已删除规则: ${pattern}` });
        return;
      }

      if (p === '/api/ignore' && req.method === 'POST') {
        const { repo, vcs } = vcsOf();
        const body = await readBody(req);
        const pathRel = String(body.path ?? '');
        const pattern = String(body.pattern ?? '').trim();
        if (!pattern) {
          sendJson(res, 400, { error: '请填写忽略规则' });
          return;
        }
        const r =
          repo.type === 'git'
            ? await (vcs as any).ignoreAdd(pattern)
            : await (vcs as any).propSetIgnore(pathRel, pattern);
        sendJson(res, 200, { ...r, authError: isAuthError(new Error(r.message)) });
        return;
      }

      if (p === '/api/remotes') {
        const { repo, vcs } = vcsOf();
        if (repo.type !== 'git') {
          sendJson(res, 200, { remotes: [] });
          return;
        }
        const remotes = await (vcs as any).remoteList();
        sendJson(res, 200, { remotes });
        return;
      }

      // ---------- 环境检测 / 安装 ----------
      if (p === '/api/env-check') {
        const check = async (cmd: string): Promise<{ installed: boolean; version: string }> => {
          try {
            const r = await run(cmd, ['--version'], { timeoutMs: 10_000 });
            return { installed: r.code === 0, version: r.stdout.split('\n')[0]?.trim() ?? '' };
          } catch {
            // 命令不存在(如未安装 svn)→ 视为未安装,而非接口 500
            return { installed: false, version: '' };
          }
        };
        const [svn, git] = await Promise.all([check('svn'), check('git')]);
        sendJson(res, 200, { svn, git });
        return;
      }

      if (p === '/api/env-install/stream') {
        // SSE：流式执行系统安装，前端显示实时日志/进度
        const tool = url.searchParams.get('tool') ?? 'both';
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        });
        const send = (data: Record<string, unknown>) => res.write(`data: ${JSON.stringify(data)}\n\n`);
        // Windows：winget 安装引导（不自动执行，给出命令）
        if (process.platform === 'win32') {
          const cmds =
            tool === 'svn'
              ? ['winget install --id TortoiseSVN.TortoiseSVN --accept-source-agreements']
              : tool === 'git'
                ? ['winget install --id Git.Git --source winget --accept-source-agreements']
                : [
                    'winget install --id TortoiseSVN.TortoiseSVN --accept-source-agreements',
                    'winget install --id Git.Git --source winget --accept-source-agreements',
                  ];
          send({ line: 'Windows 环境：请在终端以管理员身份执行以下命令安装：' });
          for (const c of cmds) send({ line: `  ${c}` });
          send({ done: true, code: 1, manual: cmds.join(' && ') });
          res.end();
          return;
        }
        // Linux：sudo apt（免密 sudo 自动装，否则给手动命令）
        const pkgs = tool === 'svn' ? ['subversion'] : tool === 'git' ? ['git'] : ['git', 'subversion'];
        const sudoOk = await run('sudo', ['-n', 'true'], { timeoutMs: 10_000 });
        send({ line: `检测 root 权限… ${sudoOk.code === 0 ? '✓ 可用' : '✗ 需要密码（请用下方手动命令）'}` });
        if (sudoOk.code !== 0) {
          send({ done: true, code: 1, manual: `sudo apt-get install -y ${pkgs.join(' ')}` });
          res.end();
          return;
        }
        send({ line: `开始安装: ${pkgs.join(' ')}…` });
        const child = spawn('sudo', ['-n', 'apt-get', 'install', '-y', ...pkgs], { stdio: ['ignore', 'pipe', 'pipe'] });
        child.stdout.on('data', (d: Buffer) => send({ line: d.toString() }));
        child.stderr.on('data', (d: Buffer) => send({ line: d.toString() }));
        child.on('error', (e) => {
          send({ line: `启动失败: ${e.message}` });
          send({ done: true, code: 1, manual: `sudo apt-get install -y ${pkgs.join(' ')}` });
          res.end();
        });
        child.on('close', (code) => {
          send({ line: code === 0 ? '✅ 安装完成' : `❌ 安装失败（退出码 ${code}）` });
          send({ done: true, code: code ?? 1 });
          res.end();
        });
        return;
      }

      // ---------- 静态文件 ----------
      // 未知 API 路径和 favicon 返回明确 404（不能落到 SPA fallback 返回 HTML）
      if (p.startsWith('/api/') || p === '/favicon.ico') {
        sendJson(res, 404, { error: 'not found' });
        return;
      }
      let filePath = p === '/' ? path.join(WEB_DIR, 'index.html') : path.join(WEB_DIR, p);
      if (!filePath.startsWith(WEB_DIR)) {
        sendJson(res, 403, { error: 'forbidden' });
        return;
      }
      if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        filePath = path.join(WEB_DIR, 'index.html');
      }
      if (!fs.existsSync(filePath)) {
        sendJson(res, 404, { error: 'not found' });
        return;
      }
      const ext = path.extname(filePath);
      const st = fs.statSync(filePath);
      res.writeHead(200, {
        'Content-Type': MIME[ext] ?? 'application/octet-stream',
        'Cache-Control': 'no-store',
        'Last-Modified': st.mtime.toUTCString(),
      });
      res.end(fs.readFileSync(filePath));
    } catch (err) {
      const e = err as Error;
      const auth = isAuthError(e);
      sendJson(res, 500, { error: e.message, authError: auth });
    }
  });

  return new Promise((resolve) => {
    // 固定端口(可预期、便于收藏)，被占用时自动换随机端口
    const DEFAULT_PORT = 23456;
    server.once('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        console.warn(`端口 ${DEFAULT_PORT} 被占用，改用随机端口`);
        server.listen(0, '127.0.0.1', onListen);
      } else {
        throw err;
      }
    });
    const onListen = () => {
      const port = (server.address() as AddressInfo).port;
      resolve({
        port,
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise((r) => server.close(() => r())),
      });
    };
    server.listen(DEFAULT_PORT, '127.0.0.1', onListen);
  });
}
