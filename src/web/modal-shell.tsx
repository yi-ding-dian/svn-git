/** 通用弹窗壳：遮罩 + 可调整大小容器 + 标题行 + 底部操作区（默认仅「关闭」）
 *  遮罩点击不关闭（只能通过关闭按钮 / Esc 关闭），避免误触弹窗消失 */
export function ModalShell(props: {
  title: string;
  /** 标题图标：SVG 组件（优先）或 emoji；emoji 依赖系统字体，部分新字符(如 🪵)可能缺字形 */
  icon?: React.ReactNode;
  width?: number;
  /** 最小宽度（默认 480） */
  minWidth?: number;
  /** 底部操作区；不传时仅「关闭」按钮 */
  foot?: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="modal-mask">
      <ResizableModal width={props.width ?? 560} minWidth={props.minWidth} onEsc={props.onClose}>
        <h3>
          {props.icon && <span style={{ marginRight: 8 }}>{props.icon}</span>}
          {props.title}
        </h3>
        <div className="body">{props.children}</div>
        <div className="foot">
          {props.foot ?? <button onClick={props.onClose}>关闭</button>}
        </div>
      </ResizableModal>
    </div>
  );
}

/** 通用可调整大小弹窗容器(ResizableModal)
 *
 * 特性:
 * - 鼠标按住窗口边缘(四边 + 四角,8 方向)拖动即可调整宽高,松开结束
 * - 尺寸钳制:最小(默认 480×360,可配)、最大(默认不超 96vw/92vh,可配)
 * - 可选受控最大化(maxed):宽高同时放大到接近视口;最大化状态下拖动边缘会自动还原
 * - 拖动开始后转为 fixed 定位(以拖动前位置为左上角),拖动中左上角不动、拖动后保持该位置
 * - 保持 .modal 的 flex column 布局(h3 / body / foot),body 内部滚动、foot 固定底部
 *
 * 用法:
 *   <div className="modal-mask">
 *     <ResizableModal width={660}>
 *       <h3>标题</h3>
 *       <div className="body">内容</div>
 *       <div className="foot">按钮</div>
 *     </ResizableModal>
 *   </div>
 * 注意：modal-mask 遮罩点击不关闭（防误触），关闭只能走按钮 / Esc（onEsc）
 */
import React, { useEffect, useRef, useState } from 'react';

/** 边缘热区厚度(px) */
const EDGE = 8;

/** 8 方向 → 拖拽光标 */
const CURSORS: Record<string, string> = {
  n: 'ns-resize',
  s: 'ns-resize',
  w: 'ew-resize',
  e: 'ew-resize',
  nw: 'nwse-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
  se: 'nwse-resize',
};

/** 8 个方向热区:位置 + 光标(角略大,便于点中) */
const EDGES: { dir: string; cursor: string; style: React.CSSProperties }[] = [
  { dir: 'n', cursor: 'ns-resize', style: { top: 0, left: 16, right: 16, height: EDGE } },
  { dir: 's', cursor: 'ns-resize', style: { bottom: 0, left: 16, right: 16, height: EDGE } },
  { dir: 'w', cursor: 'ew-resize', style: { left: 0, top: 16, bottom: 16, width: EDGE } },
  { dir: 'e', cursor: 'ew-resize', style: { right: 0, top: 16, bottom: 16, width: EDGE } },
  { dir: 'nw', cursor: 'nwse-resize', style: { top: 0, left: 0, width: 20, height: 20 } },
  { dir: 'ne', cursor: 'nesw-resize', style: { top: 0, right: 0, width: 20, height: 20 } },
  { dir: 'sw', cursor: 'nesw-resize', style: { bottom: 0, left: 0, width: 20, height: 20 } },
  { dir: 'se', cursor: 'nwse-resize', style: { bottom: 0, right: 0, width: 20, height: 20 } },
];

/** number 或 vw/vh 字符串 → px 数值;无法解析时用默认值 */
function toPx(v: number | string | undefined, def: number): number {
  if (v == null) return def;
  if (typeof v === 'number') return v;
  const s = v.trim();
  if (s.endsWith('vw')) return (parseFloat(s) / 100) * window.innerWidth;
  if (s.endsWith('vh')) return (parseFloat(s) / 100) * window.innerHeight;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : def;
}

export function ResizableModal(props: {
  /** 默认宽度(数字 px 或 CSS 字符串);拖拽后以拖拽结果为准 */
  width?: number | string;
  /** 默认高度;不传则按内容自适应 */
  height?: number | string;
  /** 最小宽/高(拖拽钳制),默认 480 / 360 */
  minWidth?: number;
  minHeight?: number;
  /** 最大宽/高(不超视口),默认 '96vw' / '92vh' */
  maxWidth?: number | string;
  maxHeight?: number | string;
  /** 受控最大化:为 true 时宽高同时放大到 maxedWidth/maxedHeight(默认同 maxWidth/maxHeight) */
  maxed?: boolean;
  /** 最大化状态回调(拖动边缘退出最大化时调用;由外部按钮切换时无需此回调) */
  onToggleMax?: () => void;
  /** 最大化时的宽/高,默认 '96vw' / '92vh' */
  maxedWidth?: number | string;
  maxedHeight?: number | string;
  /** 透传给 .modal 的额外样式(仅作为未拖拽时的初始值,拖拽后以拖拽结果为准) */
  style?: React.CSSProperties;
  /** 按 Esc 时回调(关闭弹窗);不传则 Esc 无操作(事件仍被拦截,不会穿透到底层视图) */
  onEsc?: () => void;
  children: React.ReactNode;
}) {
  // 用户拖拽后的固定尺寸;null = 未拖拽,按默认尺寸自适应
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  // 拖拽开始后弹窗改为 fixed 定位并保持左上角位置(避免 flex 居中导致拖动时整窗平移)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  // 当前拖拽中的方向(用于高亮手柄)
  const [dragDir, setDragDir] = useState('');
  const [dragging, setDragging] = useState(false);
  const elRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ dir: string; sx: number; sy: number; sw: number; sh: number; sl: number; st: number } | null>(null);

  // 最大化状态切换时回到居中(最大化撑满视口,应居中)
  useEffect(() => {
    setPos(null);
  }, [props.maxed]);

  // Esc 关闭 + 焦点圈禁 + 键盘防穿透：
  // 在 document 捕获阶段处理，弹窗打开时按键不会漏到弹窗外（底层视图的 window keydown 不再响应）。
  // 注意：不能对弹窗内所有按键无脑 stopPropagation —— React 事件委托挂在 root 容器，
  // 会被拦截导致输入框 onKeyDown（如提交注释 Ctrl+Enter）失效，故输入元素按键放行。
  useEffect(() => {
    const el = elRef.current;
    if (!el) return;
    const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as Node | null;
      const inside = !!t && el.contains(t);
      const tag = (e.target as HTMLElement)?.tagName;
      const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (e.target as HTMLElement)?.isContentEditable;
      if (e.key === 'Escape') {
        // 弹窗打开时 Esc 一律不穿透（即使不关闭，也防止底层视图收到）
        e.stopPropagation();
        props.onEsc?.();
        return;
      }
      if (e.key === 'Tab') {
        const f = el.querySelectorAll<HTMLElement>(FOCUSABLE);
        if (f.length === 0) return;
        const first = f[0]!;
        const last = f[f.length - 1]!;
        if (!inside) {
          // 焦点在弹窗外：拉回弹窗内并拦截
          e.preventDefault();
          e.stopPropagation();
          (e.shiftKey ? last : first).focus();
          return;
        }
        // 弹窗内：焦点圈禁（最后一个上 Tab → 回第一个；第一个上 Shift+Tab → 到最后一个）
        const active = document.activeElement;
        if (!e.shiftKey && active === last) {
          e.preventDefault();
          e.stopPropagation();
          first.focus();
        } else if (e.shiftKey && (active === first || !el.contains(active))) {
          e.preventDefault();
          e.stopPropagation();
          last.focus();
        }
        return;
      }
      // 其他按键：焦点在弹窗外，或弹窗内非输入元素上 → 不穿透到底层视图
      if (!inside || !typing) e.stopPropagation();
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [props.onEsc]);

  // 拖拽中:window 级监听 mousemove/mouseup
  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const minW = props.minWidth ?? 480;
      const minH = props.minHeight ?? 360;
      const maxW = toPx(props.maxWidth, window.innerWidth * 0.96);
      const maxH = toPx(props.maxHeight, window.innerHeight * 0.92);
      const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);
      let w = d.sw;
      let h = d.sh;
      const dx = e.clientX - d.sx;
      const dy = e.clientY - d.sy;
      // 按方向累加/抵消:左右边缘改变宽度,上下边缘改变高度
      if (d.dir.includes('e')) w = clamp(w + dx, minW, maxW);
      if (d.dir.includes('s')) h = clamp(h + dy, minH, maxH);
      if (d.dir.includes('w')) w = clamp(w - dx, minW, maxW);
      if (d.dir.includes('n')) h = clamp(h - dy, minH, maxH);
      // w/n 方向:窗口位置随尺寸变化移动(左/上边缘跟随鼠标,右/下边缘保持不动)
      let left = d.sl;
      let top = d.st;
      if (d.dir.includes('w')) left = d.sl + (d.sw - w);
      if (d.dir.includes('n')) top = d.st + (d.sh - h);
      setSize({ w: Math.round(w), h: Math.round(h) });
      setPos({ left: Math.round(left), top: Math.round(top) });
    };
    const onUp = () => {
      dragRef.current = null;
      setDragging(false);
      setDragDir('');
      document.body.style.cursor = '';
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
    };
  }, [dragging, props.minWidth, props.minHeight, props.maxWidth, props.maxHeight]);

  /** 按住边缘热区开始拖拽 */
  const startDrag = (dir: string) => (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const el = elRef.current;
    if (!el) return;
    e.preventDefault();
    e.stopPropagation();
    const rect = el.getBoundingClientRect();
    // 最大化状态下拖动:先还原为普通窗口,再按拖动位置继续
    if (props.maxed) props.onToggleMax?.();
    dragRef.current = { dir, sx: e.clientX, sy: e.clientY, sw: rect.width, sh: rect.height, sl: rect.left, st: rect.top };
    // 转为 fixed:左上角固定为拖动前位置,拖拽中四角/四边正确伸缩
    setPos({ left: rect.left, top: rect.top });
    document.body.style.cursor = CURSORS[dir];
    setDragDir(dir);
    setDragging(true);
  };

  // 尺寸计算优先级:最大化 > 拖拽结果 > 默认值(style / width / height)
  const width = props.maxed
    ? (props.maxedWidth ?? '96vw')
    : size
      ? `${size.w}px`
      : (props.width ?? props.style?.width);
  const height = props.maxed
    ? (props.maxedHeight ?? '92vh')
    : size
      ? `${size.h}px`
      : (props.height ?? props.style?.height);
  // 最大尺寸限制(最大化时跟随 maxed 尺寸,避免被 max 钳制)
  const maxWidth = props.maxed ? (props.maxedWidth ?? '96vw') : (props.maxWidth ?? '96vw');
  const maxHeight = props.maxed ? (props.maxedHeight ?? '92vh') : (props.maxHeight ?? '92vh');

  return (
    <div
      ref={elRef}
      className="modal"
      style={{
        ...props.style,
        width,
        height,
        maxWidth,
        maxHeight,
        position: pos ? 'fixed' : 'relative',
        left: pos?.left,
        top: pos?.top,
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {props.children}
      {/* 8 方向拖拽热区:四边 + 四角 */}
      {EDGES.map((ed) => (
        <div
          key={ed.dir}
          className={`mr-edge${dragDir === ed.dir ? ' active' : ''}`}
          style={{ ...ed.style, cursor: ed.cursor }}
          onMouseDown={startDrag(ed.dir)}
        />
      ))}
    </div>
  );
}
