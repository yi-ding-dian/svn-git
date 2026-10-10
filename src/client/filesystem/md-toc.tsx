/** Markdown 目录浮层：多级折叠树，点条目跳到文档对应标题。
 *
 *  定位/关闭沿用 MdThemePopover 那套（贴按钮、越界回退、点遮罩关闭）。
 *  条目由调用方从**渲染后的 DOM** 里提取（见 preview-pane 的 effect）—— 那样 id 顺序天然等于屏幕顺序，
 *  不用去猜 marked 的 renderer 调用次序（嵌套在引用/列表里的标题，两者可能对不上）。
 */
import React, { useLayoutEffect, useRef, useState } from 'react';
import { t } from '../../shared/i18n/index.js';

/** 目录条目（DOM 上已按 id 挂好锚点） */
export interface TocItem {
  /** 1-6，对应 h1-h6 */
  level: number;
  text: string;
  id: string;
}

export function MdTocPopover(props: {
  /** 按钮底边 y：浮层从它下方展开 */
  y: number;
  items: TocItem[];
  onJump: (id: string) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  // 初值藏在屏外：水平位置要量出宽度才能定，首帧若先画在右边会闪一下（useLayoutEffect 会赶在绘制前修正）
  const [pos, setPos] = useState({ left: -9999, top: props.y });
  /** 被折叠的条目下标。默认全展开 —— 文档通常不长，一眼看全比一层层点开快 */
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());

  // 定位：水平**贴窗口右边缘**（目录按钮右边还有「查看原文」等按钮，跟按钮右边缘对齐会让浮层悬在
  // 半空、右侧空出一块）；垂直贴按钮下方，下边不够则改为贴底。
  // 用 useLayoutEffect 而非 useEffect —— 量宽修正必须发生在绘制前，否则首帧会从右边甩出去再弹回来（肉眼可见的闪）。
  useLayoutEffect(() => {
    if (!ref.current) return;
    const r = ref.current.getBoundingClientRect();
    const left = Math.max(8, window.innerWidth - r.width - 8);
    let top = props.y;
    if (top + r.height > window.innerHeight - 8) top = Math.max(8, window.innerHeight - r.height - 8);
    setPos({ left, top });
  }, [props.y]);

  const items = props.items;
  /** 第 i 项有没有子级：后面紧跟一项、且层级更深 */
  const hasChild = (i: number): boolean => i + 1 < items.length && items[i + 1]!.level > items[i]!.level;
  /** 第 i 项的子树的结束位置（其后所有层级更深的项都归它） */
  const subEnd = (i: number): number => {
    let j = i + 1;
    while (j < items.length && items[j]!.level > items[i]!.level) j += 1;
    return j;
  };

  // 可见行：落在已折叠子树里的整段跳过
  const rows: { item: TocItem; i: number }[] = [];
  for (let i = 0; i < items.length; ) {
    rows.push({ item: items[i]!, i });
    i = collapsed.has(i) && hasChild(i) ? subEnd(i) : i + 1;
  }
  /** 缩进基准取最外层标题：文档可能没有 h1（直接从 h2 起），写死 h1 会白缩一截 */
  const baseLevel = items.reduce((m, h) => Math.min(m, h.level), 6);

  return (
    <>
      <div
        style={{ position: 'fixed', inset: 0, zIndex: 299 }}
        onClick={props.onClose}
        onContextMenu={(e) => {
          e.preventDefault();
          props.onClose();
        }}
      />
      <div
        ref={ref}
        className="ctx-menu md-toc"
        style={{ left: pos.left, top: pos.top, maxHeight: '60vh', overflowY: 'auto', minWidth: 200, maxWidth: 380 }}
      >
        {rows.map(({ item, i }) => (
          <div
            key={item.id}
            className="ctx-item md-toc-row"
            style={{ paddingLeft: 6 + (item.level - baseLevel) * 14 }}
            // 整行可点：原先只绑在标题文字上，行内边距与叶子节点的占位三角处点了没反应 ——
            // 而整行都是 cursor:pointer，看起来处处可点，于是表现为"点偏一点就没反应、再点一次才行"
            onClick={() => props.onJump(item.id)}
          >
            {hasChild(i) ? (
              <button
                className="md-toc-arrow"
                // 展开 / 折叠这一节
                title={t('fs.pv.tocToggle')}
                onClick={(e) => {
                  e.stopPropagation(); // 只折叠，不跳转
                  setCollapsed((prev) => {
                    const next = new Set(prev);
                    if (next.has(i)) next.delete(i);
                    else next.add(i);
                    return next;
                  });
                }}
              >
                {collapsed.has(i) ? '▸' : '▾'}
              </button>
            ) : (
              <span className="md-toc-arrow" />
            )}
            <span className="md-toc-text" title={item.text}>
              {item.text}
            </span>
          </div>
        ))}
      </div>
    </>
  );
}
