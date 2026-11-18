/** 文件大小展示：缺失返回空串，0 字节显示 `0 B`（列表里不能留空白）。 */
export function formatFileSize(n?: number): string {
  if (n === undefined) return '';
  if (n === 0) return '0 B';
  return formatSize(n);
}

/** 字节数 → 易读大小（0 / 缺失返回空串，界面上不显示大小）。 */
export function formatSize(n: number): string {
  if (!n || !Number.isFinite(n)) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
