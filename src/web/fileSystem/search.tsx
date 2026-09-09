/** 文件搜索（fs 拆分批次 1-3）：useFileSearch 防抖搜索 hook + FsSearchBox 输入框/结果下拉组件
 * （下拉贴屏幕右缘/下缘动态宽高，默认 10 条，第 11 行展开/收起全部） */
import React, { useEffect, useRef, useState } from 'react';
import { get } from '../api.js';

/** 搜索状态 hook：防抖 400ms 调 /api/search（当前目录），返回查询/结果/高亮索引/展开态 */
export function useFileSearch(dir: string) {
  const [fileQuery, setFileQuery] = useState('');
  const [searchResults, setSearchResults] = useState<string[]>([]);
  const [showResults, setShowResults] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const [searchExpanded, setSearchExpanded] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    const q = fileQuery.trim();
    // 门槛：至少 2 个字符，或 1 个汉字
    const isCn = /[一-鿿]/.test(q);
    if (!q || q.length < (isCn ? 1 : 2)) {
      setSearchResults([]);
      setShowResults(false);
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      get
        .search(fileQuery, dir)
        .then((r) => {
          setSearchResults(r.paths);
          setShowResults(true);
        })
        .catch(() => {});
    }, 400);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [fileQuery, dir]);

  return { fileQuery, setFileQuery, searchResults, showResults, setShowResults, activeIdx, setActiveIdx, searchExpanded, setSearchExpanded };
}
export type FileSearch = ReturnType<typeof useFileSearch>;

/** 搜索输入框 + 结果下拉（受控：状态来自 useFileSearch；选中项回调 onPick） */
export function FsSearchBox(props: { search: FileSearch; onPick: (rel: string, at: number) => void }) {
  const { fileQuery, setFileQuery, searchResults, showResults, setShowResults, activeIdx, setActiveIdx, searchExpanded, setSearchExpanded } = props.search;
  const wrapRef = useRef<HTMLSpanElement | null>(null);

  return (
    <span className="row" style={{ position: 'relative' }}>
      <span style={{ position: 'relative' }} ref={wrapRef}>
        <input
          type="text"
          placeholder="🔍 搜索文件…"
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
        {fileQuery && (
          <button
            className="search-clear"
            title="清空"
            onClick={() => {
              setFileQuery('');
              setShowResults(false);
              setActiveIdx(0);
            }}
          >
            ×
          </button>
        )}
      </span>
      {showResults && fileQuery.trim() && (
        <div
          className="search-drop"
          style={{
            maxWidth: Math.max(260, window.innerWidth - (wrapRef.current?.getBoundingClientRect().left ?? 0) - 12),
            // 最长到屏幕最下方，超出部分在面板内滚动（不越出视口）
            maxHeight: Math.max(120, window.innerHeight - (wrapRef.current?.getBoundingClientRect().bottom ?? 0) - 10),
          }}
        >
          {searchResults.length === 0 && <div className="dim" style={{ padding: '6px 10px' }}>无匹配文件</div>}
          {(searchExpanded ? searchResults : searchResults.slice(0, 10)).map((p, i) => (
            <div
              key={p}
              className={`search-item ${i === activeIdx ? 'active' : ''}`}
              onClick={() => {
                props.onPick(p, i);
                setActiveIdx(i);
              }}
            >
              <span className="dim" style={{ flexShrink: 0 }}>{i + 1}.</span>
              <span className="search-path" title={p}>{p}</span>
            </div>
          ))}
          {searchResults.length > 10 && (
            <div
              className="search-item"
              style={{ justifyContent: 'center' }}
              title={searchExpanded ? '收起列表' : '点击展开全部匹配'}
              onClick={() => setSearchExpanded(!searchExpanded)}
            >
              <span className="dim">
                {searchExpanded ? `收起 ▲（共 ${searchResults.length} 项）` : `… 共 ${searchResults.length} 个匹配（点击展开全部）`}
              </span>
            </div>
          )}
        </div>
      )}
    </span>
  );
}
