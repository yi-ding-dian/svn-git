/** 模块索引域：md 文件说明注入——文件列表名称右侧显示自定义描述。
 * 索引快照存 ~/.config/svngit/module-index.json（600 权限，同 config 惯例）；
 * 解析 md 的"目录树与文件说明"代码块（'路径 ← 描述'）与 md 表格（'| 路径 | 描述 |'）两种格式。
 * 作用域 = 注入时选定的仓库相对目录（前端默认当前浏览目录），只对该目录及子树生效。 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sendJson, readBody, repoInfo, type Ctx } from './util.js';

/** 单条路径→描述 */
export interface IndexEntry {
  path: string;
  desc: string;
}

/** 一个作用目录的索引：md 来源 + 条目（快照：md 修改后需重新注入更新） */
export interface DirIndex {
  md: string;
  entries: IndexEntry[];
}

const INDEX_PATH = path.join(os.homedir(), '.config', 'svngit', 'module-index.json');

type IndexFile = { repos: Record<string, Record<string, DirIndex>> }; // 仓库根 → 作用目录 → 索引

function loadIndex(): IndexFile {
  try {
    if (!fs.existsSync(INDEX_PATH)) return { repos: {} };
    return JSON.parse(fs.readFileSync(INDEX_PATH, 'utf8')) as IndexFile;
  } catch {
    return { repos: {} };
  }
}

function saveIndex(idx: IndexFile): void {
  try {
    fs.mkdirSync(path.dirname(INDEX_PATH), { recursive: true });
    fs.writeFileSync(INDEX_PATH, JSON.stringify(idx, null, 2), { mode: 0o600 });
  } catch {
    /* 保存失败静默（索引非关键数据） */
  }
}

/** 解析 md 文本中的路径→描述：
 * ① 树图行　`├── server.ts   ← HTTP 服务骨架…`——**层级感知**：按树形前缀（│├└─ 与空格）列宽维护
 *    父目录栈，`src/ 下 server.ts` 解析为 `src/server.ts`（与文件列表 rel 一致）；目录行（结尾 /）
 *    参与建栈；无描述目录只建栈不入条目；首行无 ← 的顶层目录当作"文档根头"剥掉（如 svn-git/）
 * ② 表格行　`| server.ts | HTTP 服务骨架… |`（跳过表头/分隔行，路径按原样）
 * ③ 其余行忽略。目录路径尾部 '/' 剥掉。 */
export function parseModuleIndex(md: string): IndexEntry[] {
  const clean = (p: string) => p.trim().replace(/\/+$/, '');
  const out: IndexEntry[] = [];
  const stack: { col: number; dir: string }[] = []; // 父目录栈（col=树形前缀列宽）
  let seenTop = false; // 是否已见过"文档根头"（首行 col0 无 ← 目录）
  let inFence = false; // 树图只在 ``` 代码块内解析（块外的 > 描述/MD 正文不参与）
  for (const line of md.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    // 代码块开关
    if (/^```/.test(t)) {
      inFence = !inFence;
      continue;
    }
    // 表格行（独立格式，不改栈；代码块内外均可）
    const tbl = t.match(/^\|([^|]+)\|([^|]+)\|/);
    if (tbl) {
      const p = clean(tbl[1]!);
      const d = tbl[2]!.trim();
      if (!p || !d || /^[-:\s]+$/.test(p)) continue; // 表头/分隔行
      out.push({ path: p, desc: d });
      continue;
    }
    if (!inFence) continue; // 代码块外其余行忽略
    // 树形行：前缀(树字符+空格) + 路径段 + 可选 ← 描述
    const m = t.match(/^([│├└┌─\s]*)([^\s←]+?)\s*((?:←\s*)(.+))?$/);
    if (!m || !m[2] || /^[│├└┌─]+$/.test(m[2])) continue; // 纯树干行（如 │   │）
    const prefix = m[1]!;
    const rawSeg = m[2]!;
    const desc = m[4]?.trim();
    const isDir = rawSeg.endsWith('/');
    const seg = clean(rawSeg);
    const col = prefix.length; // 树形前缀字符数（每层约 4 字符）
    // 文档根头：尚无任何条目且首行无 ← 的顶层目录（如 svn-git/）→ 剥掉不建栈不入条；
    // 若前面已出现过条目（如测试样本先列文件再列 src/）则 src/ 是真实目录，正常入栈
    if (!seenTop && col === 0 && isDir && !desc && out.length === 0) {
      seenTop = true;
      stack.length = 0;
      continue;
    }
    while (stack.length && stack[stack.length - 1]!.col >= col) stack.pop();
    const joined = stack.length ? `${stack[stack.length - 1]!.dir}/${seg}` : seg;
    if (isDir) {
      // 目录：入栈（供后代拼接）；带 ← 描述的目录同时作为条目
      stack.push({ col, dir: joined });
      if (desc) out.push({ path: joined, desc });
    } else if (desc) {
      out.push({ path: joined, desc });
    }
  }
  return out;
}

/** 读仓库内 md 并解析（越界/不存在返回 null；前端 preview 与 POST 注入共用同一解析口径） */
function parseRepoMd(repoRoot: string, mdRel: string): IndexEntry[] | null {
  const mdAbs = path.resolve(repoRoot, mdRel);
  if (!mdAbs.startsWith(repoRoot + path.sep)) return null;
  let text: string;
  try {
    text = fs.readFileSync(mdAbs, 'utf8');
  } catch {
    return null;
  }
  return parseModuleIndex(text);
}

export async function handle(ctx: Ctx): Promise<boolean> {
  const { req, res, url } = ctx;
  const p = url.pathname;
  const repo = repoInfo();

  if (p === '/api/module-index' && req.method === 'GET') {
    if (!repo) {
      sendJson(res, 400, { error: '未打开仓库' });
      return true;
    }
    sendJson(res, 200, { indexes: loadIndex().repos[repo.root] ?? {} });
    return true;
  }

  if (p === '/api/module-index/preview' && req.method === 'GET') {
    // 注入前预览解析结果（弹窗列举给用户勾选）
    if (!repo) {
      sendJson(res, 400, { error: '未打开仓库' });
      return true;
    }
    const md = url.searchParams.get('md') ?? '';
    const entries = parseRepoMd(repo.root, md);
    if (!entries) {
      sendJson(res, 400, { error: '解析失败：md 文件不存在或不在仓库内，或未找到「路径 ← 描述」条目' });
      return true;
    }
    sendJson(res, 200, { entries });
    return true;
  }

  if (p === '/api/module-index' && req.method === 'POST') {
    // 注入（或更新覆盖）：快照 md 解析结果；included 为前端勾选保留的 path 清单（缺省全保留）
    if (!repo) {
      sendJson(res, 400, { error: '未打开仓库' });
      return true;
    }
    const body = await readBody(req);
    const dir = String(body.dir ?? '').trim();
    const md = String(body.md ?? '').trim();
    if (!dir.startsWith('/') && dir.split(path.sep).includes('..')) {
      sendJson(res, 400, { error: '作用目录非法' });
      return true;
    }
    if (dir && !path.resolve(repo.root, dir).startsWith(repo.root + path.sep)) {
      sendJson(res, 400, { error: '作用目录越界' });
      return true;
    }
    const entries = parseRepoMd(repo.root, md);
    if (!entries) {
      sendJson(res, 400, { error: '解析失败：md 文件不存在或不在仓库内' });
      return true;
    }
    const included = Array.isArray(body.included) ? (body.included as string[]) : null;
    const filtered = included ? entries.filter((e) => included.includes(e.path)) : entries;
    // 重复 path 去重（树图/表格中同名条目出现多次时保首次），避免同一行显示多条描述
    const seen = new Set<string>();
    const final = filtered.filter((e) => {
      if (seen.has(e.path)) return false;
      seen.add(e.path);
      return true;
    });
    const idx = loadIndex();
    const byRoot = idx.repos[repo.root] ?? {};
    byRoot[dir] = { md, entries: final };
    idx.repos[repo.root] = byRoot;
    saveIndex(idx);
    sendJson(res, 200, { ok: true, count: final.length });
    return true;
  }

  if (p === '/api/module-index/clear' && req.method === 'POST') {
    // 清除指定作用目录的注入
    if (!repo) {
      sendJson(res, 400, { error: '未打开仓库' });
      return true;
    }
    const body = await readBody(req);
    const dir = String(body.dir ?? '').trim();
    const idx = loadIndex();
    const byRoot = idx.repos[repo.root];
    if (byRoot) {
      delete byRoot[dir];
      saveIndex(idx);
    }
    sendJson(res, 200, { ok: true });
    return true;
  }

  return false;
}
