/** SVN/Git 忽略规则公共逻辑（git .gitignore / svn:ignore 语义子集） */
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
