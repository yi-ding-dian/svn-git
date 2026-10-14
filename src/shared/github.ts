/** GitHub 相关共享逻辑（前后端共用，无 Node/DOM 依赖） */

/** remote URL → owner/repo（https:// / git@ / ssh:// 形式都认；非 github 或认不出 → null）。
 *  服务端（github.ts 路由）与前端（删除弹窗显示完整名）共用。 */
export function parseGithub(url: string): { owner: string; repo: string } | null {
  const clean = url.trim().replace(/\/+$/, '').replace(/\.git$/i, '');
  const m = /github\.com[:/]([^/\s]+)\/([^/\s]+)$/i.exec(clean);
  if (!m) return null;
  return { owner: m[1]!, repo: m[2]! };
}

/** GitHub 仓库名实时过滤（输入框 onChange 用）：非法字符（中文/空格/符号）换成 -，连续合并。
 *  **不修剪首尾**——修剪会让用户打不出结尾的 '-'（如 a--b 的第二个 '-' 刚输入就被削掉）；修剪放 normalize。 */
export function sanitizeGhRepoName(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9._-]+/g, '-');
}

/** GitHub 仓库名完整规范化（提交前 / 服务端校验用）：sanitize + 去首尾 - 和 .（GitHub 不允许以 . 开头）。
 *  ⚠ 为什么必须自己规范化：GitHub API 对非法名**不报错**——它把非法字符替换成 '-' 后照常创建
 *  （实测：提交「测试 仓库!!」建出名为 '-' 的仓库）。只靠 422 兜底会把垃圾名建进账号。 */
export function normalizeGhRepoName(raw: string): string {
  return sanitizeGhRepoName(raw.trim()).replace(/^[-.]+|[-.]+$/g, '');
}
