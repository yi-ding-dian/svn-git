/** 文件系统视图 · 网格模式（fs 拆分批次 3）：网格卡片 + 悬浮信息卡片（tip） */
import React from 'react';
import { CODE_DESC, codeRank, type FsEntry } from '../../api.js';
import { fmtSize } from '../../utils.js';
import { CodeBadge, DirBadge, TreeConflictBadge, type TreeConflictState } from '../../ui/badges.js';
import { GridIcon, IconLock } from '../../ui/icons.js';

/** 网格卡片（图标+状态角标+名称+大小；目录状态字母最多显示 2 个） */
export function GridItem(props: {
  entry: FsEntry;
  rel: string;
  focused: boolean;
  multi: boolean;
  searchHit: boolean;
  pulse: boolean;
  locked: boolean;
  rowRef: (el: HTMLDivElement | null) => void;
  onMouseEnter: (ev: React.MouseEvent) => void;
  onMouseLeave: () => void;
  onClick: (ev: React.MouseEvent) => void;
  onDoubleClick: () => void;
  onContextMenu: (ev: React.MouseEvent) => void;
  locateBadge: (rel: string, code: string) => void;
  /** 树冲突角标（undefined = 不是冲突）：有冲突就**只显示 ⚠**，让 M/A/D 与变更数让位——
   *  那些字母多半是子项状态聚合上来的（跟条目自身无关），冲突没解决前也没有操作性意义；
   *  明细在悬浮卡里照常给出。inner = 目录内部有冲突（不是它自己） */
  tc?: { state: TreeConflictState; inner?: boolean; innerCount?: number };
  /** 拖拽悬停在本格子（仅目录可投放）：高亮提示落点 */
  dropHover?: boolean;
}) {
  const e = props.entry;
  const dirCodes =
    e.isDir && e.codes && e.codes.length > 2
      ? [...e.codes].sort((a, b) => codeRank(b) - codeRank(a)).slice(0, 2)
      : e.codes;
  return (
    <div
      data-dir-rel={e.isDir ? props.rel : undefined} /* 拖入落点：容器按事件委托读它 */
      className={`grid-item ${props.focused || props.multi ? 'selected' : ''} ${props.searchHit ? 'search-hit' : ''}${props.pulse ? ' file-pulse' : ''}${e.miss ? ' miss' : ''}${props.dropHover ? ' dir-drop-hover' : ''}`}
      ref={props.rowRef}
      onMouseEnter={props.onMouseEnter}
      onMouseLeave={props.onMouseLeave}
      onClick={props.onClick}
      onDoubleClick={props.onDoubleClick}
      onContextMenu={props.onContextMenu}
    >
      <span className="grid-icon-wrap">
        <GridIcon isDir={e.isDir} name={e.name} />
        <span className="grid-badge">
          {props.tc ? (
            <TreeConflictBadge
              state={props.tc.state}
              inner={props.tc.inner}
              innerCount={props.tc.innerCount}
              onClick={() => props.locateBadge(props.rel, 'TC')}
            />
          ) : e.isDir ? (
            <DirBadge codes={dirCodes} onBadgeClick={(code) => props.locateBadge(props.rel, code)} />
          ) : (
            <CodeBadge code={e.code} />
          )}
          {!props.tc && e.isDir && e.count ? <span className="grid-count" title={`${e.count} 项有变更`}>{e.count}</span> : null}
          {props.locked && <IconLock size={13} />}
        </span>
      </span>
      <span className={`grid-name ${e.isDir ? 'dir' : ''}`}>{e.name}</span>
      {!e.isDir && <span className="dim small nowrap">{fmtSize(e.size)}</span>}
    </div>
  );
}

export interface TipData {
  x: number;
  y: number;
  name: string;
  isDir?: boolean;
  count?: number;
  size?: number;
  mtime?: string;
  code?: string;
  codes?: string[];
  /** 磁盘上已缺失：悬浮卡第一行提示可还原 */
  miss?: boolean;
  /** 树冲突（undefined = 不是冲突）；tcItem 带复制源明细（该目录是从哪个版本复制来的） */
  tc?: { state: TreeConflictState; inner?: boolean; innerCount?: number };
  tcItem?: { fromRev?: string; fromAuthor?: string; fromDate?: string };
}

/** 悬浮卡的冲突描述：分"自身冲突 / 目录内部有冲突"两种口吻——后者要说清条数，别让人以为该目录本身有问题 */
function tcText(tc: { state: TreeConflictState; inner?: boolean; innerCount?: number }): string {
  const stateText = tc.state === 'missing' ? '服务器上已删除' : tc.state === 'present' ? '服务器上仍在' : '未查到服务器状态';
  if (tc.inner) return `树冲突：目录内部有 ${tc.innerCount ?? '若干'} 处，${stateText}`;
  return `树冲突：服务器上该路径${tc.state === 'missing' ? '已删除' : tc.state === 'present' ? '仍在' : '状态未查'}`;
}

/** 网格悬浮信息卡片（列表/树模式已按用户要求去掉悬浮卡，仅网格保留）：彩色状态徽标 + 紧凑描述 */
export function FileTipCard(props: { tip: TipData | null }) {
  const tip = props.tip;
  if (!tip) return null;
  return (
    <div
      style={{
        position: 'fixed',
        left: Math.min(tip.x + 12, window.innerWidth - 300),
        top: Math.min(tip.y + 14, window.innerHeight - 110),
        zIndex: 400,
        background: 'var(--panel)',
        border: '1px solid var(--border)',
        borderRadius: 8,
        boxShadow: '0 4px 16px rgba(0,0,0,.18)',
        padding: '8px 10px',
        fontSize: 12,
        maxWidth: 280,
        pointerEvents: 'none',
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {tip.name}
        {tip.count ? <span className="dim">（{tip.count} 项有变更）</span> : null}
      </div>
      {tip.miss && (
        <div style={{ color: 'var(--danger)', marginBottom: 4 }}>文件已在磁盘上缺失，右键可还原</div>
      )}
      {tip.tc ? (
        <>
          <div style={{ color: tip.tc.state === 'missing' ? 'var(--err)' : tip.tc.state === 'present' ? 'var(--warn)' : 'var(--dim)', marginBottom: 4 }}>
            {tcText(tip.tc)}
            {tip.tcItem?.fromRev && (
              <span className="dim">
                （复制自 r{tip.tcItem.fromRev} {tip.tcItem.fromAuthor} {tip.tcItem.fromDate}）
              </span>
            )}
          </div>
          {/* 冲突时不再显示 M/A/D 徽标：那些字母多数是子项状态聚合来的（跟条目自身无关），
              在"必须先定夺去留"的语境下只会误导。换成一句"该怎么办"更实在。
              注意：树冲突的"放弃本地添加"会**连本地文件一起删**（要接受服务器那个删除），
              跟普通 added 目录"只取消登记、文件保留"不一样，别写错 */}
          <div className="dim" style={{ fontSize: 11, marginBottom: 4 }}>
            {tip.tc.inner
              ? '点进该目录逐条处理'
              : tip.codes?.includes('A') === true
                ? '右键可接受服务器的删除：本地文件会一并删除'
                : '右键可放弃本地修改：文件回到版本库内容'}
          </div>
        </>
      ) : (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 4 }}>
          {tip.codes && tip.codes.length > 0 &&
            [...tip.codes]
              .sort((a, b) => codeRank(b) - codeRank(a))
              .map((c) => (
                <span key={c} style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                  <CodeBadge code={c} />
                  <span>{CODE_DESC[c] ?? c}</span>
                </span>
              ))}
          {(!tip.codes || tip.codes.length === 0) && tip.code !== undefined && tip.code !== '' && tip.code !== ' ' && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
              <CodeBadge code={tip.code} />
              <span>{CODE_DESC[tip.code] ?? tip.code}</span>
            </span>
          )}
          {(!tip.codes || tip.codes.length === 0) && (!tip.code || tip.code === '' || tip.code === ' ') && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
              <CodeBadge code={''} />
              <span>干净</span>
            </span>
          )}
        </div>
      )}
      {!tip.isDir && (tip.size !== undefined || tip.mtime) && (
        <div className="dim" style={{ fontSize: 11, marginBottom: 4 }}>
          {tip.size !== undefined ? fmtSize(tip.size) : ''}
          {tip.size !== undefined && tip.mtime ? ' · ' : ''}
          {tip.mtime ?? ''}
        </div>
      )}
      <div className="dim" style={{ fontSize: 11 }}>{tip.miss ? '右键可还原' : tip.isDir ? '双击进入' : '双击查看'}</div>
    </div>
  );
}
