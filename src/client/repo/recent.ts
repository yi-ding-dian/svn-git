/** 最近项目条目工具：唯一键与实际打开路径（纯逻辑，从 shared/utils.ts 下沉）。 */

/** 最近项目条目的唯一键：仓库根 + 操作范围。
 *  同一工作副本可被当作多个"项目"打开（大仓库子项目），仅用 path 会互相覆盖。 */
export function historyEntryKey(h: { path: string; scope?: string }): string {
  return `${h.path}\u0000${h.scope ?? ''}`;
}

/** 最近项目的实际打开路径：记录了操作范围（打开的是子项目）就拼回子目录。
 *  scope 是相对仓库根的路径，Windows 上可能带反斜杠，统一成 / 再拼。 */
export function historyOpenPath(h: { path: string; scope?: string }): string {
  if (!h.scope) return h.path;
  return `${h.path.replace(/[\\/]+$/, '')}/${h.scope.replace(/\\/g, '/')}`;
}
