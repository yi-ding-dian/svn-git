/** 文件系统视图 · 树形行渲染（fs 拆分批次 3）：列表/树/过滤树三模式共用的行组件（状态徽标/名称描述/行按钮） */
import React from 'react';
import { fmtSize, statusColor } from '../../utils.js';
import { CodeBadge, DirBadge, TreeConflictBadge } from '../../ui/badges.js';
import { IconLock } from '../../ui/icons.js';
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
  /** 点击角标定位（状态字母与树冲突 ⚠ 共用；code 为 'TC' 时表示树冲突定位） */
  locateBadge?: (rel: string, code: string) => void;
  /** 拖拽悬停在本行（仅目录可投放）：高亮提示落点 */
  dropHover?: boolean;
}) {
  const { row } = props;
  return (
    <div
      ref={props.rowRef}
      data-dir-rel={row.isDir ? row.rel : undefined} /* 拖入落点：容器按事件委托读它 */
      className={`tree-row ${props.searchHit ? 'search-hit' : ''}${props.pulse ? ' file-pulse' : ''}${row.miss ? ' miss' : ''}${props.dropHover ? ' dir-drop-hover' : ''}`}
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
      {/* 有树冲突就只显示 ⚠：字母（多半是子项聚合来的）与变更数让位，明细在悬浮/右键里。
          ⚠ 可点击：像 M/A 角标一样带用户去定位（自身冲突→它自己；内部冲突→跳进去逐个找） */}
      {row.tc ? (
        <TreeConflictBadge
          state={row.tc.state}
          inner={row.tc.inner}
          innerCount={row.tc.innerCount}
          onClick={() => props.locateBadge?.(row.rel, 'TC')}
        />
      ) : row.isDir ? (
        <DirBadge codes={row.codes} onBadgeClick={props.locateBadge ? (c) => props.locateBadge!(row.rel, c) : undefined} />
      ) : (
        <CodeBadge code={row.code} />
      )}
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
