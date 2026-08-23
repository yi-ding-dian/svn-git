/** HTTP 服务：REST API（复用 vcs 层）+ 静态文件。只监听 127.0.0.1 */
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import type { AddressInfo } from 'node:net';
import { detectCwd, detectRepo } from './vcs/detect.js';
import { createVcs, type RepoInfo, type VcsResult } from './vcs/index.js';
import {
  isBinaryFile, inRepoRoot, isSafeOrigin, sendJson, readBody, isAuthError,
  getStatusCached, realpathSafe, readTextFile, vcsOf, repoInfo,
  currentScopes, STATUS_TTL, statusCache, authErrorOf,
  type Ctx,
} from './routes/util.js';
import { isIgnoredByRules, getSvnIgnoreMap } from './vcs/ignore.js';
import { diffChangedLines } from './vcs/diff-lines.js';
import { run } from './vcs/exec.js';
import { loadConfig, saveConfig } from './config.js';
import type { SvnCred } from './vcs/svn.js';
import { handle as handleConflicts } from './routes/conflicts.js';
import { handle as handleBranch } from './routes/branch.js';
import { handle as handleOps } from './routes/ops.js';

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
  /** 常用项目标记（星号，启动时优先打开） */
  fav?: boolean;
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
    const existed = loadHistory().find((h) => h.path === entry.path);
    const list = loadHistory().filter((h) => h.path !== entry.path);
    list.unshift({ ...entry, lastOpened: Date.now(), fav: existed?.fav }); // 保留常用标记（打开项目不丢星号）
    fs.mkdirSync(path.dirname(HISTORY_PATH), { recursive: true });
    fs.writeFileSync(HISTORY_PATH, JSON.stringify(list.slice(0, HISTORY_MAX), null, 2));
    fs.chmodSync(HISTORY_PATH, 0o600); // 与 config 一致，仅本人可读写
  } catch {
    /* 忽略写失败 */
  }

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

/** 修改时间格式化: "2026/8/23 11:17"（不同于 toLocaleString.slice 会留下尾冒号） */
function fmtMtime(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Linux 发行版包管理器探测（/etc/os-release）：返回安装命令与手动命令;未知回退 apt(Debian 系默认)。 */
function detectDistro(): { name: string; manager: string; install: string[]; manual: string } {
  let id = '';
  try {
    const osr = fs.readFileSync('/etc/os-release', 'utf8');
    const m = osr.match(/^ID=([\w.-]+)/m);
    if (m) id = m[1]!.toLowerCase();
  } catch {
    /* 读失败按未知处理 */
  }
  const arg = ['git', 'subversion'].join(' ');
  switch (id) {
    case 'fedora':
      return { name: 'Fedora', manager: 'dnf', install: ['sudo', '-n', 'dnf', 'install', '-y', 'git', 'subversion'], manual: `sudo dnf install -y ${arg}` };
    case 'rhel':
    case 'centos':
      return { name: 'CentOS/RHEL', manager: 'yum', install: ['sudo', '-n', 'yum', 'install', '-y', 'git', 'subversion'], manual: `sudo yum install -y ${arg}` };
    case 'opensuse':
    case 'opensuse-leap':
    case 'opensuse-tumbleweed':
      return { name: 'openSUSE', manager: 'zypper', install: ['sudo', '-n', 'zypper', '--non-interactive', 'install', 'git', 'subversion'], manual: `sudo zypper --non-interactive install -y ${arg}` };
    case 'arch':
      return { name: 'Arch', manager: 'pacman', install: ['sudo', '-n', 'pacman', '-S', '--noconfirm', 'git', 'subversion'], manual: `sudo pacman -S --noconfirm ${arg}` };
    default:
      return { name: id || '未知发行版', manager: 'apt', install: ['sudo', '-n', 'apt-get', 'install', '-y', 'git', 'subversion'], manual: `sudo apt-get install -y ${arg}` };
  }
}

/** 扩展名 → MIME（办公文档/图片/文本/压缩包,用于匹配系统 .desktop 程序） */
const EXT_MIME: Record<string, string> = {
  pdf: 'application/pdf', doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  odt: 'application/vnd.oasis.opendocument.text', ods: 'application/vnd.oasis.opendocument.spreadsheet', odp: 'application/vnd.oasis.opendocument.presentation',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', svg: 'image/svg+xml', webp: 'image/webp', bmp: 'image/bmp', ico: 'image/x-icon',
  txt: 'text/plain', md: 'text/markdown', log: 'text/plain', rst: 'text/plain', csv: 'text/csv',
  zip: 'application/zip', rar: 'application/vnd.rar', '7z': 'application/x-7z-compressed', tar: 'application/x-tar', gz: 'application/gzip',
};

/** 扫描系统 .desktop 程序（/usr/share/applications + ~/.local/share/applications）,按 MimeType 匹配返回可选择的打开方式 */
function scanDesktopApps(): { name: string; exec: string; mimes: Set<string> }[] {
  const dirs = [
    '/usr/share/applications',
    '/usr/local/share/applications',
    path.join(os.homedir(), '.local', 'share', 'applications'),
  ];
  const apps: { name: string; exec: string; mimes: Set<string>; noDisplay: boolean }[] = [];
  for (const dir of dirs) {
    let files: string[];
    try {
      files = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const f of files) {
      if (!f.endsWith('.desktop')) continue;
      try {
        const text = fs.readFileSync(path.join(dir, f), 'utf8');
        let name = '';
        let nameLocal = '';
        let exec = '';
        let mimes = new Set<string>();
        let noDisplay = false;
        let type = '';
        let hidden = false;
        for (const raw of text.split('\n')) {
          const line = raw.trim();
          if (line.startsWith('[') || !line.includes('=')) continue;
          const [k, v] = [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)];
          if (k === 'Name') name = v;
          else if (k.startsWith('Name[')) nameLocal = v;
          else if (k === 'Exec') exec = v;
          else if (k === 'MimeType') mimes = new Set(v.split(';').filter(Boolean));
          else if (k === 'NoDisplay') noDisplay = v === 'true';
          else if (k === 'Type') type = v;
          else if (k === 'Hidden') hidden = v === 'true';
        }
        if (!name || !exec || noDisplay || hidden || (type && type !== 'Application')) continue;
        apps.push({ name: nameLocal || name, exec, mimes, noDisplay });
      } catch {
        /* 单个文件损坏跳过 */
      }
    }
  }
  // 去重（优先本地程序）：Exec+Name 同视为重复;本地目录优先级已由遍历顺序保证
  const seen = new Set<string>();
  const out: { name: string; exec: string; mimes: Set<string> }[] = [];
  for (const a of apps) {
    const key = `${a.exec}|${a.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name: a.name, exec: a.exec, mimes: a.mimes });
  }
  return out;
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
      // CSRF 防护:全 API 层拦截带非本机 Origin 的请求(任意网页无法触达含副作用端点,如 shutdown/open/env-install)
      if (p.startsWith('/api/') && !isSafeOrigin(req)) {
        sendJson(res, 403, { error: '拒绝跨站请求' });
        return;
      }
      // 端点域模块（冲突防护 / 分支标签 / 操作类），按序尝试分发
      {
        const ctx: Ctx = { req, res, url, p };
        if (await handleConflicts(ctx)) return;
        if (await handleBranch(ctx)) return;
        if (await handleOps(ctx)) return;
      }
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
        });
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
        sendJson(res, 200, await vcs.gitInfo?.());
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
        sendJson(res, 200, await vcs.setRemote?.(url));
        return;
      }
      if (p === '/api/mkdir' && req.method === 'POST') {
        // 目录选择器：新建文件夹——系统级目录操作（打开项目的路径选择处使用,路径可不在任何仓库内,
        // 无仓库路径语义,故不做 inRepoRoot 校验,仅受 CSRF 同源限制（本地凭证场景））
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
        // 目录选择器：重命名文件夹——同 mkdir,系统级操作不校验仓库路径。
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

      if (p === '/api/open' && req.method === 'POST') {
        // 打开指定仓库（前端浏览到仓库后点击进入）；POST-only：切换仓库属有副作用操作，不接受 GET
        const body = await readBody(req);
        const dir = String(body.path ?? '');
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
        // 记录操作范围：打开的目录相对仓库根(子项目);打开根目录则为空(全仓库)
        currentScopes.set(r.root, dir === r.root ? '' : path.relative(r.root, dir));
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
          /** 文件大小（目录 0）与修改时间（目录空）——供悬浮卡片展示 */
          size?: number;
          mtime?: string;
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
            const n: TNode = { name: rel.split('/').pop() || rel, path: rel, isDir: false, code, children: [] };
            // 大小/修改时间: 供过滤视图的悬浮卡片展示（与 /api/fs 一致）
            try {
              const st = fs.statSync(path.join(repo.root, rel));
              n.size = st.size;
              n.mtime = fmtMtime(st.mtimeMs);
            } catch {
              /* ignore */
            }
            map.set(rel, n);
            arr.push(n);
          }
        };
        // 忽略规则（与 /api/fs 一致）：未版本化目录展开时,被 .gitignore 匹配的条目不显示为 '?'
        let gitignoreRules: string[] | null = null;
        const loadGitignore = (): string[] => {
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
            // 被忽略规则匹配（如 dist/、node_modules/）→ 不视为新文件,跳过
            if (isIgnoredByRules(loadGitignore(), n)) continue;
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
            // 目录操作集合：同时显示 M/A/D 等全部操作标识；排除未版本化 '?' 与无变更 ' '；
            // 外部引用 'X' 不进父目录集合（只显示在引用目录自身，避免 src/trunk 等全带标识）
            codes = [...new Set(sub.map((s) => s.code).filter((c) => c && c !== '?' && c !== ' ' && c !== 'none' && c !== 'X'))];
            codes.sort((a, b) => CODES_ORDER.indexOf(a) - CODES_ORDER.indexOf(b));
          }
          // 目录自身被忽略(I)：子级无操作时徽标也应显示 I（避免被误显示为干净的 √）
          if (code === 'I' && !codes) codes = ['I'];
          // 目录自身未版本化（整个目录不在版本库）：徽标显示 '?'（与文件一致，避免误显干净的 √）
          if (code === '?' && !codes) codes = ['?'];
          // 目录自身是外部引用（svn:externals 拉取的内容）：自身显示链环标识（父目录不显示）
          if (code === 'X' && !codes?.includes('X')) codes = codes ? [...codes, 'X'] : ['X'];
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
            mtime: fmtMtime(st.mtimeMs),
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
            selfLocked = (await vcs.selfLockedFiles?.()) ?? [];
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
        // 路径越界校验：svn log 会把 ../ 解析到仓库外的其他工作副本
        if (pathRel && !inRepoRoot(repo.root, path.resolve(repo.root, pathRel))) {
          sendJson(res, 400, { error: '路径越界' });
          return;
        }
        const limit = Number(url.searchParams.get('limit') ?? 200);
        const logs = await vcs.log(limit, pathRel);
        // git:附带未推送提交 hash 列表(历史视图绿灯标记);svn 无此概念
        let unpushed: string[] = [];
        if (repo.type === 'git') {
          try {
            unpushed = (await vcs.unpushed?.()) ?? [];
          } catch {
            /* 计算失败不阻断历史列表 */
          }
        }
        sendJson(res, 200, { logs, unpushed, total: 0 });
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
          const out = await vcs.show?.(`${rev}:${r}`);
          return out && out.ok ? out.output : '';
        };
        const svnCat = async (rev: string, r: string): Promise<string> => {
          const out = await vcs.catRev?.(rev, r);
          return out && out.ok ? out.output : '';
        };
        if (repo.type === 'git') {
          leftLabel = a ? a : 'HEAD（原版）';
          rightLabel = b ? b : '工作区（当前）';
          left = await gitShow(a ?? 'HEAD', rel);
          // 工作区裸读：readTextFile 含大小预检（>5MB 不整读入内存）
          right = b ? await gitShow(b, rel) : readTextFile(abs);
        } else {
          leftLabel = a ? `r${a}` : 'BASE（原版）';
          rightLabel = b ? `r${b}` : '工作区（当前）';
          left = await svnCat(a ?? 'BASE', rel);
          right = b ? await svnCat(b, rel) : readTextFile(abs);
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
        // 路径越界校验：svn diff 会把 ../ 解析到仓库外的其他工作副本
        if (pathRel && !inRepoRoot(repo.root, path.resolve(repo.root, pathRel))) {
          sendJson(res, 400, { error: '路径越界' });
          return;
        }
        if (pathRel && isBinaryFile(pathRel)) {
          sendJson(res, 200, { ok: false, output: '', error: `二进制文件（${pathRel}），不支持文本对比` });
          return;
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
        return;
      }

      if (p === '/api/show') {
        const { vcs, repo } = vcsOf();
        const rev = url.searchParams.get('rev') || '';
        const pathRel = url.searchParams.get('path') || undefined;
        if (pathRel && isBinaryFile(pathRel)) {
          sendJson(res, 200, { ok: false, output: '', error: `二进制文件（${pathRel}），不支持文本对比` });
          return;
        }
        if (repo.type === 'git') {
          const s = await vcs.show?.(rev, pathRel);
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
          // 转换失败（提交路径不属于当前工作副本，如其他分支/标签的提交）→
          // 尝试从服务器 URL 直接 diff（不依赖本地工作副本，需网络）；失败再明确提示。
          // URL 用 ^/ 仓库根相对语法：在 wc 内由 svn 自己解析仓库根，绕开 URL 映射
          // （入口 /software2 与仓库内路径 /projects 不一致）拼接错误的问题
          if (pathRel && y === '') {
            try {
              if (pathRel.startsWith('/')) {
                const du = await vcs.diffUrl?.(String(n - 1), rev, '^' + pathRel);
                if (du && (du.ok || du.output)) {
                  sendJson(res, 200, du);
                  return;
                }
              }
            } catch {
              /* URL 失败走下方提示 */
            }
            sendJson(res, 200, { ok: false, output: '', error: `该文件不在当前工作副本中，无法查看差异：${pathRel}` });
            return;
          }
          const d = await vcs.diff(String(n - 1), rev, rel);
          // 文件不在当前工作副本（D 已删除 / A 未更新到本地）或新增文件版本间不存在 →
          // 回退服务器 URL 版本间比较（不依赖工作副本，A/D 都能输出）；
          // URL 也失败时（极端场景）用 svn cat 取内容构造"整文件新增"
          if ((!d.ok || !d.output.trim()) && pathRel && pathRel.startsWith('/')) {
            try {
              const url = '^' + pathRel;
              const du = await vcs.diffUrl?.(String(n - 1), rev, url);
              if (du && (du.ok || du.output)) {
                sendJson(res, 200, du);
                return;
              }
              // cat 兜底：URL 带 @rev peg（路径在 HEAD 已删除时无 peg 会解析失败）
              const cat = await vcs.catRev?.(rev, `${url}@${rev}`);
              if (cat && cat.ok && cat.output) {
                const lines = cat.output.split('\n');
                if (lines.length && lines[lines.length - 1] === '') lines.pop();
                const range = lines.length === 0 ? '0,0' : `1,${lines.length}`;
                sendJson(res, 200, {
                  ok: true,
                  output:
                    `--- ${pathRel}\t(不存在的)\n+++ ${pathRel}\t(版本 ${rev})\n@@ -0,0 +${range} @@\n` +
                    lines.map((l: string) => '+' + l).join('\n'),
                });
                return;
              }
            } catch {
              /* 保持原结果 */
            }
          }
          sendJson(res, 200, d);
        }
        return;
      }

      if (p === '/api/ls') {
        const { vcs, repo } = vcsOf();
        const dir = url.searchParams.get('dir') || '';
        // svn list 以 URL 语义解析参数，防 ../ 指向仓库根之外（^/ 相对 URL 除外）
        if (dir && !dir.startsWith('^/') && !inRepoRoot(repo.root, path.resolve(repo.root, dir))) {
          sendJson(res, 400, { error: '路径越界' });
          return;
        }
        const list = await vcs.ls(dir);
        sendJson(res, 200, { items: list, repoType: repo.type });
        return;
      }

      if (p === '/api/cat') {
        const { vcs, repo } = vcsOf();
        const rel = url.searchParams.get('path') || '';
        let out: { ok: boolean; output: string; error?: string };
        if (repo.type === 'git') {
          // git.cat 内部有磁盘回退（未跟踪文件读盘），同样先做越界校验防 ../ 出界
          const abs = path.resolve(repo.root, rel);
          if (!inRepoRoot(repo.root, abs)) {
            sendJson(res, 400, { ok: false, output: '', error: '路径越界' });
            return;
          }
          out = (await vcs.cat?.(rel)) ?? { ok: false, output: '', error: '读取失败' };
        } else {
          // svn 工作副本直接读本地文件
          const abs = path.resolve(repo.root, rel);
          // 路径越界校验：svn 分支是裸磁盘读取,与 /api/file-versions 一致,防 ../ 穿越与符号链接出界
          if (!inRepoRoot(repo.root, abs)) {
            sendJson(res, 400, { ok: false, output: '', error: '路径越界' });
            return;
          }
          if (!fs.existsSync(abs)) {
            sendJson(res, 404, { ok: false, output: '', error: '文件不存在' });
            return;
          }
          out = { ok: true, output: readTextFile(abs) };
        }
        sendJson(res, 200, out);
        return;
      }

      if (p === '/api/file') {
        // md 预览图片：读取仓库内文件（仅图片扩展名 + 防目录穿越）
        const { repo } = vcsOf();
        const fileRel = url.searchParams.get('path') || '';
        if (!/\.(png|jpe?g|gif|svg|webp|bmp|ico)$/i.test(fileRel)) {
          sendJson(res, 400, { error: '仅支持图片文件' });
          return;
        }
        const root = path.resolve(repo.root);
        const abs = path.resolve(root, fileRel);
        // 统一 inRepoRoot（含 realpath）：与其余端点一致,防 symlink 出界
        if (!inRepoRoot(repo.root, abs)) {
          sendJson(res, 400, { error: '路径越界' });
          return;
        }
        if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
          sendJson(res, 404, { error: '文件不存在' });
          return;
        }
        // 超大图片（如几百 MB 的 PNG）：整读入内存会 OOM,读前拦截
        const imgSize = fs.statSync(abs).size;
        if (imgSize > 50 * 1024 * 1024) {
          sendJson(res, 400, { error: '图片过大（超过 50MB），无法预览' });
          return;
        }
        const ext = abs.split('.').pop()!.toLowerCase();
        /** 修改时间格式化: "2026/8/23 11:17"（不同于 toLocaleString.slice 会留下尾冒号） */
function fmtMtime(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Linux 发行版包管理器探测（/etc/os-release）：返回安装命令与手动命令;未知回退 apt(Debian 系默认)。 */
function detectDistro(): { name: string; manager: string; install: string[]; manual: string } {
  let id = '';
  try {
    const osr = fs.readFileSync('/etc/os-release', 'utf8');
    const m = osr.match(/^ID=([\w.-]+)/m);
    if (m) id = m[1]!.toLowerCase();
  } catch {
    /* 读失败按未知处理 */
  }
  const arg = ['git', 'subversion'].join(' ');
  switch (id) {
    case 'fedora':
      return { name: 'Fedora', manager: 'dnf', install: ['sudo', '-n', 'dnf', 'install', '-y', 'git', 'subversion'], manual: `sudo dnf install -y ${arg}` };
    case 'rhel':
    case 'centos':
      return { name: 'CentOS/RHEL', manager: 'yum', install: ['sudo', '-n', 'yum', 'install', '-y', 'git', 'subversion'], manual: `sudo yum install -y ${arg}` };
    case 'opensuse':
    case 'opensuse-leap':
    case 'opensuse-tumbleweed':
      return { name: 'openSUSE', manager: 'zypper', install: ['sudo', '-n', 'zypper', '--non-interactive', 'install', 'git', 'subversion'], manual: `sudo zypper --non-interactive install -y ${arg}` };
    case 'arch':
      return { name: 'Arch', manager: 'pacman', install: ['sudo', '-n', 'pacman', '-S', '--noconfirm', 'git', 'subversion'], manual: `sudo pacman -S --noconfirm ${arg}` };
    default:
      return { name: id || '未知发行版', manager: 'apt', install: ['sudo', '-n', 'apt-get', 'install', '-y', 'git', 'subversion'], manual: `sudo apt-get install -y ${arg}` };
  }
}

const MIME: Record<string, string> = {
          png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
          svg: 'image/svg+xml', webp: 'image/webp', bmp: 'image/bmp', ico: 'image/x-icon',
        };
        res.writeHead(200, { 'Content-Type': MIME[ext] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
        res.end(fs.readFileSync(abs));
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

      if (p === '/api/shutdown' && req.method === 'POST') {
        sendJson(res, 200, { ok: true });
        setTimeout(() => process.exit(0), 200);
        return;
      }

      // ---------- 版本管理扩展 API ----------
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
          // svnadmin create（本地仓库）+ 可选标准布局 + 工作副本
          fs.mkdirSync(target, { recursive: true });
          const r = await run('svnadmin', ['create', target], { timeoutMs: 120_000 });
          if (r.code !== 0) {
            result = { ok: false, message: r.stderr.trim() || 'svnadmin create 失败' };
          } else {
            let wcUrl = `file://${target}`;
            const standard = body.standard !== false;
            if (standard) {
              // 标准布局：创建 trunk/branches/tags（svn 分支机制依赖目录约定）
              const mk = await run(
                'svn',
                ['mkdir', '-q', `${wcUrl}/trunk`, `${wcUrl}/branches`, `${wcUrl}/tags`, '-m', '创建标准布局 trunk/branches/tags'],
                { timeoutMs: 60_000 }
              );
              if (mk.code !== 0) {
                sendJson(res, 200, { ok: false, message: `标准布局创建失败: ${mk.stderr.trim() || '未知'}`, authError: false });
                return;
              }
              // 工作副本检出 trunk（根下只有布局目录，检出根会把 branches 全部拖进来）
              wcUrl += '/trunk';
            }
            const wcDir = target + '-wc';
            const c = await run('svn', ['checkout', '-q', wcUrl, wcDir], { timeoutMs: 120_000 });
            result = c.code === 0
              ? { ok: true, message: `已创建 SVN 仓库 ${target}${standard ? '（标准布局，工作副本检出 trunk）' : ''}（工作副本 ${wcDir}）`, repoDir: wcDir }
              : { ok: true, message: `已创建 SVN 仓库 ${target}${standard ? '（标准布局）' : ''}（工作副本检出失败: ${c.stderr.trim() || '未知'}）`, repoDir: wcDir };
          }
        } else {
          sendJson(res, 400, { error: '未知仓库类型' });
          return;
        }
        sendJson(res, 200, { ...result, authError: false });
        return;
      }

      if (p === '/api/remotes') {
        const { repo, vcs } = vcsOf();
        if (repo.type !== 'git') {
          sendJson(res, 200, { remotes: [] });
          return;
        }
        const remotes = (await vcs.remoteList?.()) ?? [];
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

      if (p === '/api/apps-for') {
        // 系统可用打开方式（办公/图片/文本/压缩文档）：按 MimeType 匹配 .desktop 程序
        const ext = (url.searchParams.get('ext') ?? '').toLowerCase();
        const mime = EXT_MIME[ext];
        const apps = mime ? scanDesktopApps().filter((a) => a.mimes.has(mime)) : [];
        sendJson(res, 200, { apps: apps.map((a) => ({ name: a.name, exec: a.exec })) });
        return;
      }

      if (p === '/api/open-with' && req.method === 'POST') {
        // 用指定系统程序打开仓库内文件（.desktop Exec 模板解析,argv 数组 spawn,无 shell 注入面）
        const { repo } = vcsOf();
        const body = await readBody(req);
        const rel = String(body.path ?? '');
        const exec = String(body.exec ?? '');
        const abs = path.resolve(repo.root, rel);
        if (!inRepoRoot(repo.root, abs)) {
          sendJson(res, 400, { error: '路径越界' });
          return;
        }
        if (!fs.existsSync(abs)) {
          sendJson(res, 404, { error: '文件不存在' });
          return;
        }
        try {
          // Exec 模板还原: 引号支持 + %f/%u 单文件占位(替换为绝对路径) + %F/%U 多文件(此处单文件=路径)
          // %c/%i/%k/%d/%D/%n/%N 等装饰类占位移除以保持 argv 正确
          let ex = exec
            .replace(/%[fFuU]/g, () => abs)
            .replace(/%(?:[cikdDnNvm]|[fFuU]+)/g, '');
          const argv = ex.match(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\S+/g) ?? [];
          const cmd = argv.map((s) => s.replace(/^["']|["']$/g, ''));
          if (!cmd.length) throw new Error('Exec 为空');
          const child = spawn(cmd[0]!, cmd.slice(1), { detached: true, stdio: 'ignore' });
          child.on('error', (e) => sendJson(res, 500, { ok: false, error: `启动失败: ${e.message}` }));
          child.unref();
          sendJson(res, 200, { ok: true, message: `已用 ${cmd[0]} 打开: ${rel}` });
        } catch (e) {
          sendJson(res, 500, { ok: false, error: (e as Error).message });
        }
        return;
      }

      if (p === '/api/net-check') {
        // 远程连通性检测（网络灯）：只握手不取数据(git ls-remote / svn ls),8s 超时。
        // 区分"网络断"与"认证失败"：认证失败=网络通的（前端显示绿,tooltip 说明认证问题）
        const { repo, vcs } = vcsOf();
        let ok = false;
        let reason = '未知错误';
        try {
          if (repo.type === 'git') {
            const u = await run('git', ['remote', 'get-url', 'origin'], { cwd: repo.root, timeoutMs: 8_000 });
            if (u.code !== 0 || !u.stdout.trim()) {
              ok = true; // 未配置远程：无远程可检,不视为离线
              reason = '未配置远程';
            } else {
              const r = await run('git', ['ls-remote', 'origin'], { cwd: repo.root, timeoutMs: 8_000 });
              const errText = (r.stderr + '\n' + r.stdout).trim();
              if (r.code === 0) {
                ok = true; reason = '网络正常';
              } else if (/auth|credential|401|403|could not read Username|terminal prompts/i.test(errText)) {
                ok = true; reason = '已连通（认证失败，需检查令牌）';
              } else {
                ok = false; reason = errText.split('\n')[0] || '连接失败';
              }
            }
          } else {
            // svn: 访问仓库 URL（工作副本 svn info 无网络请求,必须直接打 URL）。
            // repo.url 恒空（detectRepo 不含 url），改用 vcs.info() 与 /api/info 同源获取
            const info = await vcs.info?.();
            const url = info?.url ?? repo.url;
            if (!url) {
              ok = true; reason = '未配置仓库 URL';
            } else {
              const r = await run('svn', ['ls', url], { timeoutMs: 8_000 });
              const errText = r.stderr.trim();
              if (r.code === 0) {
                ok = true; reason = '网络正常';
              } else if (/E170001|Authorization failed|Authentication failed/i.test(errText)) {
                ok = true; reason = '已连通（认证失败，请检查账号）';
              } else {
                ok = false; reason = errText.split('\n')[0] || '连接失败';
              }
            }
          }
        } catch (e) {
          ok = false;
          reason = (e as Error).message;
        }
        sendJson(res, 200, { ok, reason });
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
        // Linux：按发行版探测包管理器（apt/dnf/yum/zypper/pacman），免密 sudo 自动装，否则给手动命令
        const pkgs =
          tool === 'svn' ? ['subversion'] : tool === 'git' ? ['git'] : ['git', 'subversion'];
        /** 发行版包管理器探测（/etc/os-release）：不同发行版 svn/git 包名与安装命令不同 */
        const distro = await detectDistro();
        const install = distro.install; // ['sudo','-n',<manager>,...]
        const manual = distro.manual; // 手动命令全文
        const sudoOk = await run('sudo', ['-n', 'true'], { timeoutMs: 10_000 });
        send({ line: `检测 root 权限… ${sudoOk.code === 0 ? '✓ 可用' : '✗ 需要密码（请用下方手动命令）'}` });
        send({ line: `发行版: ${distro.name}（${distro.manager}）` });
        if (sudoOk.code !== 0) {
          send({ done: true, code: 1, manual });
          res.end();
          return;
        }
        send({ line: `开始安装: ${pkgs.join(' ')}…` });
        const child = spawn(install[0]!, install.slice(1), { stdio: ['ignore', 'pipe', 'pipe'] });
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