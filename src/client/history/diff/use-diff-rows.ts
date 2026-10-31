/** 行模型：把 unified diff 拆成左右两栏的行列表，并计算占位行锚点、块总数与差异块列表。
 *  这里只做纯数据加工（无 DOM/滚动），供渲染、导航、搜索、还原共用。 */
import { useMemo } from 'react';
import type { DiffLine, LineMark } from '../../../shared/diff-parse.js';
import { COLLAPSE_HEAD, NEVER_EXPANDED, foldBlockRows, foldKey, tailKey } from './diff-fold.js';

/** file-versions 返回值：左右全文 + 版本行文案 */
export interface DiffVersions {
  left: string;
  right: string;
  leftLabel: string;
  rightLabel: string;
}

/** 未配对删除行在右栏的落点 */
export interface RightAnchor {
  rightNo: number;
  count: number;
  after?: boolean;
}

/** 未配对新增行在左栏的落点（delAnchorRight 的镜像） */
export interface LeftAnchor {
  leftNo: number;
  count: number;
  after?: boolean;
}

/** 左栏行：原版每行 + 删除行标记 + 新增占位行 + 折叠/收起提示行 */
export interface LeftRow {
  no: number;
  text: string;
  change: boolean;
  block: number;
  line?: DiffLine;
  /** 新增占位行（左栏此处没有内容；右栏有新增） */
  ph?: boolean;
  /** 占位行在块内的序号（leftPhRefs 的数组下标） */
  phIndex?: number;
  fold?: boolean;
  foldN?: number;
  foldTotal?: number;
  tail?: boolean;
}

/** 右栏行：当前每行 + 新增行标记 + 删除占位行 + 折叠/收起提示行 */
export interface RightRow {
  no: number;
  text: string;
  change: boolean;
  block: number;
  line?: DiffLine;
  /** 删除占位行：左栏此处有 N 行被删，右栏没有对应内容 */
  delPh?: number;
  fold?: boolean;
  foldN?: number;
  foldTotal?: number;
  tail?: boolean;
}

/** 差异块：id 是 diff 块号（从 1 起）；left/right 是块内首个删除/新增行号（无则为 MAX_SAFE_INTEGER 哨兵） */
export interface DiffBlock {
  id: number;
  left: number;
  right: number;
}

export function useDiffRows(args: {
  versions: DiffVersions | null;
  diffLines: DiffLine[];
  lineMarks: Map<DiffLine, LineMark>;
  showAll: boolean;
  expandedBlocks: Set<number>;
}) {
  const { versions, diffLines, lineMarks, showAll, expandedBlocks } = args;

  // 未配对删除行在右栏的落点：这些行在右栏**没有**对应内容（被删的东西不存在于当前版本），
  // 无法靠 block 匹配定位。rightRows 据此在右栏插入一行**占位行**（红色 - 空行 + 提示文字）。
  // 落点取「删除点之后的第一行」——右栏该处显示的正是被删内容后面的内容；删除段位于文件末尾
  // （后面无行可挂）时退化为最后一个上下文行，此时占位行插在它**之后**（after=true）。
  // 同一块内的多行删除聚合成一行占位（count = 行数）。供点击/导航定位。
  const delAnchorRight = useMemo(() => {
    const m = new Map<number, RightAnchor>();
    let pending: { block: number; count: number }[] = [];
    let lastCtx = 0;
    for (const l of diffLines) {
      if (l.type === 'del') {
        if (lineMarks.get(l) === 'mod') continue; // 配成"修改"的删除行在右栏有对应行，不需要占位
        const p = pending.find((x) => x.block === l.block);
        if (p) p.count++;
        else pending.push({ block: l.block, count: 1 });
        continue;
      }
      // 同一块可能被空白 ctx 分成多段（空行间隔合并后）：count 必须累加，不能覆盖——
      // 否则右栏"此处删除了 n 行"只算最后一段（用户实报显示 2 行）
      for (const p of pending) {
        const prev = m.get(p.block);
        m.set(p.block, { rightNo: l.rightNo, count: (prev?.count ?? 0) + p.count });
      }
      pending = [];
      if (l.type === 'ctx') lastCtx = l.rightNo;
    }
    for (const p of pending) {
      if (!lastCtx) continue;
      const prev = m.get(p.block);
      m.set(p.block, { rightNo: lastCtx, count: (prev?.count ?? 0) + p.count, after: true });
    }
    return m;
  }, [diffLines, lineMarks]);

  /** 未配对新增行在左栏的落点（左栏「显示全部」模式的占位行用）——delAnchorRight 的镜像：
   *  这些新增在左栏**没有**对应内容，占位行插在「新增点之后第一行」之前；末尾新增（after）挂最后上下文行 */
  const addAnchorLeft = useMemo(() => {
    const m = new Map<number, LeftAnchor>();
    let pending: { block: number; count: number }[] = [];
    let lastCtx = 0;
    for (const l of diffLines) {
      if (l.type === 'add') {
        if (lineMarks.get(l) === 'mod') continue; // 配成"修改"的新增行在左栏有对应（del）行，不需要占位
        const p = pending.find((x) => x.block === l.block);
        if (p) p.count++;
        else pending.push({ block: l.block, count: 1 });
        continue;
      }
      // 同上：同一块被空白 ctx 分成的多段新增要累加
      for (const p of pending) {
        const prev = m.get(p.block);
        m.set(p.block, { leftNo: l.leftNo, count: (prev?.count ?? 0) + p.count });
      }
      pending = [];
      if (l.type === 'ctx') lastCtx = l.leftNo;
    }
    for (const p of pending) {
      if (!lastCtx) continue;
      const prev = m.get(p.block);
      m.set(p.block, { leftNo: lastCtx, count: (prev?.count ?? 0) + p.count, after: true });
    }
    return m;
  }, [diffLines, lineMarks]);

  /** 每块 diff 行数（del+add）：折叠阈值判定用；左右两栏共用同一口径，
   *  保证同一个块在两侧同时折叠/展开 */
  const blockTotals = useMemo(() => {
    const m = new Map<number, number>();
    for (const l of diffLines) if (l.block > 0) m.set(l.block, (m.get(l.block) ?? 0) + 1);
    return m;
  }, [diffLines]);

  // 并排行拆分：左栏 = 原版每行 + 删除行标记；右栏 = 当前每行 + 新增行标记。
  // 左栏在"新增"处插入空占位行（带背景标记），左右视觉对齐、定位直观。
  // 默认只渲染差异片段（diff 行）；「显示全部」开启后遍历原版**全文**（未改动行平铺显示、
  // 差异行照旧标记、未配对新增处插占位行——与 rightRows 的全文模式同构）
  /** 左栏行（折叠前）：完整行集。复制「左栏全部文本」要用这份——折叠只是视觉收起，
   *  复制不能缺行 */
  const leftRowsUnfolded = useMemo(() => {
    if (!versions) return [];
    const rows: LeftRow[] = [];
    if (!showAll) {
      // phIndex：占位行按块内序号进 ref 数组（连接带/动画按行取元素）；折叠统一在下面的 leftRows 里做
      //
      // 空行间隔：同一逻辑块内被**未改动的空白上下文行**隔开的占位行连续显示，不再显示这些空 ctx
      // （它们只是 diff 把 BASE 空行和新增段空行配了对）。注意只跳过 ctx——
      // 用户真正增删空行时是 add/del 行，照常显示成差异。
      const skipCtx = new Set<number>();
      for (let i = 0; i < diffLines.length; i++) {
        const l = diffLines[i]!;
        if (l.type !== 'ctx' || l.text.trim() !== '') continue;
        let p = i - 1;
        while (p >= 0 && diffLines[p]!.type === 'ctx') p--;
        let n = i + 1;
        while (n < diffLines.length && diffLines[n]!.type === 'ctx') n++;
        const prevBlock = p >= 0 ? diffLines[p]!.block : -1;
        const nextBlock = n < diffLines.length ? diffLines[n]!.block : -1;
        if (prevBlock > 0 && prevBlock === nextBlock) skipCtx.add(i);
      }
      const phCount = new Map<number, number>();
      diffLines.forEach((l, i) => {
        if (skipCtx.has(i)) return;
        if (l.type === 'ctx') rows.push({ no: l.leftNo, text: l.text, change: false, block: -1 });
        else if (l.type === 'del') rows.push({ no: l.leftNo, text: l.text, change: true, block: l.block, line: l });
        else if (l.type === 'add') {
          const idx = phCount.get(l.block) ?? 0;
          phCount.set(l.block, idx + 1);
          rows.push({ no: -l.block, text: '', change: true, block: l.block, line: l, ph: true, phIndex: idx });
        }
      });
      return rows;
    }
    // 全文模式：空文件保持空行集（让"（原版为空 — 新增文件）"空态照旧显示）
    if (versions.left === '') return rows;
    // 新增占位行：按落点行号分桶（after=true 表示插在该行之后——新增段在文件末尾）
    const before = new Map<number, { block: number; count: number }[]>();
    const after = new Map<number, { block: number; count: number }[]>();
    for (const [block, a] of addAnchorLeft) {
      const bucket = a.after ? after : before;
      const list = bucket.get(a.leftNo);
      if (list) list.push({ block, count: a.count });
      else bucket.set(a.leftNo, [{ block, count: a.count }]);
    }
    const leftMap = new Map<number, { text: string; block: number; line: DiffLine }>();
    for (const l of diffLines) {
      if (l.type === 'del') leftMap.set(l.leftNo, { text: l.text, block: l.block, line: l });
    }
    versions.left.split('\n').forEach((ln, i) => {
      const no = i + 1;
      for (const a of before.get(no) ?? []) rows.push({ no: -a.block, text: '', change: true, block: a.block, ph: true, phIndex: 0 });
      const m = leftMap.get(no);
      if (m) rows.push({ no, text: m.text, change: true, block: m.block, line: m.line });
      else rows.push({ no, text: ln, change: false, block: -1 });
      for (const a of after.get(no) ?? []) rows.push({ no: -a.block, text: '', change: true, block: a.block, ph: true, phIndex: 0 });
    });
    return rows;
  }, [versions, diffLines, showAll, addAnchorLeft]);

  /** 左栏渲染行（折叠后）：大块收起为前 COLLAPSE_HEAD 行 + 一行「+n 行（点击展开）」。
   *  左栏不参与展开，始终传 NEVER_EXPANDED。两栏折叠口径一致（共用 blockTotals）。 */
  const leftRows = useMemo(
    () =>
      foldBlockRows(
        leftRowsUnfolded,
        blockTotals,
        NEVER_EXPANDED,
        (block, total, hidden) => ({ no: foldKey(block), text: '', change: true, block, ph: true, phIndex: COLLAPSE_HEAD, fold: true, foldN: hidden, foldTotal: total }),
        (block, total) => ({ no: tailKey(block), text: '', change: true, block, ph: true, phIndex: COLLAPSE_HEAD + 1, tail: true, foldTotal: total }),
      ),
    [leftRowsUnfolded, blockTotals],
  );

  const rightRows = useMemo(() => {
    if (!versions) return [];
    // 未配对删除行的占位行：按落点行号分桶（after=true 表示插在该行之后——删除段在文件末尾）
    const before = new Map<number, { block: number; count: number }[]>();
    const after = new Map<number, { block: number; count: number }[]>();
    for (const [block, a] of delAnchorRight) {
      const bucket = a.after ? after : before;
      const list = bucket.get(a.rightNo);
      if (list) list.push({ block, count: a.count });
      else bucket.set(a.rightNo, [{ block, count: a.count }]);
    }
    const rightMap = new Map<number, { text: string; block: number; line: DiffLine }>();
    for (const l of diffLines) {
      if (l.type === 'add') rightMap.set(l.rightNo, { text: l.text, block: l.block, line: l });
    }
    const out: RightRow[] = [];
    // 占位行行号取 -block（负数，不显示行号）：与真实行号不冲突，且可直接作 rightRefs 的 key 供定位
    const pushPh = (a: { block: number; count: number }) =>
      out.push({ no: -a.block, text: '', change: true, block: a.block, delPh: a.count });
    versions.right.split('\n').forEach((ln, i) => {
      const no = i + 1;
      for (const a of before.get(no) ?? []) pushPh(a);
      const m = rightMap.get(no);
      if (m) out.push({ no, text: m.text, change: true, block: m.block, line: m.line });
      else out.push({ no, text: ln, change: false, block: -1 });
      for (const a of after.get(no) ?? []) pushPh(a);
    });
    return foldBlockRows(
      out,
      blockTotals,
      expandedBlocks,
      (block, total, hidden) => ({ no: foldKey(block), text: '', change: true, block, fold: true, foldN: hidden, foldTotal: total }),
      (block, total) => ({ no: tailKey(block), text: '', change: true, block, tail: true, foldTotal: total }),
    );
  }, [versions, diffLines, delAnchorRight, blockTotals, expandedBlocks]);

  // 差异块列表（只含真正的变更块：ctx 行的 block = -1 是「不属于任何块」的标记而不是块号，
  //  一并收进来的话会凭空多出一个"上下文伪块"——差异点计数多一站、滚动条多一个定位点）
  const blocks = useMemo(() => {
    const m = new Map<number, { left: number; right: number }>();
    for (const l of diffLines) {
      if (l.block < 0) continue;
      const v = m.get(l.block) ?? { left: Number.MAX_SAFE_INTEGER, right: Number.MAX_SAFE_INTEGER };
      if (l.type === 'del') v.left = Math.min(v.left, l.leftNo);
      if (l.type === 'add') v.right = Math.min(v.right, l.rightNo);
      m.set(l.block, v);
    }
    return [...m.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([id, v]) => ({ id, left: v.left, right: v.right }));
  }, [diffLines]);

  return { delAnchorRight, addAnchorLeft, blockTotals, leftRows, leftRowsUnfolded, rightRows, blocks };
}
