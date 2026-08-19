/** 前端公共工具：纯函数 + 通用 hook */
import { useCallback, useState } from 'react';

/** 弹窗宽度自适应最长文件名（mono 13px 约 7.6px/字符 + 勾选框/徽标/间距余量），钳制在 [minW, maxW] 防过窄/超宽 */
export function pathAutoWidth(maxPathLen: number, minW = 620, maxW = 1400): number {
  return Math.min(maxW, Math.max(minW, 140 + maxPathLen * 7.6));
}

/** 文件大小格式化（B / KB / MB） */
export function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** 勾选集合（checkbox 列表）：初始集合 + 单项切换 */
export function useCheckedSet(initial: string[]) {
  const [checked, setChecked] = useState<Set<string>>(() => new Set(initial));
  const toggle = useCallback((p: string) => {
    setChecked((s) => {
      const n = new Set(s);
      if (n.has(p)) n.delete(p);
      else n.add(p);
      return n;
    });
  }, []);
  return { checked, setChecked, toggle };
}
