/** 文件系统视图 · 树形行渲染（fs 拆分批次 3）：列表/树/过滤树三模式共用的行组件（状态徽标/名称描述/行按钮） */
import React from 'react';
import { fmtSize, statusColor } from '../../utils.js';
import { CodeBadge, DirBadge } from '../../badges.js';
import { IconLock } from '../../icons.js';
import type { VisibleRow } from '../utils.js';

/** 树形行：视觉与交互完全由 props 驱动（回调回 index/Hook 上下文） */
export function TreeRow(props: {
  row: VisibleRow;
  i: number;
  filtered: boolean;
  focused: boolean;
  multi: boolean;
  searchHit: boolean;
  pulse: boolean;
  desc: string | null;
  buttons: React.ReactNode;
  rowRef: (el: HTMLDivElement | null) => void;
  onRowClick: (ev: React.MouseEvent, row: VisibleRow, i: number) => void;
  onDoubleClick: (row: VisibleRow) => void;
  onContextMenu: (ev: React.MouseEvent, row: VisibleRow, i: number) => void;
  onMouseEnterRow: (ev: React.MouseEvent, row: VisibleRow) => void;
  onMouseLeaveRow: () => void;
}) {
  const { row } = props;
  return (
    <div
      ref={props.rowRef}
      className={`tree-row ${props.searchHit ? 'search-hit' : ''}${props.pulse ? ' file-pulse' : ''}${row.miss ? ' miss' : ''}`}
      style={{
        paddingLeft: 8 + row.depth * 18,
        background: props.focused || props.multi ? 'var(--panel2)' : undefined,
        outline: props.focused ? '1px solid var(--accent)' : props.multi ? '1px solid var(--accent)' : undefined,
      }}
      onMouseEnter={(ev) => props.onMouseEnterRow(ev, row)}
      onMouseLeave={props.onMouseLeaveRow}
      onClick={(ev) => props.onRowClick(ev, row, props.i)}
      onDoubleClick={() => props.onDoubleClick(row)}
      onContextMenu={(ev) => props.onContextMenu(ev, row, props.i)}
    >
      {row.isDir ? <DirBadge codes={row.codes} /> : <CodeBadge code={row.code} />}
      <span className="arrow">{row.isDir ? (row.open ? '▾' : '▸') : ''}</span>
      {row.locked && <IconLock size={13} />}
      <span className={`name ${row.isDir ? 'dir' : 'file'}`} style={{ flex: 1, color: statusColor(row.isDir ? row.codes?.[0] : row.code) }}>
        {row.name}
        {row.count ? <span className="count"> （{row.count} 项）</span> : null}
        {props.desc && (
          <span className="dim small" style={{ marginLeft: 10, maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            · {props.desc}
          </span>
        )}
        {row.miss && (
          <span className="dim small" style={{ marginLeft: 10 }}>
            · 已在磁盘上缺失，右键可还原
          </span>
        )}
      </span>
      {props.buttons}
      {!props.filtered && !row.isDir && <span className="dim small nowrap">{fmtSize(row.size)}</span>}
      {!props.filtered && !row.isDir && <span className="dim small nowrap" style={{ width: 110 }}>{row.mtime}</span>}
    </div>
  );
}
