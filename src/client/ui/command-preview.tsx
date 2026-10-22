/** 命令预览：折叠显示「将执行以下命令」，逐条等宽展示，可复制。
 *
 *  纯展示组件——命令文本由调用方保证与实际执行一致（本项目约定：省略 -c core.quotepath
 *  等内部标志，保留操作类型与真实参数）。危险操作建议 defaultOpen，避免用户漏看。
 *
 *  用法：
 *    <CommandPreview commands={['git checkout main']} />
 *    <CommandPreview commands={short} fullCommands={full} defaultOpen danger /> */
import React, { useState } from 'react';
import { t } from '../../shared/i18n/index.js';

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
  /** 是否显示序号（默认显示） */
  numbered?: boolean;
}) {
  const [open, setOpen] = useState(Boolean(props.defaultOpen));
  const [copied, setCopied] = useState(false);
  if (props.commands.length === 0) return null;

  const copy = () => {
    const text = props.commands.join('\n');
    void navigator.clipboard
      ?.writeText(text)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {
        /* 剪贴板不可用：静默（命令在界面上可见，可手动选中复制） */
      });
  };

  return (
    <div className="small" style={{ marginTop: 10, borderTop: '1px solid var(--border)', paddingTop: 8 }}>
      <div className="row" style={{ alignItems: 'center', gap: 8 }}>
        <button
          className="mini"
          onClick={() => setOpen((v) => !v)}
          title={t('ui.cmdPreview.toggle')}
          style={{ color: props.danger ? 'var(--err)' : undefined }}
        >
          {open ? '▾' : '▸'} {props.title ?? t('ui.cmdPreview.title')} ·{' '}
          {t(open ? 'ui.cmdPreview.expanded' : 'ui.cmdPreview.collapsed', { n: props.commands.length })}
        </button>
        {open && (
          <button className="mini" onClick={copy} title={t('ui.cmdPreview.copyTip')}>
            {copied ? t('ui.cmdPreview.copied') : t('ui.cmdPreview.copy')}
          </button>
        )}
      </div>
      {open && (
        <pre
          className="mono small"
          style={{
            margin: '6px 0 0',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
            lineHeight: 1.6,
            color: props.danger ? 'var(--err)' : undefined,
          }}
        >
          {props.commands.map((c, i) => {
            const full = props.fullCommands?.[i] ?? c;
            const line = props.numbered === false ? c : `${i + 1}. ${c}`;
            return (
              <div key={i} title={full !== c ? full : undefined}>
                {line}
              </div>
            );
          })}
        </pre>
      )}
    </div>
  );
}
