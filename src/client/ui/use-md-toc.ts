/** Markdown 文档目录（阅读区共用）：从渲染后的 DOM 提取标题、挂锚点、跳转。
 *
 *  为什么走 DOM 而不是解析 md 源码：条目顺序与文本跟屏幕上看到的完全一致
 *  （marked 的 renderer 调用次序在引用、列表等嵌套块里可能与源码顺序不同），
 *  也不用给 markdown.ts 加参数。文件预览和差异预览共用这一套。
 *
 *  用法：预览容器挂 bodyRef；正文重新渲染（innerHTML 更新）之后在 useEffect 里调 rescan；
 *  离开预览态调 clear（否则按钮还挂在旧条目上，点下去已经找不到锚点）。
 *  容器的挂载/卸载本身由 bodyRef（回调 ref）兜住 —— 见下面的注释。
 */
import { useCallback, useRef, useState } from 'react';
import type { TocItem } from './md-toc.js';

export interface MdTocApi {
  /** 挂到 md 正文容器上：提取标题、跳转都靠它。
   *  用**回调 ref** 而不是 MutableRefObject：容器可能被卸载后重建（差异视图进/出就地编辑、
   *  文件预览切原文/预览），重建后调用方的 rescan 依赖（内容、开关）往往没变、effect 不重跑，
   *  新 DOM 上没有锚点 id，目录条目点下去全都"没反应"。 */
  bodyRef: (el: HTMLDivElement | null) => void;
  items: TocItem[];
  /** 重新提取（正文重渲染后调用） */
  rescan: () => void;
  /** 清空（离开预览态时调用） */
  clear: () => void;
  /** 跳到某个标题（在容器内平滑滚动） */
  jump: (id: string) => void;
}

export function useMdToc(): MdTocApi {
  const elRef = useRef<HTMLDivElement | null>(null);
  const [items, setItems] = useState<TocItem[]>([]);
  /** 扫容器里的标题并挂锚点 id；容器为 null（还没渲染/已卸载）时清空条目 */
  const scan = useCallback((el: HTMLDivElement | null) => {
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
  /** 回调 ref：身份稳定（依赖 scan），只在容器真正挂载/卸载时被调用，重渲染不会误触发 */
  const bodyRef = useCallback(
    (el: HTMLDivElement | null) => {
      elRef.current = el;
      scan(el);
    },
    [scan],
  );
  const rescan = useCallback(() => scan(elRef.current), [scan]);
  const clear = useCallback(() => setItems([]), []);
  const jump = useCallback((id: string) => {
    elRef.current?.querySelector<HTMLElement>(`#${id}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, []);
  return { bodyRef, items, rescan, clear, jump };
}
