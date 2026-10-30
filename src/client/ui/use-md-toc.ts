/** Markdown 文档目录（阅读区共用）：从渲染后的 DOM 提取标题、挂锚点、跳转。
 *
 *  为什么走 DOM 而不是解析 md 源码：条目顺序与文本跟屏幕上看到的完全一致
 *  （marked 的 renderer 调用次序在引用、列表等嵌套块里可能与源码顺序不同），
 *  也不用给 markdown.ts 加参数。文件预览和差异预览共用这一套。
 *
 *  用法：预览容器挂 bodyRef；正文重新渲染（innerHTML 更新）之后在 useEffect 里调 rescan；
 *  离开预览态调 clear（否则按钮还挂在旧条目上，点下去已经找不到锚点）。
 */
import { useCallback, useRef, useState, type MutableRefObject } from 'react';
import type { TocItem } from './md-toc.js';

export interface MdTocApi {
  /** 挂到 md 正文容器上：提取标题、跳转都靠它 */
  bodyRef: MutableRefObject<HTMLDivElement | null>;
  items: TocItem[];
  /** 重新提取（正文重渲染后调用） */
  rescan: () => void;
  /** 清空（离开预览态时调用） */
  clear: () => void;
  /** 跳到某个标题（在容器内平滑滚动） */
  jump: (id: string) => void;
}

export function useMdToc(): MdTocApi {
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const [items, setItems] = useState<TocItem[]>([]);
  const rescan = useCallback(() => {
    const el = bodyRef.current;
    if (!el) {
      setItems([]);
      return;
    }
    const hs = [...el.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6')];
    setItems(
      hs.map((h, i) => {
        const id = `md-h-${i}`;
        h.id = id;
        return { level: Number(h.tagName[1]), text: h.textContent ?? '', id };
      }),
    );
  }, []);
  const clear = useCallback(() => setItems([]), []);
  const jump = useCallback((id: string) => {
    bodyRef.current?.querySelector<HTMLElement>(`#${id}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, []);
  return { bodyRef, items, rescan, clear, jump };
}
