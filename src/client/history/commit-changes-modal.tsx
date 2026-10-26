/** 提交文件变动详情弹窗：左侧变更文件列表，右侧差异（复用 DiffView 的嵌入/只读模式）。
 *
 *  顶部下拉可在已加载的历史里切换提交——列表条目自带 changed，切提交不用再请求文件清单。
 *  提交之间的差异一律相对第一父（合并提交取 `rev^`），与历史行里的文件数口径一致；
 *  根提交没有父，用 Git 空树对象作为"前一版本"（差异表现为整文件新增）。 */
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { ResizableModal } from '../shell/modal-shell.js';
import { DiffView } from './diff/index.js';
import { RestoreVersionConfirm } from './restore-version.js';
import type { RestoreVersionTarget } from './restore-version.js';
import { isBinaryFile } from '../shared/utils.js';
import { IconResizeHorizontal } from '../ui/icons.js';
import { ResizeCursor, useResizeCursor } from '../shared/use-resize-cursor.js';
import { ContextMenu } from '../ui/context-menu.js';
import { cmdOfRepo } from '../shared/cmd-preview.js';
import { t } from '../../shared/i18n/index.js';
import type { LogEntry } from '../shared/api.js';

/** Git 空树对象（SHA-1）：根提交的左版本。`git show <它>:path` 为空、`git diff <它> rev` 正常 */
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

/** 拖分隔条时父组件会频繁重渲染；DiffView 内部很重（行模型/搜索/滚动），
 *  记忆化后宽度变化只重排布局，不重新渲染差异内容 */
const MemoDiffView = React.memo(DiffView);

/** 文件列表折叠状态（用户偏好，跨弹窗记住）：1=收起，0/缺省=展开 */
const FILES_COLLAPSED_KEY = 'commitChanges.filesCollapsed';
/** 文件列表宽度（拖拽分隔条调整）：宽度、下限、上限、松手收起阈值 */
const FILES_WIDTH_KEY = 'commitChanges.filesWidth';
const FILES_WIDTH_DEFAULT = 300;
const FILES_WIDTH_MIN = 80;
const FILES_WIDTH_MAX = 600;
const FILES_COLLAPSE_BELOW = 120;

export function CommitChangesModal(props: {
  /** 已加载的历史列表（下拉选项来源；条目自带 changed） */
  logs: LogEntry[];
  /** 打开时选中的提交 */
  initialRev: string;
  /** 仓库引擎：还原命令预览按 svn/git 显示真实命令 */
  repoType?: 'svn' | 'git';
  onClose: () => void;
  onToast?: (msg: string, err?: boolean) => void;
  /** 打开完整差异视图（还原确认框里的「查看完整差异」） */
  onOpenDiff?: (path: string, rev: string) => void;
  /** 还原成功：通知父级刷新文件状态与历史差异记号 */
  onRestored?: () => void;
}) {
  const [rev, setRev] = useState(props.initialRev);
  const entry = useMemo(() => props.logs.find((l) => l.rev === rev) ?? null, [props.logs, rev]);
  /** 用户点选的文件；切提交后若该路径不在新提交里，自动回退到第一个变更文件 */
  const [picked, setPicked] = useState<string | null>(null);
  const path = entry?.changed.some((c) => c.path === picked) ? picked : (entry?.changed[0]?.path ?? null);
  /** 单个文件还原到当前提交的版本：待确认目标（确认前不动文件） */
  const [restoreOf, setRestoreOf] = useState<RestoreVersionTarget | null>(null);
  /** 文件列表右键菜单：位置 + 目标条目（action=D 无内容可还原；kind=dir 走目录反向合并） */
  const [fileMenu, setFileMenu] = useState<{ x: number; y: number; path: string; action: string; kind?: 'file' | 'dir' } | null>(null);
  /** 前一版本：Git 取第一父 `rev^`；SVN 用 rev-1（`^` 是 Git 语法，传给 svn 会报 E205000）。
   *  根提交没有父：Git 用空树对象，SVN 用 r0（差异表现为整文件新增）。 */
  const before =
    props.repoType === 'svn'
      ? String(Math.max(0, Number(rev) - 1))
      : entry?.isRoot
        ? EMPTY_TREE
        : `${rev}^`;
  const binary = Boolean(path && isBinaryFile(path));
  /** 版本行改成人话：原始 `rev^` 对非 Git 用户不可读（^ = 父提交，即上一版） */
  const leftLabel = entry?.isRoot ? t('hist.changes.beforeRoot') : t('hist.changes.before', { rev });
  const rightLabel = t('hist.changes.after', { rev });
  // target/labels 必须记忆化：每次渲染新建对象会让 DiffView 的加载 effect 重跑（拖拽时闪"加载对比"）
  const diffTarget = useMemo(() => ({ path: path ?? '', a: before, b: rev }), [path, before, rev]);
  const diffLabels = useMemo(() => ({ left: leftLabel, right: rightLabel }), [leftLabel, rightLabel]);
  const noop = useCallback(() => {}, []);
  /** 折叠左侧文件列表，把宽度让给差异；宽度与折叠状态都持久化，下次打开保持一致 */
  const [filesCollapsed, setFilesCollapsed] = useState(() => {
    try {
      return localStorage.getItem(FILES_COLLAPSED_KEY) === '1';
    } catch {
      return false;
    }
  });
  const [filesWidth, setFilesWidth] = useState(() => {
    try {
      const saved = Number(localStorage.getItem(FILES_WIDTH_KEY));
      return Number.isFinite(saved) && saved >= FILES_WIDTH_MIN && saved <= FILES_WIDTH_MAX ? saved : FILES_WIDTH_DEFAULT;
    } catch {
      return FILES_WIDTH_DEFAULT;
    }
  });
  const dragRef = useRef<{ startX: number; startWidth: number; lastRaw: number } | null>(null);
  /** 统一的分隔条拖拽光标（所有可调整尺寸的分隔条共用） */
  const { ghostRef, start: startResizeCursor, move: moveResizeCursor, stop: stopResizeCursor } = useResizeCursor();

  const persistCollapsed = (next: boolean) => {
    try {
      localStorage.setItem(FILES_COLLAPSED_KEY, next ? '1' : '0');
    } catch {
      /* 存储失败忽略：本次仍然生效 */
    }
  };
  const persistWidth = (next: number) => {
    try {
      localStorage.setItem(FILES_WIDTH_KEY, String(next));
    } catch {
      /* 同上 */
    }
  };

  /** 分隔条拖拽：拖动调宽；拖到最左侧（低于阈值）松手 = 收起；收起后向右拖过阈值 = 展开 */
  const onResizeDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const startWidth = filesCollapsed ? 0 : filesWidth;
    dragRef.current = { startX: e.clientX, startWidth, lastRaw: startWidth };
    // 拖拽期间隐藏系统光标，改由页面内绘制的图标跟随鼠标
    startResizeCursor(e.clientX, e.clientY);
    const onMove = (ev: MouseEvent) => {
      moveResizeCursor(ev.clientX, ev.clientY);
      const d = dragRef.current;
      if (!d) return;
      const raw = d.startWidth + (ev.clientX - d.startX);
      d.lastRaw = raw;
      if (filesCollapsed) {
        // 收起状态：向右拖过阈值才展开（避免拖出几像素就闪出一个窄列表）
        if (raw >= FILES_COLLAPSE_BELOW) {
          setFilesCollapsed(false);
          setFilesWidth(Math.min(FILES_WIDTH_MAX, raw));
        }
        return;
      }
      // 展开状态：低于下限先停在下限，松手时再按阈值决定是否收起
      setFilesWidth(Math.min(FILES_WIDTH_MAX, Math.max(FILES_WIDTH_MIN, raw)));
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      stopResizeCursor();
      const d = dragRef.current;
      dragRef.current = null;
      if (!d) return;
      if (d.lastRaw < FILES_COLLAPSE_BELOW) {
        // 拖到最左侧：收起；保留原展开宽度，下次展开回到它
        setFilesCollapsed(true);
        persistCollapsed(true);
        const keep = d.startWidth || FILES_WIDTH_DEFAULT;
        setFilesWidth(keep);
        persistWidth(keep);
      } else {
        const w = Math.min(FILES_WIDTH_MAX, Math.max(FILES_WIDTH_MIN, d.lastRaw));
        setFilesCollapsed(false);
        persistCollapsed(false);
        setFilesWidth(w);
        persistWidth(w);
      }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  /** 双击分隔条：收起 / 展开 */
  const onResizeDoubleClick = () => {
    if (filesCollapsed) {
      setFilesCollapsed(false);
      persistCollapsed(false);
    } else {
      setFilesCollapsed(true);
      persistCollapsed(true);
    }
  };

  return (
    <div className="modal-mask">
      <ResizableModal width={1180} maxed maxedWidth="98vw" maxedHeight="96vh" onEsc={props.onClose}>
        <div className="row" style={{ alignItems: 'center' }}>
          <h3
            style={{
              flex: 1,
              margin: 0,
              position: 'relative',
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              paddingRight: 46,
            }}
          >
            {/* 文件变动详情 */}
            <span style={{ flexShrink: 0 }}>{t('hist.changes.title')}</span>
            {/* 提交 */}
            <span className="dim small nowrap" style={{ fontWeight: 400 }}>{t('hist.changes.commit')}</span>
            <select
              value={rev}
              onChange={(e) => setRev(e.target.value)}
              // 悬浮看完整提交信息（下拉里已含 rev + 注释，这里补作者/时间）
              title={entry ? `${entry.rev} · ${entry.author} · ${entry.date}\n${entry.msg}` : rev}
              style={{
                flex: 1,
                minWidth: 0,
                maxWidth: 620,
                padding: '4px 8px',
                background: 'var(--panel2)',
                color: 'var(--text)',
                border: '1px solid var(--border)',
                borderRadius: 6,
                fontSize: 12,
                fontWeight: 400,
              }}
            >
              {props.logs.map((l) => (
                <option key={l.rev} value={l.rev}>
                  {/* 下拉只显示提交标题（第一行）：完整说明常有几十行，全部铺开会把列表撑爆；悬浮看全文 */}
                  {l.rev} · {l.msg.split('\n')[0]}
                </option>
              ))}
            </select>
            {/* 提交人 / 时间：并进标题行，正文不再单占两行，把高度留给差异 */}
            {entry && (
              <span
                className="dim small nowrap"
                style={{ minWidth: 0, maxWidth: 360, overflow: 'hidden', textOverflow: 'ellipsis', fontWeight: 400 }}
              >
                {entry.author} · {entry.date}
              </span>
            )}
            <button className="modal-x" title={t('common.close')} aria-label={t('common.close')} onClick={props.onClose}>
              ✕
            </button>
          </h3>
        </div>
        <div className="body" style={{ display: 'flex', flexDirection: 'column', gap: 10, minHeight: 0, flex: 1, paddingTop: 8 }}>
          <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
            {/* 左：变更文件列表（可折叠，折叠后整列让给差异） */}
            {!filesCollapsed && (
              <div
                style={{
                  width: filesWidth,
                  flexShrink: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  minHeight: 0,
                  paddingRight: 12,
                }}
              >
                {/* 变更文件（{n}） */}
                <div className="small dim" style={{ marginBottom: 6, flexShrink: 0 }}>
                  {t('hist.changes.files', { n: entry?.changed.length ?? 0 })}
                </div>
                <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
                  {entry?.changed.map((c) => (
                    <div
                      key={c.path}
                      className={`changed-row${c.path === path ? ' active' : ''}`}
                      style={{ cursor: 'pointer' }}
                      title={c.path}
                      onClick={() => setPicked(c.path)}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        setFileMenu({ x: e.clientX, y: e.clientY, path: c.path, action: c.action, kind: c.kind });
                      }}
                    >
                      <span className={`act ${c.action}`}>{c.action}</span>
                      <span
                        className="mono"
                        style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                      >
                        {c.path}
                      </span>
                      {/* 行尾「还原此版本」：只还原这一个文件，本次提交的其它文件不动；
                          D=该提交里是删除，那个版本没有内容可还原 */}
                      {c.action !== 'D' && (
                        <button
                          className="row-restore"
                          title={c.kind === 'dir'
                            ? t('hist.restoreDirItemTip', { path: c.path, rev: rev.slice(0, 7) })
                            : t('hist.restoreItemTip', { path: c.path, rev: rev.slice(0, 7) })}
                          onClick={(e) => {
                            // 整行点击是在右侧查看差异：还原按钮不能顺带切走视图
                            e.stopPropagation();
                            setRestoreOf({
                              rev,
                              path: c.path,
                              kind: c.kind,
                              // 目录还原会改动它下面的所有内容，"列表里其它文件不受影响"只对单文件说
                              otherCount: c.kind === 'dir' ? 0 : (entry?.changed.length ?? 1) - 1,
                            });
                          }}
                        >
                          ↩
                        </button>
                      )}
                    </div>
                  ))}
                  {/* 无文件变更 */}
                  {entry && entry.changed.length === 0 && <div className="dim">{t('hist.noChanged')}</div>}
                </div>
              </div>
            )}
            {/* 拖拽分隔条：左右拖调文件列表宽度；拖到最左侧自动收起；双击收起/展开 */}
            <span
              className="files-resizer"
              role="separator"
              aria-orientation="vertical"
              aria-label={filesCollapsed ? t('hist.changes.expandFiles') : t('hist.changes.collapseFiles')}
              title={t('hist.changes.resizeFiles')}
              onMouseDown={onResizeDown}
              onDoubleClick={onResizeDoubleClick}
            >
              <span className="files-resizer-grip"><IconResizeHorizontal size={14} /></span>
            </span>
            {/* 右：差异 */}
            <div
              style={{
                flex: 1,
                minWidth: 0,
                minHeight: 0,
                display: 'flex',
                flexDirection: 'column',
                paddingLeft: filesCollapsed ? 0 : 8,
              }}
            >
              {/* 列表收起时补一行当前文件路径，避免不知道在看哪个文件 */}
              {filesCollapsed && path && (
                <div
                  className="mono small dim"
                  style={{ marginBottom: 4, flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                  title={path}
                >
                  {path}
                </div>
              )}
              {!entry || !path ? (
                // 点击左侧文件查看差异
                <div className="empty">{t('hist.changes.pickFile')}</div>
              ) : binary ? (
                // 该文件为二进制文件（Word 文档 / PDF / 图片等），不支持文本对比
                <div className="dim" style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {t('hist.binaryNoDiff')}
                </div>
              ) : (
                <MemoDiffView
                  target={diffTarget}
                  labels={diffLabels}
                  tick={0}
                  active
                  embedded
                  readOnly
                  onBack={noop}
                  onToast={props.onToast}
                />
              )}
            </div>
          </div>
        </div>
      </ResizableModal>
      {/* 文件列表右键：还原此版本（只还原这一个文件，本次提交的其它文件不动） */}
      {fileMenu && entry && (
        <ContextMenu
          x={fileMenu.x}
          y={fileMenu.y}
          mask
          items={[
            {
              icon: '↩',
              // 还原此版本
              label: t('hist.restoreThis'),
              // 该提交里此文件是删除 → 置灰并说明原因
              title: fileMenu.action === 'D'
                ? t('hist.restoreDeletedTip')
                : fileMenu.kind === 'dir'
                  ? t('hist.restoreDirItemTip', { path: fileMenu.path, rev: rev.slice(0, 7) })
                  : t('hist.restoreItemTip', { path: fileMenu.path, rev: rev.slice(0, 7) }),
              disabled: fileMenu.action === 'D',
              cmd: cmdOfRepo(props.repoType ?? 'git', fileMenu.kind === 'dir' ? 'restore_rev_dir' : 'restore_rev', { rev, path: fileMenu.path }),
              action: () => {
                const p = fileMenu.path;
                setFileMenu(null);
                setRestoreOf({
                  rev,
                  path: p,
                  kind: fileMenu.kind,
                  otherCount: fileMenu.kind === 'dir' ? 0 : (entry?.changed.length ?? 1) - 1,
                });
              },
            },
          ]}
          onClose={() => setFileMenu(null)}
        />
      )}
      {/* 还原确认（叠在详情弹窗之上）：只写工作区，不改历史 */}
      {restoreOf && (
        <RestoreVersionConfirm
          target={restoreOf}
          repoType={props.repoType}
          onOpenDiff={props.onOpenDiff}
          onDone={(r) => {
            setRestoreOf(null);
            // 目录反向合并可能"改了但带冲突"：后端已返回完整说明，别套「还原失败:」前缀
            const hasConflicts = Boolean(r.conflicts?.length);
            props.onToast?.(!r.ok && !hasConflicts ? t('hist.restoreFailed', { msg: r.message }) : r.message, !r.ok);
            if (r.ok || hasConflicts) props.onRestored?.();
          }}
          onCancel={() => setRestoreOf(null)}
        />
      )}
      {/* 拖拽跟随图标：自己绘制的 SVG，拖拽期间替代系统光标 */}
      <ResizeCursor ghostRef={ghostRef} />
    </div>
  );
}
