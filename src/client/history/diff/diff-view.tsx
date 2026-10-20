/** 差异视图：并排双栏对比（左原版/右当前，修改行 M 标识，语法高亮，点击联动）/ 版本间文本 diff */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { get } from '../../shared/api.js';
import { DiffRender } from '../../ui/diff-render.js';
import { langOf } from '../../shared/highlight.js';
import { IconCopy } from '../../ui/icons.js';
import { ResizeCursor, useResizeCursor } from '../../shared/use-resize-cursor.js';
import { ContextMenu, type CtxMenuItem } from '../../ui/context-menu.js';
import { parseUnifiedDiff, lineMarksOf, type DiffLine } from '../../../shared/diff-parse.js';
import { t } from '../../../shared/i18n/index.js';
import { ConfirmModal } from '../../ui/prompt.js';
import { DiffErrorBar, DiffPaneHeaders, DiffStaleTip, DiffTopBar } from './diff-toolbar.js';
import { DiffPane } from './diff-pane.js';
import { useDiffRows } from './use-diff-rows.js';
import { useDiffSearch } from './use-diff-search.js';
import { useDiffEdit } from './use-diff-edit.js';
import { useDiffRestore } from './use-diff-restore.js';
import { useDiffNavigation } from './use-diff-navigation.js';
import type { DiffBlock, DiffVersions } from './use-diff-rows.js';
import type { DiffLabels, DiffTarget } from './diff-types.js';

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
  labels?: DiffLabels;
}

export function DiffView(props: Props) {
  const [versions, setVersions] = useState<DiffVersions | null>(null);
  const [diffLines, setDiffLines] = useState<DiffLine[]>([]);
  // 行级变更标记（新增 + / 删除 - / 修改 M）：同一块内可混合，以 DiffLine 为键
  const lineMarks = useMemo(() => lineMarksOf(diffLines), [diffLines]);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  // 差异块导航
  const [curBlock, setCurBlock] = useState(0);
  const blocksRef = useRef<DiffBlock[]>([]);
  const curBlockRef = useRef(0);
  curBlockRef.current = curBlock;
  // 行右键菜单（左右栏文本复制）；selRef：右键 mousedown 时快照选区——
  // 浏览器右键按下会清空文本选区（contextmenu 时 getSelection 已空），mousedown 捕获仍在
  const [lineCtx, setLineCtx] = useState<{ x: number; y: number; items: CtxMenuItem[] } | null>(null);
  const selRef = useRef('');
  // md 文件双栏预览：左右独立开关（预览=该栏原文 Markdown 渲染，非 diff 行视图）
  const [previewL, setPreviewL] = useState(false);
  const [previewR, setPreviewR] = useState(false);
  // 双栏同步滚动（按钮开关）：滚任一栏 → 另一栏按修改块对齐跟随。
  // 只在「显示全部」开启时出现（片段模式两栏长短不齐，同步没有意义——按钮届时隐藏）
  const [syncMode, setSyncMode] = useState(false);
  // 「显示全部」：左栏（原版）从"仅差异片段"切换为完整文件内容（未改动行平铺，差异行照旧标记）
  const [showAll, setShowAll] = useState(false);
  // 文件更新检测
  const [staleTip, setStaleTip] = useState(false);
  /** 已展开的大块：默认折叠超过 COLLAPSE_THRESHOLD 行的差异块，点击折叠行展开（换文件重置） */
  const [expandedBlocks, setExpandedBlocks] = useState<Set<number>>(new Set());
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

  // 行模型：左右两栏行列表、占位行锚点、差异块列表
  const { delAnchorRight, leftRows, rightRows, blocks } = useDiffRows({
    versions,
    diffLines,
    lineMarks,
    showAll,
    expandedBlocks,
  });
  blocksRef.current = blocks;

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

  /** 统一的分隔条拖拽光标（所有可调整尺寸的分隔条共用） */
  const { ghostRef, start: startResizeCursor, move: moveResizeCursor, stop: stopResizeCursor } = useResizeCursor();

  const search = useDiffSearch({
    leftRows,
    rightRows,
    leftRefs,
    rightRefs,
    leftPane,
    rightPane,
    isMd,
    previewL,
    previewR,
    resizeCursor: { start: startResizeCursor, move: moveResizeCursor, stop: stopResizeCursor },
  });

  const edit = useDiffEdit({
    target: props.target,
    blocksRef,
    curBlockRef,
    setError,
    onToast: props.onToast,
  });

  const restore = useDiffRestore({
    target: props.target,
    versions,
    diffLines,
    delAnchorRight,
    leftRows,
    rightRows,
    leftRefs,
    rightRefs,
    leftPhRefs,
    mtimeRef,
    setStaleTip,
    setError,
    setReloadKey: edit.setReloadKey,
    onToast: props.onToast,
  });

  const navigation = useDiffNavigation({
    diffLines,
    leftRows,
    rightRows,
    blocks,
    curBlock,
    delAnchorRight,
    leftRefs,
    rightRefs,
    leftPhRefs,
    leftPane,
    rightPane,
    editing: edit.editing,
    editingRef: edit.editingRef,
    editorRef: edit.editorRef,
    syncMode,
    setCurBlock,
    resizeCursor: { start: startResizeCursor, move: moveResizeCursor, stop: stopResizeCursor },
  });

  // 换文件时清掉「按文件开启」的视图状态。预览开关只在 md 文件上渲染切换按钮：从 md 预览切到
  // .py 时若继续保留 previewR，右栏会按 Markdown 渲染整个文件（无行号/无语法高亮，行元素也不存在，
  // 点差异点自然无法定位），而「返回对比」按钮已随 isMd=false 消失，用户无法自行退回（用户实报）。
  // 编辑态同理：不退出的话新文件会拿旧文件的内容进编辑器。
  useEffect(() => {
    setPreviewL(false);
    setPreviewR(false);
    edit.resetEdit();
    restore.resetRestore();
    setExpandedBlocks(new Set());
    // 只在换文件时重置：resetEdit/resetRestore 每次渲染重建，不能进依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
          // 记录文件指纹，开始外部更新检测（只读历史版本不做 stale 检测，也不必读工作区文件——
          // 历史文件可能已在当前工作区删除/改名，请求会 404）
          if (!props.readOnly) get.fileMtime(tgt.path!).then((m) => { mtimeRef.current = m; }).catch(() => {});
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
  }, [props.target, props.tick, edit.reloadKey, props.active]); // eslint-disable-line react-hooks/exhaustive-deps -- reloadKey：就地编辑保存后重新对比；active：隐藏时不加载，切回来补拉

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
          navigation.goBlock((curBlockRef.current + 1) % blocksRef.current.length);
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          navigation.goBlock((curBlockRef.current - 1 + blocksRef.current.length) % blocksRef.current.length);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // goBlock 是 useCallback，但它依赖 flashTarget/locateDel（变动较频繁）——
    // 入依赖会让全局键盘监听反复解绑/重绑。props 已按 onBack/active 精确到字段。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.onBack, sideMode, props.active, props.embedded]);

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

  const lang = props.target?.path ? langOf(props.target.path) : undefined;

  const title = props.target
    ? props.target.a && props.target.b
      ? `${props.target.a} → ${props.target.b}`
      // 工作区差异
      : t('hist.workingTreeDiff')
    : '';

  const goPrevBlock = () => navigation.goBlock((curBlock - 1 + blocks.length) % blocks.length);
  const goNextBlock = () => navigation.goBlock((curBlock + 1) % blocks.length);
  const toggleShowAll = () => {
    const next = !showAll;
    setShowAll(next);
    // 关掉全文时一并关掉同步滚动（按钮随之隐藏，不留隐形激活态）
    if (!next) setSyncMode(false);
  };
  /** 块级还原箭头：只有「工作区 vs 原版」且非只读才传（见 canRestoreBlock） */
  const onRestore = canRestoreBlock
    ? (blockId: number) => restore.setRestoreTarget({ blockId, kind: restore.blockKindOf(blockId) })
    : undefined;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <ResizeCursor ghostRef={ghostRef} />
      {!props.embedded && (
        <DiffTopBar
          target={props.target}
          title={title}
          sideMode={sideMode}
          blocks={blocks}
          curBlock={curBlock}
          goPrevBlock={goPrevBlock}
          goNextBlock={goNextBlock}
          showAll={showAll}
          syncMode={syncMode}
          setSyncMode={setSyncMode}
          onBack={props.onBack}
        />
      )}
      {staleTip && (
        <DiffStaleTip
          onReload={() => {
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
          onDismiss={() => setStaleTip(false)}
        />
      )}
      {error && <DiffErrorBar error={error} onClose={() => setError('')} />}
      {/* ⏳ 加载对比… */}
      {loading && !error && <div className="loading">{t('hist.loadingCompare')}</div>}
      {!loading && !error && sideMode && versions && (
        <>
          <DiffPaneHeaders
            versions={versions}
            labels={props.labels}
            embedded={Boolean(props.embedded)}
            sideMode={sideMode}
            blocks={blocks}
            curBlock={curBlock}
            goPrevBlock={goPrevBlock}
            goNextBlock={goNextBlock}
            showAll={showAll}
            syncMode={syncMode}
            setSyncMode={setSyncMode}
            onToggleShowAll={toggleShowAll}
            search={search}
            edit={edit}
            isMd={isMd}
            previewL={previewL}
            setPreviewL={setPreviewL}
            previewR={previewR}
            setPreviewR={setPreviewR}
            readOnly={props.readOnly}
          />
          <DiffPane
            isMd={isMd}
            previewL={previewL}
            previewR={previewR}
            versions={versions}
            mdBaseDir={mdBaseDir}
            leftRows={leftRows}
            rightRows={rightRows}
            lineMarks={lineMarks}
            lang={lang}
            targetBlock={navigation.targetBlock}
            blocks={blocks}
            curBlock={curBlock}
            search={search}
            edit={edit}
            navigation={navigation}
            leftPane={leftPane}
            rightPane={rightPane}
            leftRefs={leftRefs}
            rightRefs={rightRefs}
            leftPhRefs={leftPhRefs}
            targetPath={props.target!.path!}
            openLineMenu={openLineMenu}
            selRef={selRef}
            setExpandedBlocks={setExpandedBlocks}
            onRestore={onRestore}
          />
        </>
      )}
      {/* (无差异) */}
      {!loading && !error && sideMode && !versions && <div className="empty">{t('hist.noDiff')}</div>}
      {!loading && !error && !sideMode && <DiffRender text={text} />}
      {restore.restoreTarget && (
        <ConfirmModal
          danger
          title={t('hist.restoreBlockTitle')}
          message={restore.restoreMsg}
          confirmLabel={t('hist.restoreBlockConfirm')}
          onConfirm={() => {
            const target = restore.restoreTarget!;
            restore.setRestoreTarget(null);
            void restore.doRestoreBlock(target);
          }}
          onCancel={restore.resetRestore}
        />
      )}
      {lineCtx && (
        <ContextMenu x={lineCtx.x} y={lineCtx.y} items={lineCtx.items} onClose={() => setLineCtx(null)} mask />
      )}
    </div>
  );
}
