/** Markdown 文档目录（阅读区共用）：从渲染后的 DOM 提取标题、挂锚点、跳转、跟踪当前章节。
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
  /** 当前阅读到的那一节（滚动时随正文更新，打开目录浮层时用来定位与高亮） */
  activeId: string | null;
  /** 重新提取（正文重渲染后调用） */
  rescan: () => void;
  /** 清空（离开预览态时调用） */
  clear: () => void;
  /** 跳到某个标题（在容器内平滑滚动） */
  jump: (id: string) => void;
}

/** 最近的纵向可滚动祖先（正文外层容器）。找不到就当视口滚动 —— 预览面板里其实是 .diff 那层 */
function scrollParent(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const s = getComputedStyle(p);
    if (s.overflowY === 'auto' || s.overflowY === 'scroll') return p;
  }
  return null;
}

export function useMdToc(): MdTocApi {
  const elRef = useRef<HTMLDivElement | null>(null);
  /** 扫描时缓存标题元素：滚动每帧都要量位置，避免反复 querySelectorAll */
  const headsRef = useRef<HTMLElement[]>([]);
  /** 当前绑定的滚动容器与解绑函数（null = 还没绑） */
  const scrollRef = useRef<{ el: HTMLElement | null; off: () => void } | null>(null);
  const rafRef = useRef(0);
  const [items, setItems] = useState<TocItem[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);

  /** 算当前章节：最后一个「顶边越过容器可视顶部」的标题；滚到底时归最后一项
   *  （末节往往不足一屏，按顶边规则永远轮不到它）。 */
  const computeActive = useCallback(() => {
    const hs = headsRef.current;
    if (!hs.length) {
      setActiveId(null);
      return;
    }
    const sc = scrollRef.current?.el ?? null;
    if (sc && sc.clientHeight === 0) return; // 容器隐藏（切到原文/别处）时不判，rect 全是 0 会误判
    const limit = (sc ? sc.getBoundingClientRect().top : 0) + 12; // 留一点余量：标题贴顶即算已到
    let act = hs[0]!;
    for (const h of hs) {
      if (h.getBoundingClientRect().top > limit) break;
      act = h;
    }
    if (sc && sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 8) act = hs[hs.length - 1]!;
    setActiveId(act.id);
  }, []);

  /** 滚动里每帧最多算一次（scroll 事件远比帧密） */
  const schedule = useCallback(() => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      computeActive();
    });
  }, [computeActive]);

  /** 解绑滚动监听（容器重建 / 清空时调用） */
  const detach = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }
    scrollRef.current?.off();
    scrollRef.current = null;
  }, []);

  /** 绑到正文外层的滚动容器；没有滚动容器时退回监听视口 */
  const attach = useCallback(
    (el: HTMLDivElement) => {
      detach();
      const sc = scrollParent(el);
      // 用 EventTarget：HTMLElement 与 Window 的 addEventListener 重载签名不同，联合类型直接调用会报错
      const target: EventTarget = sc ?? window;
      const onScroll = () => schedule();
      target.addEventListener('scroll', onScroll, { passive: true });
      window.addEventListener('resize', onScroll);
      scrollRef.current = {
        el: sc,
        off: () => {
          target.removeEventListener('scroll', onScroll);
          window.removeEventListener('resize', onScroll);
        },
      };
    },
    [detach, schedule],
  );

  /** 扫容器里的标题并挂锚点 id；容器为 null（还没渲染/已卸载）时清空条目 */
  const scan = useCallback(
    (el: HTMLDivElement | null) => {
      if (!el) {
        detach();
        headsRef.current = [];
        setItems([]);
        setActiveId(null);
        return;
      }
      const hs = [...el.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6')];
      headsRef.current = hs;
      setItems(
        hs.map((h, i) => {
          const id = `md-h-${i}`;
          h.id = id;
          return { level: Number(h.tagName[1]), text: h.textContent ?? '', id };
        }),
      );
      attach(el);
      computeActive(); // 正文刚重渲染（换文件/切主题）时先定位一次，不必等用户滚动
    },
    [attach, computeActive, detach],
  );
  /** 回调 ref：身份稳定（依赖 scan），只在容器真正挂载/卸载时被调用，重渲染不会误触发 */
  const bodyRef = useCallback(
    (el: HTMLDivElement | null) => {
      elRef.current = el;
      scan(el);
    },
    [scan],
  );
  const rescan = useCallback(() => scan(elRef.current), [scan]);
  const clear = useCallback(() => {
    detach();
    headsRef.current = [];
    setItems([]);
    setActiveId(null);
  }, [detach]);
  const jump = useCallback((id: string) => {
    elRef.current?.querySelector<HTMLElement>(`#${id}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, []);
  return { bodyRef, items, activeId, rescan, clear, jump };
}
