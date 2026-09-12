/** diff 的块级解析与 patch 构造（纯函数：字符串进、字符串出）。
 *
 *  用途：hunk 级部分提交——用户在界面上勾选若干块，这里负责
 *  1) 把 `git diff -U1` 的输出解析成「文件头 + hunk 列表」供 UI 渲染；
 *  2) 用选中的块拼出可直接 `git apply --cached` 的 patch。
 *
 *  为什么单独成文件：解析/拼接的边界情况多（\ No newline 标记、hunk 行数、空 diff），
 *  放在纯函数里可以脱离 git 与 UI 单独测（见 test/hunks-test.mjs），VCS 层只做薄封装。
 */

import type { HunkLine, Hunk, ParsedDiff } from '../shared/types.js';

// 类型定义在 src/shared/types.ts（前后端共享）；这里 re-export，保持既有导入路径可用
export type { HunkLine, Hunk, ParsedDiff };

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/** 解析单文件 diff（`git diff -U1 -- <path>` 的输出） */
export function parseDiff(diffText: string): ParsedDiff {
  const headerLines: string[] = [];
  const hunks: Hunk[] = [];
  let cur: Hunk | null = null;

  for (const line of diffText.split('\n')) {
    if (line.startsWith('@@')) {
      if (cur) hunks.push(cur);
      const m = line.match(HUNK_RE);
      cur = {
        index: hunks.length,
        header: line,
        oldStart: Number(m?.[1] ?? 0),
        oldLines: m?.[2] === undefined ? 1 : Number(m[2]),
        newStart: Number(m?.[3] ?? 0),
        newLines: m?.[4] === undefined ? 1 : Number(m[4]),
        lines: [],
      };
      continue;
    }
    if (!cur) {
      // hunk 之前的内容 = 文件头（末尾的空行由 join 时自然处理）
      if (line !== '' || headerLines.length) headerLines.push(line);
      continue;
    }
    // hunk 内部：+/-/空格 三种常规行，`\` 是「文件末尾无换行」标记
    if (line.startsWith('+')) cur.lines.push({ type: 'add', text: line.slice(1) });
    else if (line.startsWith('-')) cur.lines.push({ type: 'del', text: line.slice(1) });
    else if (line.startsWith('\\')) cur.lines.push({ type: 'meta', text: line });
    else cur.lines.push({ type: 'context', text: line.startsWith(' ') ? line.slice(1) : line });
  }
  if (cur) hunks.push(cur);

  // 去掉文件头尾部的空串（split 末位），避免拼 patch 时多出空行
  while (headerLines.length && headerLines[headerLines.length - 1] === '') headerLines.pop();
  return { fileHeader: headerLines.join('\n'), hunks };
}

/** 把文件头 + 选中的 hunk 拼成 patch；selected 里的序号会被去重并升序排列 */
export function buildPatch(parsed: ParsedDiff, selected: number[]): string {
  const want = new Set(selected);
  const lines: string[] = [parsed.fileHeader];
  for (const h of parsed.hunks) {
    if (!want.has(h.index)) continue;
    lines.push(h.header);
    for (const l of h.lines) {
      // meta 行（\ No newline at end of file）原样输出，其余加回前缀
      if (l.type === 'meta') lines.push(l.text);
      else lines.push(`${l.type === 'add' ? '+' : l.type === 'del' ? '-' : ' '}${l.text}`);
    }
  }
  return lines.join('\n') + '\n';
}

/** 从文件头里取新内容的 blob 哈希（`index <old>..<new>` 行）。
 *  暂存前用它比对：弹窗打开后文件若被外部改动，块的位置会错位，必须拒绝而不是照旧索引套用 */
export function blobOf(fileHeader: string): string | undefined {
  const m = fileHeader.match(/^index [0-9a-f]+\.\.([0-9a-f]+)/m);
  return m?.[1];
}

/** 变更块的摘要（UI 上每块的标题用，如「第 12 行 · +3 −1」） */
export function hunkSummary(h: Hunk): string {
  const add = h.lines.filter((l) => l.type === 'add').length;
  const del = h.lines.filter((l) => l.type === 'del').length;
  return `第 ${h.oldStart} 行 · +${add} −${del}`;
}
