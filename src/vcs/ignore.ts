/** SVN/Git 忽略规则公共逻辑（git .gitignore / svn:ignore 语义子集） */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { run } from './exec.js';

/**
 * 单条忽略规则是否匹配条目名。
 * 规则尾部 `/` 视为目录规则;`*` 通配支持（匹配任意字符,不跨路径分隔）。
 */
export function isIgnoredByRules(rules: string[], name: string): boolean {
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
}

// ---------- git 忽略三来源（渲染侧检测 / 写入侧定位共用，单一实现） ----------

/**
 * 批量判定：给定的一组路径里，哪些被 git 忽略 —— **直接问 git 自己**（权威）。
 * 子目录 .gitignore / 带路径的规则（`docs/x.md`）/ `**` / 否定 `!` / 目录规则 / global /
 * .git/info/exclude 全由 git 算，与 `git status` 永远一致；已跟踪的路径不会被报告为忽略
 * （git 语义，默认会查 index）。
 *
 * 旧实现是自己读**仓库根**的 .gitignore、再拿**文件名**去比对规则 —— 子目录里的 .gitignore
 * 一个都不读、带路径的规则也匹配不上，被忽略的文件因此在浏览视图里显示成「✓ 已版本化、干净」
 * （用户实报：`RAG/.gitignore` 里的 `docs/xxx.md` 命中的文档显示为 ✓，其实它根本不在版本库里）。
 *
 * @param relPaths 相对仓库根的路径（`/` 分隔）
 */
export async function gitCheckIgnore(repoRoot: string, relPaths: string[]): Promise<Set<string>> {
  const ignored = new Set<string>();
  if (relPaths.length === 0) return ignored;
  // -z：NUL 分隔且不做引号转义，中文/空格路径原样进出
  const r = await run('git', ['check-ignore', '--stdin', '-z'], {
    cwd: repoRoot,
    stdinData: relPaths.join('\0') + '\0',
    timeoutMs: 30_000,
  });
  // 退出码：0=有被忽略的；1=一个都没有（正常结果，不是错误）；>1=出错
  if (r.code !== 0 && r.code !== 1) return ignored;
  for (const p of r.stdout.split('\0')) if (p) ignored.add(p);
  return ignored;
}

/** 路径归一：'' / '.' 都表示仓库根 */
const normDir = (d: string): string => (!d || d === '.' ? '' : d.replace(/\/+$/, ''));

/**
 * 目录级忽略判定器：一个目录只跑一次 `git check-ignore`（批量判该目录下所有条目），之后查内存集合。
 * 渲染一个目录时会被逐条目问很多次，必须缓存住。
 */
export function makeGitIgnoreChecker(repoRoot: string) {
  const cache = new Map<string, Set<string>>();
  const load = async (dirRel: string): Promise<Set<string>> => {
    const key = normDir(dirRel);
    const hit = cache.get(key);
    if (hit) return hit;
    let set = new Set<string>();
    try {
      const names = fs.readdirSync(path.join(repoRoot, key || '.'));
      set = await gitCheckIgnore(
        repoRoot,
        names.map((n) => (key ? `${key}/${n}` : n))
      );
    } catch {
      /* 目录读不到：当作没有忽略项（宁可显示 ? / ✓，也不误标 I） */
    }
    cache.set(key, set);
    return set;
  };
  return {
    /** 该目录下的 name 是否被忽略 */
    isIgnored: async (dirRel: string, name: string): Promise<boolean> => {
      const key = normDir(dirRel);
      return (await load(key)).has(key ? `${key}/${name}` : name);
    },
    /** 目录内所有条目都被忽略（目录名没被规则命中，但里面没一个是版本库内容，如 .claude/ 只含 *.local.json） */
    allIgnored: async (dirRel: string): Promise<boolean> => {
      const key = normDir(dirRel);
      let names: string[];
      try {
        names = fs.readdirSync(path.join(repoRoot, key || '.'));
      } catch {
        return true; // 读取失败：无可忽略内容，视作全体忽略
      }
      if (names.length === 0) return false; // 真空目录：无内容可忽略，保持"干净"
      const set = await load(key);
      return names.every((n) => n === '.git' || n === '.svn' || set.has(key ? `${key}/${n}` : n));
    },
  };
}

/** git 全局忽略文件：core.excludesFile 配置值（未配置 → null） */
export async function gitGlobalExcludesFile(): Promise<string | null> {
  const r = await run('git', ['config', '--global', 'core.excludesfile']);
  const p = r.stdout.trim();
  return p || null;
}

/** 确保 global excludesFile 已配置：未配置 → 设为 ~/.gitignore_global 并返回该路径；已配置 → 返回既有路径 */
export async function ensureGitGlobalExcludesFile(): Promise<string> {
  const existing = await gitGlobalExcludesFile();
  if (existing) return existing;
  const def = path.join(os.homedir(), '.gitignore_global');
  await run('git', ['config', '--global', 'core.excludesfile', def]);
  return def;
}

/** 读取忽略文件规则（去注释/空行；分布式 .gitignore 与 exclude/global 同格式） */
function readGitIgnoreRules(file: string): string[] {
  try {
    return fs
      .readFileSync(file, 'utf8')
      .split('\n')
      .map((s) => s.trim())
      .filter((s) => s && !s.startsWith('#'));
  } catch {
    return [];
  }
}

/** git 三来源忽略规则（渲染侧 /api/fs、filtered-tree? 的展开用）：
 * .gitignore(随仓库分发) / global(excludesFile,仅本机全部仓库) / .git/info/exclude(仅本机本仓库)。
 * global 未配置 core.excludesFile 时自动不含（git 本就不读该档）。 */
export async function gitIgnoreSources(repoRoot: string): Promise<{ file: string; rules: string[] }[]> {
  const gitignore = path.join(repoRoot, '.gitignore');
  const exclude = path.join(repoRoot, '.git', 'info', 'exclude');
  const sources: { file: string; rules: string[] }[] = [
    { file: gitignore, rules: readGitIgnoreRules(gitignore) },
  ];
  const global = await gitGlobalExcludesFile();
  if (global) {
    const gf = path.resolve(global);
    sources.push({ file: gf, rules: readGitIgnoreRules(gf) });
  }
  sources.push({ file: exclude, rules: readGitIgnoreRules(exclude) });
  return sources;
}

const SVN_IGNORE_MAP_TTL = 60_000;
const svnIgnoreMapCache = new Map<string, { time: number; map: Map<string, string[]> }>();
const svnIgnoreMapInflight = new Map<string, Promise<Map<string, string[]>>>();
/** 缓存代际：invalidate 时 +1；拉取完成写缓存前比对，变了就不写 ——
 *  否则"改规则时正好在途的那次拉取"完成后会把旧快照又写回去，失效等于白做 */
const svnIgnoreMapGen = new Map<string, number>();

/** 写入 svn:ignore 后**必须**调用（三处写入点：svn.ts 的 setSvnIgnore、/api/ignore-remove、
 *  /api/unignore）。缓存是全仓库规则快照、TTL 60 秒，不清的话紧接着的读
 *  （/api/ignore-source 查忽略来源、/api/unignore 找规则）拿到的是旧快照 ——
 *  表现为"刚加的规则查不到、立刻取消忽略报'未找到规则'"，得等 60 秒才正常（实报 bug）。 */
export function invalidateSvnIgnoreMap(root: string): void {
  svnIgnoreMapCache.delete(root);
  svnIgnoreMapInflight.delete(root);
  svnIgnoreMapGen.set(root, (svnIgnoreMapGen.get(root) ?? 0) + 1);
}

/**
 * 拉取（带缓存）仓库全部 svn:ignore 规则：dir -> rules[]。
 * 逐目录 propget 太慢(每目录一次 svn 进程 ~30ms),改为一次 `svn propget svn:ignore -R .`
 * 递归拉取全仓库规则(输出格式:<路径> - <规则> 块,空行分隔),缓存 60s,之后所有目录查内存 Map(0 命令)。
 */
export function getSvnIgnoreMap(root: string): Promise<Map<string, string[]>> {
  const hit = svnIgnoreMapCache.get(root);
  if (hit && Date.now() - hit.time < SVN_IGNORE_MAP_TTL) return Promise.resolve(hit.map);
  const inflight = svnIgnoreMapInflight.get(root);
  if (inflight) return inflight;
  const gen = svnIgnoreMapGen.get(root) ?? 0; // 发起时的代际，写缓存前比对
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
    // 拉取期间被 invalidate 过（用户改了规则）→ 这份快照已过期，不写回缓存
    if ((svnIgnoreMapGen.get(root) ?? 0) === gen) svnIgnoreMapCache.set(root, { time: Date.now(), map });
    return map;
  });
  svnIgnoreMapInflight.set(root, p);
  void p.finally(() => svnIgnoreMapInflight.delete(root));
  return p;
}
