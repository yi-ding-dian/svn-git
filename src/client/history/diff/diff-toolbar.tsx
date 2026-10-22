/** 差异视图的顶栏与栏头：顶栏（标题/差异块导航/返回）与版本号行 + 左右栏头
 *  （搜索开关、显示全部、编辑/预览按钮）。嵌入弹窗时顶栏整行隐藏，块导航挪到两栏缝隙。 */
import React from 'react';
import { isImeComposing } from '../../shared/utils.js';
import { t } from '../../../shared/i18n/index.js';
import type { DiffLabels, DiffTarget } from './diff-types.js';
import type { DiffBlock, DiffVersions } from './use-diff-rows.js';
import type { DiffEditApi } from './use-diff-edit.js';
import type { DiffSearchApi } from './use-diff-search.js';
import { Tooltip } from '../../ui/tooltip.js';

/** 文件被外部改动时的提示条：更新文件（重拉两侧版本与 diff）/ 忽略 */
export function DiffStaleTip(props: { onReload: () => void; onDismiss: () => void }) {
  return (
    <div className="stale-tip" style={{ marginBottom: 8 }}>
      {/* ⚠ 文件已更新，是否更新文件？ */}
      <span>{t('hist.fileChanged')}</span>
      <span className="grow" />
      <button className="mini primary" onClick={props.onReload}>
        {/* 更新文件 */}
        {t('hist.reloadFile')}
      </button>
      {/* 忽略 */}
      <button className="mini" onClick={props.onDismiss}>{t('hist.dismiss')}</button>
    </div>
  );
}

/** 错误条：× 关掉这条提示 */
export function DiffErrorBar(props: { error: string; onClose: () => void }) {
  return (
    <div className="error" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{ flex: 1, minWidth: 0 }}>{props.error}</span>
      {/* ×：关掉这条提示 */}
      <button className="mini" style={{ flexShrink: 0 }} title={t('common.close')} onClick={props.onClose}>
        ×
      </button>
    </div>
  );
}

export function DiffTopBar(props: {
  target: DiffTarget | null;
  title: string;
  sideMode: boolean;
  blocks: DiffBlock[];
  curBlock: number;
  goPrevBlock: () => void;
  goNextBlock: () => void;
  showAll: boolean;
  syncMode: boolean;
  setSyncMode: React.Dispatch<React.SetStateAction<boolean>>;
  onBack: () => void;
}) {
  const { target, title, sideMode, blocks, curBlock, goPrevBlock, goNextBlock, showAll, syncMode, setSyncMode, onBack } = props;
  return (
    // 顶栏（标题 / 块导航 / 返回）：嵌入弹窗时整行隐藏，块导航挪到两栏缝隙
    <div className="row" style={{ marginBottom: 8, flexShrink: 0, flexWrap: 'wrap' }}>
      <span className="dim">
        {/* 差异: {rev} — {path} / 差异: {rev} */}
        {target?.path ? t('hist.diffOfPath', { rev: title, path: target.path }) : t('hist.diffOf', { rev: title })}
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
            <Tooltip content={t('hist.syncTip')}>
              <button
                className={`mini${syncMode ? ' primary' : ''}`}
                onClick={() => setSyncMode((v) => !v)}
              >
                {/* ↔ 同步滚动 */}
                {t('hist.syncScroll')}
              </button>
            </Tooltip>
          )}
        </>
      )}
      {/* ← 键返回 */}
      <span className="dim small">{t('hist.arrowKeyBack')}</span>
      {/* ← 返回 */}
      <button className="mini" onClick={onBack}>{t('hist.back')}</button>
    </div>
  );
}

export function DiffPaneHeaders(props: {
  versions: DiffVersions;
  labels?: DiffLabels;
  embedded: boolean;
  sideMode: boolean;
  blocks: DiffBlock[];
  curBlock: number;
  goPrevBlock: () => void;
  goNextBlock: () => void;
  showAll: boolean;
  syncMode: boolean;
  setSyncMode: React.Dispatch<React.SetStateAction<boolean>>;
  onToggleShowAll: () => void;
  search: DiffSearchApi;
  edit: DiffEditApi;
  isMd: boolean;
  previewL: boolean;
  setPreviewL: React.Dispatch<React.SetStateAction<boolean>>;
  previewR: boolean;
  setPreviewR: React.Dispatch<React.SetStateAction<boolean>>;
  readOnly?: boolean;
}) {
  const { versions, labels, embedded, sideMode, blocks, curBlock, goPrevBlock, goNextBlock, showAll, syncMode, setSyncMode, onToggleShowAll, search, edit, isMd, previewL, setPreviewL, previewR, setPreviewR, readOnly } = props;

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
        <Tooltip content={t('hist.syncTip')}>
          <button
            className={`mini${syncMode ? ' primary' : ''}`}
            style={{ padding: '0 6px', height: 20, lineHeight: '18px' }}
            onClick={() => setSyncMode((v) => !v)}
          >
            {/* ↔ 同步滚动 */}
            {t('hist.syncScroll')}
          </button>
        </Tooltip>
      )}
    </div>
  );

  return (
    <>
      {/* 版本号行：左右标签分别对齐两栏起点；嵌入弹窗的块导航贴在这行右侧（分隔线左边） */}
      <div style={{ position: 'relative', height: 20, marginBottom: 4, flexShrink: 0 }}>
        <span
          className="dim small"
          style={{ position: 'absolute', left: 0, top: 0, maxWidth: '40%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
        >
          ◀ {labels?.left ?? versions.leftLabel}
        </span>
        <span
          className="dim small"
          style={{ position: 'absolute', left: '50%', top: 0, maxWidth: '40%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
        >
          ▶ {labels?.right ?? versions.rightLabel}
        </span>
        {embedded && embeddedBlockNav}
      </div>
      {/* 栏头：左右各带独立搜索框（定位各自栏内代码） */}
      <div style={{ display: 'flex', flexShrink: 0, marginBottom: 6, gap: 8 }}>
        {/* 左栏：原版 */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="row" style={{ gap: 6 }}>
            {search.dSearchLActive ? (
              <>
                {/* 输入框外层 relative：右侧拖拽手柄绝对定位用（左栏独立宽度） */}
                <span style={{ position: 'relative', width: search.dSearchWL, flexShrink: 0, display: 'inline-flex' }}>
                  <input
                    autoFocus
                    type="text"
                    // 搜索左栏代码…
                    placeholder={t('hist.searchLeftPlaceholder')}
                    value={search.dSearchL}
                    onChange={(e) => {
                      search.setDSearchL(e.target.value);
                      search.setDMatchLIdx(0);
                    }}
                    onKeyDown={(e) => {
                      if (isImeComposing(e)) return;
                      if (e.key === 'Enter') search.goNextLMatch();
                      if (e.key === 'Escape') search.setDSearchLActive(false);
                    }}
                    style={{ width: '100%', boxSizing: 'border-box' }}
                  />
                  {/* 右边缘拖拽手柄：左右拖调宽；往左拖窄过阈值松手 = 收起搜索 */}
                  <span className="search-resize" onMouseDown={search.onDSearchResizeDown('L')} title={t('fs.search.resize')} />
                </span>
                <span className="grow" />
                {/* 拖窄至阈值内：松手将收起搜索 */}
                {search.collapseHint === 'L' && (
                  <span className="small" style={{ color: 'var(--warn)', whiteSpace: 'nowrap' }}>{t('hist.releaseToCollapse')}</span>
                )}
                <span className="dim small nowrap">
                  {/* 无匹配 */}
                  {search.dSearchL.trim() && search.dMatchesL.length > 0 ? `${search.dMatchLIdx + 1}/${search.dMatchesL.length}` : search.dSearchL.trim() ? t('hist.noMatchText') : ''}
                </span>
                {/* 下一个 ↓ */}
                <button className="mini" onClick={search.goNextLMatch}>{t('hist.nextBlock')}</button>
              </>
            ) : (
              // 🔍 搜索此栏
              <button className="mini" onClick={() => search.setDSearchLActive(true)}>{t('hist.searchPane')}</button>
            )}
            {/* 显示全部：左栏从差异片段展开为完整原版（开启后顶栏出现「同步滚动」；关掉时联动关同步。
                放左栏头部：它管的就是左栏，与「预览」等左栏查看方式并列） */}
            <Tooltip content={t('hist.showAllTip')}>
              <button
                className={`mini${showAll ? ' primary' : ''}`}
                onClick={onToggleShowAll}
              >
                {/* 显示全部 */}
                {t('hist.showAll')}
              </button>
            </Tooltip>
            {isMd && previewL && (
              // 返回差异行视图
              <button className="mini" onClick={() => setPreviewL((v) => !v)} title={t('hist.backToDiff')}>
                {/* 返回对比 */}
                {t('hist.backToCompare')}
              </button>
            )}
            {isMd && !previewL && (
              // Markdown 渲染预览（原版）
              <Tooltip content={t('hist.mdPreviewLeft')}>
                <button className="mini" onClick={() => setPreviewL((v) => !v)}>
                  {/* 预览 */}
                  👁 {t('common.preview')}
                </button>
              </Tooltip>
            )}
          </div>
        </div>
        {/* 右栏：当前 */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="row" style={{ gap: 6 }}>
            {edit.editing ? (
              <>
                {/* 编辑中 */}
                <span className="dim small">{t('fs.pv.editing')}</span>
                <span className="grow" />
                {/* 💾 保存（有修改才点亮）；保存后自动重新对比 */}
                <button className={`mini${edit.editDirty ? ' primary' : ''}`} onClick={() => edit.editorRef.current?.save()}>{t('fs.pv.saveBtn')}</button>
                {/* 取消：丢弃修改，回到差异视图 */}
                <button className="mini" onClick={edit.cancelEdit}>{t('common.cancel')}</button>
              </>
            ) : (
            <>
            {search.dSearchActive ? (
              <>
                {/* 输入框外层 relative：右侧拖拽手柄绝对定位用（右栏独立宽度） */}
                <span style={{ position: 'relative', width: search.dSearchWR, flexShrink: 0, display: 'inline-flex' }}>
                  <input
                    autoFocus
                    type="text"
                    // 搜索右栏代码…
                    placeholder={t('hist.searchRightPlaceholder')}
                    value={search.dSearch}
                    onChange={(e) => {
                      search.setDSearch(e.target.value);
                      search.setDMatchIdx(0);
                    }}
                    onKeyDown={(e) => {
                      if (isImeComposing(e)) return;
                      if (e.key === 'Enter') search.goNextDMatch();
                      if (e.key === 'Escape') search.setDSearchActive(false);
                    }}
                    style={{ width: '100%', boxSizing: 'border-box' }}
                  />
                  {/* 右边缘拖拽手柄：左右拖调宽；往左拖窄过阈值松手 = 收起搜索 */}
                  <span className="search-resize" onMouseDown={search.onDSearchResizeDown('R')} title={t('fs.search.resize')} />
                </span>
                <span className="grow" />
                {/* 拖窄至阈值内：松手将收起搜索 */}
                {search.collapseHint === 'R' && (
                  <span className="small" style={{ color: 'var(--warn)', whiteSpace: 'nowrap' }}>{t('hist.releaseToCollapse')}</span>
                )}
                <span className="dim small nowrap">
                  {/* 无匹配 */}
                  {search.dSearch.trim() && search.dMatches.length > 0 ? `${search.dMatchIdx + 1}/${search.dMatches.length}` : search.dSearch.trim() ? t('hist.noMatchText') : ''}
                </span>
                {/* 下一个 ↓ */}
                <button className="mini" onClick={search.goNextDMatch}>{t('hist.nextBlock')}</button>
              </>
            ) : (
              // 🔍 搜索此栏
              <button className="mini" onClick={() => search.setDSearchActive(true)}>{t('hist.searchPane')}</button>
            )}
            {/* ✎ 编辑：右栏就地编辑（定位到当前差异处；非 UTF-8/超限文件点击时提示）。
                历史版本只读：不提供编辑入口 */}
            {!readOnly && (
              <Tooltip content={t('hist.editInPlaceTip')}>
                <button className="mini" onClick={edit.startEdit}>{t('fs.pv.edit')}</button>
              </Tooltip>
            )}
            {isMd && (
              // 返回差异行视图 / Markdown 渲染预览（当前）
              <Tooltip content={previewR ? t('hist.backToDiff') : t('hist.mdPreviewRight')}>
                <button className="mini" onClick={() => setPreviewR((v) => !v)}>
                  {/* 返回对比 / 预览 */}
                  {previewR ? t('hist.backToCompare') : `👁 ${t('common.preview')}`}
                </button>
              </Tooltip>
            )}
            </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
