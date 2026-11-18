/** 路径安全校验：realpath 解析、仓库根边界、二进制判断。 */
import fs from 'node:fs';
import path from 'node:path';
import { BINARY_EXTS } from '../shared/types.js';
import type { RepoInfo } from '../vcs/index.js';

/** 二进制文件判断：常量来自 shared（单一来源），与前端 utils.isBinaryFile 一致 */
export function isBinaryFile(p: string): boolean {
  const name = p.split('/').pop() ?? '';
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : '';
  return BINARY_EXTS.has(ext);
}

/** realpath 安全解析：路径不存在（如待创建的 mkdir/rename 目标）时逐级向上解析最长存在前缀再拼接 */
export function  realpathSafe(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    const parent = path.dirname(p);
    if (parent === p) return p; // 逐级到根仍不存在的极端情况,原样返回
    return path.join(realpathSafe(parent), path.basename(p));
  }
}

/** 校验绝对路径是否位于仓库根内（防止 ../git-repo-2 这类前缀匹配绕过）。
 * 两侧均 realpath 解析：仓库内 symlink 指向仓库外时（repo/link -> /etc），
 * 字符串比较无法发现，必须与真实目标比较。 */
export function  inRepoRoot(root: string, abs: string): boolean {
  const realRoot = realpathSafe(root);
  const realAbs = realpathSafe(abs);
  const rel = path.relative(realRoot, realAbs);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/** 仓库相对路径 → 绝对路径并做 realpath 边界校验；越界返回 null。
 *  **新端点一律走这里**：裸 `startsWith(repoRoot)` 是词法比较，仓库内 symlink 指向仓库外时会被骗过。 */
export function  resolveRepoPath(repo: RepoInfo, rel: string): string | null {
  const abs = path.resolve(repo.root, rel);
  return inRepoRoot(repo.root, abs) ? abs : null;
}
