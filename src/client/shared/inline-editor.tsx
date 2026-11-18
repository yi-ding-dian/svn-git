/** 内联编辑器（独立组件；文件预览的内联编辑与 diff 右栏「就地编辑」共用）：
 *  行号列 + 高亮层 + 透明文字 textarea 三件套（滚动同步由 textarea 驱动）；
 *  脏检测（draft ≠ 初始文本，LF 规范化后比）——「保存」按钮由调用方按 onDirtyChange 点亮；
 *  保存 = 行尾还原原文风格 → 按原编码写回（/api/write-file，后端含编码/占位符守卫）；
 *  jumpLine：进入时光标定位到该行 + 滚动居中（diff 里"定位到当前差异处"用）。
 *  非 UTF-8 / 超限文件的准入由调用方把关（读取时带回的 encoding/truncated 事实）。
 *  **每次进入编辑应是新挂载**（调用方用条件渲染/key 保证）：定位只在挂载时做一次。 */
import React, { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import { post } from '../shared/api.js';
import { highlightLine, langOf } from '../shared/highlight.js';
import { t } from '../../shared/i18n/index.js';

/** 编辑高亮层的单行（memo：击键时只有被改动的行重新高亮，大文件也不卡）。
 *  搜索态：命中行把匹配词包成 <mark> **常亮**（textarea 字形透明，只有高亮层看得见），
 *  当前跳转行用深色（edit-hit-cur）。未命中行 query 传 undefined —— memo 保持不重渲染。 */
const EditHlLine = React.memo(function EditHlLine({
  line,
  lang,
  query,
  active,
}: {
  line: string;
  lang?: string;
  /** 本行命中的搜索词（未命中/未搜索为 undefined） */
  query?: string;
  /** 是否是当前跳转到的行 */
  active?: boolean;
}) {
  const q = query && query.trim() ? query.toLowerCase() : '';
  if (!q) return <div><span dangerouslySetInnerHTML={{ __html: highlightLine(line, lang) }} /></div>;
  // 本行所有命中（不区分大小写；预览态按行高亮，这里词级高亮，同一行多处都标出来）
  const lower = line.toLowerCase();
  const hits: { col: number; len: number }[] = [];
  for (let at = lower.indexOf(q); at >= 0; at = lower.indexOf(q, at + q.length)) {
    hits.push({ col: at, len: q.length });
  }
  if (!hits.length) return <div><span dangerouslySetInnerHTML={{ __html: highlightLine(line, lang) }} /></div>;
  // 按命中切段：普通段走语法高亮，命中段换成 <mark>（整行照常是 pre，间距不变）
  const parts: React.ReactNode[] = [];
  let prev = 0;
  hits.forEach((h, i) => {
    if (h.col > prev) {
      parts.push(
        <span key={`t${i}`} dangerouslySetInnerHTML={{ __html: highlightLine(line.slice(prev, h.col), lang) }} />,
      );
    }
    parts.push(
      <mark key={`h${i}`} className={active ? 'edit-hit-cur' : 'edit-hit'}>
        {line.slice(h.col, h.col + h.len)}
      </mark>,
    );
    prev = h.col + h.len;
  });
  if (prev < line.length) {
    parts.push(<span key="tail" dangerouslySetInnerHTML={{ __html: highlightLine(line.slice(prev), lang) }} />);
  }
  return <div>{parts}</div>;
});

export interface InlineEditorHandle {
  /** 保存（调用方按钮触发）：行尾还原 → 写回 → onSaved / onError */
  save: () => void;
  /** 光标定位到指定行（1-based）+ 滚动居中；
   *  flashRange 给了就**整段行脉冲高亮**（diff 里点左栏/刻度指认改动块用——块级、像非编辑态） */
  gotoLine: (line: number, flashRange?: { from: number; to: number }) => void;
  /** 选中某行里的一个匹配词（编辑态搜索用）：col 为行内 0-based 起始字符，len 为词长；
   *  同时滚到该行并让文本框拿回焦点（选区本身浏览器也会滚进来，这里手动居中更稳） */
  selectMatch: (line: number, col: number, len: number) => void;
}

export const InlineEditor = forwardRef<
  InlineEditorHandle,
  {
    /** 相对仓库根路径（保存用） */
    rel: string;
    /** 初始文本（原文；CRLF 由 eol 描述） */
    initialText: string;
    /** 原文行尾风格（保存时还原——textarea 会把 CRLF 规范化成 LF） */
    eol: '\n' | '\r\n';
    /** 文件名（语法高亮语言判定用） */
    fileName: string;
    /** 进入时定位到的行（1-based；光标 + 滚动居中） */
    jumpLine?: number;
    /** 脏状态变化（调用方据此点亮/熄灭保存按钮） */
    onDirtyChange: (dirty: boolean) => void;
    /** 草稿文本上报（挂载时也报一次初始文本）：编辑态的目录要从草稿实时解析标题 */
    onDraftChange?: (text: string) => void;
    /** 编辑态搜索（调用方算好的命中行）：命中词常亮，当前跳转行深色。
     *  只把词传给命中行——未命中行的 memo 不因搜索词变化重渲染。 */
    search?: { query: string; hitLines: Set<number>; activeLine: number };
    /** 保存成功：message 给提示；text 是**刚写盘的草稿**（LF）——
     *  调用方要同步正文时直接用它，别依赖 onDraftChange 的 state（回调闭包里可能还是旧值） */
    onSaved: (message: string, text: string) => void;
    onError: (message: string) => void;
  }
>(function InlineEditor(props, ref) {
  const [draft, setDraft] = useState(props.initialText);
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const numsRef = useRef<HTMLDivElement | null>(null);
  /** textarea 滚动条占位（横向条高 / 纵向条宽）：高亮层与行号列没有滚动条，
   *  **必须把这部分补进它们的内容尺寸**（CSS 见 --edit-sb-*），否则滚到底部时
   *  它们比 textarea 少滚一个滚动条的高度/宽度 → 行号与文字错位（用户实报）。
   *  部分浏览器滚动条不占空间（overlay），测量值为 0，不影响现有布局。 */
  const [sb, setSb] = useState({ h: 0, w: 0 });
  /** 统一行高（整数像素）：textarea 的光标按 line-height 定位，高亮层/行号列按行 div 高度定位；
   *  缩放后行高常是 14.4px 这类小数，浏览器把行 div 吸附到 1/64px（14.391），
   *  textarea 内部行位置却按 14.4 走 → 每行差零点零几像素，越往下越明显（用户实报「标记位越往下越靠上」）。
   *  取整成整数像素后三层完全一致（缩放多少都不会再有吸附差）。 */
  const [lineH, setLineH] = useState(0);
  /** 测量 textarea 的滚动条占位，并跟随内容/窗口尺寸变化更新（draft 变化时滚动条可能出现/消失） */
  useLayoutEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    const measure = () => {
      const h = Math.max(0, ta.offsetHeight - ta.clientHeight);
      const w = Math.max(0, ta.offsetWidth - ta.clientWidth);
      setSb((p) => (p.h === h && p.w === w ? p : { h, w }));
      // 行高取整：字号已包含内容缩放（CSS calc），×1.5 后四舍五入成整数像素
      const fs = parseFloat(getComputedStyle(ta).fontSize) || 14;
      const lh = Math.max(1, Math.round(fs * 1.5));
      setLineH((p) => (p === lh ? p : lh));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(ta);
    // 内容缩放（--content-zoom）与字号（--font-size）都写在根节点 style 上：变化时重新取整
    const mo = new MutationObserver(measure);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] });
    mo.observe(document.body, { attributes: true, attributeFilter: ['style'] });
    window.addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      mo.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [draft]);
  const hlRef = useRef<HTMLDivElement | null>(null);
  /** 三件套滚动同步：高亮层横竖都跟（wrap=off 有横向滚动），行号列只跟纵向 */
  const syncScroll = () => {
    if (!taRef.current) return;
    if (numsRef.current) numsRef.current.scrollTop = taRef.current.scrollTop;
    if (hlRef.current) {
      hlRef.current.scrollTop = taRef.current.scrollTop;
      hlRef.current.scrollLeft = taRef.current.scrollLeft;
    }
  };
  /** 脏检测基准：初始文本 LF 规范化；**保存成功后更新为已保存的草稿**——
   *  这样保存后留在编辑态，按钮自动变灰，下一次修改再亮起。 */
  const [savedText, setSavedText] = useState(props.initialText.replace(/\r\n/g, '\n'));
  const dirty = draft !== savedText;
  useEffect(() => {
    props.onDirtyChange(dirty);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 只在脏状态翻转时通知
  }, [dirty]);
  /** 草稿上报：编辑态的目录按草稿实时解析（与上面同理，只在草稿变化时通知；挂载时报初始文本） */
  useEffect(() => {
    props.onDraftChange?.(draft);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 只在草稿变化时上报
  }, [draft]);
  /** 光标定位到指定行（1-based）+ 滚动居中。挂载时的 jumpLine 与编辑中「点左栏差异行」
   *  的联动共用；读 ta.value（实时草稿，编辑中内容可能已变）。
   *  flashRange 给了就**整段行脉冲**（高亮层对应行加动画类——textarea 背景透明，底色可见） */
  const gotoLine = (line: number, flashRange?: { from: number; to: number }) => {
    const ta = taRef.current;
    if (!ta || line <= 0) return;
    const lines = ta.value.replace(/\r\n/g, '\n').split('\n');
    const k = Math.min(line - 1, lines.length); // 该行之前有 k 行
    const lineStart = lines.slice(0, k).join('\n').length + (k > 0 ? 1 : 0); // 各行字符 + 行间换行
    ta.setSelectionRange(lineStart, lineStart);
    const lh = parseFloat(getComputedStyle(ta).lineHeight) || 21;
    ta.scrollTop = Math.max(0, (line - 1) * lh - ta.clientHeight / 2 + lh);
    if (flashRange) {
      // 整段行脉冲（块级）：先摘再挂 + 强制 reflow——连点同一块也重播（同 diff 脉冲的跨帧方案）
      const hl = hlRef.current;
      if (hl) {
        for (let n = flashRange.from; n <= flashRange.to; n++) {
          const el = hl.children[n - 1] as HTMLElement | undefined;
          if (!el) continue;
          el.classList.remove('edit-line-flash');
          void el.offsetWidth;
          el.classList.add('edit-line-flash');
          el.addEventListener('animationend', () => el.classList.remove('edit-line-flash'), { once: true });
        }
      }
    }
    syncScroll();
    ta.focus();
  };
  const selectMatch = (line: number, col: number, len: number) => {
    const ta = taRef.current;
    if (!ta || line <= 0) return;
    const lines = ta.value.replace(/\r\n/g, '\n').split('\n');
    const k = Math.min(line - 1, lines.length);
    const lineStart = lines.slice(0, k).join('\n').length + (k > 0 ? 1 : 0);
    const from = lineStart + Math.max(0, col);
    ta.setSelectionRange(from, Math.min(from + Math.max(1, len), ta.value.length));
    const lh = parseFloat(getComputedStyle(ta).lineHeight) || 21;
    ta.scrollTop = Math.max(0, (line - 1) * lh - ta.clientHeight / 2 + lh);
    // 行脉冲：不抢焦点 —— 搜索框要保持焦点，用户才能连按 Enter 跳下一个
    // （失焦 textarea 的选区不一定可见，行脉冲让"跳到了哪一行"始终看得出来）
    const el = hlRef.current?.children[line - 1] as HTMLElement | undefined;
    if (el) {
      el.classList.remove('edit-line-flash');
      void el.offsetWidth;
      el.classList.add('edit-line-flash');
      el.addEventListener('animationend', () => el.classList.remove('edit-line-flash'), { once: true });
    }
    syncScroll();
  };
  // 进入定位（仅挂载一次）
  useEffect(() => {
    if (props.jumpLine) gotoLine(props.jumpLine);
    else taRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 定位只在进入编辑时做一次
  }, []);
  useImperativeHandle(
    ref,
    () => ({
      save: () => {
        const content = draft.replace(/\r?\n/g, props.eol);
        void post
          .writeFile(props.rel, content)
          .then((r) => {
            if (!r.ok) {
              // 保存失败
              props.onError(r.message || t('fs.pv.saveFailed'));
              return;
            }
            // 已保存（把刚写盘的草稿一并带回：父级据此同步正文，不依赖异步上报的 state）
            props.onSaved(r.message || t('fs.pv.saved'), draft);
            // 基线前移：保存后不退出编辑，按钮变灰；继续改会重新变亮
            setSavedText(draft);
          })
          // 保存失败: {msg}
          .catch((e: Error) => props.onError(t('fs.pv.saveFailedMsg', { msg: e.message })));
      },
      gotoLine,
      selectMatch,
    }),
    // draft 必须进依赖：save 闭包要拿最新草稿（gotoLine 读 ta.value，不受影响）
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [draft],
  );
  return (
    // data-content-zoom：鼠标在编辑区时 Ctrl+滚轮**只缩放文件内容**（界面不动）；
    // 字号/行高/行号列在 CSS 里按 --content-zoom 同步放大，三者保持 1:1 对齐
    <div
      className="preview-edit-wrap"
      data-content-zoom=""
      style={
        {
          '--edit-sb-h': `${sb.h}px`,
          '--edit-sb-w': `${sb.w}px`,
          ...(lineH ? { '--edit-line-h': `${lineH}px` } : {}),
        } as React.CSSProperties
      }
    >
      {/* 行号列：行数与行高都跟 textarea 一致（见 CSS 的 calc），滚动由 textarea 驱动 */}
      <div className="preview-edit-nums" ref={numsRef}>
        {draft.split('\n').map((_, i) => (
          <div key={i}>{i + 1}</div>
        ))}
      </div>
      <div className="preview-edit-area">
        {/* 实时高亮层：彩色代码由它显示（textarea 字形透明、只留光标），字体/行高与 textarea 严格一致 */}
        <div className="preview-edit-hl" ref={hlRef} aria-hidden>
          {draft.split('\n').map((line, i) => (
            <EditHlLine
              key={i}
              line={line}
              lang={langOf(props.fileName)}
              query={props.search?.hitLines.has(i) ? props.search.query : undefined}
              active={i === props.search?.activeLine}
            />
          ))}
        </div>
        <textarea
          className="preview-edit"
          ref={taRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onScroll={syncScroll}
          wrap="off"
          spellCheck={false}
          autoFocus
        />
      </div>
    </div>
  );
});
