/** 文件系统视图 · 网格模式（fs 拆分批次 3）：网格卡片 + 悬浮信息卡片（tip） */
import React from 'react';
import { CODE_DESC, codeRank, type FsEntry } from '../../api.js';
import { fmtSize } from '../../utils.js';
import { CodeBadge, DirBadge } from '../../badges.js';
import { GridIcon, IconLock } from '../../icons.js';

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
}) {
  const e = props.entry;
  const dirCodes =
    e.isDir && e.codes && e.codes.length > 2
      ? [...e.codes].sort((a, b) => codeRank(b) - codeRank(a)).slice(0, 2)
      : e.codes;
  return (
    <div
      className={`grid-item ${props.focused || props.multi ? 'selected' : ''} ${props.searchHit ? 'search-hit' : ''}${props.pulse ? ' file-pulse' : ''}${e.miss ? ' miss' : ''}`}
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
          {e.isDir ? <DirBadge codes={dirCodes} onBadgeClick={(code) => props.locateBadge(props.rel, code)} /> : <CodeBadge code={e.code} />}
          {e.isDir && e.count ? <span className="grid-count" title={`${e.count} 项有变更`}>{e.count}</span> : null}
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
