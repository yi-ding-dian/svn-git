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
