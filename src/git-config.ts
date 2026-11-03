/** 全局 git 配置：让所有 GitHub 的 https 地址自动走 SSH。
 *
 *  写入：url.git@github.com:.insteadOf = https://github.com/
 *  效果：remote 里写 https://github.com/... 也会被 git 替换成 git@github.com:...，
 *  新克隆/新添加的 GitHub 项目不用逐个改 remote 就走 SSH。
 *
 *  只增删这一条规则，用户自己的其他 url.*.insteadOf 原样保留；
 *  开关状态直接读 git 配置（不另存到 config.json，避免两处不一致）。 */
import { execFileSync } from 'node:child_process';

const KEY = 'url.git@github.com:.insteadOf';
const VALUE = 'https://github.com/';

/** 执行 git config --global，捕获退出码与输出（失败不抛） */
function gitGlobal(args: string[]): { code: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync('git', ['config', '--global', ...args], {
      encoding: 'utf8',
      timeout: 10_000,
      windowsHide: true,
    });
    return { code: 0, stdout, stderr: '' };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return { code: e.status ?? 1, stdout: String(e.stdout ?? ''), stderr: String(e.stderr ?? '') };
  }
}

/** 当前是否已启用（git 全局配置里是否有这条规则） */
export function getGithubInsteadOf(): boolean {
  const r = gitGlobal(['--get-all', KEY]);
  if (r.code !== 0) return false;
  return r.stdout
    .split('\n')
    .map((s) => s.trim())
    .includes(VALUE);
}

/** 开启/关闭：只增删 `https://github.com/` 这一条，保留用户同名的其他值 */
export function setGithubInsteadOf(enabled: boolean): { ok: boolean; error?: string } {
  const current = getGithubInsteadOf();
  if (enabled === current) return { ok: true };
  if (enabled) {
    const r = gitGlobal(['--add', KEY, VALUE]);
    return r.code === 0 ? { ok: true } : { ok: false, error: r.stderr.trim() };
  }
  // --unset 带 value-regex：只删我们这一条；没有匹配时退出码非 0，也视为已关闭。
  // 值里的 `.` 按字面量转义，避免误删形似的其他规则。
  const r = gitGlobal(['--unset', KEY, VALUE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')]);
  if (r.code === 0) return { ok: true };
  return getGithubInsteadOf() ? { ok: false, error: r.stderr.trim() } : { ok: true };
}
