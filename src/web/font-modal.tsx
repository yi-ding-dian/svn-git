/** 字体设置弹窗：字号滑块（实时预览）+ 界面字体 / 代码字体下拉
 *
 * 全部即时生效（无需保存按钮），持久化由 app.tsx 的 useEffect 负责（localStorage）
 */
import React, { useEffect, useState } from 'react';
import { ModalShell } from './modal-shell.js';
import { get } from './api.js';

/** 界面字体选项（value 为 CSS font-family 字符串；空 = 系统默认） */
export const UI_FONTS: { label: string; value: string }[] = [
  { label: '系统默认', value: '' },
  { label: '微软雅黑', value: '"Microsoft YaHei", sans-serif' },
  { label: '宋体', value: '"SimSun", serif' },
  { label: '黑体', value: '"SimHei", sans-serif' },
  { label: '苹方', value: '"PingFang SC", sans-serif' },
  { label: '思源黑体', value: '"Noto Sans CJK SC", sans-serif' },
  // 楷体/思源宋体/仿宋/圆体：跨平台字体栈（KaiTi=Windows 微软楷体，STKaiti=macOS 华文楷体；Linux 无原生楷体则回退 serif）
  { label: '楷体', value: '"KaiTi", "楷体", "STKaiti", serif' },
  { label: '思源宋体', value: '"Noto Serif CJK SC", serif' },
  { label: '仿宋', value: '"FangSong", "仿宋", "STFangsong", serif' },
  { label: '圆体', value: '"HYZhongYuanB5", "YouYuan", "幼圆", sans-serif' },
];

/** 代码字体选项（空 = 默认等宽栈） */
export const CODE_FONTS: { label: string; value: string }[] = [
  { label: '默认等宽', value: '' },
  { label: 'JetBrains Mono', value: '"JetBrains Mono", Consolas, monospace' },
  { label: 'Consolas', value: 'Consolas, monospace' },
  { label: 'Courier New', value: '"Courier New", monospace' },
  { label: 'Fira Code', value: '"Fira Code", Consolas, monospace' },
];

/** 字号范围（滑块） */
export const FONT_MIN = 12;
export const FONT_MAX = 20;

/** css 通用族（系统字体表不含，不参与存在性判断） */
const GENERIC_FAMILIES = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'math', 'fangsong', 'emojis']);

/** 字体栈是否系统可用：栈中任一真实 family 在系统字体表里即 true。
 * 字体表取自服务端（Linux: fc-list / Win: 注册表）——浏览器 document.fonts.check 会被
 * fontconfig 字体别名干扰（不存在的字体也返回 true），不可用。 */
function familyAvailable(stack: string, systemFonts: Set<string> | null): boolean {
  if (!stack) return true;
  const fams = stack
    .split(',')
    .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
    .filter((f) => f && !GENERIC_FAMILIES.has(f.toLowerCase()));
  if (fams.length === 0) return true; // 只剩通用族/空栈（含系统默认）恒可用
  if (!systemFonts) return true; // 字体表未加载/失败：保守显示全部（旧行为）
  return fams.some((f) => systemFonts.has(f.toLowerCase()));
}

/** 预览代码片段 */
const CODE_SAMPLE = `const greet = (name) => {
  // 代码字体预览
  return \`Hello, \${name}!\`;
};
greet('svnkit');`;

/** 字体下拉（自绘面板）：系统没有的字体灰色+禁止选择，悬浮 title 提示。
 * 原生 <select> 的 option 在 Chromium 下拉面板中悬浮不显示 tooltip，故用自绘。 */
function FontSelect(props: {
  value: string;
  options: { label: string; value: string }[];
  /** 该字体系统不存在（灰显禁选） */
  unavailable: (v: string) => boolean;
  onPick: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('.font-select')) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);
  const curLabel = props.options.find((o) => o.value === props.value)?.label ?? '系统默认';
  return (
    <div className="font-select" style={{ position: 'relative', width: '100%' }}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        style={{ width: '100%', textAlign: 'left', padding: '4px 6px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 4, cursor: 'pointer', fontSize: 14 }}
      >
        <span>{curLabel}</span>
        <span style={{ float: 'right', color: 'var(--dim)' }}>▾</span>
      </button>
      {open && (
        <div
          style={{
            position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 2, background: 'var(--panel2)',
            border: '1px solid var(--border)', borderRadius: 6, boxShadow: '0 4px 16px rgba(0,0,0,.25)',
            maxHeight: 240, overflow: 'auto', zIndex: 20,
          }}
        >
          {props.options.map((o) => {
            const dis = props.unavailable(o.value);
            return (
              <div
                key={o.label}
                title={dis ? `系统没有「${o.label}」字体样式` : undefined}
                onClick={() => {
                  if (!dis) {
                    setOpen(false);
                    props.onPick(o.value);
                  }
                }}
                onMouseEnter={(e) => {
                  if (!dis) (e.currentTarget as HTMLElement).style.background = 'var(--panel2)';
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLElement).style.background = '';
                }}
                style={{
                  padding: '5px 10px',
                  fontSize: 13,
                  cursor: dis ? 'not-allowed' : 'pointer',
                  color: dis ? 'var(--dim)' : undefined,
                }}
              >
                {o.label}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function FontModal(props: {
  fontSize: number;
  setFontSize: (n: number) => void;
  uiFont: string;
  setUiFont: (f: string) => void;
  codeFont: string;
  setCodeFont: (f: string) => void;
  onClose: () => void;
}) {
  // 系统字体表（服务端查询；null = 未加载/查询失败 → 全部可选）
  const [systemFonts, setSystemFonts] = useState<Set<string> | null>(null);
  useEffect(() => {
    let ok = true;
    get
      .fonts()
      .then((r) => {
        if (ok) setSystemFonts(new Set(r.families.map((f) => f.toLowerCase())));
      })
      .catch(() => {});
    return () => {
      ok = false;
    };
  }, []);
  // 选中系统不存在的字体时的提示（字体选项全部显示，不可用字体选中后不生效并提示）
  const unavailable = (v: string) => !familyAvailable(v, systemFonts);
  return (
    <ModalShell title="🔤 字体设置" width={520} onClose={props.onClose}>
      {/* 字号滑块 */}
      <div style={{ marginBottom: 16 }}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span className="dim small">字号</span>
          <b>{props.fontSize}px</b>
        </div>
        <input
          type="range"
          min={FONT_MIN}
          max={FONT_MAX}
          step={1}
          value={props.fontSize}
          onChange={(e) => props.setFontSize(Number(e.target.value))}
          style={{ width: '100%', marginTop: 6, cursor: 'pointer' }}
        />
        <div className="row dim small" style={{ justifyContent: 'space-between' }}>
          <span>{FONT_MIN}px</span>
          <span>{FONT_MAX}px</span>
        </div>
      </div>
      {/* 界面字体 */}
      <div style={{ marginBottom: 12 }}>
        <div className="dim small" style={{ marginBottom: 4 }}>界面字体</div>
        <FontSelect value={props.uiFont} options={UI_FONTS} unavailable={unavailable} onPick={props.setUiFont} />
      </div>
      {/* 代码字体 */}
      <div style={{ marginBottom: 14 }}>
        <div className="dim small" style={{ marginBottom: 4 }}>代码字体（差异对比 / 代码查看等区域）</div>
        <FontSelect value={props.codeFont} options={CODE_FONTS} unavailable={unavailable} onPick={props.setCodeFont} />
      </div>
      {/* 实时预览（inline 字体直接应用，拖动滑块字号全局即时变化） */}
      <div className="dim small" style={{ marginBottom: 4 }}>实时预览</div>
      <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px' }}>
        <div style={{ fontFamily: props.uiFont || undefined, marginBottom: 8 }}>
          svn-git 文件版本管理 · AaBbCc · 你好世界 123
        </div>
        <pre
          style={{
            fontFamily: props.codeFont || undefined,
            fontSize: '0.92em',
            margin: 0,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
          }}
        >
          {CODE_SAMPLE}
        </pre>
      </div>
    </ModalShell>
  );
}
