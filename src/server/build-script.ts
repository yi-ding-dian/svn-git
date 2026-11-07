/** 打包脚本探测（服务端共享）：本地打包 tab 与 /api/info 的 canLocalBuild 共用一份判断，
 *  避免「入口显示了、面板却说找不到脚本」两套规则分叉。
 *  只认固定白名单，不接受客户端传入路径。 */
import fs from 'node:fs';
import path from 'node:path';
import { inRepoRoot } from './routes/util.js';

export type BuildScriptKind = 'sh' | 'bat';

export interface BuildScriptHit {
  /** 仓库相对路径（POSIX 分隔符） */
  rel: string;
  kind: BuildScriptKind;
  abs: string;
  mtime: number;
}

/** 当前平台会查找的候选（按优先级；deploy/ 优先于项目根） */
export function buildScriptCandidates(): { rel: string; kind: BuildScriptKind }[] {
  if (process.platform === 'win32') {
    return [
      { rel: 'deploy/build.bat', kind: 'bat' },
      { rel: 'deploy/build.cmd', kind: 'bat' },
      { rel: 'build.bat', kind: 'bat' },
      { rel: 'build.cmd', kind: 'bat' },
    ];
  }
  return [
    { rel: 'deploy/build.sh', kind: 'sh' },
    { rel: 'build.sh', kind: 'sh' },
  ];
}

/** 探测可用的打包脚本；没有返回 null */
export function detectBuildScript(root: string): BuildScriptHit | null {
  for (const c of buildScriptCandidates()) {
    const abs = path.join(root, c.rel);
    // realpath 越界校验：仓库内 symlink 指向仓库外时拒绝
    if (!inRepoRoot(root, abs)) continue;
    try {
      const st = fs.statSync(abs);
      if (st.isFile()) return { ...c, abs, mtime: st.mtimeMs };
    } catch {
      /* 不存在/不可读：试下一个 */
    }
  }
  return null;
}

/** 用户指定脚本的校验失败原因 */
export type BuildScriptError = 'outside' | 'missing' | 'extension';

/** 校验用户选择的脚本：必须在仓库内、是普通文件、扩展名与当前平台匹配。 */
export function resolveBuildScript(root: string, raw: string): BuildScriptHit | BuildScriptError {
  const p = raw.trim();
  if (!p) return 'missing';
  const abs = path.isAbsolute(p) ? path.resolve(p) : path.resolve(root, p);
  if (!inRepoRoot(root, abs)) return 'outside';
  const ext = path.extname(abs).toLowerCase();
  const allowed = process.platform === 'win32' ? ['.bat', '.cmd'] : ['.sh'];
  if (!allowed.includes(ext)) return 'extension';
  try {
    const st = fs.statSync(abs);
    if (!st.isFile()) return 'missing';
    return {
      rel: path.relative(root, abs).split(path.sep).join('/'),
      kind: ext === '.sh' ? 'sh' : 'bat',
      abs,
      mtime: st.mtimeMs,
    };
  } catch {
    return 'missing';
  }
}
