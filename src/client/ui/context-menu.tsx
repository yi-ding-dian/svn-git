/** 通用右键菜单：遮罩(可选) + ctx-menu，菜单项支持 图标/危险色/分隔线/二级子菜单
 *
 * 用法：
 *   <ContextMenu x={x} y={y} items={items} onClose={close} mask />
 *   - mask：渲染全屏遮罩（点击/右键关闭），适合"最近项目"等简单右键；fs 视图用 window 监听关闭时不传
 *   - onMouseEnter/onMouseLeave：透传给菜单（fs 的"菜单悬停保持/延迟关闭"逻辑）
 *
 * 二级子菜单定位：悬浮/点击带 submenu 的菜单项时,用该项的真实 DOM 矩形贴其右侧
 * （fixed + 视口坐标,非估算行高）,菜单项高度/分隔线如何变化都能精确对齐。
 */
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';

export interface CtxMenuItem {
  icon?: React.ReactNode;
  label?: string;
  danger?: boolean;
  /** 分隔线（渲染时忽略其他字段） */
  sep?: boolean;
  /** 命令预览：悬浮该项时在菜单底部显示将执行的命令（教学/透明层） */
  cmd?: string;
  /** 悬浮提示（原生 tooltip，如危险操作的后果说明） */
  title?: string;
  action?: () => void;
  /** 二级子菜单（悬浮/点击右侧展开,如「打开方式」） */
  submenu?: CtxMenuItem[];
  /** 不显示右侧 ▶ 箭头（子菜单照常展开）——给「语言」这类展开方式不言自明的项用 */
  noArrow?: boolean;
  /** 可拖拽的唯一键（按住可拖出菜单，如工具栏定制） */
  dndKey?: string;
  /** 拖拽开始（mousedown，配合 dndKey；仅按住拖动用途，普通点击动作不受影响） */
  onMouseDown?: (e: React.MouseEvent) => void;
  /** 拖拽结束（mouseup） */
  onDragEnd?: (e: React.MouseEvent) => void;
  /** 拖拽落点高亮（菜单内部重排：该项顶部显示蓝边） */
  dropTop?: boolean;
}

export function ContextMenu(props: {
  x: number;
  y: number;
  items: CtxMenuItem[];
  onClose: () => void;
  mask?: boolean;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [pinIdx, setPinIdx] = useState<number | null>(null); // 点击展开锁定的子菜单项
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);
  // 清理孤立/连续分隔线：菜单首项前的 sep（"隔离空气"）与重复 sep 一律去掉
  const items = props.items.filter((it, i) => !(it.sep && (i === 0 || props.items[i - 1]?.sep)));
  // 当前应展开的子菜单项（悬浮或点击锁定均算）
  let openSub: { it: CtxMenuItem; i: number } | null = null;
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (it.submenu && (hoverIdx === i || pinIdx === i)) {
      openSub = { it, i };
      break;
    }
  }
  const subRect = openSub ? itemRefs.current[openSub.i]?.getBoundingClientRect() : undefined;
  // 菜单尺寸量出来之前先按原始 (x,y) 放，量到后夹回视口内（layout effect 在绘制前完成，看不到跳动）。
  // 原先没有这一步：菜单直接以点击点为左上角向下展开，右键靠近窗口底部的行（如"最近项目"最后几行）
  // 时后半截会被窗口底边裁掉——「删除」这类项根本点不到（用户实报）。
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const M = 8; // 距视口边缘的留白
    const left = Math.max(M, Math.min(props.x, window.innerWidth - r.width - M));
    const top = Math.max(M, Math.min(props.y, window.innerHeight - r.height - M));
    setPos((p) => (p && p.left === left && p.top === top ? p : { left, top }));
  }, [props.x, props.y, items]);
  const at = pos ?? { left: props.x, top: props.y };
  return (
    <>
      {props.mask && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 299 }}
          onClick={props.onClose}
          onContextMenu={(e) => {
            e.preventDefault();
            props.onClose();
          }}
        />
      )}
      <div
        ref={menuRef}
        className="ctx-menu"
        style={{ left: at.left, top: at.top }}
        onMouseEnter={props.onMouseEnter}
        onMouseLeave={props.onMouseLeave}
      >
        {items.map((it, i) =>
          it.sep ? (
            <div key={i} className="ctx-sep" />
          ) : (
            <div
              key={i}
              ref={(el) => {
                itemRefs.current[i] = el;
              }}
              className={`ctx-item ${it.danger ? 'danger' : ''} ${it.submenu && hoverIdx === i ? 'submenu-open' : ''}`}
              data-menu-key={it.dndKey}
              style={it.dropTop ? { boxShadow: 'inset 0 2.5px 0 var(--accent)' } : undefined}
              title={it.cmd ? `${it.title ?? ''}\n${it.cmd}` : it.title}
              onMouseDown={it.onMouseDown}
              onMouseUp={it.onDragEnd}
              onClick={() => {
                if (it.submenu) {
                  setHoverIdx(i);
                  setPinIdx(i);
                  return; // 子菜单项: 点击=展开(与悬浮一致)
                }
                // 先关菜单再执行动作（各调用方原有行为一致：关闭优先）
                props.onClose();
                it.action?.();
              }}
              onMouseEnter={() => setHoverIdx(it.submenu ? i : null)}
            >
              <span className="ctx-icon">{it.icon}</span>
              <span>{it.label}</span>
              {it.submenu && !it.noArrow && <span className="ctx-arrow">▶</span>}
            </div>
          )
        )}
        {/* 二级子菜单面板：贴住对应项右侧；右侧空间不足（子菜单宽 > 右缘余量）时向左展开（真实 DOM 定位,详见文件头注释） */}
        {openSub && subRect && (
          <SubmenuPane openSub={openSub} subRect={subRect} onEnter={() => setHoverIdx(openSub.i)} onLeave={() => { setHoverIdx(null); setPinIdx(null); }} onAction={() => props.onClose()} />
        )}
      </div>
    </>
  );
}

/** 二级子菜单面板：ref 量宽后决定向左/向右展开（右缘不足向左），避免被屏幕右边界截断 */
function SubmenuPane(props: {
  openSub: { it: CtxMenuItem; i: number };
  subRect: DOMRect;
  onEnter: () => void;
  onLeave: () => void;
  onAction: () => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [flip, setFlip] = useState(false);
  useEffect(() => {
    if (!ref.current) return;
    const w = ref.current.offsetWidth;
    setFlip(props.subRect.right - 2 + w > window.innerWidth);
  }, [props.subRect, props.openSub, props.openSub.it]);
  return (
    <div
      ref={ref}
      className="ctx-menu ctx-submenu"
      style={{
        position: 'fixed',
        left: flip && ref.current ? props.subRect.left - ref.current.offsetWidth + 2 : props.subRect.right - 2,
        top: props.subRect.top,
      }}
      onMouseEnter={props.onEnter}
      onMouseLeave={props.onLeave}
    >
      {props.openSub.it.submenu!.map((s, si) => (
        <div
          key={si}
          className={`ctx-item ${s.danger ? 'danger' : ''}`}
          title={s.cmd ? `${s.cmd}\n${s.title ?? ''}` : s.title}
          onClick={() => {
            props.onAction();
            s.action?.();
          }}
        >
          <span className="ctx-icon">{s.icon}</span>
          <span>{s.label}</span>
        </div>
      ))}
    </div>
  );
}
