/** 提交注释输入块（提交弹窗共用）：标题 + 正文 + 类型快捷按钮 + 字数 + Ctrl+Enter。
 *
 *  结构对标提交注释规范：标题一行（必填，列表/`git log --oneline` 只看这一行），
 *  正文可选（为什么改、取舍、坑），提交时拼成 `标题\n\n正文` —— Git/SVN 的标准多段式。
 *  - 类型按钮：插入/替换五类前缀（作用于标题），保留冒号后的正文，光标停在冒号后
 *  - 粘贴多行自动拆分：第一行进标题，其余进正文
 *  - 草稿按项目持久化（draftRoot）：关掉/取消不丢，提交成功后由调用方 clearCommitDraft 清掉
 *  - 标题失焦为空时红边；标题有效性经 onValidityChange 通知调用方禁用提交 */
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { t, type I18nKey } from '../../shared/i18n/index.js';
import { Tooltip } from '../ui/tooltip.js';
import { loadCommitDraft, saveCommitDraft } from './commit-draft.js';

/** 五类前缀：按钮文字走 i18n；插入内容固定为中文规范前缀（团队提交注释按这份规范写）。
 *  tipKey：悬浮解释「什么情况下用这个类型」（对照提交注释规范，带一个简例）。 */
const PREFIXES: { key: I18nKey; prefix: string; tipKey: I18nKey }[] = [
  { key: 'ops.commitComment.prefixFix', prefix: '修复', tipKey: 'ops.commitComment.tipFix' },
  { key: 'ops.commitComment.prefixAdd', prefix: '新增', tipKey: 'ops.commitComment.tipAdd' },
  { key: 'ops.commitComment.prefixImprove', prefix: '优化', tipKey: 'ops.commitComment.tipImprove' },
  { key: 'ops.commitComment.prefixRefactor', prefix: '重构', tipKey: 'ops.commitComment.tipRefactor' },
  { key: 'ops.commitComment.prefixCleanup', prefix: '清理', tipKey: 'ops.commitComment.tipCleanup' },
];

/** 标题超过这个字数提示变黄（不拦截，只是提醒别写成流水账）。
 *  与提交注释规范的「标题约 40 字内」一致；中文信息密度高，50 字对标题偏长了。 */
const LEN_WARN = 40;

/** 完整注释 → 标题/正文：第一个空行是分隔；旧草稿没有空行时第一行当标题，其余算正文 */
export function splitCommitMessage(full: string): { title: string; body: string } {
  const norm = full.replace(/\r\n/g, '\n');
  const blank = norm.indexOf('\n\n');
  if (blank >= 0) {
    return { title: norm.slice(0, blank).trimEnd(), body: norm.slice(blank + 2).replace(/^\n+/, '') };
  }
  const nl = norm.indexOf('\n');
  if (nl >= 0) return { title: norm.slice(0, nl).trimEnd(), body: norm.slice(nl + 1) };
  return { title: norm, body: '' };
}

export function CommitCommentBox(props: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  /** 标题是否有内容：提交按钮据此禁用（正文不能替代标题） */
  onValidityChange?: (valid: boolean) => void;
  /** 正文输入框行数 */
  rows?: number;
  /** 标题占位 */
  placeholder?: string;
  autoFocus?: boolean;
  /** 项目根：有值时启用草稿保存/恢复（多项目隔离） */
  draftRoot?: string;
}) {
  const titleRef = useRef<HTMLInputElement | null>(null);
  const init = splitCommitMessage(props.value);
  const [title, setTitle] = useState(init.title);
  const [body, setBody] = useState(init.body);
  /** 用户碰过标题（失焦/输入过）：之后为空才画红边，一打开就红不好看 */
  const [touched, setTouched] = useState(false);
  /** 最近一次由本组件拼出去的完整值：外部 value 变的只是草稿恢复/返回修改，才重新拆分 */
  const lastEmitted = useRef(props.value);
  /** 草稿水合完成前不回写：否则挂载时的空值会先把已有草稿删掉 */
  const hydrated = useRef(false);

  useEffect(() => {
    const root = props.draftRoot;
    if (root) {
      const saved = loadCommitDraft(root);
      if (saved && !props.value.trim()) props.onChange(saved);
    }
    hydrated.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 只在挂载时恢复一次
  }, []);
  // 外部 value 变化（草稿恢复、从差异/确认返回）→ 重新拆分标题/正文
  useEffect(() => {
    if (props.value === lastEmitted.current) return;
    const s = splitCommitMessage(props.value);
    lastEmitted.current = props.value;
    setTitle(s.title);
    setBody(s.body);
  }, [props.value]);
  useEffect(() => {
    if (!hydrated.current || !props.draftRoot) return;
    saveCommitDraft(props.draftRoot, props.value);
  }, [props.value, props.draftRoot]);
  // 标题有效性上报（调用方据此禁用提交按钮）
  useEffect(() => {
    props.onValidityChange?.(title.trim().length > 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 只在标题内容变化时上报
  }, [title]);

  /** 标题/正文 → 完整注释（有正文才加空行） */
  const emit = (nextTitle: string, nextBody: string) => {
    const full = nextBody ? `${nextTitle}\n\n${nextBody}` : nextTitle;
    lastEmitted.current = full;
    props.onChange(full);
  };
  const changeTitle = (next: string) => {
    setTitle(next);
    emit(next, body);
  };
  /** 正文整段替换 + 光标定位（自动列表续行/退出用；受控组件必须走 state 更新） */
  const updateBody = (next: string, caret: number) => {
    setBody(next);
    emit(title, next);
    requestAnimationFrame(() => {
      const ta = bodyRef.current;
      if (!ta) return;
      ta.focus();
      ta.setSelectionRange(caret, caret);
    });
  };

  /** 正文（可选、自动高度）：为什么改、关键取舍、踩过的坑 */
  // 正文框随内容自动变高：最少 3 行、最多 10 行，超过才滚动（弹窗跟着变高，写正文能看全）
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);
  useLayoutEffect(() => {
    const ta = bodyRef.current;
    if (!ta) return;
    let lastW = ta.clientWidth;
    const measure = () => {
      const cs = getComputedStyle(ta);
      const lineH = parseFloat(cs.lineHeight) || 21;
      const pad = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
      const border = parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth);
      const borderBox = cs.boxSizing === 'border-box';
      const base = borderBox ? pad + border : 0;
      const minH = lineH * 3 + base;
      const maxH = lineH * 10 + base;
      // 先归零再量：固定高度下 scrollHeight 只返回当前可见高度，量不到真实内容
      ta.style.height = 'auto';
      const content = ta.scrollHeight; // 含 padding
      const contentH = content + (borderBox ? border : -pad);
      ta.style.height = `${Math.min(Math.max(contentH, minH), maxH)}px`;
      ta.style.overflowY = contentH > maxH + 1 ? 'auto' : 'hidden';
      lastW = ta.clientWidth;
    };
    measure();
    // 弹窗宽度被拖动/最大化时折行会变：宽度变化才重量（高度变化不触发，避免自激）
    const ro = new ResizeObserver(() => {
      if (ta.clientWidth !== lastW) measure();
    });
    ro.observe(ta);
    return () => ro.disconnect();
  }, [body, props.rows]);

  /** 插入/替换类型前缀（作用于标题）：保留冒号后的内容，光标停在冒号后 */
  const applyPrefix = (prefix: string) => {
    const head = `${prefix}：`;
    const rest = title.replace(/^(新增|修复|优化|重构|清理)：\s*/, '');
    const next = head + rest;
    changeTitle(next);
    setTouched(true);
    requestAnimationFrame(() => {
      const el = titleRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(head.length, head.length);
    });
  };

  const invalid = touched && !title.trim();
  const len = title.trim().length;

  return (
    <>
      <div className="cmt-label row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        {/* 📝 提交注释 / （必填） */}
        <span>
          {t('ops.commitComment.label')}{' '}
          <span className="dim" style={{ fontWeight: 400 }}>{t('ops.commitComment.required')}</span>
        </span>
        {/* 类型快捷按钮：点一下插入前缀，不用手打和记全角冒号 */}
        <span className="cmt-prefixes">
          {PREFIXES.map((p) => (
            <Tooltip key={p.prefix} content={t(p.tipKey)}>
              <button type="button" className="mini cmt-prefix" onClick={() => applyPrefix(p.prefix)}>
                {t(p.key)}
              </button>
            </Tooltip>
          ))}
        </span>
      </div>
      {/* 标题（必填）：列表、git log --oneline 只显示这一行 */}
      <div className="row" style={{ gap: 8, alignItems: 'center', flexShrink: 0 }}>
        <input
          ref={titleRef}
          type="text"
          className={`cmt-text cmt-title${invalid ? ' invalid' : ''}`}
          value={title}
          placeholder={props.placeholder}
          onChange={(e) => {
            changeTitle(e.target.value);
            if (e.target.value.trim()) setTouched(true);
          }}
          onBlur={() => setTouched(true)}
          onPaste={(e) => {
            // 粘贴多行：第一行进标题，其余进正文（别把整段塞进单行标题）
            const text = e.clipboardData.getData('text');
            if (!/\r?\n/.test(text)) return;
            e.preventDefault();
            const [head, ...rest] = text.replace(/\r\n/g, '\n').split('\n');
            const nextTitle = (head ?? '').trimEnd();
            const nextBody = rest.join('\n').replace(/^\n+/, '');
            setTitle(nextTitle);
            setBody(nextBody);
            emit(nextTitle, nextBody);
            setTouched(true);
          }}
          onKeyDown={(e) => {
            // 单行标题里按 Ctrl+Enter 直接提交
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') props.onSubmit();
          }}
          autoFocus={props.autoFocus}
        />
        {/* 字数：只算标题；超过建议长度变黄，只提醒不拦截 */}
        <span className={len > LEN_WARN ? 'cmt-len over' : 'cmt-len'}>{t('ops.commitComment.chars', { n: len })}</span>
      </div>
      {/* 正文（可选）：为什么改、关键取舍、踩过的坑；高度随内容自动增长（3~10 行） */}
      <textarea
        className="cmt-text cmt-body"
        ref={bodyRef}
        rows={props.rows ?? 3}
        placeholder={t('ops.commitComment.bodyPlaceholder')}
        value={body}
        onChange={(e) => {
          setBody(e.target.value);
          emit(title, e.target.value);
        }}
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            props.onSubmit();
            return;
          }
          // 列表自动续行：`- 要点` / `* 要点` / `1. 要点` 行尾回车，下一行自动带标记；
          // 空的列表项再回车则删掉标记退出列表（与常见 Markdown 编辑器一致）
          if (e.key !== 'Enter' || e.shiftKey || e.altKey || e.ctrlKey || e.metaKey) return;
          const ta = e.currentTarget;
          if (ta.selectionStart !== ta.selectionEnd) return; // 有选区：走默认换行
          const pos = ta.selectionStart;
          const value = ta.value;
          const lineStart = value.lastIndexOf('\n', pos - 1) + 1;
          const lineEnd = value.indexOf('\n', pos);
          const atLineEnd = lineEnd === -1 ? pos === value.length : pos === lineEnd;
          if (!atLineEnd) return; // 只在行尾续行，行中回车保持默认拆分
          const line = value.slice(lineStart, lineEnd === -1 ? value.length : lineEnd);
          const m = line.match(/^(\s*)([-*]|\d+\.)\s+(.*)$/);
          if (!m) return;
          const indent = m[1] ?? '';
          const marker = m[2] ?? '';
          const rest = m[3] ?? '';
          e.preventDefault();
          if (!rest.trim()) {
            // 空的列表项：回车退出列表（删掉这一行的标记，保留换行结构）
            const next = value.slice(0, lineStart) + value.slice(lineEnd === -1 ? value.length : lineEnd);
            updateBody(next, lineStart);
            return;
          }
          const nextMarker = /^\d+\.$/.test(marker) ? `${parseInt(marker, 10) + 1}. ` : `${marker} `;
          const insert = `\n${indent}${nextMarker}`;
          updateBody(value.slice(0, pos) + insert + value.slice(pos), pos + insert.length);
        }}
        style={{ flexShrink: 0, marginTop: 6 }}
      />
    </>
  );
}
