/** 差异视图：并排双栏对比（左原版/右当前，修改行 M 标识，语法高亮，点击联动）/ 版本间文本 diff */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { get, post } from '../shared/api.js';
import { isImeComposing } from '../shared/utils.js';
import { DiffRender } from '../ui/diff-render.js';
import { langOf, highlightLine } from '../shared/highlight.js';
import { renderMarkdown } from '../shared/markdown.js';
import { IconCopy } from '../ui/icons.js';
import { ContextMenu, type CtxMenuItem } from '../ui/context-menu.js';
import { parseUnifiedDiff, lineMarksOf, type DiffLine } from '../../shared/diff-parse.js';
import { t } from '../../shared/i18n/index.js';
import { InlineEditor, type InlineEditorHandle } from '../shared/inline-editor.js';
import { DiffConnectors } from '../shared/diff-connectors.js';
import { ConfirmModal } from '../ui/prompt.js';

export interface DiffTarget {
  path?: string;
  a?: string;
  b?: string;
}

/** 大块折叠：块内 diff 行数超过阈值默认折叠为前 10 行 + 一行「+n 行（点击展开）」。
 *  阈值约一屏（pane 高约 594px / 行高 20.15px ≈ 29 行）。 */
const COLLAPSE_THRESHOLD = 30;
const COLLAPSE_HEAD = 10;
/** 左栏不参与展开：右侧点「展开」时左栏保持折叠占位、不跟着动，所以传空集合 */
const NEVER_EXPANDED = new Set<number>();

/** 折叠行 / 收起行使用的高位负数行号（与真实行号、-block 占位行号都不冲突，可直接当 refs 键） */
const foldKey = (block: number) => -(block + 100000);
const tailKey = (block: number) => -(block + 200000);

/** 把一段行列表按「大块折叠」规则过滤：
 *  - 块内 diff 行数 ≤ 阈值：原样返回
 *  - 超过阈值且未展开：保留前 COLLAPSE_HEAD 行，随后插入一行 makeFold 折叠提示，其余丢弃
 *  - 已展开：全部保留，并在块尾补一行 makeTail「收起」
 *  左右两栏各自调用，但折叠状态共用同一组块号——两侧行数保持一致。 */
function foldBlockRows<T extends { block: number }>(
  rows: T[],
  totals: Map<number, number>,
  expanded: Set<number>,
  makeFold: (block: number, total: number, hidden: number) => T,
  makeTail: (block: number, total: number) => T,
): T[] {
  const out: T[] = [];
  const seen = new Map<number, number>();
  for (const r of rows) {
    if (r.block <= 0) {
      out.push(r);
      continue;
    }
    const total = totals.get(r.block) ?? 0;
    if (total <= COLLAPSE_THRESHOLD || expanded.has(r.block)) {
      out.push(r);
      continue;
    }
    const i = seen.get(r.block) ?? 0;
    seen.set(r.block, i + 1);
    if (i < COLLAPSE_HEAD) out.push(r);
    else if (i === COLLAPSE_HEAD) out.push(makeFold(r.block, total, total - COLLAPSE_HEAD));
  }
  if (expanded.size === 0) return out;
  // 展开块尾部补「收起」行：块内最后一行之后（下一行属于别的块或列表结束）
  const res: T[] = [];
  for (let i = 0; i < out.length; i++) {
    const r = out[i]!;
    res.push(r);
    const next = out[i + 1];
    if (r.block > 0 && expanded.has(r.block) && (!next || next.block !== r.block)) {
      res.push(makeTail(r.block, totals.get(r.block) ?? 0));
    }
  }
  return res;
}

/** 搜索框宽度：右边缘拖拽调整、**左右两栏各自独立**、localStorage 持久化；越界值回默认。
 *  往左拖窄到阈值内（SEARCH_W_COLLAPSE）松手 = 收起搜索（拖动中显示提示），收起不落盘 */
const SEARCH_W_KEY_L = 'diffSearch.widthL';
const SEARCH_W_KEY_R = 'diffSearch.widthR';
const SEARCH_W_DEFAULT = 360;
const SEARCH_W_MIN = 60; // 拖拽硬下限（再窄即进入"将收起"区）
const SEARCH_W_COLLAPSE = 100; // 松手时宽度 < 此值 → 收起搜索
const SEARCH_W_MAX = 520;

interface Props {
  target: DiffTarget | null;
  tick: number;
  onBack: () => void;
  /** 当前视图是否激活（视图常驻挂载、display 切换；键盘监听只在激活时生效，防止隐藏时 ←/Esc 误触发返回） */
  active: boolean;
  /** 复制成功提示（全局 toast） */
  onToast?: (msg: string) => void;
  /** 嵌入模式（弹窗内复用）：隐藏标题与「返回」按钮，←/Esc 不触发返回（交给弹窗自己关） */
  embedded?: boolean;
  /** 只读模式（看历史版本时）：隐藏就地编辑、不做工作区文件指纹轮询——历史内容不该被写回 */
  readOnly?: boolean;
  /** 覆盖版本行标签（历史提交弹窗用人类可读文案）；不传则用 file-versions 返回的原始版本号 */
  labels?: { left?: string; right?: string };
}

export function DiffView(props: Props) {
  const [versions, setVersions] = useState<{ left: string; right: string; leftLabel: string; rightLabel: string } | null>(null);
  const [diffLines, setDiffLines] = useState<DiffLine[]>([]);
  // 行级变更标记（新增 + / 删除 - / 修改 M）：同一块内可混合，以 DiffLine 为键
  const lineMarks = useMemo(() => lineMarksOf(diffLines), [diffLines]);
  // 未配对删除行在右栏的落点：这些行在右栏**没有**对应内容（被删的东西不存在于当前版本），
  // 无法靠 block 匹配定位。rightRows 据此在右栏插入一行**占位行**（红色 - 空行 + 提示文字）。
  // 落点取「删除点之后的第一行」——右栏该处显示的正是被删内容后面的内容；删除段位于文件末尾
  // （后面无行可挂）时退化为最后一个上下文行，此时占位行插在它**之后**（after=true）。
  // 同一块内的多行删除聚合成一行占位（count = 行数）。供点击/导航定位。
  const delAnchorRight = useMemo(() => {
    const m = new Map<number, { rightNo: number; count: number; after?: boolean }>();
    let pending: { block: number; count: number }[] = [];
    let lastCtx = 0;
    for (const l of diffLines) {
      if (l.type === 'del') {
        if (lineMarks.get(l) === 'mod') continue; // 配成"修改"的删除行在右栏有对应行，不需要占位
        const p = pending.find((x) => x.block === l.block);
        if (p) p.count++;
        else pending.push({ block: l.block, count: 1 });
        continue;
      }
      // 同一块可能被空白 ctx 分成多段（空行间隔合并后）：count 必须累加，不能覆盖——
      // 否则右栏"此处删除了 n 行"只算最后一段（用户实报显示 2 行）
      for (const p of pending) {
        const prev = m.get(p.block);
        m.set(p.block, { rightNo: l.rightNo, count: (prev?.count ?? 0) + p.count });
      }
      pending = [];
      if (l.type === 'ctx') lastCtx = l.rightNo;
    }
    for (const p of pending) {
      if (!lastCtx) continue;
      const prev = m.get(p.block);
      m.set(p.block, { rightNo: lastCtx, count: (prev?.count ?? 0) + p.count, after: true });
    }
    return m;
  }, [diffLines, lineMarks]);
  /** 未配对新增行在左栏的落点（左栏「显示全部」模式的占位行用）——delAnchorRight 的镜像：
   *  这些新增在左栏**没有**对应内容，占位行插在「新增点之后第一行」之前；末尾新增（after）挂最后上下文行 */
  const addAnchorLeft = useMemo(() => {
    const m = new Map<number, { leftNo: number; count: number; after?: boolean }>();
    let pending: { block: number; count: number }[] = [];
    let lastCtx = 0;
    for (const l of diffLines) {
      if (l.type === 'add') {
        if (lineMarks.get(l) === 'mod') continue; // 配成"修改"的新增行在左栏有对应（del）行，不需要占位
        const p = pending.find((x) => x.block === l.block);
        if (p) p.count++;
        else pending.push({ block: l.block, count: 1 });
        continue;
      }
      // 同上：同一块被空白 ctx 分成的多段新增要累加
      for (const p of pending) {
        const prev = m.get(p.block);
        m.set(p.block, { leftNo: l.leftNo, count: (prev?.count ?? 0) + p.count });
      }
      pending = [];
      if (l.type === 'ctx') lastCtx = l.leftNo;
    }
    for (const p of pending) {
      if (!lastCtx) continue;
      const prev = m.get(p.block);
      m.set(p.block, { leftNo: lastCtx, count: (prev?.count ?? 0) + p.count, after: true });
    }
    return m;
  }, [diffLines, lineMarks]);
  // 经 ref 读取：locateDel 要放进 goBlock（依赖稳定的 useCallback），直接闭包会捕获过期表
  const delAnchorRef = useRef(delAnchorRight);
  delAnchorRef.current = delAnchorRight;
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  // 差异块导航
  const [curBlock, setCurBlock] = useState(0);
  // 行右键菜单（左右栏文本复制）；selRef：右键 mousedown 时快照选区——
  // 浏览器右键按下会清空文本选区（contextmenu 时 getSelection 已空），mousedown 捕获仍在
  const [lineCtx, setLineCtx] = useState<{ x: number; y: number; items: CtxMenuItem[] } | null>(null);
  const selRef = useRef('');
  /** 复制 text 到剪贴板：toast 文案由调用方整句给出（各语言语序不同，不能靠 label 拼接） */
  const copyText = (text: string, toast: string) => {
    void navigator.clipboard
      ?.writeText(text)
      .then(() => props.onToast?.(toast))
      // 复制失败
      .catch(() => props.onToast?.(t('hist.copyFailed')));
  };
  const openLineMenu = (e: React.MouseEvent, rowText: string, side: 'left' | 'right') => {
    e.preventDefault();
    const sel = selRef.current;
    // 左栏 / 右栏
    const sideName = side === 'left' ? t('hist.sideLeft') : t('hist.sideRight');
    const items: CtxMenuItem[] = [];
    if (sel) {
      // 复制选中文本 / 选中文本已复制
      items.push({ icon: <IconCopy />, label: t('hist.copySelection'), action: () => copyText(sel, t('hist.copiedSelection')) });
    }
    items.push(
      // 复制此行 / 本行已复制
      { icon: <IconCopy />, label: t('hist.copyRow'), action: () => copyText(rowText, t('hist.copiedRow')) },
      // 复制{side}全部文本 / {side}全部文本已复制
      { icon: <IconCopy />, label: t('hist.copyAll', { side: sideName }), action: () => copyText((side === 'left' ? leftRows : rightRows).map((r) => r.text).join('\n'), t('hist.copiedAll', { side: sideName })) },
    );
    setLineCtx({ x: e.clientX, y: e.clientY, items });
  };
  // diff 内搜索（右栏 = 当前内容）
  const [dSearch, setDSearch] = useState('');
  const [dSearchActive, setDSearchActive] = useState(false);
  const [dMatchIdx, setDMatchIdx] = useState(0);
  // 左栏搜索（原版内容），独立于右栏搜索
  const [dSearchL, setDSearchL] = useState('');
  const [dSearchLActive, setDSearchLActive] = useState(false);
  const [dMatchLIdx, setDMatchLIdx] = useState(0);
  /** 搜索框宽度（左右各自独立；右边缘拖拽调整，鼠标松开落盘）。
   *  往左拖窄过阈值 = 松手收起搜索（拖动中显示提示）；收起不落盘，下次展开恢复收起前的宽度 */
  const readSearchW = (key: string) => {
    const saved = Number(localStorage.getItem(key));
    return Number.isFinite(saved) && saved >= SEARCH_W_MIN && saved <= SEARCH_W_MAX ? saved : SEARCH_W_DEFAULT;
  };
  const [dSearchWL, setDSearchWL] = useState(() => readSearchW(SEARCH_W_KEY_L));
  const [dSearchWR, setDSearchWR] = useState(() => readSearchW(SEARCH_W_KEY_R));
  /** 拖拽中的"将收起"提示归属哪一栏（''=无） */
  const [collapseHint, setCollapseHint] = useState<'' | 'L' | 'R'>('');
  const wRefL = useRef(dSearchWL);
  wRefL.current = dSearchWL;
  const wRefR = useRef(dSearchWR);
  wRefR.current = dSearchWR;
  const dResizeRef = useRef<{ side: 'L' | 'R'; startX: number; startW: number } | null>(null);
  /** 右边缘拖拽：左右移动调宽；拖窄过阈值时显示"将收起"提示、松手收起（宽度还原为拖动前的值）。
   *  拖拽期间定住全页光标/禁选中（鼠标滑出手柄不闪回默认光标） */
  const onDSearchResizeDown = (side: 'L' | 'R') => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startW = side === 'L' ? wRefL.current : wRefR.current;
    dResizeRef.current = { side, startX: e.clientX, startW };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    const onMove = (ev: MouseEvent) => {
      const d = dResizeRef.current;
      if (!d) return;
      const w = Math.min(SEARCH_W_MAX, Math.max(SEARCH_W_MIN, d.startW + (ev.clientX - d.startX)));
      if (d.side === 'L') {
        wRefL.current = w;
        setDSearchWL(w);
      } else {
        wRefR.current = w;
        setDSearchWR(w);
      }
      setCollapseHint(w < SEARCH_W_COLLAPSE ? d.side : '');
    };
    const onUp = () => {
      const d = dResizeRef.current;
      dResizeRef.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      setCollapseHint('');
      if (!d) return;
      const w = d.side === 'L' ? wRefL.current : wRefR.current;
      if (w < SEARCH_W_COLLAPSE) {
        // 拖窄过阈值：收起（宽度还原为拖动前的值、不落盘——下次展开还是收起前的宽度）
        if (d.side === 'L') {
          wRefL.current = d.startW;
          setDSearchWL(d.startW);
          setDSearchLActive(false);
        } else {
          wRefR.current = d.startW;
          setDSearchWR(d.startW);
          setDSearchActive(false);
        }
      } else {
        localStorage.setItem(d.side === 'L' ? SEARCH_W_KEY_L : SEARCH_W_KEY_R, String(w));
      }
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };
  // md 文件双栏预览：左右独立开关（预览=该栏原文 Markdown 渲染，非 diff 行视图）
  const [previewL, setPreviewL] = useState(false);
  const [previewR, setPreviewR] = useState(false);
  // 双栏同步滚动（按钮开关）：滚任一栏 → 另一栏按修改块对齐跟随。
  // 只在「显示全部」开启时出现（片段模式两栏长短不齐，同步没有意义——按钮届时隐藏）
  const [syncMode, setSyncMode] = useState(false);
  // 「显示全部」：左栏（原版）从"仅差异片段"切换为完整文件内容（未改动行平铺，差异行照旧标记）
  const [showAll, setShowAll] = useState(false);
  const syncLock = useRef(false);
  /** 差异块跳转（上/下一个、点刻度点）期间的锁：跳转的平滑滚动会触发 onScroll，
   *  若让同步滚动逻辑介入会与跳转互相拉扯——两栏各停"差一点"（实测）。独立于 syncLock，
   *  避免与同步流程自身的释放时机产生竞态 */
  const jumpLock = useRef(false);
  // 文件更新检测
  const [staleTip, setStaleTip] = useState(false);
  /** 右栏「就地编辑」（diff 内直接改工作区文件）：编辑模式 + 编辑器句柄/脏态 +
   *  进入前拉到的最新文本（准入检查一并做掉）+ 保存后重对比的加载 key */
  const [editing, setEditing] = useState(false);
  const editorRef = useRef<InlineEditorHandle>(null);
  // editing 的镜像：goBlock 是 useCallback（闭包缓存），直读 editing 会拿旧值（进出编辑态
  // 不触发它重建）——"编辑态跳转走编辑器"的分支必须读 ref 才可靠
  const editingRef = useRef(false);
  editingRef.current = editing;
  const [editDirty, setEditDirty] = useState(false);
  const [editData, setEditData] = useState<{ text: string; eol: '\n' | '\r\n'; jumpLine?: number } | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  /** 块级还原确认：左栏差异块旁的箭头点击后要还原的块（确认前不动文件） */
  const [restoreTarget, setRestoreTarget] = useState<{ blockId: number; kind: 'mod' | 'del' | 'add' } | null>(null);
  /** 已展开的大块：默认折叠超过 COLLAPSE_THRESHOLD 行的差异块，点击折叠行展开（换文件重置） */
  const [expandedBlocks, setExpandedBlocks] = useState<Set<number>>(new Set());
  /** 进入就地编辑：先拉一次**最新工作区文本**（兼做准入——非 UTF-8/超限文件不给编辑），
   *  光标定位到当前差异块的右栏行号（与「下一个」定位同一套；纯删除块/占位行不定位） */
  const startEdit = () => {
    if (!props.target?.path) return;
    const b = blocksRef.current[curBlockRef.current];
    const jumpLine = b && b.right > 0 && b.right < Number.MAX_SAFE_INTEGER ? b.right : undefined;
    void get
      .cat(props.target.path, true)
      .then((r) => {
        if (!r.ok) {
          setError(r.error ?? t('fs.pv.readFailed'));
          return;
        }
        if (r.encoding) {
          // 该文件是 {enc} 编码，不支持内联编辑（怕改坏原编码）；请用外部程序打开
          setError(t('fs.pv.encNoEditFull', { enc: r.encoding }));
          return;
        }
        if (r.truncated) {
          // 文件过大（超过 5MB），未读取全文，不支持内联编辑；请用外部程序打开
          setError(t('fs.pv.tooLargeNoEdit'));
          return;
        }
        const text = r.output;
        setEditData({ text, eol: text.includes('\r\n') ? '\r\n' : '\n', jumpLine });
        setEditDirty(false);
        setEditing(true);
      })
      .catch((e: Error) => setError((e as Error).message));
  };
  const mtimeRef = useRef<{ mtime: number; size: number } | null>(null);

  const leftRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const rightRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  // 左栏新增占位行 refs（按块号存**数组**，下标=块内第几个占位行）：
  // 连接带要取整块首尾、还原动画要给每一行播扫光，单个元素不够
  const leftPhRefs = useRef<Map<number, HTMLDivElement[]>>(new Map());
  const leftPane = useRef<HTMLDivElement>(null);
  const rightPane = useRef<HTMLDivElement>(null);

  const sideMode = Boolean(props.target?.path);
  /** 只有「工作区 vs 原版」才有块级还原语义：版本间对比（target.b 指定）右栏是历史版本，
   *  写回工作区会张冠李戴 */
  // 块级还原会写工作区：只读模式（历史版本）一律不给
  const canRestoreBlock = sideMode && !props.target?.b && !props.readOnly;
  // md 文件：左右栏预览（renderMarkdown 复用文件预览同款渲染；baseDir 供相对图片路径）
  const isMd = Boolean(props.target?.path?.toLowerCase().endsWith('.md'));
  const mdBaseDir = props.target?.path?.includes('/') ? props.target.path.slice(0, props.target.path.lastIndexOf('/')) : '';

  // 换文件时清掉「按文件开启」的视图状态。预览开关只在 md 文件上渲染切换按钮：从 md 预览切到
  // .py 时若继续保留 previewR，右栏会按 Markdown 渲染整个文件（无行号/无语法高亮，行元素也不存在，
  // 点差异点自然无法定位），而「返回对比」按钮已随 isMd=false 消失，用户无法自行退回（用户实报）。
  // 编辑态同理：不退出的话新文件会拿旧文件的内容进编辑器。
  useEffect(() => {
    setPreviewL(false);
    setPreviewR(false);
    setEditing(false);
    setEditData(null);
    setEditDirty(false);
    setRestoreTarget(null);
    setExpandedBlocks(new Set());
  }, [props.target]);

  useEffect(() => {
    if (!props.target) return;
    // 视图隐藏时不加载：看过一次 diff 后 target 常驻，否则每次 tick 都会在后台重拉两份文件 + diff
    if (!props.active) return;
    let cancelled = false;
    setLoading(true);
    setError('');
    const tgt = props.target;
    if (sideMode) {
      // 并排模式：加载左右版本 + 行级 diff
      Promise.all([
        get.fileVersions(tgt.path!, tgt.a, tgt.b),
        get.diff(tgt.path, tgt.a, tgt.b),
      ])
        .then(([fv, d]) => {
          if (cancelled) return;
          setVersions({ left: fv.left, right: fv.right, leftLabel: fv.leftLabel, rightLabel: fv.rightLabel });
          setDiffLines(d.ok ? parseUnifiedDiff(d.output) : []);
          setCurBlock(0);
          // 记录文件指纹，开始外部更新检测
          get.fileMtime(tgt.path!).then((m) => { mtimeRef.current = m; }).catch(() => {});
          setStaleTip(false);
        })
        .catch((e: Error) => {
          if (!cancelled) setError(e.message);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    } else {
      // 文本模式（全仓库 diff 或版本间）
      get
        .diff(tgt.path, tgt.a, tgt.b)
        .then((r) => {
          if (!cancelled) {
            // diff 失败
            if (!r.ok) setError(r.error ?? t('hist.diffFailed'));
            // (无差异)
            else setText(r.output.trim() || t('hist.noDiff'));
          }
        })
        .catch((e: Error) => {
          if (!cancelled) setError(e.message);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }
    return () => {
      cancelled = true;
    };
  }, [props.target, props.tick, reloadKey, props.active]); // eslint-disable-line react-hooks/exhaustive-deps -- reloadKey：就地编辑保存后重新对比；active：隐藏时不加载，切回来补拉

  // 差异块导航
  const blocksRef = useRef<{ id: number; left: number; right: number }[]>([]);
  const curBlockRef = useRef(0);
  curBlockRef.current = curBlock;
  // 跳转目标块高亮：点击一侧/块导航后，两侧对应块脉冲呼吸约 2.2s（多块散布时一眼锁定对应修改）
  const [targetBlock, setTargetBlock] = useState<number | null>(null);
  const targetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashTarget = useCallback((block: number) => {
    // 先清、隔一帧再设：连点同一个点（targetBlock 值不变）时类没被移除过，CSS 动画不会重播
    // ——用户想"再看一眼"时闪不出来。跨帧先摘类再挂，动画每次都从头播
    setTargetBlock(null);
    if (targetTimer.current) clearTimeout(targetTimer.current);
    targetTimer.current = setTimeout(() => setTargetBlock(null), 2500); // 与 CSS 的 0.75s×3 匹配、留余量
    requestAnimationFrame(() => setTargetBlock(block));
  }, []);

  /** 定位纯删除块：返回右栏**占位行**的行号（-block，由 rightRows 插入并注册进 rightRefs）；
   *  非删除块返回 undefined（调用方走默认定位）。占位行常驻，无需临时角标与定时清除。 */
  const locateDel = useCallback((block: number): number | undefined => {
    return delAnchorRef.current.has(block) ? -block : undefined;
  }, []);

  // 跳转到差异块：左右两栏都滚动到块首行。
  // **跳转期间锁住同步滚动**（jumpLock）：smooth 滚动触发的 onScroll 若让同步逻辑介入，
  // 会与跳转互相拉扯、两栏各停"差一点"（实测：开着同步滚动时上/下一个与点刻度点都跳不准）。
  // 锁 700ms（smooth 动画时长量级）后自释；期间用户手动滚动的同步会暂歇——跳转后本就该稳定
  const goBlock = useCallback((i: number) => {
    const b = blocksRef.current[i];
    if (!b) return;
    setCurBlock(i);
    flashTarget(b.id);
    jumpLock.current = true;
    window.setTimeout(() => {
      jumpLock.current = false;
    }, 700);
    // 左栏：有 del 行用其行号；纯新增块的 b.left 是 MAX_SAFE_INTEGER 哨兵（块内无 del 行），
    // 落到块内第一个占位行（leftPhRefs 按块号存）——否则「下一个/左栏刻度」点了左栏纹丝不动
    const leftEl = b.left !== Number.MAX_SAFE_INTEGER ? leftRefs.current.get(b.left) : leftPhRefs.current.get(b.id)?.[0];
    leftEl?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    // 编辑态：右栏是编辑器（没有行元素，rightRefs 定位不到）——把光标定位到块的工作区行，
    // 并让**整块的行**脉冲高亮（flashRange=块的工作区行范围——像非编辑态的块级 sb-target；
    // 纯删除块无对应行，range/行号缺省时 gotoLine 自行忽略）
    if (editingRef.current) {
      editorRef.current?.gotoLine(
        b.right > 0 && b.right < Number.MAX_SAFE_INTEGER ? b.right : 0,
        blockRightRangeRef.current.get(b.id),
      );
      return;
    }
    // 纯删除块的 b.right 是 MAX_SAFE_INTEGER 哨兵（块内无 add 行），get 不到元素 → 右栏原本纹丝不动
    rightRefs.current.get(locateDel(b.id) ?? b.right)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [flashTarget, locateDel]);

  // ← / Esc 返回；↑↓ 差异块导航（并排模式且有差异时）
  useEffect(() => {
    if (!props.active) return; // 视图隐藏时键盘不响应（防止穿透到其他视图）
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      // 嵌入弹窗时 ←/Esc 归弹窗管（Esc 关窗），这里只保留差异块导航
      if (!props.embedded && (e.key === 'ArrowLeft' || e.key === 'Escape')) {
        e.preventDefault();
        props.onBack();
        return;
      }
      if (sideMode && blocksRef.current.length > 0) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          goBlock((curBlockRef.current + 1) % blocksRef.current.length);
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          goBlock((curBlockRef.current - 1 + blocksRef.current.length) % blocksRef.current.length);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // goBlock 是 useCallback，但它依赖 flashTarget/locateDel（变动较频繁）——
    // 入依赖会让全局键盘监听反复解绑/重绑。props 已按 onBack/active 精确到字段。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.onBack, sideMode, props.active, props.embedded]);

  // 差异块列表（只含真正的变更块：ctx 行的 block = -1 是「不属于任何块」的标记而不是块号，
  //  一并收进来的话会凭空多出一个"上下文伪块"——差异点计数多一站、滚动条多一个定位点）
  const blocks = useMemo(() => {
    const m = new Map<number, { left: number; right: number }>();
    for (const l of diffLines) {
      if (l.block < 0) continue;
      const v = m.get(l.block) ?? { left: Number.MAX_SAFE_INTEGER, right: Number.MAX_SAFE_INTEGER };
      if (l.type === 'del') v.left = Math.min(v.left, l.leftNo);
      if (l.type === 'add') v.right = Math.min(v.right, l.rightNo);
      m.set(l.block, v);
    }
    return [...m.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([id, v]) => ({ id, left: v.left, right: v.right }));
  }, [diffLines]);
  blocksRef.current = blocks;

  // 左右栏比例拖拽
  const [leftRatio, setLeftRatio] = useState(50);
  const dragState = useRef<{ startX: number; startRatio: number } | null>(null);
  const startDrag = (e: React.MouseEvent) => {
    dragState.current = { startX: e.clientX, startRatio: leftRatio };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };
  useEffect(() => {
    const move = (e: MouseEvent) => {
      if (!dragState.current) return;
      const delta = ((e.clientX - dragState.current.startX) / window.innerWidth) * 100;
      setLeftRatio(Math.min(85, Math.max(15, dragState.current.startRatio + delta)));
    };
    const up = () => {
      dragState.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
  }, []);

  // 外部更新检测（3 秒轮询文件指纹）
  useEffect(() => {
    // 只读（历史版本）不轮询：它比较的是工作区文件，和眼前这份历史内容无关
    if (!sideMode || !props.target?.path || !props.active || props.readOnly) return;
    const path = props.target.path;
    const timer = setInterval(() => {
      if (staleTip) return;
      get
        .fileMtime(path)
        .then((m) => {
          if (mtimeRef.current && (m.mtime !== mtimeRef.current.mtime || m.size !== mtimeRef.current.size)) {
            setStaleTip(true);
          }
        })
        .catch(() => {});
    }, 3000);
    return () => clearInterval(timer);
  }, [sideMode, props.target, staleTip, props.active, props.readOnly]);

  // 并排行拆分：左栏 = 原版每行 + 删除行标记；右栏 = 当前每行 + 新增行标记。
  // 左栏在"新增"处插入空占位行（带背景标记），左右视觉对齐、定位直观。
  // 默认只渲染差异片段（diff 行）；「显示全部」开启后遍历原版**全文**（未改动行平铺显示、
  // 差异行照旧标记、未配对新增处插占位行——与 rightRows 的全文模式同构）
  /** 每块 diff 行数（del+add）：折叠阈值判定用；左右两栏共用同一口径，
   *  保证同一个块在两侧同时折叠/展开 */
  const blockTotals = useMemo(() => {
    const m = new Map<number, number>();
    for (const l of diffLines) if (l.block > 0) m.set(l.block, (m.get(l.block) ?? 0) + 1);
    return m;
  }, [diffLines]);

  const leftRows = useMemo(() => {
    if (!versions) return [];
    const rows: { no: number; text: string; change: boolean; block: number; line?: DiffLine; ph?: boolean; phIndex?: number; fold?: boolean; foldN?: number; foldTotal?: number; tail?: boolean }[] = [];
    if (!showAll) {
      // phIndex：占位行按块内序号进 ref 数组（连接带/动画按行取元素）；折叠由末尾 foldBlockRows 统一处理
      //
      // 空行间隔：同一逻辑块内被**未改动的空白上下文行**隔开的占位行连续显示，不再显示这些空 ctx
      // （它们只是 diff 把 BASE 空行和新增段空行配了对）。注意只跳过 ctx——
      // 用户真正增删空行时是 add/del 行，照常显示成差异。
      const skipCtx = new Set<number>();
      for (let i = 0; i < diffLines.length; i++) {
        const l = diffLines[i]!;
        if (l.type !== 'ctx' || l.text.trim() !== '') continue;
        let p = i - 1;
        while (p >= 0 && diffLines[p]!.type === 'ctx') p--;
        let n = i + 1;
        while (n < diffLines.length && diffLines[n]!.type === 'ctx') n++;
        const prevBlock = p >= 0 ? diffLines[p]!.block : -1;
        const nextBlock = n < diffLines.length ? diffLines[n]!.block : -1;
        if (prevBlock > 0 && prevBlock === nextBlock) skipCtx.add(i);
      }
      const phCount = new Map<number, number>();
      diffLines.forEach((l, i) => {
        if (skipCtx.has(i)) return;
        if (l.type === 'ctx') rows.push({ no: l.leftNo, text: l.text, change: false, block: -1 });
        else if (l.type === 'del') rows.push({ no: l.leftNo, text: l.text, change: true, block: l.block, line: l });
        else if (l.type === 'add') {
          const idx = phCount.get(l.block) ?? 0;
          phCount.set(l.block, idx + 1);
          rows.push({ no: -l.block, text: '', change: true, block: l.block, line: l, ph: true, phIndex: idx });
        }
      });
      return foldBlockRows(
        rows,
        blockTotals,
        NEVER_EXPANDED,
        (block, total, hidden) => ({ no: foldKey(block), text: '', change: true, block, ph: true, phIndex: COLLAPSE_HEAD, fold: true, foldN: hidden, foldTotal: total }),
        (block, total) => ({ no: tailKey(block), text: '', change: true, block, ph: true, phIndex: COLLAPSE_HEAD + 1, tail: true, foldTotal: total }),
      );
    }
    // 全文模式：空文件保持空行集（让"（原版为空 — 新增文件）"空态照旧显示）
    if (versions.left === '') return rows;
    // 新增占位行：按落点行号分桶（after=true 表示插在该行之后——新增段在文件末尾）
    const before = new Map<number, { block: number; count: number }[]>();
    const after = new Map<number, { block: number; count: number }[]>();
    for (const [block, a] of addAnchorLeft) {
      const bucket = a.after ? after : before;
      const list = bucket.get(a.leftNo);
      if (list) list.push({ block, count: a.count });
      else bucket.set(a.leftNo, [{ block, count: a.count }]);
    }
    const leftMap = new Map<number, { text: string; block: number; line: DiffLine }>();
    for (const l of diffLines) {
      if (l.type === 'del') leftMap.set(l.leftNo, { text: l.text, block: l.block, line: l });
    }
    versions.left.split('\n').forEach((ln, i) => {
      const no = i + 1;
      for (const a of before.get(no) ?? []) rows.push({ no: -a.block, text: '', change: true, block: a.block, ph: true, phIndex: 0 });
      const m = leftMap.get(no);
      if (m) rows.push({ no, text: m.text, change: true, block: m.block, line: m.line });
      else rows.push({ no, text: ln, change: false, block: -1 });
      for (const a of after.get(no) ?? []) rows.push({ no: -a.block, text: '', change: true, block: a.block, ph: true, phIndex: 0 });
    });
    return foldBlockRows(
      rows,
      blockTotals,
      NEVER_EXPANDED,
      (block, total, hidden) => ({ no: foldKey(block), text: '', change: true, block, ph: true, phIndex: COLLAPSE_HEAD, fold: true, foldN: hidden, foldTotal: total }),
      (block, total) => ({ no: tailKey(block), text: '', change: true, block, ph: true, phIndex: COLLAPSE_HEAD + 1, tail: true, foldTotal: total }),
    );
  }, [versions, diffLines, showAll, addAnchorLeft, blockTotals]);

  const rightRows = useMemo(() => {
    if (!versions) return [];
    // 未配对删除行的占位行：按落点行号分桶（after=true 表示插在该行之后——删除段在文件末尾）
    const before = new Map<number, { block: number; count: number }[]>();
    const after = new Map<number, { block: number; count: number }[]>();
    for (const [block, a] of delAnchorRight) {
      const bucket = a.after ? after : before;
      const list = bucket.get(a.rightNo);
      if (list) list.push({ block, count: a.count });
      else bucket.set(a.rightNo, [{ block, count: a.count }]);
    }
    const rightMap = new Map<number, { text: string; block: number; line: DiffLine }>();
    for (const l of diffLines) {
      if (l.type === 'add') rightMap.set(l.rightNo, { text: l.text, block: l.block, line: l });
    }
    const out: { no: number; text: string; change: boolean; block: number; line?: DiffLine; delPh?: number; fold?: boolean; foldN?: number; foldTotal?: number; tail?: boolean }[] = [];
    // 占位行行号取 -block（负数，不显示行号）：与真实行号不冲突，且可直接作 rightRefs 的 key 供定位
    const pushPh = (a: { block: number; count: number }) =>
      out.push({ no: -a.block, text: '', change: true, block: a.block, delPh: a.count });
    versions.right.split('\n').forEach((ln, i) => {
      const no = i + 1;
      for (const a of before.get(no) ?? []) pushPh(a);
      const m = rightMap.get(no);
      if (m) out.push({ no, text: m.text, change: true, block: m.block, line: m.line });
      else out.push({ no, text: ln, change: false, block: -1 });
      for (const a of after.get(no) ?? []) pushPh(a);
    });
    return foldBlockRows(
      out,
      blockTotals,
      expandedBlocks,
      (block, total, hidden) => ({ no: foldKey(block), text: '', change: true, block, fold: true, foldN: hidden, foldTotal: total }),
      (block, total) => ({ no: tailKey(block), text: '', change: true, block, tail: true, foldTotal: total }),
    );
  }, [versions, diffLines, delAnchorRight, blockTotals, expandedBlocks]);

  // ---- 块级还原：把工作区的某一块改回原版，其余修改保留 ----

  /** 块的变更类型：有删有加=修改、只有加=新增、只有删=删除（与连接带配色同一口径） */
  const blockKindOf = useCallback(
    (blockId: number): 'mod' | 'del' | 'add' => {
      let hasDel = false;
      let hasAdd = false;
      for (const l of diffLines) {
        if (l.block !== blockId) continue;
        if (l.type === 'del') hasDel = true;
        else if (l.type === 'add') hasAdd = true;
      }
      return hasAdd && hasDel ? 'mod' : hasAdd ? 'add' : 'del';
    },
    [diffLines],
  );

  /** 还原动画：新增行绿色扫光、删除行擦除，扫完把行折叠（写回后重载即消失）。
   *  Promise 最多等 650ms——大块（上千行）逐行 30ms 错峰会把重载拖到几十秒，
   *  用户看到「右边没了、左边还挂着差异」。只给前 24 行播动画，总时长封顶。 */
  const playRestoreAnim = useCallback(
    (blockId: number, kind: 'mod' | 'del' | 'add'): Promise<void> => {
      if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return Promise.resolve();
      const MAX_ANIM_ROWS = 24;
      const pick = (side: 'left' | 'right') => {
        const rows = side === 'left' ? leftRows : rightRows;
        const els: HTMLElement[] = [];
        for (const r of rows) {
          if (r.block !== blockId) continue;
          // 折叠行/收起行是提示行，不参与扫光
          if ('fold' in r || 'tail' in r) continue;
          // 左栏占位行的 ref 按块号存数组（leftPhRefs），真实行按行号存（leftRefs）
          const isPh = 'ph' in r && r.ph;
          const phIdx = 'phIndex' in r ? (r.phIndex ?? 0) : 0;
          const el = side === 'left' ? (isPh ? leftPhRefs.current.get(r.block)?.[phIdx] : leftRefs.current.get(r.no)) : rightRefs.current.get(r.no);
          if (el?.isConnected) els.push(el);
        }
        return els;
      };
      const sweep = (els: HTMLElement[], color: 'ok' | 'err', base: number) =>
        els.slice(0, MAX_ANIM_ROWS).map((el, i) => {
          el.style.position = 'relative';
          el.style.overflow = 'hidden';
          const beam = document.createElement('div');
          beam.className = 'anim-sweep-beam';
          // 删除侧用红色光带（与行底色一致）；新增侧沿用动画域默认的绿色光带
          if (color === 'err') beam.style.background = 'linear-gradient(90deg, rgba(207,34,46,0), rgba(207,34,46,.38), rgba(207,34,46,0))';
          el.appendChild(beam);
          const a = beam.animate(
            [
              { transform: 'translateX(-130%)', opacity: 0, easing: 'cubic-bezier(.45,.05,.6,1)' },
              { transform: 'translateX(30%)', opacity: 1, offset: 0.22 },
              { transform: 'translateX(170%)', opacity: 1, offset: 0.8 },
              { transform: 'translateX(300%)', opacity: 0 },
            ],
            { duration: 420, delay: base + Math.min(i * 30, 240), fill: 'both' },
          );
          a.onfinish = () => beam.remove();
          return a;
        });
      const collapse = (els: HTMLElement[], base: number) =>
        els.slice(0, MAX_ANIM_ROWS).map((el) => {
          el.style.overflow = 'hidden';
          const h = el.getBoundingClientRect().height;
          return el.animate(
            [
              { maxHeight: `${h}px`, opacity: 1 },
              { maxHeight: '0px', opacity: 0 },
            ],
            { duration: 220, delay: base + 360, easing: 'ease-in', fill: 'forwards' },
          );
        });
      const leftEls = pick('left');
      const rightEls = pick('right');
      const anims: Animation[] = [];
      if (kind === 'mod') {
        // 修改块：左栏删除侧擦除、右栏新增侧绿色扫光，两侧都收起
        anims.push(...sweep(leftEls, 'err', 0), ...sweep(rightEls, 'ok', 60), ...collapse(leftEls, 0), ...collapse(rightEls, 60));
      } else if (kind === 'add') {
        // 新增块：右栏行扫光收起；左栏占位区同步收起，不能只消失一侧
        anims.push(...sweep(rightEls, 'ok', 0), ...collapse(rightEls, 0), ...collapse(leftEls, 0));
      } else {
        // 删除块：左栏删除行擦除收起；右栏删除占位行同步收起
        anims.push(...sweep(leftEls, 'err', 0), ...collapse(leftEls, 0), ...collapse(rightEls, 0));
      }
      const done = Promise.all(anims.map((a) => a.finished.catch(() => undefined))).then(() => undefined);
      // 动画最多 ~1.2s；再封 650ms，保证写回后立刻重载（大块逐行错峰曾把重载拖到几十秒）
      return Promise.race([done, new Promise<void>((r) => setTimeout(r, 650))]);
    },
    [leftRows, rightRows, leftRefs, rightRefs, leftPhRefs],
  );

  /** 执行块级还原：用 diff 行号精确改写工作区文本，只动这一块。
   *  新增块=删掉工作区对应行；纯删除块=按占位落点插回原版行；修改块=整块替换。 */
  const doRestoreBlock = useCallback(
    async (target: { blockId: number; kind: 'mod' | 'del' | 'add' }) => {
      const tgt = props.target;
      if (!tgt?.path || !versions) return;
      // 外部改动检测：mtime/size 变了说明行号可能已失效，先让用户更新对比（避免改错位置）
      try {
        const m = await get.fileMtime(tgt.path);
        const prev = mtimeRef.current;
        if (prev && (m.mtime !== prev.mtime || m.size !== prev.size)) {
          setStaleTip(true);
          props.onToast?.(t('hist.restoreStale'));
          return;
        }
      } catch {
        /* 检测失败不阻塞：写回接口自己会报错 */
      }
      const adds = diffLines.filter((l) => l.type === 'add' && l.block === target.blockId).map((l) => l.rightNo);
      const dels = diffLines.filter((l) => l.type === 'del' && l.block === target.blockId).map((l) => l.text);
      if (adds.length === 0 && dels.length === 0) return;
      // 工作区按行拆分：保留原 EOL（CRLF 文件每行末尾的 \r 原样不动；git diff 解析出的
      // 新增/删除文本不带 \r，插回时按工作区风格补齐）
      const lines = versions.right.split('\n');
      const crlf = versions.right.includes('\r\n');
      const delTexts = dels.map((x) => (crlf && !x.endsWith('\r') ? x + '\r' : x));
      let next: string[];
      if (adds.length > 0) {
        const start = Math.min(...adds);
        const end = Math.max(...adds);
        next = [...lines.slice(0, start - 1), ...delTexts, ...lines.slice(end)];
      } else {
        // 纯删除块：右栏没有对应行，按占位行落点插回（after=删除段位于文件末尾）
        const anchor = delAnchorRight.get(target.blockId);
        if (!anchor) return;
        const at = anchor.after ? anchor.rightNo : anchor.rightNo - 1;
        next = [...lines.slice(0, at), ...delTexts, ...lines.slice(at)];
      }
      const anim = playRestoreAnim(target.blockId, target.kind);
      const res = await post.writeFile(tgt.path, next.join('\n'));
      if (!res.ok) {
        // 写失败：重载一次清掉折叠动画留下的视觉状态，并报错
        setError(res.message ?? t('fs.pv.saveFailed'));
        setReloadKey((k) => k + 1);
        return;
      }
      await anim;
      props.onToast?.(t('hist.restoreDone'));
      setReloadKey((k) => k + 1);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- playRestoreAnim/versions/diffLines 每次渲染重建，无需进依赖（闭包取当前值）
    [props.target, diffLines, versions, delAnchorRight],
  );

  // diff 搜索匹配（右栏 = 当前内容）
  const dMatches = useMemo(() => {
    if (!dSearchActive || !dSearch.trim()) return [] as number[];
    const q = dSearch.toLowerCase();
    const out: number[] = [];
    rightRows.forEach((r) => {
      if (r.text.toLowerCase().includes(q)) out.push(r.no);
    });
    return out;
  }, [dSearch, dSearchActive, rightRows]);

  const goNextDMatch = useCallback(() => {
    if (dMatches.length === 0) return;
    const next = (dMatchIdx + 1) % dMatches.length;
    setDMatchIdx(next);
    // 预览模式：无行元素，按匹配比例滚动预览容器（近似定位）
    if (isMd && previewR) {
      const p = rightPane.current;
      if (p) p.scrollTop = (next / Math.max(1, dMatches.length)) * (p.scrollHeight - p.clientHeight);
      return;
    }
    rightRefs.current.get(dMatches[next]!)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [dMatches, dMatchIdx, previewR, isMd]);

  // 左栏搜索匹配 + 跳转
  const dMatchesL = useMemo(() => {
    if (!dSearchLActive || !dSearchL.trim()) return [] as number[];
    const q = dSearchL.toLowerCase();
    return leftRows.filter((r) => r.text.toLowerCase().includes(q)).map((r) => r.no);
  }, [dSearchL, dSearchLActive, leftRows]);
  const goNextLMatch = useCallback(() => {
    if (dMatchesL.length === 0) return;
    const next = (dMatchLIdx + 1) % dMatchesL.length;
    setDMatchLIdx(next);
    // 预览模式：无行元素，按匹配比例滚动预览容器（近似定位）
    if (isMd && previewL) {
      const p = leftPane.current;
      if (p) p.scrollTop = (next / Math.max(1, dMatchesL.length)) * (p.scrollHeight - p.clientHeight);
      return;
    }
    leftRefs.current.get(dMatchesL[next]!)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [dMatchesL, dMatchLIdx, previewL, isMd]);

  // 滚动条预览标记：修改块位置（绿=有新增/修改行，红=纯删除）。
  // index 是块在 blocks 数组里的序号（curBlock / goBlock 的语义）；block 是 diff 块号（从 1 起，见
  // diff-parse 的块号约定）——高亮与跳转一律用 index：早期误用 block 与 curBlock 比较，错位 1
  const scrollMarkers = useMemo(() => {
    if (blocks.length === 0) return [] as { block: number; index: number; percent: number; color: 'add' | 'del' }[];
    const total = Math.max(leftRows.length, rightRows.length, 1);
    return blocks.map((b, index) => {
      const hasAdd = b.right > 0 && b.right !== Number.MAX_SAFE_INTEGER;
      const anchor = hasAdd ? b.right : b.left;
      return { block: b.id, index, percent: Math.min(99, Math.max(0, (anchor / total) * 100)), color: hasAdd ? ('add' as const) : ('del' as const) };
    });
  }, [blocks, leftRows.length, rightRows.length]);

  // 左栏滚动条标记：与右栏同款（同块同色、点击走同一 goBlock 两侧联动）。
  // 位置按**左栏行索引**算：左栏未「显示全部」时是差异片段、行号不连续——用行号比例会错位；
  // index 同右栏（高亮/跳转用）；rowIdx = 锚行在 leftRows 里的序号（纵向定位用，见渲染处 min(…)）
  const leftScrollMarkers = useMemo(() => {
    if (blocks.length === 0 || leftRows.length === 0) return [] as { block: number; index: number; rowIdx: number; percent: number; color: 'add' | 'del' }[];
    return blocks.flatMap((b, index) => {
      const idx = leftRows.findIndex((r) => r.block === b.id);
      if (idx < 0) return [];
      const hasAdd = b.right > 0 && b.right !== Number.MAX_SAFE_INTEGER;
      return [{ block: b.id, index, rowIdx: idx, percent: Math.min(99, Math.max(0, (idx / leftRows.length) * 100)), color: hasAdd ? ('add' as const) : ('del' as const) }];
    });
  }, [blocks, leftRows]);
  // 左栏代码行的行高（px）：纵向定位的像素项用。取 pane 继承的 line-height 实测值
  // （CSS 调了自动跟上）；首帧（ref 未挂）先用默认值，误差一帧内自愈
  const [leftLineH, setLeftLineH] = useState(20.15);
  useEffect(() => {
    const pane = leftPane.current;
    if (!pane) return;
    const lh = parseFloat(getComputedStyle(pane).lineHeight);
    if (lh > 0) setLeftLineH(lh);
  }, []);

  // 变更块定位：本侧有对应行（del→左栏 / add→右栏）用其行号；
  // 本侧无对应行（点击新增行跳左栏 / 删除行跳右栏）定位到该块最近位置（负数 = 左栏占位行）
  const blockFirstLeft = useMemo(() => {
    const m = new Map<number, number>();
    for (const l of diffLines) {
      if (l.type === 'del' && !m.has(l.block)) m.set(l.block, l.leftNo);
      else if (l.type === 'add' && !m.has(l.block)) m.set(l.block, -l.block); // 占位行
    }
    return m;
  }, [diffLines]);
  const blockFirstRight = useMemo(() => {
    const m = new Map<number, number>();
    let lastCtx = 0;
    for (const l of diffLines) {
      if (l.type === 'ctx') lastCtx = l.rightNo;
      else if (l.type === 'add' && !m.has(l.block)) m.set(l.block, l.rightNo);
      else if (l.type === 'del' && !m.has(l.block)) m.set(l.block, lastCtx || 1);
    }
    return m;
  }, [diffLines]);
  /** 每个差异块在**工作区**的行范围（min..max add 行；块内 add 行连续）——编辑态"整块脉冲高亮"用 */
  const blockRightRange = useMemo(() => {
    const m = new Map<number, { from: number; to: number }>();
    for (const l of diffLines) {
      if (l.type !== 'add' || l.block < 0) continue;
      const cur = m.get(l.block);
      m.set(l.block, cur ? { from: Math.min(cur.from, l.rightNo), to: Math.max(cur.to, l.rightNo) } : { from: l.rightNo, to: l.rightNo });
    }
    return m;
  }, [diffLines]);
  /** goBlock 是缓存闭包，读它要走镜像 ref（同 blocksRef 模式） */
  const blockRightRangeRef = useRef(blockRightRange);
  blockRightRangeRef.current = blockRightRange;

  /** 双栏同步滚动：绑在两侧 pane 的 onScroll。两栏行高一致（占位行设计），
   *  高度相近时直接等量同步；差异大时按变更块对齐（否则比例同步）；syncLock 防循环。
   *  死区 ±2px：目标与当前差小于 2px 不设置——防止浮点取整造成的 ±1px 往返抽搐 */
  const lockTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onScrollSync = useCallback(
    (side: 'left' | 'right') => (e: React.UIEvent<HTMLDivElement>) => {
      if (!syncMode || syncLock.current || jumpLock.current) return;
      syncLock.current = true;
      const pane = e.currentTarget;
      const rows = side === 'left' ? leftRows : rightRows;
      const dstPane = (side === 'left' ? rightPane : leftPane).current;
      const setDst = (target: number): boolean => {
        if (!dstPane) return true;
        if (Math.abs(dstPane.scrollTop - target) < 2) return true; // 已对齐：不动（防振荡）
        dstPane.scrollTop = Math.max(0, target);
        return true;
      };
      if (dstPane) {
        const hDiff = Math.abs(pane.scrollHeight - dstPane.scrollHeight);
        if (hDiff < 300) {
          setDst(pane.scrollTop); // 等量同步（同行高 + 占位对齐，普通文件高度差 <300px）
        } else if (rows.length > 0 && pane.firstElementChild) {
          const rowH = (pane.firstElementChild as HTMLElement).offsetHeight || 18;
          let i = Math.min(Math.max(0, Math.floor(pane.scrollTop / rowH)), rows.length - 1);
          while (i < rows.length && rows[i].block < 0) i++; // 向下找视口处最近的变更块
          if (i < rows.length && rows[i].block >= 0) {
            const block = rows[i].block;
            const dstBlockNo = side === 'left' ? blockFirstRight.get(block) : blockFirstLeft.get(block);
            // 目标元素：右栏目标恒为行（无占位）；左栏目标优先占位行（phRefs key=block），否则行
            let dstEl: HTMLDivElement | undefined = undefined;
            if (side === 'left') dstEl = dstBlockNo !== undefined ? (rightRefs.current.get(dstBlockNo) ?? undefined) : undefined;
            else dstEl = leftPhRefs.current.get(block)?.[0] ?? (dstBlockNo !== undefined ? (leftRefs.current.get(dstBlockNo) ?? undefined) : undefined);
            const phRow = (rows[i] as { ph?: boolean }).ph;
            const srcEl = phRow
              ? leftPhRefs.current.get(block)?.[(rows[i] as { phIndex?: number }).phIndex ?? 0]
              : (side === 'left' ? leftRefs.current : rightRefs.current).get(rows[i].no);
            if (dstEl && srcEl) {
              setDst(dstEl.offsetTop + (pane.scrollTop - srcEl.offsetTop));
            } else {
              // 无块可对齐：比例同步
              const maxSrc = Math.max(1, pane.scrollHeight - pane.clientHeight);
              const maxDst = Math.max(1, dstPane.scrollHeight - dstPane.clientHeight);
              setDst(Math.min(Math.max(0, (pane.scrollTop / maxSrc) * maxDst), maxDst));
            }
          } else {
            // 无块可对齐：比例同步
            const maxSrc = Math.max(1, pane.scrollHeight - pane.clientHeight);
            const maxDst = Math.max(1, dstPane.scrollHeight - dstPane.clientHeight);
            setDst(Math.min(Math.max(0, (pane.scrollTop / maxSrc) * maxDst), maxDst));
          }
        }
      }
      if (lockTimer.current) clearTimeout(lockTimer.current);
      lockTimer.current = setTimeout(() => {
        syncLock.current = false;
      }, 80);
    },
    [syncMode, leftRows, rightRows, blockFirstLeft, blockFirstRight],
  );

  // 手动滚动到指定行（scrollIntoView 会连带滚动外层容器，改为 pane 内精确滚动，左右联动可靠）
  const scrollToLine = (pane: HTMLDivElement | null, el: HTMLDivElement | undefined) => {
    if (!pane || !el) return;
    const rect = el.getBoundingClientRect();
    const paneRect = pane.getBoundingClientRect();
    pane.scrollTop += rect.top - paneRect.top - pane.clientHeight / 2;
  };
  // 点击右侧修改行 → 左侧滚动到对应修改块首行（新增块滚到左栏占位行）并高亮该块
  const jumpLeft = (block: number) => {
    const no = blockFirstLeft.get(block);
    if (no === undefined) return;
    flashTarget(block);
    if (no < 0) scrollToLine(leftPane.current, leftPhRefs.current.get(-no)?.[0]);
    else scrollToLine(leftPane.current, leftRefs.current.get(no));
  };
  // 点击左侧修改行 → 右侧滚动 + 同块高亮（纯删除块右栏无对应行 → 滚到插入的删除占位行）
  const jumpRight = (block: number) => {
    const no = locateDel(block) ?? blockFirstRight.get(block);
    if (no === undefined) return;
    flashTarget(block);
    if (editing) {
      // 就地编辑中：右栏是编辑器——点击改为把**光标**定位到对应行。
      // 行号用块的 b.right（add 行的**工作区行号**——与进入编辑时的定位同源，实测准）；
      // 不走 blockFirstRight：它对"修改块"给的是 del 行的左栏行号（凑巧相同场景才没暴露，实测差 1 行）。
      // 纯删除块（right 是哨兵）不定位（工作区没有该内容，光标留在原处）
      const b = blocksRef.current[blocksRef.current.findIndex((x) => x.id === block)];
      const line = b && b.right > 0 && b.right < Number.MAX_SAFE_INTEGER ? b.right : 0;
      // 整块脉冲（块的工作区行范围）——编辑态点左栏"指认改动处"，与右栏行高亮同效果
      editorRef.current?.gotoLine(line, blockRightRange.get(block));
      return;
    }
    scrollToLine(rightPane.current, rightRefs.current.get(no));
  };

  const lang = props.target?.path ? langOf(props.target.path) : undefined;

  const title = props.target
    ? props.target.a && props.target.b
      ? `${props.target.a} → ${props.target.b}`
      // 工作区差异
      : t('hist.workingTreeDiff')
    : '';

  // 还原确认文案：行数直接数当前块的 diff 行（不估算），三种块各说清楚会动什么
  const restoreMsg = useMemo(() => {
    if (!restoreTarget) return '';
    const a = diffLines.filter((l) => l.type === 'add' && l.block === restoreTarget.blockId).length;
    const d = diffLines.filter((l) => l.type === 'del' && l.block === restoreTarget.blockId).length;
    if (restoreTarget.kind === 'add') return t('hist.restoreBlockMsgAdd', { n: a });
    if (restoreTarget.kind === 'del') return t('hist.restoreBlockMsgDel', { n: d });
    return t('hist.restoreBlockMsgMod', { a, d });
  }, [restoreTarget, diffLines]);

  const goPrevBlock = () => goBlock((curBlock - 1 + blocks.length) % blocks.length);
  const goNextBlock = () => goBlock((curBlock + 1) % blocks.length);
  /** 嵌入弹窗时的差异块导航：只显示 ↑/↓，放在左右两栏中间的缝隙里（不单占一行） */
  const embeddedBlockNav = sideMode && blocks.length > 0 && (
    <div
      style={{
        position: 'absolute',
        right: '50%',
        top: 0,
        marginRight: 8,
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        whiteSpace: 'nowrap',
      }}
    >
      {/* 差异点 {i}/{n} */}
      <span className="dim small nowrap">{t('hist.blockCounter', { i: curBlock + 1, n: blocks.length })}</span>
      <button className="mini" style={{ padding: '0 6px', height: 20, lineHeight: '18px' }} title={t('hist.prevBlock')} onClick={goPrevBlock}>↑</button>
      <button className="mini" style={{ padding: '0 6px', height: 20, lineHeight: '18px' }} title={t('hist.nextBlock')} onClick={goNextBlock}>↓</button>
      {showAll && (
        <button
          className={`mini${syncMode ? ' primary' : ''}`}
          style={{ padding: '0 6px', height: 20, lineHeight: '18px' }}
          onClick={() => setSyncMode((v) => !v)}
          title={t('hist.syncTip')}
        >
          {/* ↔ 同步滚动 */}
          {t('hist.syncScroll')}
        </button>
      )}
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {/* 顶栏（标题 / 块导航 / 返回）：嵌入弹窗时整行隐藏，块导航挪到两栏缝隙 */}
      {!props.embedded && (
        <div className="row" style={{ marginBottom: 8, flexShrink: 0, flexWrap: 'wrap' }}>
          <span className="dim">
            {/* 差异: {rev} — {path} / 差异: {rev} */}
            {props.target?.path ? t('hist.diffOfPath', { rev: title, path: props.target.path }) : t('hist.diffOf', { rev: title })}
          </span>
          <span className="grow" />
          {sideMode && blocks.length > 0 && (
            <>
              {/* 差异点 {i}/{n} */}
              <span className="dim small nowrap">{t('hist.blockCounter', { i: curBlock + 1, n: blocks.length })}</span>
              {/* 上一个 ↑ */}
              <button className="mini" onClick={goPrevBlock}>{t('hist.prevBlock')}</button>
              {/* 下一个 ↓ */}
              <button className="mini" onClick={goNextBlock}>{t('hist.nextBlock')}</button>
              {showAll && (
                <button
                  className={`mini${syncMode ? ' primary' : ''}`}
                  onClick={() => setSyncMode((v) => !v)}
                  // 开启后滚动任一栏，另一栏自动跟随（预览模式下为按比例跟随，无行对齐）
                  title={t('hist.syncTip')}
                >
                  {/* ↔ 同步滚动 */}
                  {t('hist.syncScroll')}
                </button>
              )}
            </>
          )}
          {/* ← 键返回 */}
          <span className="dim small">{t('hist.arrowKeyBack')}</span>
          {/* ← 返回 */}
          <button className="mini" onClick={props.onBack}>{t('hist.back')}</button>
        </div>
      )}
      {staleTip && (
        <div className="stale-tip" style={{ marginBottom: 8 }}>
          {/* ⚠ 文件已更新，是否更新文件？ */}
          <span>{t('hist.fileChanged')}</span>
          <span className="grow" />
          <button
            className="mini primary"
            onClick={() => {
              setStaleTip(false);
              setLoading(true);
              setError('');
              const tgt = props.target!;
              Promise.all([get.fileVersions(tgt.path!, tgt.a, tgt.b), get.diff(tgt.path, tgt.a, tgt.b)])
                .then(([fv, d]) => {
                  setVersions({ left: fv.left, right: fv.right, leftLabel: fv.leftLabel, rightLabel: fv.rightLabel });
                  setDiffLines(d.ok ? parseUnifiedDiff(d.output) : []);
                  get.fileMtime(tgt.path!).then((m) => { mtimeRef.current = m; }).catch(() => {});
                })
                .catch((e: Error) => setError(e.message))
                .finally(() => setLoading(false));
            }}
          >
            {/* 更新文件 */}
            {t('hist.reloadFile')}
          </button>
          {/* 忽略 */}
          <button className="mini" onClick={() => setStaleTip(false)}>{t('hist.dismiss')}</button>
        </div>
      )}
      {error && (
        <div className="error" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ flex: 1, minWidth: 0 }}>{error}</span>
          {/* ×：关掉这条提示 */}
          <button className="mini" style={{ flexShrink: 0 }} title={t('common.close')} onClick={() => setError('')}>
            ×
          </button>
        </div>
      )}
      {/* ⏳ 加载对比… */}
      {loading && !error && <div className="loading">{t('hist.loadingCompare')}</div>}
      {!loading && !error && sideMode && versions && (
        <>
          {/* 版本号行：左右标签分别对齐两栏起点；嵌入弹窗的块导航贴在这行右侧（分隔线左边） */}
          <div style={{ position: 'relative', height: 20, marginBottom: 4, flexShrink: 0 }}>
            <span
              className="dim small"
              style={{ position: 'absolute', left: 0, top: 0, maxWidth: '40%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
            >
              ◀ {props.labels?.left ?? versions.leftLabel}
            </span>
            <span
              className="dim small"
              style={{ position: 'absolute', left: '50%', top: 0, maxWidth: '40%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
            >
              ▶ {props.labels?.right ?? versions.rightLabel}
            </span>
            {props.embedded && embeddedBlockNav}
          </div>
          {/* 栏头：左右各带独立搜索框（定位各自栏内代码） */}
          <div style={{ display: 'flex', flexShrink: 0, marginBottom: 6, gap: 8 }}>
            {/* 左栏：原版 */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="row" style={{ gap: 6 }}>
                {dSearchLActive ? (
                  <>
                    {/* 输入框外层 relative：右侧拖拽手柄绝对定位用（左栏独立宽度） */}
                    <span style={{ position: 'relative', width: dSearchWL, flexShrink: 0, display: 'inline-flex' }}>
                      <input
                        autoFocus
                        type="text"
                        // 搜索左栏代码…
                        placeholder={t('hist.searchLeftPlaceholder')}
                        value={dSearchL}
                        onChange={(e) => {
                          setDSearchL(e.target.value);
                          setDMatchLIdx(0);
                        }}
                        onKeyDown={(e) => {
                          if (isImeComposing(e)) return;
                          if (e.key === 'Enter') goNextLMatch();
                          if (e.key === 'Escape') setDSearchLActive(false);
                        }}
                        style={{ width: '100%', boxSizing: 'border-box' }}
                      />
                      {/* 右边缘拖拽手柄：左右拖调宽；往左拖窄过阈值松手 = 收起搜索 */}
                      <span className="search-resize" onMouseDown={onDSearchResizeDown('L')} title={t('fs.search.resize')} />
                    </span>
                    <span className="grow" />
                    {/* 拖窄至阈值内：松手将收起搜索 */}
                    {collapseHint === 'L' && (
                      <span className="small" style={{ color: 'var(--warn)', whiteSpace: 'nowrap' }}>{t('hist.releaseToCollapse')}</span>
                    )}
                    <span className="dim small nowrap">
                      {/* 无匹配 */}
                      {dSearchL.trim() && dMatchesL.length > 0 ? `${dMatchLIdx + 1}/${dMatchesL.length}` : dSearchL.trim() ? t('hist.noMatchText') : ''}
                    </span>
                    {/* 下一个 ↓ */}
                    <button className="mini" onClick={goNextLMatch}>{t('hist.nextBlock')}</button>
                  </>
                ) : (
                  // 🔍 搜索此栏
                  <button className="mini" onClick={() => setDSearchLActive(true)}>{t('hist.searchPane')}</button>
                )}
                {/* 显示全部：左栏从差异片段展开为完整原版（开启后顶栏出现「同步滚动」；关掉时联动关同步。
                    放左栏头部：它管的就是左栏，与「预览」等左栏查看方式并列） */}
                <button
                  className={`mini${showAll ? ' primary' : ''}`}
                  onClick={() => {
                    const next = !showAll;
                    setShowAll(next);
                    // 关掉全文时一并关掉同步滚动（按钮随之隐藏，不留隐形激活态）
                    if (!next) setSyncMode(false);
                  }}
                  // 左栏展开为完整文件内容（未改动行平铺显示，差异行照旧标记）
                  title={t('hist.showAllTip')}
                >
                  {/* 显示全部 */}
                  {t('hist.showAll')}
                </button>
                {isMd && previewL && (
                  // 返回差异行视图
                  <button className="mini" onClick={() => setPreviewL((v) => !v)} title={t('hist.backToDiff')}>
                    {/* 返回对比 */}
                    {t('hist.backToCompare')}
                  </button>
                )}
                {isMd && !previewL && (
                  // Markdown 渲染预览（原版）
                  <button className="mini" onClick={() => setPreviewL((v) => !v)} title={t('hist.mdPreviewLeft')}>
                    {/* 预览 */}
                    👁 {t('common.preview')}
                  </button>
                )}
              </div>
            </div>
            {/* 右栏：当前 */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="row" style={{ gap: 6 }}>
                {editing ? (
                  <>
                    {/* 编辑中 */}
                    <span className="dim small">{t('fs.pv.editing')}</span>
                    <span className="grow" />
                    {/* 💾 保存（有修改才点亮）；保存后自动重新对比 */}
                    <button className={`mini${editDirty ? ' primary' : ''}`} onClick={() => editorRef.current?.save()}>{t('fs.pv.saveBtn')}</button>
                    {/* 取消：丢弃修改，回到差异视图 */}
                    <button className="mini" onClick={() => { setEditing(false); setEditData(null); }}>{t('common.cancel')}</button>
                  </>
                ) : (
                <>
                {dSearchActive ? (
                  <>
                    {/* 输入框外层 relative：右侧拖拽手柄绝对定位用（右栏独立宽度） */}
                    <span style={{ position: 'relative', width: dSearchWR, flexShrink: 0, display: 'inline-flex' }}>
                      <input
                        autoFocus
                        type="text"
                        // 搜索右栏代码…
                        placeholder={t('hist.searchRightPlaceholder')}
                        value={dSearch}
                        onChange={(e) => {
                          setDSearch(e.target.value);
                          setDMatchIdx(0);
                        }}
                        onKeyDown={(e) => {
                          if (isImeComposing(e)) return;
                          if (e.key === 'Enter') goNextDMatch();
                          if (e.key === 'Escape') setDSearchActive(false);
                        }}
                        style={{ width: '100%', boxSizing: 'border-box' }}
                      />
                      {/* 右边缘拖拽手柄：左右拖调宽；往左拖窄过阈值松手 = 收起搜索 */}
                      <span className="search-resize" onMouseDown={onDSearchResizeDown('R')} title={t('fs.search.resize')} />
                    </span>
                    <span className="grow" />
                    {/* 拖窄至阈值内：松手将收起搜索 */}
                    {collapseHint === 'R' && (
                      <span className="small" style={{ color: 'var(--warn)', whiteSpace: 'nowrap' }}>{t('hist.releaseToCollapse')}</span>
                    )}
                    <span className="dim small nowrap">
                      {/* 无匹配 */}
                      {dSearch.trim() && dMatches.length > 0 ? `${dMatchIdx + 1}/${dMatches.length}` : dSearch.trim() ? t('hist.noMatchText') : ''}
                    </span>
                    {/* 下一个 ↓ */}
                    <button className="mini" onClick={goNextDMatch}>{t('hist.nextBlock')}</button>
                  </>
                ) : (
                  // 🔍 搜索此栏
                  <button className="mini" onClick={() => setDSearchActive(true)}>{t('hist.searchPane')}</button>
                )}
                {/* ✎ 编辑：右栏就地编辑（定位到当前差异处；非 UTF-8/超限文件点击时提示）。
                    历史版本只读：不提供编辑入口 */}
                {!props.readOnly && (
                  <button className="mini" onClick={startEdit} title={t('hist.editInPlaceTip')}>{t('fs.pv.edit')}</button>
                )}
                {isMd && (
                  // 返回差异行视图 / Markdown 渲染预览（当前）
                  <button className="mini" onClick={() => setPreviewR((v) => !v)} title={previewR ? t('hist.backToDiff') : t('hist.mdPreviewRight')}>
                    {/* 返回对比 / 预览 */}
                    {previewR ? t('hist.backToCompare') : `👁 ${t('common.preview')}`}
                  </button>
                )}
                </>
                )}
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', flex: 1, minHeight: 0, border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
            {/* 左栏：原版（flex 不伸缩，宽度由 leftRatio 控制；sb-pane 默认 flex:1 会覆盖 width） */}
            {/* 左栏 + 滚动条预览标记（结构同右栏：pane 让出 12px 给标记条） */}
            <div style={{ position: 'relative', flex: '0 0 auto', width: `${leftRatio}%`, display: 'flex', minWidth: 0 }}>
            <div ref={leftPane} className="sb-pane" onScroll={onScrollSync('left')}>
              {isMd && previewL ? (
                <div
                  className="md-render"
                  style={{ padding: 16 }}
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(versions?.left ?? '', { baseDir: mdBaseDir }) }}
                />
              ) : (
              <>
              {/* （原版为空 — 新增文件） / （无差异）：原版非空但当前无差异时不能再说"新增文件" */}
              {leftRows.length === 0 && (
                <div className="dim" style={{ padding: 20 }}>
                  {versions?.left ? t('hist.noDiff') : t('hist.leftEmpty')}
                </div>
              )}
              {leftRows.map((r, i) => {
                const isHitL = dSearchLActive && dMatchesL.includes(r.no);
                const isCurL = isHitL && r.no === dMatchesL[dMatchLIdx % Math.max(1, dMatchesL.length)];
                const phIdx = r.phIndex ?? 0;
                return (
                <div
                  // 占位行行号相同（-block），必须拼渲染序号才唯一
                  key={`l${r.no}-${i}`}
                  ref={(el) => {
                    if (r.ph) {
                      if (el) {
                        let arr = leftPhRefs.current.get(r.block);
                        if (!arr) {
                          arr = [];
                          leftPhRefs.current.set(r.block, arr);
                        }
                        arr[phIdx] = el;
                      } else {
                        const arr = leftPhRefs.current.get(r.block);
                        if (arr) delete arr[phIdx];
                      }
                    } else if (el) leftRefs.current.set(r.no, el);
                  }}
                  className={`sb-line ${r.fold || r.tail ? 'sb-fold sb-fold-ghost' : r.ph ? 'sb-ph' : r.change ? 'sb-del' : ''} ${isHitL ? 'pv-hit' : ''} ${isCurL ? 'pv-cur' : ''} ${r.change && r.block === targetBlock && !r.fold && !r.tail ? 'sb-target' : ''}`}
                  onClick={() => {
                    // 左栏只占位、不提供展开/收起入口（折叠行与右栏同一行高，保持两栏对齐）
                    if (r.fold || r.tail) return;
                    if (r.change) jumpRight(r.block);
                  }}
                  onContextMenu={(e) => openLineMenu(e, r.text, 'left')}
                  onMouseDown={(e) => { if (e.button === 2) selRef.current = (window.getSelection()?.toString() ?? '').trim(); }}
                  // 右栏此处有新增（点击右侧定位） / 修改处（点击右侧定位）
                  title={r.ph ? t('hist.phRight') : r.change ? t('hist.changeRight') : ''}
                >
                  <span className="sb-no">{r.ph ? '' : r.no}</span>
                  <span
                    className="sb-marker"
                    style={{ color: r.tail ? 'var(--dim)' : r.ph ? 'var(--ok)' : r.line && lineMarks.get(r.line) === 'del' ? 'var(--err)' : undefined }}
                  >
                    {r.fold || r.tail ? '' : r.ph ? '+' : r.change ? (r.line && lineMarks.get(r.line) === 'mod' ? 'M' : '-') : ''}
                  </span>
                  {r.fold || r.tail ? null : (
                    <span className="sb-code" dangerouslySetInnerHTML={{ __html: highlightLine(r.text, lang) }} />
                  )}
                </div>
                );
              })}
              </>
              )}
            </div>
            {/* 滚动条预览标记：绿=新增/修改，红=删除；点击两侧联动定位（与右栏刻度同行为） */}
            {leftScrollMarkers.length > 0 && (
              <div className="sb-scrollbar" title={t('hist.markerTip')}>
                {leftScrollMarkers.map((m) => (
                  <div
                    key={m.block}
                    className={`sb-marker-dot ${m.color} ${m.index === curBlock ? 'current' : ''}`}
                    // 纵向位置 = min(比例位置, 锚行像素位置)：内容可滚动时取比例（滚动地图，与右栏同）；
                    // 内容不满一屏（片段模式常见）时取像素——纯比例会散布到条底空白区、与行明显错位
                    style={{ top: `min(${m.percent}%, ${Math.round(m.rowIdx * leftLineH)}px)` }}
                    onClick={(e) => {
                      e.stopPropagation();
                      goBlock(m.index);
                    }}
                    title={m.color === 'add' ? t('hist.markerAdd') : t('common.delete')}
                  />
                ))}
              </div>
            )}
            </div>
            {/* 拖拽手柄 */}
            {/* 拖动调整左右栏宽度 */}
            <div className="sb-resizer" onMouseDown={startDrag} title={t('hist.dragResizer')} />
            {/* 中间连接带：曲线连接左右对应的差异块（行元素缺失时自然留空，如 Markdown 预览/就地编辑） */}
            <DiffConnectors
              leftPane={leftPane}
              rightPane={rightPane}
              leftRows={leftRows}
              rightRows={rightRows}
              leftRefs={leftRefs}
              rightRefs={rightRefs}
              leftPhRefs={leftPhRefs}
              currentBlockId={blocks[curBlock]?.id}
              onJump={goBlock}
              onRestore={canRestoreBlock ? (blockId) => setRestoreTarget({ blockId, kind: blockKindOf(blockId) }) : undefined}
            />
            {/* 右栏：当前 + 滚动条预览标记；「就地编辑」时整栏换成编辑器（左栏保持原版对照） */}
            {editing && editData ? (
              <div style={{ flex: 1, display: 'flex', minWidth: 0 }}>
                <InlineEditor
                  ref={editorRef}
                  rel={props.target!.path!}
                  initialText={editData.text}
                  eol={editData.eol}
                  fileName={props.target!.path!.split('/').pop() ?? ''}
                  jumpLine={editData.jumpLine}
                  onDirtyChange={setEditDirty}
                  onSaved={(m) => {
                    setEditing(false);
                    setEditData(null);
                    setReloadKey((k) => k + 1); // 保存后重新对比（工作区文件与 diff 一起重载）
                    props.onToast?.(m);
                  }}
                  onError={(e) => setError(e)}
                />
              </div>
            ) : (
            <div style={{ position: 'relative', flex: 1, display: 'flex', minWidth: 0 }}>
            <div ref={rightPane} className="sb-pane" onScroll={onScrollSync('right')}>
              {isMd && previewR ? (
                <div
                  className="md-render"
                  style={{ padding: 16 }}
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(versions?.right ?? '', { baseDir: mdBaseDir }) }}
                />
              ) : (
              <>
              {/* （当前为空 — 文件已删除） */}
              {rightRows.length === 0 && <div className="dim" style={{ padding: 20 }}>{t('hist.rightEmpty')}</div>}
              {rightRows.map((r) => {
                const isDelPh = r.delPh !== undefined; // 删除占位行：左栏此处有 N 行被删，右栏无对应内容
                const isFold = r.fold === true; // 大块折叠行：显示「+n 行」，点击展开
                const isTail = r.tail === true; // 展开块尾部「− 收起」
                const isHit = !isDelPh && !isFold && !isTail && dSearchActive && dMatches.includes(r.no);
                const isCur = isHit && r.no === dMatches[dMatchIdx % Math.max(1, dMatches.length)];
                return (
                  <div
                    key={`r${r.no}`}
                    ref={(el) => {
                      if (el) rightRefs.current.set(r.no, el);
                    }}
                    className={`sb-line ${isFold ? 'sb-fold' : isTail ? 'sb-fold sb-fold-tail' : isDelPh ? 'sb-ph-del' : r.change ? 'sb-add' : ''} ${isHit ? 'pv-hit' : ''} ${isCur ? 'pv-cur' : ''} ${r.change && r.block === targetBlock && !isFold && !isTail ? 'sb-target' : ''}`}
                    onClick={() => {
                      if (isFold) setExpandedBlocks((prev) => new Set(prev).add(r.block));
                      else if (isTail) setExpandedBlocks((prev) => {
                        const next = new Set(prev);
                        next.delete(r.block);
                        return next;
                      });
                      else if (r.change) jumpLeft(r.block);
                    }}
                    onContextMenu={(e) => openLineMenu(e, r.text, 'right')}
                    onMouseDown={(e) => { if (e.button === 2) selRef.current = (window.getSelection()?.toString() ?? '').trim(); }}
                    // 展开全部 / 收起此块 / 左栏此处删除了 {n} 行（点击定位） / 修改处（点击左侧定位）
                    title={isFold ? t('hist.foldExpandTip') : isTail ? t('hist.foldCollapseTip') : isDelPh ? t('hist.delPhRightTip', { n: r.delPh! }) : r.change ? t('hist.changeLeft') : ''}
                  >
                    <span className="sb-no">{isDelPh || isFold || isTail ? '' : r.no}</span>
                    <span
                      className="sb-marker"
                      style={{ color: isTail ? 'var(--dim)' : isFold ? 'var(--ok)' : isDelPh ? 'var(--err)' : r.line && lineMarks.get(r.line) === 'add' ? 'var(--ok)' : undefined }}
                    >
                      {isFold || isTail ? '' : isDelPh ? '-' : r.change ? (r.line && lineMarks.get(r.line) === 'mod' ? 'M' : '+') : ''}
                    </span>
                    {isFold ? (
                      // +{n} 行（点击展开）
                      <span className="sb-fold-text">{t('hist.rowsFolded', { n: r.foldN ?? 0 })}</span>
                    ) : isTail ? (
                      // − 收起
                      <span className="sb-fold-text">{t('hist.foldTail')}</span>
                    ) : isDelPh ? (
                      // ← 左栏此处删除了 {n} 行
                      <span className="sb-ph-hint">{t('hist.delPhRightHint', { n: r.delPh! })}</span>
                    ) : (
                      <span className="sb-code" dangerouslySetInnerHTML={{ __html: highlightLine(r.text, lang) }} />
                    )}
                  </div>
                );
              })}
              </>
              )}
            </div>
            {/* 滚动条预览标记：绿=新增/修改，红=删除 */}
            {scrollMarkers.length > 0 && (
              // 修改位置（点击跳转）
              <div className="sb-scrollbar" title={t('hist.markerTip')}>
                {scrollMarkers.map((m) => (
                  <div
                    key={m.block}
                    className={`sb-marker-dot ${m.color} ${m.index === curBlock ? 'current' : ''}`}
                    style={{ top: `${m.percent}%` }}
                    onClick={(e) => {
                      e.stopPropagation();
                      goBlock(m.index);
                    }}
                    // 新增/修改 / 删除
                    title={m.color === 'add' ? t('hist.markerAdd') : t('common.delete')}
                  />
                ))}
              </div>
            )}
            </div>
            )}
          </div>
        </>
      )}
      {/* (无差异) */}
      {!loading && !error && sideMode && !versions && <div className="empty">{t('hist.noDiff')}</div>}
      {!loading && !error && !sideMode && <DiffRender text={text} />}
      {restoreTarget && (
        <ConfirmModal
          danger
          title={t('hist.restoreBlockTitle')}
          message={restoreMsg}
          confirmLabel={t('hist.restoreBlockConfirm')}
          onConfirm={() => {
            const target = restoreTarget;
            setRestoreTarget(null);
            void doRestoreBlock(target);
          }}
          onCancel={() => setRestoreTarget(null)}
        />
      )}
      {lineCtx && (
        <ContextMenu x={lineCtx.x} y={lineCtx.y} items={lineCtx.items} onClose={() => setLineCtx(null)} mask />
      )}
    </div>
  );
}
