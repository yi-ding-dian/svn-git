/** 大块折叠的纯函数与常量：不依赖 React/DOM，diff 行模型与渲染共用同一套口径。 */

/** 大块折叠：块内 diff 行数超过阈值默认折叠为前 10 行 + 一行「+n 行（点击展开）」。
 *  阈值约一屏（pane 高约 594px / 行高 20.15px ≈ 29 行）。 */
export const COLLAPSE_THRESHOLD = 30;
export const COLLAPSE_HEAD = 10;
/** 左栏不参与展开：右侧点「展开」时左栏保持折叠占位、不跟着动，所以传空集合 */
export const NEVER_EXPANDED = new Set<number>();

/** 折叠行 / 收起行使用的高位负数行号（与真实行号、-block 占位行号都不冲突，可直接当 refs 键） */
export const foldKey = (block: number) => -(block + 100000);
export const tailKey = (block: number) => -(block + 200000);

/** 把一段行列表按「大块折叠」规则过滤：
 *  - 块内 diff 行数 ≤ 阈值：原样返回
 *  - 超过阈值且未展开：保留前 COLLAPSE_HEAD 行，随后插入一行 makeFold 折叠提示，其余丢弃
 *  - 已展开：全部保留，并在块尾补一行 makeTail「收起」
 *  左右两栏各自调用，但折叠状态共用同一组块号——两侧行数保持一致。 */
export function foldBlockRows<T extends { block: number }>(
  rows: T[],
  totals: Map<number, number>,
  expanded: Set<number>,
  makeFold: (block: number, total: number, hidden: number) => T,
  makeTail: (block: number, total: number) => T,
): T[] {
  const out: T[] = [];
  const seen = new Map<number, number>();
  for (const r of rows) {
    if (r.block <= 0) {
      out.push(r);
      continue;
    }
    const total = totals.get(r.block) ?? 0;
    if (total <= COLLAPSE_THRESHOLD || expanded.has(r.block)) {
      out.push(r);
      continue;
    }
    const i = seen.get(r.block) ?? 0;
    seen.set(r.block, i + 1);
    if (i < COLLAPSE_HEAD) out.push(r);
    else if (i === COLLAPSE_HEAD) out.push(makeFold(r.block, total, total - COLLAPSE_HEAD));
  }
  if (expanded.size === 0) return out;
  // 展开块尾部补「收起」行：块内最后一行之后（下一行属于别的块或列表结束）
  const res: T[] = [];
  for (let i = 0; i < out.length; i++) {
    const r = out[i]!;
    res.push(r);
    const next = out[i + 1];
    if (r.block > 0 && expanded.has(r.block) && (!next || next.block !== r.block)) {
      res.push(makeTail(r.block, totals.get(r.block) ?? 0));
    }
  }
  return res;
}
