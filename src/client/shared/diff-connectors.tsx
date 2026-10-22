/** 并排对比中间连接带：用曲线/色带把左右对应的差异块连起来（Beyond Compare 风格）。
 *
 *  基础版只做**块级**连接——不做跨块的"移动检测"，颜色沿用差异语义：
 *  红=删除（对面只有占位行）、绿=新增（本侧只有占位行）、蓝=修改（两侧都有内容）。
 *
 *  两栏各自独立滚动（同步只是近似对齐），且行内长代码会折行、行高不固定，
 *  所以坐标一律用 getBoundingClientRect 实测，不假设"行号 × 行高"。
 *  滚动/尺寸变化时用 rAF 合批重绘。 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { t } from '../../shared/i18n/index.js';

/** 连接带宽度（px）：左右两栏之间的固定窄带，不参与左右比例拖拽 */
export const CONNECT_WIDTH = 44;

/** 连接带只关心行与块的对应关系（与 diff.tsx 的 leftRows / rightRows 结构兼容） */
export interface ConnectRow {
  no: number;
  block: number;
  /** 左栏：新增占位行（该块在左栏没有对应内容） */
  ph?: boolean;
  /** 占位行在块内的序号（左栏新增占位区可能有多行） */
  phIndex?: number;
  /** 右栏：删除占位行（该块在右栏没有对应内容） */
  delPh?: number;
}

interface Props {
  leftPane: React.RefObject<HTMLDivElement>;
  rightPane: React.RefObject<HTMLDivElement>;
  leftRows: ConnectRow[];
  rightRows: ConnectRow[];
  /** 行元素 ref 表：左栏真实行 / 右栏真实行与删除占位行（负数行号） / 左栏新增占位行（按块号存数组，下标=块内序号） */
  leftRefs: React.MutableRefObject<Map<number, HTMLDivElement>>;
  rightRefs: React.MutableRefObject<Map<number, HTMLDivElement>>;
  leftPhRefs: React.MutableRefObject<Map<number, HTMLDivElement[]>>;
  /** 当前差异块 id（diff 块号，从 1 起）：对应连接带加亮 */
  currentBlockId?: number;
  /** 点击连接带跳转；参数是 blocks 数组下标（与分组顺序一致） */
  onJump?: (index: number) => void;
  /** 块级还原：传入时每块显示还原箭头（只对「工作区 vs 原版」有意义） */
  onRestore?: (blockId: number, index: number) => void;
  /** 非空 = 禁用还原（箭头打斜杠，悬浮显示原因） */
  restoreDisabledReason?: string;
}

type LinkKind = 'mod' | 'del' | 'add';

interface Link {
  id: number;
  index: number;
  kind: LinkKind;
  d: string;
  /** 块首行在连接带内的 y（视口坐标，已裁剪）：还原箭头的位置 */
  top: number;
  /** 左右两端纵向距离过大（两栏滚动错位）：填充降到很淡，避免多条带子交叉糊成一片 */
  far: boolean;
}

interface Group {
  id: number;
  left: ConnectRow[];
  right: ConnectRow[];
}

export function DiffConnectors(props: Props) {
  const { leftPane, rightPane, leftRows, rightRows, leftRefs, rightRefs, leftPhRefs, currentBlockId, onJump, onRestore } = props;

  // 按块号归组：左右各自的行在渲染顺序里是连续的（unified diff 先删后增），首尾即块边界。
  // block < 0 是上下文行，不参与连接。
  const groups = useMemo(() => {
    const m = new Map<number, Group>();
    const ensure = (id: number) => {
      let g = m.get(id);
      if (!g) {
        g = { id, left: [], right: [] };
        m.set(id, g);
      }
      return g;
    };
    for (const r of leftRows) if (r.block > 0) ensure(r.block).left.push(r);
    for (const r of rightRows) if (r.block > 0) ensure(r.block).right.push(r);
    // blocks 数组按块号升序（与 diff.tsx 一致）——下标可直接用于跳转
    return [...m.values()].sort((a, b) => a.id - b.id);
  }, [leftRows, rightRows]);

  const [view, setView] = useState<{ w: number; h: number; links: Link[] }>({ w: CONNECT_WIDTH, h: 0, links: [] });

  const draw = useCallback(() => {
    const lp = leftPane.current;
    const rp = rightPane.current;
    if (!lp || !rp) return;
    const lr = lp.getBoundingClientRect();
    const rr = rp.getBoundingClientRect();
    const H = Math.max(lp.clientHeight, rp.clientHeight);
    if (H <= 0) return;
    const W = CONNECT_WIDTH;
    const cx = W / 2;
    const clamp = (v: number) => Math.max(0, Math.min(H, v));
    const out: Link[] = [];

    /** 取行元素：isConnected 过滤掉"已卸载但 ref 表里还留着"的旧节点（切预览/换文件后 ref 不删） */
    const elementOf = (r: ConnectRow, side: 'left' | 'right'): HTMLDivElement | undefined => {
      const el =
        side === 'left'
          ? r.ph
            ? leftPhRefs.current.get(r.block)?.[r.phIndex ?? 0]
            : leftRefs.current.get(r.no)
          : rightRefs.current.get(r.no);
      return el?.isConnected ? el : undefined;
    };

    groups.forEach((g, index) => {
      // 某一侧没有这个块的行：不画连接带（冲突解决里手动编辑完结果后，中栏不再有块行）
      if (g.left.length === 0 || g.right.length === 0) return;
      const leftFirst = elementOf(g.left[0]!, 'left');
      const leftLast = elementOf(g.left[g.left.length - 1]!, 'left');
      const rightFirst = elementOf(g.right[0]!, 'right');
      const rightLast = elementOf(g.right[g.right.length - 1]!, 'right');
      if (!leftFirst || !leftLast || !rightFirst || !rightLast) return;

      const a = leftFirst.getBoundingClientRect();
      const b = leftLast.getBoundingClientRect();
      const c = rightFirst.getBoundingClientRect();
      const d = rightLast.getBoundingClientRect();
      let lt = a.top - lr.top;
      let lb = b.bottom - lr.top;
      let rt = c.top - rr.top;
      let rb = d.bottom - rr.top;

      // 整块都在视口外：不画；跨视口的块按视口裁剪（曲线贴边，滚动时自然进出）
      if (Math.min(lb, rb) <= 0 || Math.max(lt, rt) >= H) return;
      lt = clamp(lt);
      lb = clamp(lb);
      rt = clamp(rt);
      rb = clamp(rb);

      // 上边界左→右，下边界右→左，闭合成填充带；左右高度不等时自然形成 S 形
      const path = `M0 ${lt}C${cx} ${lt} ${cx} ${rt} ${W} ${rt}L${W} ${rb}C${cx} ${rb} ${cx} ${lb} 0 ${lb}Z`;
      const hasLeft = g.left.some((r) => !r.ph);
      const hasRight = g.right.some((r) => r.delPh === undefined);
      const kind: LinkKind = hasLeft && hasRight ? 'mod' : hasLeft ? 'del' : 'add';
      // 左右块中心纵向差超过 35% 视口高：两栏明显错位，色带交叉会糊成一大片，降成细线
      const far = Math.abs((lt + lb) / 2 - (rt + rb) / 2) > H * 0.35;
      out.push({ id: g.id, index, kind, d: path, top: lt, far });
    });

    setView({ w: W, h: H, links: out });
  }, [groups, leftPane, rightPane, leftRefs, rightRefs, leftPhRefs]);

  useEffect(() => {
    const lp = leftPane.current;
    const rp = rightPane.current;
    let raf = 0;
    const schedule = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        draw();
      });
    };
    lp?.addEventListener('scroll', schedule, { passive: true });
    rp?.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    const ro = new ResizeObserver(schedule);
    if (lp) ro.observe(lp);
    if (rp) ro.observe(rp);
    schedule();
    return () => {
      if (raf) cancelAnimationFrame(raf);
      lp?.removeEventListener('scroll', schedule);
      rp?.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      ro.disconnect();
    };
  }, [draw, leftPane, rightPane]);

  return (
    <div className="sb-connect">
      <svg width="100%" height="100%" viewBox={`0 0 ${view.w} ${Math.max(1, view.h)}`} preserveAspectRatio="none">
        {view.links.map((l) => (
          <path
            key={l.id}
            className={`sb-link ${l.kind}${l.far ? ' far' : ''}${l.id === currentBlockId ? ' current' : ''}`}
            d={l.d}
            onClick={onJump ? () => onJump(l.index) : undefined}
          />
        ))}
      </svg>
      {/* 还原箭头：块首行左侧、指向右栏（把原版内容应用到工作区）。
          只有「工作区 vs 原版」才传 onRestore——版本间对比里右栏不是工作区，还原无意义。 */}
      {onRestore &&
        view.links.map((l) => {
          const disabled = Boolean(props.restoreDisabledReason);
          return (
            <button
              key={`restore-${l.id}`}
              className={`sb-restore-btn${disabled ? ' disabled' : ''}`}
              disabled={disabled}
              // 块首行贴视口顶/底时，按钮（24px、translateY(-50%)）会有一半被 overflow 裁掉；
              // 内缩半个按钮高度，保证任何滚动位置都完整可见
              style={{ top: Math.min(Math.max(l.top, 12), Math.max(12, view.h - 12)) }}
              title={disabled ? props.restoreDisabledReason : t('hist.restoreBlockTip')}
              onClick={(e) => {
                e.stopPropagation();
                if (!disabled) onRestore(l.id, l.index);
              }}
            >
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 9H14M9.5 4.5L14 9l-4.5 4.5" />
              </svg>
            </button>
          );
        })}
    </div>
  );
}
