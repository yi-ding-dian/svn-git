/** diff 文本着色渲染 */
import React from 'react';

/**
 * @param marks 可选：要标出的 **BASE 行号**（旧文件行号，即后端算出的"双方都改到的行"）。
 *   这里用与 `vcs/diff-lines.ts` **完全相同**的行号跟踪规则，保证标出来的行和后端判定冲突的行严格对上
 *   （hunk 头重置行号；`--- `/`+++ ` 文件头不推进；`-` 与上下文行推进；`+` 停在插入位置不推进）。
 */
export function DiffRender(props: { text: string; marks?: Set<number> }) {
  const marks = props.marks;
  let cur = 0;
  let lastDelMarked = false; // 上一个删除行是否被标记：改一行 = 删一行 + 插一行，插入行要跟着标
  return (
    <div className="diff">
      {props.text.split('\n').map((l, i) => {
        let cls = '';
        let marked = false;
        if (l.startsWith('@@')) {
          cls = 'hunk';
          const h = l.match(/^@@ -(\d+)/);
          if (h?.[1]) cur = Number(h[1]);
          lastDelMarked = false;
        } else if (l.startsWith('diff --git') || l.startsWith('Index:') || l.startsWith('commit ')) {
          cls = 'filehead';
          lastDelMarked = false;
        } else if (/^---\s/.test(l) || /^\+\+\+\s/.test(l) || l.startsWith('===')) {
          cls = 'meta';
          lastDelMarked = false;
        } else if (l.startsWith('+')) {
          cls = 'add';
          // 插入位置的行号也参与判定（双方在同一位置各插入一行的情况），或跟着被标中的删除行
          marked = (marks?.has(cur) ?? false) || lastDelMarked;
        } else if (l.startsWith('-')) {
          cls = 'del';
          lastDelMarked = marks?.has(cur) ?? false;
          marked = lastDelMarked;
          cur += 1;
        } else if (l.startsWith(' ')) {
          // 上下文行一律不标：插入位置的行号会指向它下面那一行，标了就成了"第 N+1 行也冲突"的假象
          lastDelMarked = false;
          cur += 1;
        } else {
          lastDelMarked = false;
        }
        return (
          <div key={i} className={`line ${cls}${marked ? ' mark' : ''}`}>
            {l || ' '}
          </div>
        );
      })}
    </div>
  );
}
