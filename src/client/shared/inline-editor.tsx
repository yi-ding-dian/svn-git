/** 内联编辑器（独立组件；文件预览的内联编辑与 diff 右栏「就地编辑」共用）：
 *  行号列 + 高亮层 + 透明文字 textarea 三件套（滚动同步由 textarea 驱动）；
 *  脏检测（draft ≠ 初始文本，LF 规范化后比）——「保存」按钮由调用方按 onDirtyChange 点亮；
 *  保存 = 行尾还原原文风格 → 按原编码写回（/api/write-file，后端含编码/占位符守卫）；
 *  jumpLine：进入时光标定位到该行 + 滚动居中（diff 里"定位到当前差异处"用）。
 *  非 UTF-8 / 超限文件的准入由调用方把关（读取时带回的 encoding/truncated 事实）。
 *  **每次进入编辑应是新挂载**（调用方用条件渲染/key 保证）：定位只在挂载时做一次。 */
import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { post } from '../shared/api.js';
import { highlightLine, langOf } from '../shared/highlight.js';
import { t } from '../../shared/i18n/index.js';

/** 编辑高亮层的单行（memo：击键时只有被改动的行重新高亮，大文件也不卡） */
const EditHlLine = React.memo(function EditHlLine({ line, lang }: { line: string; lang?: string }) {
  return <div><span dangerouslySetInnerHTML={{ __html: highlightLine(line, lang) }} /></div>;
});

export interface InlineEditorHandle {
  /** 保存（调用方按钮触发）：行尾还原 → 写回 → onSaved / onError */
  save: () => void;
  /** 光标定位到指定行（1-based）+ 滚动居中；
   *  flashRange 给了就**整段行脉冲高亮**（diff 里点左栏/刻度指认改动块用——块级、像非编辑态） */
  gotoLine: (line: number, flashRange?: { from: number; to: number }) => void;
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
    onSaved: (message: string) => void;
    onError: (message: string) => void;
  }
>(function InlineEditor(props, ref) {
  const [draft, setDraft] = useState(props.initialText);
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const numsRef = useRef<HTMLDivElement | null>(null);
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
  /** 脏检测：基准 = 初始文本 LF 规范化（textarea 内部总是 LF） */
  const dirty = draft !== props.initialText.replace(/\r\n/g, '\n');
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
            // 已保存
            props.onSaved(r.message || t('fs.pv.saved'));
          })
          // 保存失败: {msg}
          .catch((e: Error) => props.onError(t('fs.pv.saveFailedMsg', { msg: e.message })));
      },
      gotoLine,
    }),
    // draft 必须进依赖：save 闭包要拿最新草稿（gotoLine 读 ta.value，不受影响）
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [draft],
  );
  return (
    <div className="preview-edit-wrap">
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
            <EditHlLine key={i} line={line} lang={langOf(props.fileName)} />
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
