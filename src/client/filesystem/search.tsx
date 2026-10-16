/** 文件搜索（fs 拆分批次 1-3）：useFileSearch 防抖搜索 hook + FsSearchBox 输入框/结果下拉组件
 *  （下拉贴屏幕右缘/下缘动态宽高，默认 10 条，第 11 行展开/收起全部）。
 *  两种模式（框内芯片切换，localStorage 记住）：
 *   - 'file'    文件名搜索（/api/search，行为与从前完全一致）
 *   - 'content' 文件内容搜索（/api/search-content；命中显示 路径:行号 + 行内容，点击跳预览定位行）
 *  互为独立：一次只搜一种、结果不混（用户定稿——搜文件名字时不想被内容命中污染，反之亦然）。 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { t } from '../../shared/i18n/index.js';
import { get } from '../shared/api.js';
// 命中高亮已提升 shared（仓库浏览搜索共用，边界规范）
import { highlightMatch } from '../shared/highlight-match.js';

/** 内容搜索命中（与服务端 /api/search-content 的 hits 对应）；line 为 1-based */
export interface ContentHit {
  path: string;
  line: number;
  text: string;
}
export type SearchMode = 'file' | 'content';
/** 模式持久化 key：切过一次后下次打开沿用（免得每次都要再点） */
const MODE_KEY = 'fsSearch.mode';
/** 输入框宽度持久化 key（右边缘拖拽调整）与范围 */
const WIDTH_KEY = 'fsSearch.width';
const WIDTH_DEFAULT = 170;
const WIDTH_MIN = 120;
const WIDTH_MAX = 600;

/** 搜索状态 hook：防抖 400ms 调 /api/search（当前目录），返回查询/结果/搜索中/高亮索引/展开态 */
export function useFileSearch(dir: string) {
  const [mode, setModeState] = useState<SearchMode>(() => (localStorage.getItem(MODE_KEY) === 'content' ? 'content' : 'file'));
  const [fileQuery, setFileQuery] = useState('');
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

  useEffect(() => {
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
 *  框内左侧模式芯片切换 文件名 ⇄ 文件内容（placeholder 一起变，防"以为在搜名实为搜内容"） */
export function FsSearchBox(props: { search: FileSearch; onPick: (rel: string, at: number, line?: number) => void }) {
  const { mode, setMode, fileQuery, setFileQuery, nameResults, contentResults, truncated, showResults, setShowResults, searching, activeIdx, setActiveIdx, searchExpanded, setSearchExpanded } = props.search;
  const wrapRef = useRef<HTMLSpanElement | null>(null);
  /** 输入框宽度：右边缘拖拽调整，持久化；越界值（手改 localStorage 等）一律回默认 */
  const [boxWidth, setBoxWidth] = useState(() => {
    const saved = Number(localStorage.getItem(WIDTH_KEY));
    return Number.isFinite(saved) && saved >= WIDTH_MIN && saved <= WIDTH_MAX ? saved : WIDTH_DEFAULT;
  });
  /** 最新宽度（mouseup 落盘 localStorage 用）——事件闭包拿不到最新 state，走 ref */
  const widthRef = useRef(boxWidth);
  const resizeRef = useRef<{ startX: number; startW: number } | null>(null);
  /** 右边缘拖拽：左右移动调宽。拖拽期间定住全页光标/禁选中（鼠标滑出手柄时不闪回默认光标） */
  const onResizeDown = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    resizeRef.current = { startX: e.clientX, startW: widthRef.current };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    const onMove = (ev: MouseEvent) => {
      const d = resizeRef.current;
      if (!d) return;
      const w = Math.min(WIDTH_MAX, Math.max(WIDTH_MIN, d.startW + (ev.clientX - d.startX)));
      widthRef.current = w;
      setBoxWidth(w);
    };
    const onUp = () => {
      resizeRef.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
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

  return (
    <span className="row" style={{ position: 'relative' }}>
      <span style={{ position: 'relative' }} ref={wrapRef}>
        {/* 模式芯片：点击切换。stopPropagation——防冒泡出去被当"点外部"顺带收起下拉 */}
        <span
          className={`search-mode-chip${mode === 'content' ? ' content' : ''}`}
          title={t('fs.search.modeSwitch')}
          onClick={(e) => {
            e.stopPropagation();
            setMode(mode === 'file' ? 'content' : 'file');
          }}
        >
          {mode === 'file' ? t('fs.search.mode.file') : t('fs.search.mode.content')}
        </span>
        <input
          type="text"
          // 🔍 搜索文件… / 🔍 搜索内容…
          placeholder={mode === 'file' ? t('fs.search.placeholder') : t('fs.search.placeholderContent')}
          value={fileQuery}
          onChange={(e) => {
            setFileQuery(e.target.value);
            setActiveIdx(0);
            setSearchExpanded(false);
          }}
          onKeyDown={(e) => {
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
          style={{ width: boxWidth, paddingRight: 24, paddingLeft: 46 }}
        />
        {/* 右边缘拖拽手柄：左右拖调整输入框宽度（宽度记忆，见 onResizeDown） */}
        <span className="search-resize" onMouseDown={onResizeDown} title={t('fs.search.resize')} />
        {/* 右侧同一位置：搜索中转圈 / 否则是清空按钮（不并排占位，避免输入区变窄） */}
        {searching ? (
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
      {(searching || (showResults && fileQuery.trim())) && (
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
