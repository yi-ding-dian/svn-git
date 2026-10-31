/** 并排主体：左右栏行渲染、占位行、折叠行、滚动同步绑定、搜索高亮、连接带与就地编辑器。
 *  只负责展示与把事件转给 hooks/外壳；行模型与导航逻辑不在这里。 */
import React from 'react';
import { highlightLine } from '../../shared/highlight.js';
import { renderMarkdown } from '../../shared/markdown.js';
import { IconResizeHorizontal } from '../../ui/icons.js';
import { DiffConnectors } from '../../shared/diff-connectors.js';
import { InlineEditor } from '../../shared/inline-editor.js';
import { t } from '../../../shared/i18n/index.js';
import type { DiffLine, LineMark } from '../../../shared/diff-parse.js';
import type { DiffEditApi } from './use-diff-edit.js';
import type { DiffNavigationApi } from './use-diff-navigation.js';
import type { DiffSearchApi } from './use-diff-search.js';
import type { DiffBlock, DiffVersions, LeftRow, RightRow } from './use-diff-rows.js';
import { Tooltip } from '../../ui/tooltip.js';

export function DiffPane(props: {
  isMd: boolean;
  previewL: boolean;
  previewR: boolean;
  versions: DiffVersions | null;
  mdBaseDir: string;
  leftRows: LeftRow[];
  rightRows: RightRow[];
  lineMarks: Map<DiffLine, LineMark>;
  lang?: string;
  targetBlock: number | null;
  blocks: DiffBlock[];
  curBlock: number;
  search: DiffSearchApi;
  edit: DiffEditApi;
  navigation: DiffNavigationApi;
  leftPane: React.RefObject<HTMLDivElement>;
  rightPane: React.RefObject<HTMLDivElement>;
  leftRefs: React.MutableRefObject<Map<number, HTMLDivElement>>;
  rightRefs: React.MutableRefObject<Map<number, HTMLDivElement>>;
  leftPhRefs: React.MutableRefObject<Map<number, HTMLDivElement[]>>;
  /** md 预览正文容器（左右各一）：目录提取与跳转用。回调 ref——容器重建时由 useMdToc 重新挂锚点 */
  mdLeftRef: React.RefCallback<HTMLDivElement>;
  mdRightRef: React.RefCallback<HTMLDivElement>;
  targetPath: string;
  openLineMenu: (e: React.MouseEvent, rowText: string, side: 'left' | 'right') => void;
  selRef: React.MutableRefObject<string>;
  setExpandedBlocks: React.Dispatch<React.SetStateAction<Set<number>>>;
  onRestore?: (blockId: number) => void;
  /** 禁用还原箭头的原因（非空时箭头打斜杠 + 悬浮说明） */
  restoreDisabledReason?: string;
}) {
  const {
    isMd,
    previewL,
    previewR,
    versions,
    mdBaseDir,
    leftRows,
    rightRows,
    lineMarks,
    lang,
    targetBlock,
    blocks,
    curBlock,
    search,
    edit,
    navigation,
    leftPane,
    rightPane,
    leftRefs,
    rightRefs,
    leftPhRefs,
    mdLeftRef,
    mdRightRef,
    targetPath,
    openLineMenu,
    selRef,
    setExpandedBlocks,
    onRestore,
  } = props;

  return (
    <div style={{ display: 'flex', flex: 1, minHeight: 0, border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
      {/* 左栏：原版（flex 不伸缩，宽度由 leftRatio 控制；sb-pane 默认 flex:1 会覆盖 width） */}
      {/* 左栏 + 滚动条预览标记（结构同右栏：pane 让出 12px 给标记条） */}
      <div style={{ position: 'relative', flex: '0 0 auto', width: `${navigation.leftRatio}%`, display: 'flex', minWidth: 0 }}>
      {/* data-content-zoom：鼠标在正文里时 Ctrl+滚轮只缩放内容（界面不动） */}
      <div ref={leftPane} className="sb-pane" data-content-zoom="" onScroll={navigation.onScrollSync('left')}>
        {isMd && previewL ? (
          <div
            ref={mdLeftRef}
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
          const isHitL = search.dSearchLActive && search.dMatchesL.includes(r.no);
          const isCurL = isHitL && r.no === search.dMatchesL[search.dMatchLIdx % Math.max(1, search.dMatchesL.length)];
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
              if (r.change) navigation.jumpRight(r.block);
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
      {navigation.leftScrollMarkers.length > 0 && (
        <Tooltip content={t('hist.markerTip')}>
        <div className="sb-scrollbar">
          {navigation.leftScrollMarkers.map((m) => (
            <div
              key={m.block}
              className={`sb-marker-dot ${m.color} ${m.index === curBlock ? 'current' : ''}`}
              // 纵向位置 = min(比例位置, 锚行像素位置)：内容可滚动时取比例（滚动地图，与右栏同）；
              // 内容不满一屏（片段模式常见）时取像素——纯比例会散布到条底空白区、与行明显错位
              style={{ top: `min(${m.percent}%, ${Math.round(m.rowIdx * navigation.leftLineH)}px)` }}
              onClick={(e) => {
                e.stopPropagation();
                navigation.goBlock(m.index);
              }}
              title={m.color === 'add' ? t('hist.markerAdd') : t('common.delete')}
            />
          ))}
        </div>
        </Tooltip>
      )}
      </div>
      {/* 拖拽手柄 */}
      {/* 拖动调整左右栏宽度 */}
      <Tooltip content={t('hist.dragResizer')}>
        <div className="sb-resizer" onMouseDown={navigation.startDrag}>
          <span className="sb-resizer-grip"><IconResizeHorizontal size={14} /></span>
        </div>
      </Tooltip>
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
        onJump={navigation.goBlock}
        onRestore={onRestore}
        restoreDisabledReason={props.restoreDisabledReason}
      />
      {/* 右栏：当前 + 滚动条预览标记；「就地编辑」时整栏换成编辑器（左栏保持原版对照） */}
      {edit.editing && edit.editData ? (
        <div style={{ flex: 1, display: 'flex', minWidth: 0 }}>
          <InlineEditor
            ref={edit.editorRef}
            rel={targetPath}
            initialText={edit.editData.text}
            eol={edit.editData.eol}
            fileName={targetPath.split('/').pop() ?? ''}
            jumpLine={edit.editData.jumpLine}
            onDirtyChange={edit.setEditDirty}
            onDraftChange={edit.onDraftChange}
            onSaved={edit.onEditorSaved}
            onError={edit.onEditorError}
          />
        </div>
      ) : (
      <div style={{ position: 'relative', flex: 1, display: 'flex', minWidth: 0 }}>
      <div ref={rightPane} className="sb-pane" data-content-zoom="" onScroll={navigation.onScrollSync('right')}>
        {isMd && previewR ? (
          <div
            ref={mdRightRef}
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
          const isHit = !isDelPh && !isFold && !isTail && search.dSearchActive && search.dMatches.includes(r.no);
          const isCur = isHit && r.no === search.dMatches[search.dMatchIdx % Math.max(1, search.dMatches.length)];
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
                else if (r.change) navigation.jumpLeft(r.block);
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
      {navigation.scrollMarkers.length > 0 && (
        // 修改位置（点击跳转）
        <Tooltip content={t('hist.markerTip')}>
        <div className="sb-scrollbar">
          {navigation.scrollMarkers.map((m) => (
            <div
              key={m.block}
              className={`sb-marker-dot ${m.color} ${m.index === curBlock ? 'current' : ''}`}
              style={{ top: `${m.percent}%` }}
              onClick={(e) => {
                e.stopPropagation();
                navigation.goBlock(m.index);
              }}
              // 新增/修改 / 删除
              title={m.color === 'add' ? t('hist.markerAdd') : t('common.delete')}
            />
          ))}
        </div>
        </Tooltip>
      )}
      </div>
      )}
    </div>
  );
}
