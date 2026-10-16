/** 搜索匹配高亮（把命中段包成 <mark class="search-mark">）：文件浏览器搜索与仓库浏览搜索共用，
 *  从 filesystem/search.tsx 提升到 shared（两个业务域都在用，按边界规范上浮）。 */
import React from 'react';

export function highlightMatch(text: string, q: string): React.ReactNode {
  if (!q) return text;
  const low = text.toLowerCase();
  const lq = q.toLowerCase();
  const out: React.ReactNode[] = [];
  let i = 0;
  let k = 0;
  for (;;) {
    const at = low.indexOf(lq, i);
    if (at < 0) break;
    if (at > i) out.push(text.slice(i, at));
    out.push(
      <mark key={k++} className="search-mark">
        {text.slice(at, at + q.length)}
      </mark>
    );
    i = at + q.length;
  }
  if (out.length === 0) return text;
  out.push(text.slice(i));
  return out;
}
