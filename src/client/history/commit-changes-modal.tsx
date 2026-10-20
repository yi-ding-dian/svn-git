/** 提交文件变动详情弹窗：左侧变更文件列表，右侧差异（复用 DiffView 的嵌入/只读模式）。
 *
 *  顶部下拉可在已加载的历史里切换提交——列表条目自带 changed，切提交不用再请求文件清单。
 *  提交之间的差异一律相对第一父（合并提交取 `rev^`），与历史行里的文件数口径一致；
 *  根提交没有父，用 Git 空树对象作为"前一版本"（差异表现为整文件新增）。 */
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { ResizableModal } from '../shell/modal-shell.js';
import { DiffView } from './diff.js';
import { isBinaryFile } from '../shared/utils.js';
import { IconResizeHorizontal } from '../ui/icons.js';
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
  onClose: () => void;
  onToast?: (msg: string, err?: boolean) => void;
}) {
  const [rev, setRev] = useState(props.initialRev);
  const entry = useMemo(() => props.logs.find((l) => l.rev === rev) ?? null, [props.logs, rev]);
  /** 用户点选的文件；切提交后若该路径不在新提交里，自动回退到第一个变更文件 */
  const [picked, setPicked] = useState<string | null>(null);
  const path = entry?.changed.some((c) => c.path === picked) ? picked : (entry?.changed[0]?.path ?? null);
  /** 前一版本：合并提交取第一父；根提交用空树 */
  const before = entry?.isRoot ? EMPTY_TREE : `${rev}^`;
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
  /** 拖拽时跟随鼠标的图标（自己画的 SVG，DOM 直接定位，避免 mousemove 触发整窗重渲染） */
  const ghostRef = useRef<HTMLSpanElement | null>(null);
  const moveGhost = (x: number, y: number) => {
    const g = ghostRef.current;
    if (!g) return;
    // 图标居中压在鼠标点上（浮层 24×24）：与按下时手柄图标的位置衔接，不显得"跳走"
    g.style.display = 'flex';
    g.style.left = `${x - 12}px`;
    g.style.top = `${y - 12}px`;
  };

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
    document.body.classList.add('files-resizing');
    moveGhost(e.clientX, e.clientY);
    const onMove = (ev: MouseEvent) => {
      moveGhost(ev.clientX, ev.clientY);
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
      document.body.classList.remove('files-resizing');
      if (ghostRef.current) ghostRef.current.style.display = 'none';
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
                  {l.rev} · {l.msg}
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
                    >
                      <span className={`act ${c.action}`}>{c.action}</span>
                      <span
                        className="mono"
                        style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                      >
                        {c.path}
                      </span>
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
      {/* 拖拽跟随图标：自己绘制的 SVG，拖拽期间替代系统光标 */}
      <span ref={ghostRef} className="files-resize-ghost" aria-hidden="true">
        <IconResizeHorizontal size={14} />
      </span>
    </div>
  );
}
