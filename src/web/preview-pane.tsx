/** 文件预览面板：文本语法高亮 / 图片 / Markdown 渲染 / 追溯(Blame)，含预览内搜索（/ 激活）。
 *  从 fs.tsx FsView 抽出（保持原行为不变，本组件不依赖文件列表状态）：
 *  - 开关由父级控制：FsView 写入预览目标（每次打开都是新对象）→ 本组件挂载并自行加载内容
 *    （get.cat / get.blame），目标变化即重置 md/blame/搜索/图片放大等内部模式并重新读取。
 *  - 键盘：预览打开期间的按键由本组件处理（/ 开搜索、搜索中 Esc 关搜索、Esc/←/Backspace 返回列表、
 *    其余键吞掉不让列表响应），与列表联动的焦点/滚动/跨行跳转定位逻辑保留在 FsView。
 *  - 错误分两级回调：文本读取失败（致命，退回列表）与展示类错误（图片加载失败，仅红条提示）。 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { get } from './api.js';
import { langOf, highlightLine } from './highlight.js';
import { renderMarkdown } from './markdown.js';

/** 预览目标：{文件名, 相对路径, 状态码?, 是否图片?}；文本内容由面板自行加载 */
export interface PreviewTarget {
  name: string;
  rel: string;
  /** 条目状态码：'?'=未版本化 / 'I'=忽略 → 无提交历史（追溯按钮禁用 + 顶部说明文案） */
  code?: string;
  /** 图片文件：直接显示原图（不经文本读取/diff） */
  img?: boolean;
}

interface Props {
  target: PreviewTarget;
  /** 视图是否激活：预览键盘监听只在激活时生效（与 FsView 键盘一致，防止隐藏时按键穿透误关） */
  active: boolean;
  /** 请求关闭预览（← / Esc / Backspace / 「← 返回列表」按钮） */
  onClose: () => void;
  /** 非致命错误（如图片加载失败）：顶部红条提示，预览保留 */
  onError: (msg: string) => void;
  /** 致命错误（文本读取失败）：父级红条提示并退回列表（对应旧 openFile 读取失败后的行为） */
  onOpenError: (msg: string) => void;
}

export function PreviewPane(props: Props) {
  const { target } = props;
  /** 原文内容（null = 加载中；img 目标不使用） */
  const [text, setText] = useState<string | null>(null);
  // md 文件渲染预览模式（预览按钮切换；false=原文高亮，true=Markdown 渲染）
  const [mdPreview, setMdPreview] = useState(false);
  const [blameMode, setBlameMode] = useState(false);
  const [blameData, setBlameData] = useState<{ rev: string; author: string; date: string; line: number; text: string }[]>([]);
  // 原文预览搜索
  const [searchQ, setSearchQ] = useState('');
  const [searchActive, setSearchActive] = useState(false);
  const [matchIdx, setMatchIdx] = useState(0);
  /** md/图片预览图片放大查看（点击图片 → 全屏显示原图） */
  const [imgViewer, setImgViewer] = useState<string | null>(null);
  const previewRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  /** 顶部说明文案（与旧 openFile 打开时生成的 note 一致；img 目标无说明） */
  const note = target.img ? undefined : target.code === '?' ? '未版本化文件（原文）' : '无差异 — 文件原文';

  // 目标变化（FsView 每次打开都写入新对象）→ 重置内部模式并重新读取内容
  useEffect(() => {
    setMdPreview(false); // 重新打开文件回到原文模式
    setBlameMode(false);
    setBlameData([]);
    setSearchActive(false);
    setSearchQ('');
    setMatchIdx(0);
    setImgViewer(null);
    if (target.img) {
      setText(null);
      return;
    }
    let cancelled = false;
    setText(null); // 进入加载态
    get
      .cat(target.rel)
      .then((r) => {
        if (cancelled) return;
        if (!r.ok) throw new Error(r.error ?? '读取失败');
        setText(r.output);
      })
      .catch((err: Error) => {
        if (!cancelled) props.onOpenError(err.message); // 读取失败：父级红条 + 退回列表（旧 openFile 同款终态）
      });
    return () => {
      cancelled = true;
    };
  }, [target]); // eslint-disable-line react-hooks/exhaustive-deps（target 每次打开都是新对象，必须整引用重置）

  /** md-render 容器点击：目标是图片则放大查看 */
  const onMdRenderClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const t = e.target as HTMLElement;
    if (t.tagName === 'IMG') setImgViewer((t as HTMLImageElement).src);
  };
  useEffect(() => {
    if (!imgViewer) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setImgViewer(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [imgViewer]);

  // 预览键盘（原来在 FsView 键盘 handler 的 preview 分支）：/ 开搜索 · 搜索中 Esc 关搜索 ·
  // Esc/←/Backspace 返回列表 · 其余键吞掉（预览打开时列表键盘不生效）
  const searchActiveRef = useRef(searchActive);
  searchActiveRef.current = searchActive;
  useEffect(() => {
    if (!props.active) return; // 视图隐藏时键盘不响应（防止穿透到其他视图）
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return; // 输入框内不拦截（搜索框自身 onKeyDown 处理 Enter/Esc）
      if (searchActiveRef.current) {
        if (e.key === 'Escape') setSearchActive(false);
        return;
      }
      if (e.key === 'Escape' || e.key === 'ArrowLeft' || e.key === 'Backspace') {
        e.preventDefault();
        props.onClose(); // ← 返回列表
        return;
      }
      if (e.key === '/') {
        e.preventDefault();
        setSearchActive(true);
        setSearchQ('');
        setMatchIdx(0);
        return;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [props.active]); // eslint-disable-line react-hooks/exhaustive-deps（回调 setter 均稳定，无需重复绑定）

  // ---------- 原文预览搜索 ----------
  const previewLines = useMemo(() => (text ?? '').split('\n'), [text]);
  const matches = useMemo(() => {
    if (!searchActive || !searchQ.trim()) return [] as number[];
    const q = searchQ.toLowerCase();
    const out: number[] = [];
    previewLines.forEach((l, i) => {
      if (l.toLowerCase().includes(q)) out.push(i);
    });
    return out;
  }, [previewLines, searchActive, searchQ]);

  const goNextMatch = useCallback(() => {
    if (matches.length === 0) return;
    const next = (matchIdx + 1) % matches.length;
    setMatchIdx(next);
    const el = previewRefs.current.get(matches[next]!);
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [matches, matchIdx]);

  /** 追溯（Blame）：逐行标注提交/作者 */
  const toggleBlame = useCallback(async () => {
    if (blameMode) {
      setBlameMode(false);
      return;
    }
    try {
      const r = await get.blame(target.rel);
      setBlameData(r.lines);
      setBlameMode(true);
    } catch (err) {
      props.onError((err as Error).message);
    }
  }, [blameMode, target.rel, props.onError]);

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <div className="row" style={{ marginBottom: 8, flexWrap: 'wrap' }}>
        <span className="dim">{target.name}</span>
        {note && <span className="small" style={{ color: 'var(--accent)' }}>ℹ {note}</span>}
        {searchActive ? (
          <span className="row" style={{ gap: 6 }}>
            <input
              autoFocus
              type="text"
              placeholder="搜索代码…"
              value={searchQ}
              onChange={(e) => {
                setSearchQ(e.target.value);
                setMatchIdx(0);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') goNextMatch();
                if (e.key === 'Escape') setSearchActive(false);
              }}
              style={{ width: 200 }}
            />
            <span className="dim small">
              {searchQ.trim() && matches.length > 0 ? `${matchIdx + 1}/${matches.length}` : searchQ.trim() ? '无匹配' : ''}
            </span>
            <button className="mini" onClick={goNextMatch}>下一个 ↓</button>
          </span>
        ) : (
          <button className="mini" onClick={() => setSearchActive(true)}>🔍 搜索 (/)</button>
        )}
        <button
          className={`mini ${blameMode ? 'primary' : ''}`}
          disabled={target.code === '?' || target.code === 'I'}
          onClick={() => void toggleBlame()}
          title={
            target.code === '?' || target.code === 'I'
              ? '未版本化/忽略的文件没有提交历史，无法追溯'
              : '逐行标注提交/作者'
          }
        >
          📜 追溯
        </button>
        <span className="grow" />
        {target.name.toLowerCase().endsWith('.md') && (
          <button className="mini" onClick={() => setMdPreview((v) => !v)} title="Markdown 渲染预览">
            {mdPreview ? '📄 查看原文' : '👁 预览'}
          </button>
        )}
        <span className="dim small">← 键返回列表 · / 搜索</span>
        <button className="mini" onClick={props.onClose}>← 返回列表</button>
      </div>
      <div className="diff" style={{ flex: 1, overflow: 'auto' }}>
        {/* 图片预览：直接显示图片（点击放大复用 md-render 的放大机制） */}
        {target.img ? (
          <div
            className="md-render"
            onClick={onMdRenderClick}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100%', padding: 16 }}
          >
            <img
              src={`/api/file?path=${encodeURIComponent(target.rel)}`}
              alt={target.name}
              style={{ maxWidth: '100%', maxHeight: 'calc(100% - 40px)', objectFit: 'contain', borderRadius: 6, cursor: 'zoom-in' }}
              onError={(e) => props.onError(`图片读取失败: ${(e.target as HTMLImageElement).alt}`)}
            />
          </div>
        ) : text === null ? (
          // 文本读取中（旧实现读完才进入预览；抽组件后先挂载面板壳、内容异步加载，失败由 onOpenError 退回列表）
          <div className="loading">
            <div className="spinner" style={{ width: 24, height: 24 }} />
            <div style={{ marginTop: 8 }}>正在加载…</div>
          </div>
        ) : mdPreview && target.name.toLowerCase().endsWith('.md') ? (
          <div
            className="md-render"
            onClick={onMdRenderClick}
            dangerouslySetInnerHTML={{
              __html: renderMarkdown(text, { baseDir: target.rel.includes('/') ? target.rel.slice(0, target.rel.lastIndexOf('/')) : '' }),
            }}
          />
        ) : blameMode ? (
          // Blame 视图：行前缀显示 版本+作者
          blameData.map((b, i) => {
            const isHit = searchActive && matches.includes(i);
            const isCur = isHit && i === matches[matchIdx % Math.max(1, matches.length)];
            return (
              <div
                key={i}
                ref={(el) => {
                  if (el) previewRefs.current.set(i, el);
                }}
                className={`pv-line ${isHit ? 'pv-hit' : ''} ${isCur ? 'pv-cur' : ''}`}
                title={`${b.rev} · ${b.author}${b.date ? ' · ' + b.date : ''}`}
              >
                <span className="blame-meta">{b.rev} {b.author}</span>
                <span dangerouslySetInnerHTML={{ __html: highlightLine(b.text, langOf(target.name)) }} />
              </div>
            );
          })
        ) : (
          previewLines.map((line, i) => {
            const isHit = searchActive && matches.includes(i);
            const isCur = isHit && i === matches[matchIdx % Math.max(1, matches.length)];
            return (
              <div
                key={i}
                ref={(el) => {
                  if (el) previewRefs.current.set(i, el);
                }}
                className={`pv-line ${isHit ? 'pv-hit' : ''} ${isCur ? 'pv-cur' : ''}`}
              >
                <span className="sb-no">{i + 1}</span>
                <span className="pv-src" dangerouslySetInnerHTML={{ __html: highlightLine(line, langOf(target.name)) }} />
              </div>
            );
          })
        )}
      </div>
      {/* 图片放大查看：全屏深色遮罩 + 原图自适应，点击遮罩 / ESC 关闭 */}
      {imgViewer && (
        <div
          className="modal-mask"
          style={{
            background: 'rgba(0,0,0,.78)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'zoom-out',
            zIndex: 500,
          }}
          onClick={() => setImgViewer(null)}
          title="点击关闭（ESC）"
        >
          <img
            src={imgViewer}
            style={{ maxWidth: '92vw', maxHeight: '92vh', objectFit: 'contain', borderRadius: 8, boxShadow: '0 12px 48px rgba(0,0,0,.55)' }}
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}
