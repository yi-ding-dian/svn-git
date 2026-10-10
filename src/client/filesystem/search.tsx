/** 文件搜索（fs 拆分批次 1-3）：useFileSearch 防抖搜索 hook + FsSearchBox 输入框/结果下拉组件
 * （下拉贴屏幕右缘/下缘动态宽高，默认 10 条，第 11 行展开/收起全部） */
import React, { useEffect, useRef, useState } from 'react';
import { t } from '../../shared/i18n/index.js';
import { get } from '../shared/api.js';

/** 搜索状态 hook：防抖 400ms 调 /api/search（当前目录），返回查询/结果/搜索中/高亮索引/展开态 */
export function useFileSearch(dir: string) {
  const [fileQuery, setFileQuery] = useState('');
  const [searchResults, setSearchResults] = useState<string[]>([]);
  const [showResults, setShowResults] = useState(false);
  /** 搜索中（含 400ms 防抖期）：打字即置位，结果回来才落——否则大仓库上几秒没反应，像卡死 */
  const [searching, setSearching] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const [searchExpanded, setSearchExpanded] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  /** 请求序号：只认最新一次响应。后端慢时"mis→misc"两次请求会并发，
   *  先发的很可能后返回，不做序号校验就会用旧查询的结果覆盖新查询的 —— 结果对不上 */
  const seqRef = useRef(0);

  useEffect(() => {
    const q = fileQuery.trim();
    // 门槛：至少 2 个字符，或 1 个汉字
    const isCn = /[一-鿿]/.test(q); // i18n-ignore: 判定输入是否含中文的逻辑正则（非界面文案）
    if (!q || q.length < (isCn ? 1 : 2)) {
      seqRef.current += 1; // 让在途请求作废（否则它回来还会把结果填上）
      setSearchResults([]);
      setShowResults(false);
      setSearching(false);
      return;
    }
    setSearching(true);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const seq = ++seqRef.current;
      get
        .search(fileQuery, dir)
        .then((r) => {
          if (seq !== seqRef.current) return; // 迟到的旧响应：丢弃
          setSearchResults(r.paths);
          setShowResults(true);
          setSearching(false);
        })
        .catch(() => {
          if (seq === seqRef.current) setSearching(false);
        });
    }, 400);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [fileQuery, dir]);

  return { fileQuery, setFileQuery, searchResults, showResults, setShowResults, searching, activeIdx, setActiveIdx, searchExpanded, setSearchExpanded };
}

/** 把命中的片段包成 <mark>（大小写不敏感，与后端 includes 判定一致） */
function highlightMatch(text: string, q: string): React.ReactNode {
  if (!q) return text;
  const low = text.toLowerCase();
  const lq = q.toLowerCase();
  const out: React.ReactNode[] = [];
  let i = 0;
  let k = 0;
  for (;;) {
    const at = low.indexOf(lq, i);
    if (at < 0) break;
    if (at > i) out.push(text.slice(i, at));
    out.push(
      <mark key={k++} className="search-mark">
        {text.slice(at, at + q.length)}
      </mark>
    );
    i = at + q.length;
  }
  if (out.length === 0) return text;
  out.push(text.slice(i));
  return out;
}
export type FileSearch = ReturnType<typeof useFileSearch>;

/** 搜索输入框 + 结果下拉（受控：状态来自 useFileSearch；选中项回调 onPick） */
export function FsSearchBox(props: { search: FileSearch; onPick: (rel: string, at: number) => void }) {
  const { fileQuery, setFileQuery, searchResults, showResults, setShowResults, searching, activeIdx, setActiveIdx, searchExpanded, setSearchExpanded } = props.search;
  const wrapRef = useRef<HTMLSpanElement | null>(null);

  return (
    <span className="row" style={{ position: 'relative' }}>
      <span style={{ position: 'relative' }} ref={wrapRef}>
        <input
          type="text"
          // 🔍 搜索文件…
          placeholder={t('fs.search.placeholder')}
          value={fileQuery}
          onChange={(e) => {
            setFileQuery(e.target.value);
            setActiveIdx(0);
            setSearchExpanded(false);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActiveIdx((i) => Math.min(searchResults.length - 1, i + 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActiveIdx((i) => Math.max(0, i - 1));
            } else if (e.key === 'Enter') {
              if (searchResults.length > 0) {
                const at = Math.min(activeIdx, searchResults.length - 1);
                props.onPick(searchResults[at]!, at);
              }
            } else if (e.key === 'Escape') {
              setFileQuery('');
              setSearchExpanded(false);
              setShowResults(false);
            }
          }}
          style={{ width: 170, paddingRight: 24 }}
        />
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
            // 无匹配文件
            searchResults.length === 0 && <div className="dim" style={{ padding: '6px 10px' }}>{t('fs.search.none')}</div>
          )}
          {!searching && (searchExpanded ? searchResults : searchResults.slice(0, 10)).map((p, i) => (
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
          {!searching && searchResults.length > 10 && (
            <div
              className="search-item"
              style={{ justifyContent: 'center' }}
              // 收起列表 / 点击展开全部匹配
              title={searchExpanded ? t('fs.search.collapse') : t('fs.search.expand')}
              onClick={() => setSearchExpanded(!searchExpanded)}
            >
              <span className="dim">
                {/* 收起 ▲（共 {n} 项） / … 共 {n} 个匹配（点击展开全部） */}
                {searchExpanded ? t('fs.search.collapsed', { n: searchResults.length }) : t('fs.search.expandAll', { n: searchResults.length })}
              </span>
            </div>
          )}
        </div>
      )}
    </span>
  );
}
