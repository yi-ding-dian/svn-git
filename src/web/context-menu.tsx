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
import React, { useRef, useState } from 'react';

export interface CtxMenuItem {
  icon?: React.ReactNode;
  label?: string;
  danger?: boolean;
  /** 分隔线（渲染时忽略其他字段） */
  sep?: boolean;
  /** 命令预览：悬浮该项时在菜单底部显示将执行的命令（教学/透明层） */
  cmd?: string;
  action?: () => void;
  /** 二级子菜单（悬浮/点击右侧展开,如「打开方式」） */
  submenu?: CtxMenuItem[];
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
        className="ctx-menu"
        style={{ left: props.x, top: props.y }}
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
              title={it.cmd ?? undefined}
            >
              <span className="ctx-icon">{it.icon}</span>
              <span>{it.label}</span>
              {it.submenu && <span className="ctx-arrow">▶</span>}
            </div>
          )
        )}
        {/* 二级子菜单面板：贴住对应项右侧（真实 DOM 定位,详见文件头注释） */}
        {openSub && subRect && (
          <div
            className="ctx-menu ctx-submenu"
            style={{ position: 'fixed', left: subRect.right - 2, top: subRect.top }}
            onMouseEnter={() => setHoverIdx(openSub!.i)}
            onMouseLeave={() => {
              setHoverIdx(null);
              setPinIdx(null);
            }}
          >
            {openSub!.it.submenu!.map((s, si) => (
              <div
                key={si}
                className={`ctx-item ${s.danger ? 'danger' : ''}`}
                onClick={() => {
                  props.onClose();
                  s.action?.();
                }}
              >
                <span className="ctx-icon">{s.icon}</span>
                <span>{s.label}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
