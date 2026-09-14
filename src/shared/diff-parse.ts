/** unified diff 解析 + 行级变更标记（纯函数：无 React/DOM 依赖，可在 node 侧单测）。
 *
 * 为何下沉到 shared：标记算法需要单测覆盖才能守住回归，而展示层（views/diff.tsx）
 * 没有测试入口；node 单测从 dist/shared 直接 import 本模块。
 *
 * 历史：标记曾经是块级粒度——"同一块内有删有加即整块判 M"。但 unified diff 的格式
 * 惯例是"先输出全部删除行、再输出全部新增行"，紧邻的删+增必然落进同一块，
 * 于是"删掉一大段（搬到别的文件）+ 原地新增另一段无关代码"被整块标成 M。
 * 现改为行级：块内做相似度配对，配对上的行才是 M（见 lineMarksOf）。
 */

/** unified diff 解析出的行 */
export interface DiffLine {
  text: string;
  type: 'ctx' | 'del' | 'add';
  leftNo: number;
  rightNo: number;
  block: number;
}

/** 行级变更标记：M 修改 / + 新增 / - 删除 */
export type LineMark = 'mod' | 'add' | 'del';

/** 认定为"同一行的修改"所需的最低相似度。低于此值宁可拆成 删除+新增，
 *  也不配对成 M——把两行无关的代码配成"修改"，比诚实显示成一删一增更误导
 *  （用户看到 M 会以为这行还有对应内容活着）。 */
const SIM_THRESHOLD = 0.5;
/** 逐行配对的规模上限（|删除行| × |新增行|）。超过就放弃配对、直接按纯删/纯增标记：
 *  整文件重写之类的大 hunk 上 O(n×m) 编辑距离会把界面卡住，而那种改动本就没有
 *  逐行对应关系，不猜反而更准。 */
const MAX_PAIR_CELLS = 40000;
/** 相似度以千分整数参与 DP，回溯时做整数相等比较（浮点相加的误差会让回溯选错分支） */
const SCALE = 1000;

/** 解析 unified diff。block 为变更块编号（上下文行为 -1）；同一块内先删后增是格式惯例。 */
export function parseUnifiedDiff(text: string): DiffLine[] {
  const out: DiffLine[] = [];
  let leftNo = 0;
  let rightNo = 0;
  let block = 0;
  let blockOpen = false;
  let inHunk = false;
  for (const raw of text.split('\n')) {
    const hunk = raw.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)/);
    if (hunk && hunk[1] && hunk[2]) {
      leftNo = Number(hunk[1]);
      rightNo = Number(hunk[2]);
      inHunk = true;
      blockOpen = false;
      continue;
    }
    if (!inHunk) continue;
    const ch = raw[0];
    if (ch === ' ') {
      out.push({ text: raw.slice(1), type: 'ctx', leftNo: leftNo++, rightNo: rightNo++, block: -1 });
      blockOpen = false;
    } else if (ch === '-') {
      if (!blockOpen) {
        block += 1;
        blockOpen = true;
      }
      out.push({ text: raw.slice(1), type: 'del', leftNo: leftNo++, rightNo: 0, block });
    } else if (ch === '+') {
      // 注意：这里同样看 blockOpen——由删转增时不另开块（同一处替换的删与增同块），
      // 只有上下文行才重置 blockOpen。块号语义被导航/滚动条/占位行复用，不可更改。
      if (!blockOpen) {
        block += 1;
        blockOpen = true;
      }
      out.push({ text: raw.slice(1), type: 'add', leftNo: 0, rightNo: rightNo++, block });
    } else if (ch === '\\') {
      /* 无换行符提示，忽略 */
    } else {
      inHunk = false;
    }
  }
  return out;
}

/** 编辑距离（滚动数组；超过 maxDist 提前退出——配对只关心"够不够像"，不需要精确值） */
function editDistance(a: string, b: string, maxDist: number): number {
  const n = a.length;
  const m = b.length;
  if (n === 0) return m;
  if (m === 0) return n;
  let prev = new Int32Array(m + 1);
  let cur = new Int32Array(m + 1);
  for (let j = 0; j <= m; j++) prev[j] = j;
  for (let i = 1; i <= n; i++) {
    cur[0] = i;
    const ca = a.charCodeAt(i - 1);
    let rowMin = i;
    for (let j = 1; j <= m; j++) {
      const cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
      const del = prev[j]! + 1;
      const ins = cur[j - 1]! + 1;
      const sub = prev[j - 1]! + cost;
      const v = del < ins ? (del < sub ? del : sub) : ins < sub ? ins : sub;
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > maxDist) return maxDist + 1; // 本行最小距离已超标 → 最终距离必然超标
    const t = prev;
    prev = cur;
    cur = t;
  }
  return prev[m]!;
}

/** 行相似度 0（完全不同）~ 1（完全相同）。长度差本身超过阈值允许的最大编辑距离时
 *  直接判 0，省掉编辑距离计算（配对矩阵里绝大多数格子靠这一步快速排除）。 */
function lineSim(a: string, b: string): number {
  const la = a.length;
  const lb = b.length;
  if (la === 0 || lb === 0) return la === lb ? 1 : 0;
  const max = la > lb ? la : lb;
  const min = la > lb ? lb : la;
  const maxDist = Math.floor((1 - SIM_THRESHOLD) * max);
  if (max - min > maxDist) return 0;
  const dist = editDistance(a, b, maxDist);
  if (dist > maxDist) return 0;
  return 1 - dist / max;
}

/** 保序配对：在删除段与新增段之间求总相似度最大的不交叉配对（序列对齐 DP）。
 *  返回 [删除行下标, 新增行下标] 列表，按下标升序。 */
function pairRows(dels: DiffLine[], adds: DiffLine[]): Array<[number, number]> {
  const n = dels.length;
  const m = adds.length;
  if (n === 0 || m === 0) return [];
  if (n * m > MAX_PAIR_CELLS) return []; // 退化：块太大，不做逐行猜测
  const sim = new Int32Array(n * m);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < m; j++) {
      sim[i * m + j] = Math.round(lineSim(dels[i]!.text, adds[j]!.text) * SCALE);
    }
  }
  const minSim = Math.round(SIM_THRESHOLD * SCALE);
  const W = m + 1;
  const dp = new Int32Array((n + 1) * W);
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const skipDel = dp[(i - 1) * W + j]!;
      const skipAdd = dp[i * W + (j - 1)]!;
      let best = skipDel > skipAdd ? skipDel : skipAdd;
      const s = sim[(i - 1) * m + (j - 1)]!;
      if (s >= minSim) {
        const diag = dp[(i - 1) * W + (j - 1)]! + s;
        if (diag > best) best = diag;
      }
      dp[i * W + j] = best;
    }
  }
  // 回溯：优先走配对分支（并列时也配，符合"尽量识别为修改"的直觉）
  const pairs: Array<[number, number]> = [];
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    const s = sim[(i - 1) * m + (j - 1)]!;
    if (s >= minSim && dp[i * W + j] === dp[(i - 1) * W + (j - 1)]! + s) {
      pairs.push([i - 1, j - 1]);
      i--;
      j--;
    } else if (dp[(i - 1) * W + j]! >= dp[i * W + (j - 1)]!) {
      i--;
    } else {
      j--;
    }
  }
  pairs.reverse();
  return pairs;
}

/**
 * 行级变更标记：逐行给出 M / + / -，同一块内可以混合出现。
 * - 纯新增块 → 全部 add；纯删除块 → 全部 del
 * - 有删有加 → 逐行相似度配对：配上的（删行,增行）都是 mod，落单的按各自类型标
 * - 纯删除块紧跟纯新增块（块号连续）→ 同一处替换，合并两段一起配对
 *   （与旧块级口径的配对范围一致，只是判定细化到了行）
 */
export function lineMarksOf(lines: DiffLine[]): Map<DiffLine, LineMark> {
  const blocks = new Map<number, { dels: DiffLine[]; adds: DiffLine[] }>();
  for (const l of lines) {
    if (l.block < 0) continue; // 上下文行不属于任何块
    let b = blocks.get(l.block);
    if (!b) {
      b = { dels: [], adds: [] };
      blocks.set(l.block, b);
    }
    if (l.type === 'del') b.dels.push(l);
    else if (l.type === 'add') b.adds.push(l);
  }
  const ids = [...blocks.keys()].sort((a, b) => a - b);
  const out = new Map<DiffLine, LineMark>();
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i]!;
    const b = blocks.get(id)!;
    const dels = b.dels;
    let adds = b.adds;
    // 纯删除块后紧跟纯新增块（编号连续 ⇒ 中间只隔了上下文行）→ 合并配对
    const nextId = ids[i + 1];
    if (dels.length > 0 && adds.length === 0 && nextId === id + 1) {
      const nb = blocks.get(nextId)!;
      if (nb.dels.length === 0 && nb.adds.length > 0) {
        adds = nb.adds;
        i++; // 下一个块已并入本次处理
      }
    }
    if (dels.length === 0) {
      for (const l of adds) out.set(l, 'add');
      continue;
    }
    if (adds.length === 0) {
      for (const l of dels) out.set(l, 'del');
      continue;
    }
    const pairedDel = new Set<number>();
    const pairedAdd = new Set<number>();
    for (const [di, ai] of pairRows(dels, adds)) {
      pairedDel.add(di);
      pairedAdd.add(ai);
    }
    dels.forEach((l, k) => out.set(l, pairedDel.has(k) ? 'mod' : 'del'));
    adds.forEach((l, k) => out.set(l, pairedAdd.has(k) ? 'mod' : 'add'));
  }
  return out;
}
