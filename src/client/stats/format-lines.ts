/** 行数显示：一万以下带千分位原样显示；一万及以上用「w」单位（如 1.26w、26.47w、120w）。
 *  只用于界面展示——导出的 md 报告仍写精确数字，方便计算与核对。 */
export function formatLines(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '0';
  if (n < 10_000) return n.toLocaleString();
  const w = n / 10_000;
  // 100w 以上不再保留小数（1,000,000 → 100w）
  const s = w >= 100 ? String(Math.round(w)) : w.toFixed(2).replace(/\.?0+$/, '');
  return `${s}w`;
}
