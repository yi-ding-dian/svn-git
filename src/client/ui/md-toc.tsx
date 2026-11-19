/** Markdown 目录浮层：多级折叠树，点条目跳到文档对应标题。
 *
 *  定位/关闭沿用 MdThemePopover 那套（贴按钮、越界回退、点遮罩关闭）。
 *  条目由调用方从**渲染后的 DOM** 里提取（见 use-md-toc 的 rescan）—— 那样 id 顺序天然等于屏幕顺序，
 *  不用去猜 marked 的 renderer 调用次序（嵌套在引用/列表里的标题，两者可能对不上）。
 *
 *  放在 ui/（而不是某个业务域）：文件预览与差异预览都要用，跨域共享组件不能留在业务域里。
 */
import React, { useLayoutEffect, useRef, useState } from 'react';
import { t } from '../../shared/i18n/index.js';
import { Tooltip } from './tooltip.js';
import { useTocPinned } from './use-toc-pinned.js';

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
  /** 按钮左边缘 x：浮层左缘与它对齐、向右展开（用户定稿："尽量靠右，但不能偏离按钮太远"） */
  x: number;
  items: TocItem[];
  /** 当前阅读到的那一节（滚动跟踪由 use-md-toc 提供）：打开时滚到它，并常驻淡底高亮 */
  activeId?: string | null;
  /** 允许固定（只有文件浏览的 md 目录传：「刚好阅读」这一场景；编辑态 / diff 不启用） */
  pinnable?: boolean;
  onJump: (id: string) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  /** 固定（右键工具栏目录按钮切换）：遮罩不拦鼠标、目录跟随正文滚动。
   *  只在调用方允许的场景（文件浏览预览）生效；编辑态 / diff 浮层保持原行为。 */
  const globalPinned = useTocPinned();
  const pinned = props.pinnable ? globalPinned : false;
  // 初值藏在屏外：水平位置要量出宽度才能定，首帧若先画在右边会闪一下（useLayoutEffect 会赶在绘制前修正）
  const [pos, setPos] = useState({ left: -9999, top: props.y });
  /** 被折叠的条目下标。默认全展开 —— 文档通常不长，一眼看全比一层层点开快 */
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  /** 点击过的条目：实底强调色，与「当前阅读位置」的淡底区分（人点了哪一节要一眼看到） */
  const [selected, setSelected] = useState<string | null>(null);

  // 定位：水平**左对齐按钮左边缘、向右展开**（"尽量靠右，但不偏离按钮"——用户定稿；与 MdThemePopover
  // 同一套"贴按钮"模式），右侧不够则回退贴窗口右缘；垂直贴按钮下方，下边不够则改为贴底。
  // 用 useLayoutEffect 而非 useEffect —— 量宽修正必须发生在绘制前，否则首帧会从右边甩出去再弹回来（肉眼可见的闪）。
  useLayoutEffect(() => {
    if (!ref.current) return;
    const r = ref.current.getBoundingClientRect();
    const left = Math.max(8, Math.min(props.x, window.innerWidth - r.width - 8));
    let top = props.y;
    if (top + r.height > window.innerHeight - 8) top = Math.max(8, window.innerHeight - r.height - 8);
    setPos({ left, top });
  }, [props.y, props.x]);

  /** 打开时把当前章节滚进浮层的可视区（约 1/3 处）——只改浮层自身 scrollTop，
   *  不碰正文与页面；之后用户手动翻目录时不再抢（activeId 随正文变化也不重新定位）。 */
  const located = useRef(false);
  useLayoutEffect(() => {
    if (located.current || !props.activeId || !ref.current) return;
    const box = ref.current;
    const row = box.querySelector<HTMLElement>('[data-cur="1"]');
    if (!row) return; // 条目还没画出来（兜底：下一轮 pos 更新时再试）
    located.current = true;
    box.scrollTop = Math.max(0, row.offsetTop - box.clientHeight / 3);
  }, [props.activeId, pos]);

  /** 固定后跟随阅读位置：当前章节滚出浮层可视区时把它带回 1/3 处（平滑）；
   *  已在可视区就不动——避免抢用户手动翻目录的手。 */
  useLayoutEffect(() => {
    if (!pinned || !props.activeId) return;
    const box = ref.current;
    if (!box) return;
    const row = box.querySelector<HTMLElement>('[data-cur="1"]');
    if (!row) return;
    const rh = row.offsetHeight || 1;
    const top = row.offsetTop;
    const viewTop = box.scrollTop;
    const viewBottom = viewTop + box.clientHeight;
    if (top >= viewTop + 4 && top + rh <= viewBottom - 4) return;
    box.scrollTo({ top: Math.max(0, top - box.clientHeight / 3), behavior: 'smooth' });
  }, [pinned, props.activeId]);

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
        // 固定后遮罩透明化（不拦事件）：点击正文、选中文字、滚轮滚正文都照常，
        // 目录也就不会因为"点了外面"而消失；关闭走 Esc / 目录按钮
        style={{ position: 'fixed', inset: 0, zIndex: 299, pointerEvents: pinned ? 'none' : undefined }}
        onClick={props.onClose}
        onContextMenu={(e) => {
          e.preventDefault();
          props.onClose();
        }}
      />
      <div
        ref={ref}
        className="ctx-menu md-toc"
        style={{
          left: pos.left,
          top: pos.top,
          // 高度固定一屏六成：固定/未固定都一样（用户定稿：固定只影响关闭与跟随，不改尺寸）
          maxHeight: '60vh',
          overflowY: 'auto',
          minWidth: 200,
          maxWidth: 380,
        }}
      >
        {rows.map(({ item, i }) => (
          <div
            key={item.id}
            className={`ctx-item md-toc-row${item.id === props.activeId ? ' cur' : ''}${item.id === selected ? ' sel' : ''}`}
            data-cur={item.id === props.activeId ? '1' : undefined}
            style={{ paddingLeft: 6 + (item.level - baseLevel) * 14 }}
            // 整行可点：原先只绑在标题文字上，行内边距与叶子节点的占位三角处点了没反应 ——
            // 而整行都是 cursor:pointer，看起来处处可点，于是表现为"点偏一点就没反应、再点一次才行"
            onClick={() => {
              setSelected(item.id); // 标记"刚点的这一节"，与当前阅读位置的淡底分开显示
              props.onJump(item.id);
            }}
          >
            {hasChild(i) ? (
              // 展开 / 折叠这一节
              <Tooltip content={t('fs.pv.tocToggle')}>
                <button
                  className="md-toc-arrow"
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
              </Tooltip>
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
