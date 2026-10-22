/** 命令预览：折叠显示「将执行以下命令」，展开后是带序号的命令列表。
 *
 *  纯展示组件——命令文本由调用方保证与实际执行一致（项目约定：省略 -c core.quotepath
 *  等内部标志，保留操作类型与真实参数）。危险操作可 defaultOpen，避免用户漏看。
 *
 *  两种外观：
 *  - 默认：浅底代码块、独立行号列、行分隔、每行内部省略
 *  - compact + marker="circled"：①②③ 前置、无背景/边框（项目迁移面板用）
 *
 *  复制：标题行右侧「复制」复制全部（折叠时也显示）；鼠标悬浮某一行时出现该行「复制」。
 *  长命令单行省略，窗口变宽自动显示更多；悬浮命令行显示完整内容。 */
import React, { useState } from 'react';
import { t } from '../../shared/i18n/index.js';

const CIRCLED = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳';
const circledOf = (i: number) => CIRCLED[i] ?? `${i + 1}.`;

export function CommandPreview(props: {
  commands: string[];
  /** 默认展开（危险操作建议 true） */
  defaultOpen?: boolean;
  /** 危险色（删除、强制操作等） */
  danger?: boolean;
  /** 标题覆盖（默认「将执行以下命令」） */
  title?: string;
  /** 每条命令的完整版本：列表显示简写，悬浮显示完整 */
  fullCommands?: string[];
  /** 是否显示序号（默认显示；marker="circled" 时忽略） */
  numbered?: boolean;
  /** 序号样式：number（默认，独立行号列）/ circled（①②③ 前置在命令里） */
  marker?: 'number' | 'circled';
  /** 紧凑外观：无代码块背景/边框/行分隔（贴近项目迁移面板） */
  compact?: boolean;
}) {
  const [open, setOpen] = useState(Boolean(props.defaultOpen));
  const [copied, setCopied] = useState(false);
  /** 悬浮行 / 刚复制过的行（单行复制反馈） */
  const [hoverLine, setHoverLine] = useState<number | null>(null);
  const [copiedLine, setCopiedLine] = useState<number | null>(null);
  if (props.commands.length === 0) return null;

  const circled = props.marker === 'circled';
  const showNumbers = props.numbered !== false && !circled;

  const copyAll = () => {
    void navigator.clipboard
      ?.writeText(props.commands.join('\n'))
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {
        /* 剪贴板不可用：静默（命令在界面上可见，可手动选中复制） */
      });
  };

  const copyLine = (text: string, i: number) => {
    void navigator.clipboard
      ?.writeText(text)
      .then(() => {
        setCopiedLine(i);
        setTimeout(() => setCopiedLine((cur) => (cur === i ? null : cur)), 1500);
      })
      .catch(() => {
        /* 静默 */
      });
  };

  return (
    <div className="small" style={{ marginTop: 10 }}>
      <div className="row" style={{ alignItems: 'center', gap: 8 }}>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          title={t('ui.cmdPreview.toggle')}
          style={{
            background: 'transparent',
            border: 'none',
            padding: 0,
            cursor: 'pointer',
            color: props.danger ? 'var(--err)' : 'var(--dim)',
            fontSize: '0.9em',
          }}
        >
          {open ? '▾' : '▸'} {props.title ?? t('ui.cmdPreview.title')} ·{' '}
          {t(open ? 'ui.cmdPreview.expanded' : 'ui.cmdPreview.collapsed', { n: props.commands.length })}
        </button>
        {/* 复制全部：折叠/展开都显示 */}
        <button
          className="mini"
          onClick={copyAll}
          title={t('ui.cmdPreview.copyTip')}
          style={{ minWidth: 48, padding: '1px 4px', fontSize: '0.75em' }}
        >
          {copied ? '✓' : t('ui.cmdPreview.copy')}
        </button>
      </div>
      {open && (
        <div
          style={{
            marginTop: 6,
            ...(props.compact ? {} : { border: '1px solid var(--border)', borderRadius: 6, background: 'var(--panel2)' }),
            maxHeight: 160,
            overflowY: 'auto',
          }}
        >
          {props.commands.map((c, i) => {
            const full = props.fullCommands?.[i] ?? c;
            return (
              <div
                key={i}
                onMouseEnter={() => setHoverLine(i)}
                onMouseLeave={() => setHoverLine(null)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: props.compact ? '2px 0' : '4px 10px',
                  borderBottom: !props.compact && i < props.commands.length - 1 ? '1px solid var(--border)' : undefined,
                }}
              >
                {showNumbers && (
                  <span className="mono" style={{ color: 'var(--dim)', userSelect: 'none', textAlign: 'right', flexShrink: 0 }}>
                    {i + 1}
                  </span>
                )}
                <code
                  className="mono"
                  style={{
                    flex: 1,
                    minWidth: 0,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    color: props.danger ? 'var(--err)' : 'var(--text)',
                  }}
                  title={full}
                >
                  {circled ? `${circledOf(i)} ${c}` : c}
                </code>
                {/* 始终占位（隐藏时保留宽度），悬浮只切换可见性——行内容不会跳动 */}
                <button
                  className="mini"
                  style={{
                    flexShrink: 0,
                    width: 44,
                    padding: '1px 4px',
                    fontSize: '0.75em',
                    visibility: hoverLine === i ? 'visible' : 'hidden',
                  }}
                  onClick={() => copyLine(c, i)}
                  title={t('ui.cmdPreview.copyLineTip')}
                >
                  {copiedLine === i ? '✓' : t('ui.cmdPreview.copy')}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
