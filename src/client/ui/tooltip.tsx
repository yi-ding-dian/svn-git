/** 通用悬浮提示：替代原生 title，浮层跟随主题、支持富内容。
 *
 * 用法：
 *   <Tooltip content={<><TipTitle>标题</TipTitle><TipMarkdown text={正文} /></>}>
 *     <button>…</button>
 *   </Tooltip>
 *
 * 设计要点（性能相关）：
 *   - 不渲染包裹元素：事件通过 cloneElement 注入到子元素本身，不改原有布局/绝对定位
 *   - 浮层是单例 Portal，未打开时返回 null（DOM 里没有节点）
 *   - 350ms 延迟出现，移出立即取消；扫过列表不会反复创建浮层
 *   - 位置贴近原生 title：出现在**光标右下方**，右侧/底部放不下就翻到另一侧；
 *     键盘 focus 没有光标坐标时回退到元素右下角。位置只在打开时测量一次；
 *     打开期间滚动/缩放直接收起（不逐帧重算）
 *   - mousemove 只写 ref（记录光标位置），不触发渲染，避免高频 setState
 */
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { renderMarkdown } from '../shared/markdown.js';

/** 延迟出现：避免鼠标扫过列表时频繁闪现 */
const SHOW_DELAY = 350;
/** 浮层相对光标的偏移：Chromium 原生 title 就在光标右下方约这个距离 */
const CURSOR_X = 14;
const CURSOR_Y = 18;
/** 浮层与视口边缘的留白 */
const EDGE = 8;

type AnchorProps = {
  ref?: React.Ref<HTMLElement>;
  onMouseEnter?: React.MouseEventHandler;
  onMouseLeave?: React.MouseEventHandler;
  onMouseMove?: React.MouseEventHandler;
  onFocus?: React.FocusEventHandler;
  onBlur?: React.FocusEventHandler;
};

/** 把外部 ref 和内部 ref 都挂到锚点元素上（子元素可能自带 ref） */
function setRef(ref: React.Ref<HTMLElement> | undefined, node: HTMLElement | null): void {
  if (typeof ref === 'function') ref(node);
  else if (ref && typeof ref === 'object') (ref as React.MutableRefObject<HTMLElement | null>).current = node;
}

export function Tooltip(props: {
  /** 浮层内容：字符串按普通文本显示；富内容用 TipTitle/TipMarkdown 等小组件拼 */
  content: React.ReactNode;
  /** 不显示（条件提示用）：传 true 时原样返回子元素，不挂任何事件 */
  disabled?: boolean;
  /** 出现延迟（ms），默认 350 */
  delay?: number;
  children: React.ReactElement;
}) {
  const anchorRef = useRef<HTMLElement | null>(null);
  const timerRef = useRef<number | null>(null);
  /** 最近一次光标坐标（mousemove 只写这里，不触发渲染） */
  const pointRef = useRef<{ x: number; y: number } | null>(null);
  const [point, setPoint] = useState<{ x: number; y: number } | null>(null);
  const [open, setOpen] = useState(false);

  const clearTimer = useCallback(() => {
    if (timerRef.current != null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);
  const show = useCallback(() => {
    clearTimer();
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      // 锚点已不在文档里（列表刷新/换文件）就不弹
      if (anchorRef.current?.isConnected) {
        setPoint(pointRef.current);
        setOpen(true);
      }
    }, props.delay ?? SHOW_DELAY);
  }, [clearTimer, props.delay]);
  const hide = useCallback(() => {
    clearTimer();
    setOpen(false);
  }, [clearTimer]);

  useEffect(() => () => clearTimer(), [clearTimer]);

  // 打开期间滚动/缩放：直接收起。长列表滚动时逐帧测量浮层位置会掉帧，
  // 收起后鼠标移出再移入即可重新显示，体验上更稳。
  useEffect(() => {
    if (!open) return;
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    return () => {
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('resize', hide);
    };
  }, [open, hide]);

  const hasContent = props.content != null && props.content !== false && props.content !== '';
  const child = props.children;
  const cp = child.props as AnchorProps;
  // 条件提示：无内容/禁用时原样返回，零开销（hooks 已全部调用，数量保持稳定）
  if (props.disabled || !hasContent) return child;

  const anchor = React.cloneElement(child, {
    ref: (node: HTMLElement | null) => {
      anchorRef.current = node;
      setRef(cp.ref, node);
    },
    onMouseEnter: (e: React.MouseEvent) => {
      cp.onMouseEnter?.(e);
      pointRef.current = { x: e.clientX, y: e.clientY };
      show();
    },
    onMouseMove: (e: React.MouseEvent) => {
      cp.onMouseMove?.(e);
      pointRef.current = { x: e.clientX, y: e.clientY };
    },
    onMouseLeave: (e: React.MouseEvent) => {
      cp.onMouseLeave?.(e);
      hide();
    },
    onFocus: (e: React.FocusEvent) => {
      cp.onFocus?.(e);
      // 键盘聚焦没有光标坐标：回退到元素右下角（元素中心的正下方）
      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
      pointRef.current = { x: r.left + r.width / 2, y: r.bottom };
      show();
    },
    onBlur: (e: React.FocusEvent) => {
      cp.onBlur?.(e);
      hide();
    },
  } as AnchorProps);

  return (
    <>
      {anchor}
      {open && anchorRef.current && (
        <TipLayer point={point} anchor={anchorRef.current}>
          {props.content}
        </TipLayer>
      )}
    </>
  );
}

/** 浮层本体：首帧先以 visibility:hidden 量尺寸，layout effect 定位后再显示（不会闪到左上角） */
function TipLayer(props: { point: { x: number; y: number } | null; anchor: HTMLElement; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    // 与原生 title 一致：光标右下方；放不下就翻到光标另一侧
    const a = props.anchor.getBoundingClientRect();
    const x = props.point?.x ?? a.left + a.width / 2;
    const y = props.point?.y ?? a.bottom;
    let left = x + CURSOR_X;
    let top = y + CURSOR_Y;
    if (left + r.width > window.innerWidth - EDGE) left = x - r.width - CURSOR_X;
    if (top + r.height > window.innerHeight - EDGE) top = y - r.height - CURSOR_Y;
    left = Math.max(EDGE, left);
    top = Math.max(EDGE, top);
    setPos({ left, top });
  }, [props.point, props.anchor, props.children]);

  return createPortal(
    <div
      ref={ref}
      className="tip-layer"
      style={{ left: pos?.left ?? 0, top: pos?.top ?? 0, visibility: pos ? 'visible' : 'hidden' }}
    >
      {typeof props.children === 'string' ? (
        // 纯字符串内容：保留 \n 换行（命令预览等场景），与富内容节点互不干扰
        <div className="tip-text">{props.children}</div>
      ) : (
        props.children
      )}
    </div>,
    document.body,
  );
}

/** 标题行：加粗 */
export function TipTitle(props: { children: React.ReactNode }) {
  return <div className="tip-title">{props.children}</div>;
}

/** Markdown 正文：与历史详情/提交注释预览同一套渲染。
 *  breaks: true —— 单换行也换行，纯文本写的提交说明不会粘成一段；
 *  恰好是 Markdown 语法的行（- 列表、**加粗**、# 标题）按语法显示。 */
export function TipMarkdown(props: { text: string }) {
  return (
    <div
      className="tip-body tip-md md-render commit-msg-md"
      dangerouslySetInnerHTML={{ __html: renderMarkdown(props.text, { breaks: true }) }}
    />
  );
}

/** 末尾提示行：淡色小字 */
export function TipHint(props: { children: React.ReactNode }) {
  return <div className="tip-hint">{props.children}</div>;
}
