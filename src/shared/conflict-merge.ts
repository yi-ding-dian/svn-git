/** 冲突合并模型：把工作区里带冲突标记的文件拆成「普通段 / 冲突段」，按选择生成结果行。
 *
 *  为什么以**工作区文件**为准，而不是拿 ours/theirs 自己 diff 重建：
 *  git/svn 的自动合并已经把"只有一方改过"的行合好了，真正需要人处理的只有
 *  `<<<<<<< / ======= / >>>>>>>` 之间那几段。拿本地和对方两份完整文件做全量 diff，
 *  会把"对方改了、我没改"这类已经自动合并好的行也当成冲突，逐行让人选 —— 又累又错。
 *
 *  纯函数（无 React/DOM 依赖），单测从 dist/client 直接 import。
 *  行尾原样保留（CRLF 文件的每行末尾带 \r）：结果拼回文本时不能把行尾换掉。 */

/** 冲突块里采用哪一边 */
export type ConflictChoice = 'ours' | 'theirs' | 'both';

/** 冲突标记的原文（保留行尾；未选择时按原样拼回结果） */
export interface ConflictMarkers {
  open: string;
  base?: string;
  mid: string;
  close: string;
}

export interface ConflictBlock {
  /** 从 1 起的冲突块编号（同一文件内唯一，UI 用它做块号/refs 键） */
  id: number;
  /** `<<<<<<<` 后的标记文本（git 是分支名，svn 是 .mine） */
  labelOurs: string;
  /** `>>>>>>>` 后的标记文本（git 是分支名，svn 是 .r123） */
  labelTheirs: string;
  /** 本地段（标记之间靠前的那一半） */
  ours: string[];
  /** 对方段 */
  theirs: string[];
  /** diff3 风格的公共祖先段（`|||||||`），只有合并工具写了才有 */
  base: string[] | null;
  markers: ConflictMarkers;
}

export interface PlainSegment {
  kind: 'plain';
  lines: string[];
}

export interface ConflictSegment {
  kind: 'conflict';
  block: ConflictBlock;
}

export type MergeSegment = PlainSegment | ConflictSegment;

/** 结果行来源：普通内容 / 冲突标记 / 本地段 / 对方段 */
export type ResultLineKind = 'plain' | 'marker' | 'ours' | 'theirs';

export interface ResultLine {
  text: string;
  kind: ResultLineKind;
  /** 所属冲突块 id；0 = 非冲突内容 */
  block: number;
}

const OPEN = /^<<<<<<<(\s|$)/;
const BASE = /^\|\|\|\|\|\|\|(\s|$)/;
const MID = /^=======(\s|$)/;
const CLOSE = /^>>>>>>>(\s|$)/;

/** 取标记行末尾的说明文字：`<<<<<<< HEAD` → `HEAD`（行尾的 \r 一并去掉） */
function labelOf(line: string): string {
  return line.replace(/^[<|=>]+\s*/, '').replace(/\r$/, '').trim();
}

/** 解析工作区文件的冲突标记。未闭合 / 嵌套的畸形标记按普通内容处理（不猜）。 */
export function parseConflictWork(work: string): MergeSegment[] {
  const lines = work.split('\n');
  const out: MergeSegment[] = [];
  let plain: string[] = [];
  let nextId = 0;
  const flushPlain = () => {
    if (plain.length > 0) out.push({ kind: 'plain', lines: plain });
    plain = [];
  };
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (!OPEN.test(line)) {
      plain.push(line);
      i += 1;
      continue;
    }
    // 往后找 `=======` 与 `>>>>>>>`（中间可能还有一个 `|||||||` 祖先段）
    let baseAt = -1;
    let midAt = -1;
    let closeAt = -1;
    for (let j = i + 1; j < lines.length; j++) {
      const l = lines[j]!;
      if (midAt < 0 && baseAt < 0 && BASE.test(l)) {
        baseAt = j;
        continue;
      }
      if (midAt < 0 && MID.test(l)) {
        midAt = j;
        continue;
      }
      if (midAt >= 0 && CLOSE.test(l)) {
        closeAt = j;
        break;
      }
      // 没等到 `=======` 又遇到新的开始标记：畸形，当前这段当普通内容
      if (midAt < 0 && OPEN.test(l)) break;
    }
    if (midAt < 0 || closeAt < 0) {
      plain.push(line);
      i += 1;
      continue;
    }
    flushPlain();
    nextId += 1;
    const oursEnd = baseAt >= 0 ? baseAt : midAt;
    out.push({
      kind: 'conflict',
      block: {
        id: nextId,
        labelOurs: labelOf(line),
        labelTheirs: labelOf(lines[closeAt]!),
        ours: lines.slice(i + 1, oursEnd),
        theirs: lines.slice(midAt + 1, closeAt),
        base: baseAt >= 0 ? lines.slice(baseAt + 1, midAt) : null,
        markers: {
          open: line,
          base: baseAt >= 0 ? lines[baseAt]! : undefined,
          mid: lines[midAt]!,
          close: lines[closeAt]!,
        },
      },
    });
    i = closeAt + 1;
  }
  flushPlain();
  return out;
}

/** 供 UI 用：把某个冲突块展开成结果行（不经过整份文件，选择按钮单独替换这一块） */
export function blockResultLines(block: ConflictBlock, choice: ConflictChoice | undefined): ResultLine[] {
  const out: ResultLine[] = [];
  const push = (text: string, kind: ResultLineKind) => out.push({ text, kind, block: block.id });
  if (!choice) {
    push(block.markers.open, 'marker');
    for (const l of block.ours) push(l, 'ours');
    if (block.markers.base !== undefined && block.base) {
      push(block.markers.base, 'marker');
      for (const l of block.base) push(l, 'plain');
    }
    push(block.markers.mid, 'marker');
    for (const l of block.theirs) push(l, 'theirs');
    push(block.markers.close, 'marker');
    return out;
  }
  if (choice === 'ours' || choice === 'both') for (const l of block.ours) push(l, 'ours');
  if (choice === 'theirs' || choice === 'both') for (const l of block.theirs) push(l, 'theirs');
  return out;
}

/** 整份结果行：普通段原样 + 每块按选择展开 */
export function buildResultLines(
  segments: MergeSegment[],
  choices: Record<number, ConflictChoice>,
): ResultLine[] {
  const out: ResultLine[] = [];
  for (const seg of segments) {
    if (seg.kind === 'plain') {
      for (const text of seg.lines) out.push({ text, kind: 'plain', block: 0 });
    } else {
      out.push(...blockResultLines(seg.block, choices[seg.block.id]));
    }
  }
  return out;
}

/** 结果行 → 文件文本（行尾原样拼回） */
export function joinResultLines(lines: ResultLine[]): string {
  return lines.map((l) => l.text).join('\n');
}

/** 文本里还剩多少个未处理的冲突块（手动编辑后用来判断能否保存：
 *  用户可能把标记删干净了，也可能只改了一半） */
export function countConflictBlocks(text: string): number {
  let n = 0;
  for (const seg of parseConflictWork(text)) if (seg.kind === 'conflict') n += 1;
  return n;
}

/** 去掉行尾 \r 后比较：工作区文件与 ours/theirs 来源不同，行尾可能一边 CRLF 一边 LF */
function sameLine(a: string, b: string): boolean {
  return (a.endsWith('\r') ? a.slice(0, -1) : a) === (b.endsWith('\r') ? b.slice(0, -1) : b);
}

/** 在完整文件里找一段连续行（冲突段在 ours/theirs 完整文件中的位置，用于高亮和连接带）。
 *
 *  from 是搜索起点（行下标）：同一个文件的多个冲突块在两边都按文件顺序出现，
 *  用游标往后找可以避免重复内容匹配到前面的同款行。
 *  needle 为空（一侧是纯新增/纯删除）时返回 null —— 那一侧本来就没有对应内容。 */
export function findBlockRange(
  fileLines: string[],
  needle: string[],
  from = 0,
): { start: number; end: number } | null {
  if (needle.length === 0 || needle.length > fileLines.length) return null;
  const last = fileLines.length - needle.length;
  for (let i = Math.max(0, from); i <= last; i++) {
    let ok = true;
    for (let j = 0; j < needle.length; j++) {
      if (!sameLine(fileLines[i + j]!, needle[j]!)) {
        ok = false;
        break;
      }
    }
    if (ok) return { start: i, end: i + needle.length - 1 };
  }
  return null;
}

/** 每个冲突块在某一侧完整文件中的行区间（theirs 段去 theirs 里找，ours 段去 ours 里找） */
export function locateBlocks(
  segments: MergeSegment[],
  side: 'ours' | 'theirs',
  fileLines: string[],
): Map<number, { start: number; end: number }> {
  const out = new Map<number, { start: number; end: number }>();
  let cursor = 0;
  for (const seg of segments) {
    if (seg.kind !== 'conflict') continue;
    const needle = side === 'ours' ? seg.block.ours : seg.block.theirs;
    const range = findBlockRange(fileLines, needle, cursor);
    if (range) {
      out.set(seg.block.id, range);
      cursor = range.end + 1; // 下一块从这一块之后找（块不会重叠）
    }
  }
  return out;
}
