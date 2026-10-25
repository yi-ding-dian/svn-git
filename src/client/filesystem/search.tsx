/** 文件搜索（fs 拆分批次 1-3）：useFileSearch 防抖搜索 hook + FsSearchBox 输入框/结果下拉组件
 *  （下拉贴屏幕右缘/下缘动态宽高，默认 10 条，第 11 行展开/收起全部）。
 *  两种模式（框内芯片切换，localStorage 记住）：
 *   - 'file'    文件名搜索（/api/search，行为与从前完全一致）
 *   - 'content' 文件内容搜索（/api/search-content；命中显示 路径:行号 + 行内容，点击跳预览定位行）
 *  互为独立：一次只搜一种、结果不混（用户定稿——搜文件名字时不想被内容命中污染，反之亦然）。 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { t } from '../../shared/i18n/index.js';
import type { LineCondition } from '../../shared/types.js';
import { get } from '../shared/api.js';
import { isImeComposing } from '../shared/utils.js';
import { ResizeCursor, useResizeCursor } from '../shared/use-resize-cursor.js';
import { Tooltip } from '../ui/tooltip.js';
import { ContextMenu, type CtxMenuItem } from '../ui/context-menu.js';
// 命中高亮已提升 shared（仓库浏览搜索共用，边界规范）
import { highlightMatch } from '../shared/highlight-match.js';
import { parseLineCondition, sanitizeLineQuery, sameLineCondition } from './utils.js';
import type { LineScanState } from './line-filter.js';

/** 内容搜索命中（与服务端 /api/search-content 的 hits 对应）；line 为 1-based */
export interface ContentHit {
  path: string;
  line: number;
  text: string;
}
export type SearchMode = 'file' | 'content' | 'lineCount';
/** 非行数模式：记住它，退出行数模式时恢复（行数模式不参与「文件 ⇄ 内容」互切） */
type TextSearchMode = Exclude<SearchMode, 'lineCount'>;
/** 模式持久化 key：切过一次后下次打开沿用（免得每次都要再点） */
const MODE_KEY = 'fsSearch.mode';
/** 输入框宽度持久化 key（右边缘拖拽调整）与范围 */
const WIDTH_KEY = 'fsSearch.width';
const WIDTH_DEFAULT = 170;
const WIDTH_MIN = 120;
const WIDTH_MAX = 600;

/** 搜索状态 hook：防抖 400ms 调 /api/search（当前目录），返回查询/结果/搜索中/高亮索引/展开态。
 *  第三模式「行数」不在这里发请求：阈值输入是手动确认的（见 line-filter.tsx 的 useLineScan）。 */
export function useFileSearch(dir: string) {
  const [mode, setModeState] = useState<SearchMode>(() => {
    const saved = localStorage.getItem(MODE_KEY);
    return saved === 'content' || saved === 'lineCount' ? saved : 'file';
  });
  /** 行数模式记住上一个文本模式：退出时回到它，而不是固定回「文件」 */
  const prevModeRef = useRef<TextSearchMode>(mode === 'lineCount' ? 'file' : mode);
  const [fileQuery, setFileQuery] = useState('');
  /** 行数阈值输入与文件名/内容查询分开存：切模式不互相覆盖 */
  const [lineQuery, setLineQueryState] = useState('');
  const [nameResults, setNameResults] = useState<string[]>([]);
  const [contentResults, setContentResults] = useState<ContentHit[]>([]);
  const [truncated, setTruncated] = useState<'limit' | 'time' | undefined>(undefined);
  const [showResults, setShowResults] = useState(false);
  /** 搜索中（含 400ms 防抖期）：打字即置位，结果回来才落——否则大仓库上几秒没反应，像卡死 */
  const [searching, setSearching] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const [searchExpanded, setSearchExpanded] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  /** 请求序号：只认最新一次响应。后端慢时"mis→misc"两次请求会并发，
   *  先发的很可能后返回，不做序号校验就会用旧查询的结果覆盖新查询的 —— 结果对不上 */
  const seqRef = useRef(0);
  /** 内容搜索的在途请求（最重的操作）：输入变化/清空/切模式时 abort —— 后端 req close 停止扫描，
   *  不为作废的查询白烧 CPU（文件名搜索快，只靠 seq 校验即可，无需 abort） */
  const abortRef = useRef<AbortController | null>(null);

  const setMode = useCallback((m: SearchMode) => {
    if (m !== 'lineCount') prevModeRef.current = m;
    localStorage.setItem(MODE_KEY, m);
    setModeState(m);
    // 切换即清空另一模式的结果：旧模式的命中绝不能在新模式下闪现（不污染）
    abortRef.current?.abort();
    setNameResults([]);
    setContentResults([]);
    setTruncated(undefined);
    setActiveIdx(0);
    setSearchExpanded(false);
    setShowResults(false);
  }, []);

  /** 行数输入只留 < / > 和数字（粘贴 >=100 之类的写法时 = 会被丢掉） */
  const setLineQuery = useCallback((value: string) => setLineQueryState(sanitizeLineQuery(value)), []);

  /** 退出行数模式：清空阈值并回到上一个文本模式（文件/内容） */
  const exitLineMode = useCallback(() => {
    setLineQueryState('');
    setMode(prevModeRef.current);
  }, [setMode]);

  useEffect(() => {
    // 行数模式不走文件名/内容搜索：清掉旧结果，避免行数树下面还挂着上一轮命中
    if (mode === 'lineCount') {
      seqRef.current += 1;
      abortRef.current?.abort();
      setNameResults([]);
      setContentResults([]);
      setTruncated(undefined);
      setShowResults(false);
      setSearching(false);
      return;
    }
    const q = fileQuery.trim();
    // 门槛：至少 2 个字符，或 1 个汉字
    const isCn = /[一-鿿]/.test(q); // i18n-ignore: 判定输入是否含中文的逻辑正则（非界面文案）
    if (!q || q.length < (isCn ? 1 : 2)) {
      seqRef.current += 1; // 让在途请求作废（否则它回来还会把结果填上）
      abortRef.current?.abort();
      setNameResults([]);
      setContentResults([]);
      setTruncated(undefined);
      setShowResults(false);
      setSearching(false);
      return;
    }
    setSearching(true);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const seq = ++seqRef.current;
      const fail = () => {
        if (seq === seqRef.current) setSearching(false);
      };
      if (mode === 'file') {
        get
          .search(fileQuery, dir)
          .then((r) => {
            if (seq !== seqRef.current) return; // 迟到的旧响应：丢弃
            setNameResults(r.paths);
            setShowResults(true);
            setSearching(false);
          })
          .catch(fail);
      } else {
        abortRef.current?.abort(); // 取消上一次仍在扫的内容搜索
        const ac = new AbortController();
        abortRef.current = ac;
        get
          .searchContent(fileQuery, dir, ac.signal)
          .then((r) => {
            if (seq !== seqRef.current) return;
            setContentResults(r.hits);
            setTruncated(r.truncated);
            setShowResults(true);
            setSearching(false);
          })
          .catch(fail);
      }
    }, 400);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [fileQuery, dir, mode]);

  // 卸载（切项目/离开文件视图）：杀掉在途内容搜索
  useEffect(() => () => abortRef.current?.abort(), []);

  return {
    mode,
    setMode,
    fileQuery,
    setFileQuery,
    lineQuery,
    setLineQuery,
    exitLineMode,
    nameResults,
    contentResults,
    truncated,
    showResults,
    setShowResults,
    searching,
    activeIdx,
    setActiveIdx,
    searchExpanded,
    setSearchExpanded,
  };
}

/** 把命中的片段包成 <mark>（大小写不敏感，与后端 includes 判定一致）。
 *  已提升到 shared/highlight-match.tsx（文件浏览器与仓库浏览共用）——此处 import 使用 */
export type FileSearch = ReturnType<typeof useFileSearch>;

/** 搜索输入框 + 结果下拉（受控：状态来自 useFileSearch；选中项回调 onPick）；
 *  框内左侧模式芯片点击弹出 文件 / 内容 / 行数；行数模式手动确认后才扫描，
 *  结果不落在下拉里，而是接管主列表区（见 line-filter.tsx）。 */
export function FsSearchBox(props: {
  search: FileSearch;
  lineScan: LineScanState;
  /** 点确定：父组件先切树视图，再调用 lineScan.scan */
  onLineStart: (condition: LineCondition) => void;
  /** 离开行数模式：重置扫描结果并恢复进入前的视图（不改变搜索模式） */
  onLineExit: () => void;
  onPick: (rel: string, at: number, line?: number) => void;
}) {
  const { mode, setMode, fileQuery, setFileQuery, lineQuery, setLineQuery, exitLineMode, nameResults, contentResults, truncated, showResults, setShowResults, searching, activeIdx, setActiveIdx, searchExpanded, setSearchExpanded } = props.search;
  const lineScan = props.lineScan;
  const isLine = mode === 'lineCount';
  const lineCondition = isLine ? parseLineCondition(lineQuery) : null;
  const isScanning = lineScan.status === 'scanning';
  /** 已扫过同一条件 → 按钮变「重新扫描」；输入改了 → 高亮「确定」提示要重扫 */
  const isRescan = !isScanning && !!lineCondition && sameLineCondition(lineCondition, lineScan.condition) && lineScan.status === 'done';
  const needsRescan = !isScanning && !!lineCondition && !!lineScan.condition && !sameLineCondition(lineCondition, lineScan.condition);
  const [modeMenu, setModeMenu] = useState<{ x: number; y: number } | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const wrapRef = useRef<HTMLSpanElement | null>(null);
  /** 输入框宽度：右边缘拖拽调整，持久化；越界值（手改 localStorage 等）一律回默认 */
  const [boxWidth, setBoxWidth] = useState(() => {
    const saved = Number(localStorage.getItem(WIDTH_KEY));
    return Number.isFinite(saved) && saved >= WIDTH_MIN && saved <= WIDTH_MAX ? saved : WIDTH_DEFAULT;
  });
  /** 最新宽度（mouseup 落盘 localStorage 用）——事件闭包拿不到最新 state，走 ref */
  const widthRef = useRef(boxWidth);
  const resizeRef = useRef<{ startX: number; startW: number } | null>(null);
  /** 统一的分隔条拖拽光标（所有可调整尺寸的分隔条共用） */
  const { ghostRef, start: startResizeCursor, move: moveResizeCursor, stop: stopResizeCursor } = useResizeCursor();
  /** 右边缘拖拽：左右移动调宽。拖拽期间隐藏系统光标、由应用内图标跟随 */
  const onResizeDown = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    resizeRef.current = { startX: e.clientX, startW: widthRef.current };
    startResizeCursor(e.clientX, e.clientY);
    const onMove = (ev: MouseEvent) => {
      moveResizeCursor(ev.clientX, ev.clientY);
      const d = resizeRef.current;
      if (!d) return;
      const w = Math.min(WIDTH_MAX, Math.max(WIDTH_MIN, d.startW + (ev.clientX - d.startX)));
      widthRef.current = w;
      setBoxWidth(w);
    };
    const onUp = () => {
      resizeRef.current = null;
      stopResizeCursor();
      localStorage.setItem(WIDTH_KEY, String(widthRef.current));
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };
  /** 当前模式的结果数（键盘导航/展开行共用；两模式互斥，一次只有一组结果） */
  const count = mode === 'file' ? nameResults.length : contentResults.length;
  /** 选中第 i 个结果：文件模式定位文件；内容模式定位文件 + 打开预览并跳到命中行 */
  const pickAt = (i: number) => {
    if (mode === 'file') {
      const rel = nameResults[i];
      if (rel != null) props.onPick(rel, i);
    } else {
      const h = contentResults[i];
      if (h) props.onPick(h.path, i, h.line);
    }
  };

  const modeLabel = (m: SearchMode): string =>
    m === 'file' ? t('fs.search.mode.file') : m === 'content' ? t('fs.search.mode.content') : t('fs.search.mode.lineCount');
  const modeDesc = (m: SearchMode): string =>
    m === 'file'
      ? t('fs.search.mode.fileDesc')
      : m === 'content'
        ? t('fs.search.mode.contentDesc')
        : t('fs.search.mode.lineCountDesc');
  /** 选模式：离开行数时先收掉扫描结果并恢复视图；进入行数时把光标放进输入框 */
  const chooseMode = (m: SearchMode) => {
    setModeMenu(null);
    if (m === mode) return;
    if (isLine) {
      props.onLineExit();
      // 与 Esc/「全部」同一口径：离开行数模式就清空阈值，下次进来是空输入
      props.search.exitLineMode();
    }
    setMode(m);
    if (m === 'lineCount') setTimeout(() => inputRef.current?.focus(), 0);
  };
  const openModeMenu = (e: React.MouseEvent) => {
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setModeMenu({ x: rect.left, y: rect.bottom + 4 });
  };
  const modeItems: CtxMenuItem[] = (['file', 'content', 'lineCount'] as SearchMode[]).map((m) => ({
    // 勾选放图标列：三个名字左对齐；右侧小字说明填掉原本的横向空白
    icon: mode === m ? '✓' : '',
    label: modeLabel(m),
    desc: modeDesc(m),
    action: () => chooseMode(m),
  }));

  return (
    <span className="row" style={{ position: 'relative' }}>
      <ResizeCursor ghostRef={ghostRef} />
      <span style={{ position: 'relative' }} ref={wrapRef}>
        {/* 模式芯片：点击弹列表选择 文件 / 内容 / 行数（三段式会把输入框挤窄，用菜单更省地方） */}
        <Tooltip content={t('fs.search.modeSwitch')}>
          <span className={`search-mode-chip${mode === 'content' ? ' content' : ''}${isLine ? ' line' : ''}`} onClick={openModeMenu}>
            {modeLabel(mode)} ▾
          </span>
        </Tooltip>
        <input
          ref={inputRef}
          type="text"
          // 🔍 搜索文件… / 🔍 搜索内容… / 输入行数，如 1000
          placeholder={
            isLine ? t('fs.line.placeholder') : mode === 'file' ? t('fs.search.placeholder') : t('fs.search.placeholderContent')
          }
          value={isLine ? lineQuery : fileQuery}
          onChange={(e) => {
            if (isLine) {
              setLineQuery(e.target.value);
              return;
            }
            setFileQuery(e.target.value);
            setActiveIdx(0);
            setSearchExpanded(false);
          }}
          onKeyDown={(e) => {
            if (isImeComposing(e)) return;
            if (isLine) {
              if (e.key === 'Enter') {
                e.preventDefault();
                if (!isScanning && lineCondition) props.onLineStart(lineCondition);
              } else if (e.key === 'Escape') {
                e.preventDefault();
                props.onLineExit();
                exitLineMode();
              }
              return;
            }
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActiveIdx((i) => Math.min(count - 1, i + 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActiveIdx((i) => Math.max(0, i - 1));
            } else if (e.key === 'Enter') {
              if (count > 0) pickAt(Math.min(activeIdx, count - 1));
            } else if (e.key === 'Escape') {
              setFileQuery('');
              setSearchExpanded(false);
              setShowResults(false);
            }
          }}
          style={{ width: boxWidth, paddingRight: isLine ? 58 : 24, paddingLeft: 52 }}
        />
        {/* 右边缘拖拽手柄：左右拖调整输入框宽度（宽度记忆，见 onResizeDown） */}
        <span className="search-resize" onMouseDown={onResizeDown} title={t('fs.search.resize')} />
        {/* 右侧同一位置：行数模式的确认/取消 / 普通搜索的转圈与清空（不并排占位，避免输入区变窄） */}
        {isLine ? (
          <button
            className={`search-confirm${needsRescan ? ' primary' : ''}`}
            disabled={!isScanning && !lineCondition}
            title={isScanning ? t('fs.line.cancel') : isRescan ? t('fs.line.rescan') : t('fs.line.confirm')}
            onClick={() => {
              if (isScanning) lineScan.cancel();
              else if (lineCondition) props.onLineStart(lineCondition);
            }}
          >
            {isScanning ? t('fs.line.cancel') : isRescan ? t('fs.line.rescan') : t('fs.line.confirm')}
          </button>
        ) : searching ? (
          // 正在搜索…
          <span className="search-spin search-box-spin" title={t('fs.search.searching')} />
        ) : (
          fileQuery && (
            <button
              className="search-clear"
              // 清空
              title={t('fs.search.clear')}
              onClick={() => {
                setFileQuery('');
                setShowResults(false);
                setActiveIdx(0);
              }}
            >
              ×
            </button>
          )
        )}
      </span>
      {/* 行数语法的完整说明：placeholder 放不下这么长，扫过一次后头部会显示解析结果，就不再浮着了 */}
      {isLine && !lineScan.started && <span className="search-line-hint">{t('fs.line.hint')}</span>}
      {modeMenu && (
        <ContextMenu
          x={modeMenu.x}
          y={modeMenu.y}
          items={modeItems}
          onClose={() => setModeMenu(null)}
          mask
        />
      )}
      {!isLine && (searching || (showResults && fileQuery.trim())) && (
        <div
          className="search-drop"
          style={{
            maxWidth: Math.max(260, window.innerWidth - (wrapRef.current?.getBoundingClientRect().left ?? 0) - 12),
            // 最长到屏幕最下方，超出部分在面板内滚动（不越出视口）
            maxHeight: Math.max(120, window.innerHeight - (wrapRef.current?.getBoundingClientRect().bottom ?? 0) - 10),
          }}
        >
          {searching ? (
            // 搜索中不显示上一轮的结果：那些结果对应当前查询之外的输入，显示出来只会误导
            <div className="dim row" style={{ padding: '6px 10px', gap: 6, alignItems: 'center' }}>
              {/* 正在搜索… */}
              <span className="search-spin" /> {t('fs.search.searching')}
            </div>
          ) : (
            // 无匹配：文件名 / 内容
            count === 0 && <div className="dim" style={{ padding: '6px 10px' }}>{mode === 'file' ? t('fs.search.none') : t('fs.search.noneContent')}</div>
          )}
          {!searching &&
            mode === 'file' &&
            (searchExpanded ? nameResults : nameResults.slice(0, 10)).map((p, i) => (
              <div
                key={p}
                className={`search-item ${i === activeIdx ? 'active' : ''}`}
                onClick={() => {
                  props.onPick(p, i);
                  setActiveIdx(i);
                }}
              >
                <span className="dim" style={{ flexShrink: 0 }}>{i + 1}.</span>
                <span className="search-path" title={p}>{highlightMatch(p, fileQuery.trim())}</span>
              </div>
            ))}
          {!searching &&
            mode === 'content' &&
            (searchExpanded ? contentResults : contentResults.slice(0, 10)).map((h, i) => (
              <div
                key={`${h.path}:${h.line}`}
                className={`search-item ${i === activeIdx ? 'active' : ''}`}
                onClick={() => {
                  pickAt(i);
                  setActiveIdx(i);
                  setShowResults(false); // 打开预览后收起下拉（否则悬在预览上挡内容）；输入词保留，可继续改
                }}
                title={`${h.path}:${h.line}`}
              >
                <span className="dim" style={{ flexShrink: 0 }}>{i + 1}.</span>
                {/* 路径:行号 + 行内容（命中词两处都高亮） */}
                <span className="search-path search-hit-at">{highlightMatch(h.path, fileQuery.trim())}:{h.line}</span>
                <span className="search-line-text">{highlightMatch(h.text, fileQuery.trim())}</span>
              </div>
            ))}
          {!searching && count > 10 && (
            <div
              className="search-item"
              style={{ justifyContent: 'center' }}
              // 收起列表 / 点击展开全部匹配
              title={searchExpanded ? t('fs.search.collapse') : t('fs.search.expand')}
              onClick={() => setSearchExpanded(!searchExpanded)}
            >
              <span className="dim">
                {/* 收起 ▲（共 {n} 项） / … 共 {n} 个匹配（点击展开全部） */}
                {searchExpanded ? t('fs.search.collapsed', { n: count }) : t('fs.search.expandAll', { n: count })}
              </span>
            </div>
          )}
          {/* 结果被截断（命中满 200 / 扫描超时 / 候选超 5 万）：说清楚只显示了部分 */}
          {!searching && mode === 'content' && truncated && (
            <div className="dim" style={{ padding: '4px 10px' }}>
              {truncated === 'time' ? t('fs.search.truncatedTime', { n: count }) : t('fs.search.truncatedLimit', { n: count })}
            </div>
          )}
        </div>
      )}
    </span>
  );
}
