/** 仓库类型识别：从目标路径向上查找 .svn / .git */
import fs from 'node:fs';
import path from 'node:path';
import type { RepoInfo } from './types.js';

/** 识别路径所在仓库；非仓库返回 null */
export function detectRepo(dir: string): RepoInfo | null {
  const abs = path.resolve(dir);
  let cur = abs;
  while (true) {
    if (fs.existsSync(path.join(cur, '.git'))) {
      return { type: 'git', root: cur, cwd: abs };
    }
    if (fs.existsSync(path.join(cur, '.svn'))) {
      return { type: 'svn', root: cur, cwd: abs };
    }
    const parent = path.dirname(cur);
    if (parent === cur) return null;
    cur = parent;
  }
}

/** 识别当前目录仓库；支持环境变量 SVNKIT_DIR 覆盖启动路径 */
export function detectCwd(override?: string): RepoInfo | null {
  const start = override ?? process.env.SVNKIT_DIR ?? process.cwd();
  return detectRepo(start);
}
