/** 从 Markdown **源码**提取目录（编辑模式用）。
 *
 *  和 useMdToc 的区别：那边扫的是渲染后的 DOM（预览态才有容器），编辑态正文在 textarea 里，
 *  没有 DOM 可扫，只能按行解析源码。**条目跟着草稿实时变**，id 直接取 1-based 源码行号，
 *  点击方据此让编辑器跳行（InlineEditor.gotoLine）。
 *
 *  只认 ATX 标题（# ~ ######）：setext 下划线式（标题下加 === / ---）会把正文里的分隔线认成标题；
 *  围栏代码块（``` / ~~~）里的 # 是注释，不算标题。
 */
import { useMemo } from 'react';
import type { TocItem } from './md-toc.js';

export function useSourceToc(text: string): TocItem[] {
  return useMemo(() => {
    const items: TocItem[] = [];
    /** 当前所在的围栏代码块标记字符（空串 = 不在围栏里） */
    let fence = '';
    text.split('\n').forEach((line, i) => {
      const f = line.match(/^\s{0,3}(`{3,}|~{3,})/);
      if (f) {
        const mark = f[1]!.charAt(0);
        if (!fence) fence = mark;
        else if (fence === mark) fence = '';
        return;
      }
      if (fence) return;
      const m = line.match(/^\s{0,3}(#{1,6})[ \t]+(.*?)[ \t]*#*[ \t]*$/);
      if (!m) return;
      items.push({ level: m[1]!.length, text: m[2]!, id: String(i + 1) });
    });
    return items;
  }, [text]);
}
