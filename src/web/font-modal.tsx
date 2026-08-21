/** 字体设置弹窗：字号滑块（实时预览）+ 界面字体 / 代码字体下拉
 *
 * 全部即时生效（无需保存按钮），持久化由 app.tsx 的 useEffect 负责（localStorage）
 */
import React from 'react';
import { ModalShell } from './modal-shell.js';

/** 界面字体选项（value 为 CSS font-family 字符串；空 = 系统默认） */
export const UI_FONTS: { label: string; value: string }[] = [
  { label: '系统默认', value: '' },
  { label: '微软雅黑', value: '"Microsoft YaHei", sans-serif' },
  { label: '宋体', value: '"SimSun", serif' },
  { label: '黑体', value: '"SimHei", sans-serif' },
  { label: '苹方', value: '"PingFang SC", sans-serif' },
  { label: '思源黑体', value: '"Noto Sans CJK SC", sans-serif' },
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

/** 预览代码片段 */
const CODE_SAMPLE = `const greet = (name) => {
  // 代码字体预览
  return \`Hello, \${name}!\`;
};
greet('svnkit');`;

export function FontModal(props: {
  fontSize: number;
  setFontSize: (n: number) => void;
  uiFont: string;
  setUiFont: (f: string) => void;
  codeFont: string;
  setCodeFont: (f: string) => void;
  onClose: () => void;
}) {
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
        <select
          value={props.uiFont}
          onChange={(e) => props.setUiFont(e.target.value)}
          style={{ width: '100%', padding: '4px 6px' }}
        >
          {UI_FONTS.map((f) => (
            <option key={f.label} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
      </div>
      {/* 代码字体 */}
      <div style={{ marginBottom: 14 }}>
        <div className="dim small" style={{ marginBottom: 4 }}>代码字体（差异对比 / 代码查看等区域）</div>
        <select
          value={props.codeFont}
          onChange={(e) => props.setCodeFont(e.target.value)}
          style={{ width: '100%', padding: '4px 6px' }}
        >
          {CODE_FONTS.map((f) => (
            <option key={f.label} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
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
