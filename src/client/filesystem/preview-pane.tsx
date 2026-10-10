/** 文件预览面板：文本语法高亮 / 图片 / Markdown 渲染 / 追溯(Blame)，含预览内搜索（/ 激活）。
 *  从 fs.tsx FsView 抽出（保持原行为不变，本组件不依赖文件列表状态）：
 *  - 开关由父级控制：FsView 写入预览目标（每次打开都是新对象）→ 本组件挂载并自行加载内容
 *    （get.cat / get.blame），目标变化即重置 md/blame/搜索/图片放大等内部模式并重新读取。
 *  - 键盘：预览打开期间的按键由本组件处理（/ 开搜索、搜索中 Esc 关搜索、Esc/←/Backspace 返回列表、
 *    其余键吞掉不让列表响应），与列表联动的焦点/滚动/跨行跳转定位逻辑保留在 FsView。
 *  - 错误分两级回调：文本读取失败（致命，退回列表）与展示类错误（图片加载失败，仅红条提示）。 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { get, post } from '../shared/api.js';
import { ContextMenu, type CtxMenuItem } from '../ui/context-menu.js';
import { AppIcon } from '../ui/ui.js';
import { IconExternal } from '../ui/icons.js';
import { langOf, highlightLine } from '../shared/highlight.js';
import { renderMarkdown } from '../shared/markdown.js';
import { MdThemePopover, loadMdTheme, saveMdTheme, mdThemeVars, mdThemeName } from './md-theme.js';

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
  /** 内联编辑保存成功：父级据此刷新列表（文件状态会从干净变成 M）并提示 */
  onSaved?: (msg: string) => void;
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
  /** 内联编辑：编辑框内容 + 是否在编辑中 + 保存后重读的触发键（target 没变，只能靠它） */
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  /** 原文的行尾风格：**textarea 会把 CRLF 规范化成 LF**（浏览器行为），保存前得按这个还原，
   *  否则 CRLF 文件存一次就变成整文件 diff —— 用户会以为工具把他的文件改乱了 */
  const eolRef = useRef('\n');
  /** 编辑态行号列：与 textarea 同步滚动的独立一列（textarea 里塞不了行号元素）。
   *  行数与行高都和 textarea 严格一致，所以 scrollTop 直接照搬就对得上 */
  const editTaRef = useRef<HTMLTextAreaElement | null>(null);
  const editNumsRef = useRef<HTMLDivElement | null>(null);
  const syncEditScroll = () => {
    if (editNumsRef.current && editTaRef.current) editNumsRef.current.scrollTop = editTaRef.current.scrollTop;
  };
  /** 「编辑」的程序选择菜单：点按钮时按扩展名拉一次可选程序 */
  const [editMenu, setEditMenu] = useState<{ x: number; y: number; items: CtxMenuItem[] } | null>(null);
  const openEditMenu = async (ev: React.MouseEvent) => {
    const ext = props.target.name.split('.').pop()?.toLowerCase() ?? '';
    let apps: { name: string; exec: string; icon: string }[] = [];
    let chooseOpen: string | null | undefined;
    try {
      const r = await get.appsFor(ext);
      apps = r.apps ?? [];
      chooseOpen = r.chooseOpen;
    } catch {
      /* 探测失败就只留"系统默认程序"那一项，别把按钮点死 */
    }
    const run = (exec: string) => {
      setEditMenu(null);
      void post
        .openWith(props.target.rel, exec)
        .then((x) => {
          if (!x.ok) props.onError(x.message || '打开失败');
        })
        .catch((e: Error) => props.onError(`打开失败: ${e.message}`));
    };
    const items: CtxMenuItem[] = [
      // 第一项：工具内直接改（改完就能提交，不用切出去）。
      // **只给"读全了的 UTF-8"**：
      //  ① 非 UTF-8（用户决策）：编码是"不是合法 UTF-8 就当 GB18030"猜出来的 —— 猜错时（日文/繁体/韩文）
      //     内容看着像正常汉字、改完保存却把原编码毁掉；真 GBK 与猜错的在探测层**无法区分**。
      //  ② 超限文件：正文是占位符不是真内容，保存会把占位符写进文件。
      // 两种都只走下面的外部程序（它们认编码更准、也不受我们的大小限制）。
      ...(fileEnc || fileTruncated ? [] : [{ label: '✎ 直接编辑', action: startEdit }, { sep: true } as CtxMenuItem]),
      // 想用外部编辑器时再往下选。**不替用户自动选默认程序**：不少系统上 .md/.txt 默认关联的是
      // 浏览器或只读预览器，直接点下去等于什么也改不了
      {
        icon: <IconExternal />,
        label: '用系统默认程序打开',
        // 不给内联编辑时得说明原因，别让用户以为是功能坏了
        title: fileTruncated
          ? '文件过大（超过 5MB），未读取全文，不支持内联编辑；请用外部程序打开'
          : fileEnc
            ? `该文件是 ${fileEnc} 编码，不支持内联编辑（怕改坏原编码）`
            : undefined,
        action: () => run(''),
      },
      ...(apps.length ? [{ sep: true } as CtxMenuItem] : []),
      // 程序图标与右键「打开方式…」同源（/api/icon 按 .desktop 的 Icon 名查），取不到会回退通用文件图标
      ...apps.slice(0, 6).map((a) => ({ icon: <AppIcon icon={a.icon} />, label: a.name, action: () => run(a.exec) })),
      ...(chooseOpen
        ? [
            { sep: true } as CtxMenuItem,
            { icon: <IconExternal />, label: '选择其他应用…', action: () => run(chooseOpen!) },
          ]
        : []),
    ];
    setEditMenu({ x: ev.clientX, y: ev.clientY, items });
  };
  /** 全屏浏览：面板浮到最上层铺满窗口（长文阅读用）。只切 className，DOM 不重挂 → 滚动位置不丢 */
  const [full, setFull] = useState(false);
  /** md 阅读主题（只染文档区，与界面主题无关）；localStorage 持久化，「跟随界面」= 'follow' */
  const [mdTheme, setMdTheme] = useState(loadMdTheme);
  /** md 主题气泡位置（null = 未打开） */
  const [mdThemePop, setMdThemePop] = useState<{ x: number; y: number } | null>(null);
  const previewRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  /** 顶部说明文案（与旧 openFile 打开时生成的 note 一致；img 目标无说明） */
  const note = target.img ? undefined : target.code === '?' ? '未版本化文件（原文）' : '无差异 — 文件原文';
  /** 非 UTF-8 文件（GBK 等）的编码提示：不提示的话，用户会以为文件本来就是 UTF-8 */
  const [fileEnc, setFileEnc] = useState('');
  /** 超大文件（>5MB）：正文是"（文件过大，未读取全文）"**占位符**而非真内容，
   *  拿去编辑保存就会把这句话写进文件 —— 和 fileEnc 一样不给内联编辑 */
  const [fileTruncated, setFileTruncated] = useState(false);
  const isMd = target.name.toLowerCase().endsWith('.md');
  /** md 阅读主题的 inline 变量（只打给 md 的预览容器；「跟随界面」为 undefined 不覆盖） */
  const mdVars = isMd ? mdThemeVars(mdTheme) : undefined;

  // 目标变化（FsView 每次打开都写入新对象）→ 重置内部模式并重新读取内容
  useEffect(() => {
    setMdPreview(false); // 重新打开文件回到原文模式
    setFull(false); // 重新打开文件退出全屏（换文件后满窗弹着会不知道在看哪个）
    setMdThemePop(null); // 关掉可能开着的 md 主题气泡（主题本身是持久偏好，不重置）
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
    setFileEnc('');
    setFileTruncated(false);
    get
      .cat(target.rel)
      .then((r) => {
        if (cancelled) return;
        if (!r.ok) throw new Error(r.error ?? '读取失败');
        setFileEnc(r.encoding ?? '');
        setFileTruncated(!!r.truncated);
        eolRef.current = r.output.includes('\r\n') ? '\r\n' : '\n'; // 记下原文行尾
        setText(r.output);
      })
      .catch((err: Error) => {
        if (!cancelled) props.onOpenError(err.message); // 读取失败：父级红条 + 退回列表（旧 openFile 同款终态）
      });
    return () => {
      cancelled = true;
    };
  }, [target, reloadKey]); // eslint-disable-line react-hooks/exhaustive-deps -- target 每次打开都是新对象；reloadKey 用于保存后重读

  /** 进入内联编辑（「编辑」菜单的第一项）。**只对 UTF-8 开**，原因见 openEditMenu */
  const startEdit = () => {
    setEditMenu(null);
    // 纵深防御：菜单里已经不给非 UTF-8 这一项了，这里再挡一道
    // （fileEnc 要等内容读完才有，万一它在菜单渲染之后才到，菜单里会短暂出现这一项）
    if (fileEnc) {
      props.onError(`该文件是 ${fileEnc} 编码，不支持内联编辑（怕改坏原编码）；请用外部程序打开`);
      return;
    }
    if (fileTruncated) {
      props.onError('文件过大（超过 5MB），未读取全文，不支持内联编辑；请用外部程序打开');
      return;
    }
    setDraft(text ?? '');
    setEditing(true);
  };
  /** 保存：行尾还原成原文风格 → 后端按原编码写回 → 重读内容 + 通知父级刷新列表 */
  const saveEdit = () => {
    const content = draft.replace(/\r?\n/g, eolRef.current);
    void post
      .writeFile(props.target.rel, content)
      .then((r) => {
        if (!r.ok) {
          props.onError(r.message || '保存失败');
          return;
        }
        setEditing(false);
        setReloadKey((k) => k + 1);
        props.onSaved?.(r.message || '已保存');
      })
      .catch((e: Error) => props.onError(`保存失败: ${e.message}`));
  };

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
  const fullRef = useRef(full);
  fullRef.current = full;
  const mdPopRef = useRef(mdThemePop);
  mdPopRef.current = mdThemePop;
  useEffect(() => {
    if (!props.active) return; // 视图隐藏时键盘不响应（防止穿透到其他视图）
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return; // 输入框内不拦截（搜索框自身 onKeyDown 处理 Enter/Esc）
      if (mdPopRef.current) {
        if (e.key === 'Escape') setMdThemePop(null); // 气泡开着：Esc 只关气泡，不连预览一起关
        return;
      }
      if (searchActiveRef.current) {
        if (e.key === 'Escape') setSearchActive(false);
        return;
      }
      if (fullRef.current && e.key === 'Escape') {
        e.preventDefault();
        setFull(false); // 全屏下 Esc 先退全屏（←/Backspace 仍是返回列表）
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
  }, [props.active]); // eslint-disable-line react-hooks/exhaustive-deps -- 回调 setter 均稳定，无需重复绑定

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
    <div className={full ? 'pv-full' : undefined} style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <div className="row" style={{ marginBottom: full ? 0 : 8, flexWrap: 'wrap' }}>
        <span className="dim">{target.name}</span>
        {note && <span className="small" style={{ color: 'var(--accent)' }}>ℹ {note}</span>}
        {fileEnc && (
          <span className="small dim" title="该文件不是 UTF-8 编码，预览按此编码解码显示；保存时会按原编码写回">
            🈚 按 {fileEnc.toUpperCase()} 解码
          </span>
        )}
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
        {!editing && (
          <>
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
        {isMd && (
          <button
            className={`mini ${mdTheme !== 'follow' ? 'primary' : ''}`}
            title="md 阅读主题：只改文档区配色，界面主题不受影响"
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              setMdThemePop({ x: r.left, y: r.bottom + 4 });
            }}
          >
            🎨 主题{mdTheme === 'follow' ? '' : ` · ${mdThemeName(mdTheme)}`}
          </button>
        )}
        <span className="grow" />
        <button
          className={`mini ${full ? 'primary' : ''}`}
          onClick={() => setFull((v) => !v)}
          title={full ? '退出全屏（Esc）' : '铺满窗口阅读长文，Esc 退出'}
        >
          ⛶ {full ? '退出全屏' : '全屏浏览'}
        </button>
        {isMd && (
          <button className="mini" onClick={() => setMdPreview((v) => !v)} title="Markdown 渲染预览">
            {mdPreview ? '📄 查看原文' : '👁 预览'}
          </button>
        )}
        {/* 编辑：用系统默认程序打开（openWith 传空 exec = 默认程序）。
            **只给文本**：图片这类没有"文本编辑"的意义（二进制文档更进不到预览——双击时就被拦下了）。
            改完不回读内容：文件在别的程序手里、什么时候保存我们不知道；用户自己按「刷新」即可。 */}
        {!target.img && (
          <button
            className="mini"
            onClick={(ev) => void openEditMenu(ev)}
            title="选择用哪个程序打开来编辑这个文件；改完回到这里按「刷新」即可看到变更"
          >
            ✎ 编辑
          </button>
        )}
          </>
        )}
        {editing ? (
          <>
            <span className="dim small">
              编辑中{fileEnc ? ` · 按 ${fileEnc} 保存` : ''}
              {eolRef.current === '\r\n' ? ' · 保持 CRLF 行尾' : ''}
            </span>
            <span className="grow" />
            <button className="mini primary" onClick={saveEdit}>💾 保存</button>
            <button className="mini" onClick={() => setEditing(false)}>取消</button>
          </>
        ) : (
          <>
            <span className="dim small">{full ? 'Esc 退出全屏 · ' : ''}← 键返回列表 · / 搜索</span>
            <button className="mini" onClick={props.onClose}>← 返回列表</button>
          </>
        )}
        {editMenu && (
          /* mask：点菜单外面 = 不想编辑了，菜单关掉（用户实报：点其他地方菜单不消失） */
          <ContextMenu x={editMenu.x} y={editMenu.y} items={editMenu.items} onClose={() => setEditMenu(null)} mask />
        )}
      </div>
      {/* md 阅读主题：变量 inline 打在这个滚动容器上，只作用其子树（工具栏/界面不受影响） */}
      {editing ? (
        <div className="preview-edit-wrap">
          {/* 行号列：行数与行高都跟 textarea 一致（见 CSS 的 calc），滚动由 textarea 驱动 */}
          <div className="preview-edit-nums" ref={editNumsRef}>
            {draft.split('\n').map((_, i) => (
              <div key={i}>{i + 1}</div>
            ))}
          </div>
          <textarea
            className="preview-edit"
            ref={editTaRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onScroll={syncEditScroll}
            wrap="off"
            spellCheck={false}
            autoFocus
          />
        </div>
      ) : (
      <div className="diff" style={{ flex: 1, overflow: 'auto', ...mdVars }}>
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
      )}
      {/* md 阅读主题气泡：选完接着看（不关气泡，可连续试）；Esc / 点遮罩只关气泡，预览留着 */}
      {mdThemePop && (
        <MdThemePopover
          x={mdThemePop.x}
          y={mdThemePop.y}
          current={mdTheme}
          onPick={(k) => {
            setMdTheme(k);
            saveMdTheme(k);
          }}
          onClose={() => setMdThemePop(null)}
        />
      )}
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
