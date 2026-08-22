/** 行级冲突检测核心算法：解析 unified diff 中 BASE 侧的变更位置。
 * 纯函数，无外部依赖——与 server.ts 解耦后便于独立单测（预检/提交前强制拦截依赖其正确性）。 */

/**
 * diffChangedLines：解析 unified diff 文本,返回 BASE 侧变更行号集合。
 * del = 被删除/修改的 BASE 行号;ins = 插入位置集合（+ 行对应的 BASE 行号,即在该行之后插入）。
 */
export function diffChangedLines(diffText: string): { del: Set<number>; ins: Set<number> } {
  const del = new Set<number>();
  const ins = new Set<number>();
  let cur = 0;
  for (const raw of diffText.split('\n')) {
    const h = raw.match(/^@@ -(\d+)(?:,\d+)?/);
    if (h && h[1]) {
      cur = Number(h[1]);
      continue;
    }
    // 跳过文件头行（svn 的 "--- xxx (版本 34)" / git 的 "--- a/xxx" 与 "+++ b/xxx"）。
    // 文件头恒为三横线/三加号+空格；内容行以 ---/+++ 开头时（如 markdown 分隔行）被 diff
    // 冠以行首标记后恒为四横线/四加号（---- / ++++），故收紧为带空格的精确匹配，
    // 否则行号 cur 漏递增导致其后所有 BASE 行号偏移 1（行级冲突漏报/误报）。
    // +++ 行以 + 开头，若不跳过会被误判为插入行（且此时行号 cur=0 → 恒误报"文件开头冲突"）
    if (raw.startsWith('--- ') || raw.startsWith('+++ ')) continue;
    if (raw.startsWith('-')) {
      del.add(cur);
      cur += 1;
    } else if (raw.startsWith('+')) {
      ins.add(cur); // 在该 BASE 行位置之后插入
    } else if (raw.startsWith(' ')) {
      cur += 1;
    }
  }
  return { del, ins };
}
