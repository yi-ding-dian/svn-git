/** 主题气泡：侧边栏「…」入口点击后，在点击处弹出（复用 .ctx-menu 的浮层样式与全屏遮罩机制）。
 *
 *  内容：
 *  - 分组列出全部内置主题（浅色 / 深色）+「我的主题」，点任一主题即时生效（不关气泡，可连续试）
 *  - 「自定义配色」：暴露 6 个取色器（背景/面板/边框/文字/次要文字/强调色），改动即时预览
 *    （临时写 CSS 变量覆盖），其余 8 个语义色 + 9 个代码高亮色按背景明暗自动推导，避免深色底看不清
 *  - 「保存」把当前 6 色存为「我的主题」（列表由 app.tsx 持有并持久化到 localStorage）
 *
 *  定位：贴点击处，右/下越界时回退到视口内（与 ContextMenu 二级子菜单同样的处理思路）。
 *  关闭：点遮罩 / Esc / 关闭时取消未保存的预览（onPreview(null) 回到正式主题）。
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { THEMES } from '../shell/header.js';
import { IconPalette } from '../ui/icons.js';
import { type MyTheme, deriveThemeVars, THEME_VAR_KEYS, toHex } from '../shared/theme.js';


/** 自定义面板暴露给用户的 6 个颜色（其余变量自动推导） */
const EDITABLE: { key: 'bg' | 'panel' | 'border' | 'text' | 'dim' | 'accent'; label: string }[] = [
  { key: 'bg', label: '背景' },
  { key: 'panel', label: '面板' },
  { key: 'border', label: '边框' },
  { key: 'text', label: '文字' },
  { key: 'dim', label: '次要文字' },
  { key: 'accent', label: '强调色' },
];


/** 读取当前实际生效的 6 个色：自定义面板的初值取当前主题，便于在其基础上微调 */
export function currentColors(): Omit<MyTheme, 'key' | 'name'> {
  const cs = getComputedStyle(document.body);
  const g = (k: string) => toHex(cs.getPropertyValue(k));
  return { bg: g('--bg'), panel: g('--panel'), border: g('--border'), text: g('--text'), dim: g('--dim'), accent: g('--accent') };
}

interface Props {
  x: number;
  y: number;
  /** 当前主题 key（内置 key 或 my-xxx） */
  theme: string;
  onPick: (key: string) => void;
  onClose: () => void;
  myThemes: MyTheme[];
  onSave: (t: MyTheme) => void;
  onDelete: (key: string) => void;
  /** 实时预览：传具体色组则临时覆盖 CSS 变量；传 null 取消预览（回到正式主题） */
  onPreview: (t: Omit<MyTheme, 'key' | 'name'> | null) => void;
}

export function ThemePopover(props: Props) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState({ left: props.x, top: props.y });
  const [customOpen, setCustomOpen] = useState(false);
  const [draft, setDraft] = useState<Omit<MyTheme, 'key' | 'name'>>(() => currentColors());
  const [name, setName] = useState('');

  // 越界回退：右/下超出视口时贴边显示（宽度依赖内容，故渲染后再量一次）
  useEffect(() => {
    if (!ref.current) return;
    const r = ref.current.getBoundingClientRect();
    let left = props.x;
    let top = props.y;
    if (left + r.width > window.innerWidth - 8) left = Math.max(8, window.innerWidth - r.width - 8);
    if (top + r.height > window.innerHeight - 8) top = Math.max(8, window.innerHeight - r.height - 8);
    setPos({ left, top });
  }, [props.x, props.y, customOpen]);

  const close = () => {
    props.onPreview(null); // 取消未保存的预览
    props.onClose();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const light = useMemo(() => THEMES.filter((t) => t.group === 'light'), []);
  const dark = useMemo(() => THEMES.filter((t) => t.group === 'dark'), []);

  /** 改某个色：立即预览 */
  const edit = (k: string, v: string) => {
    const next = { ...draft, [k]: v };
    setDraft(next);
    props.onPreview(next);
  };

  /** 内置主题色卡（浅色/深色共用） */
  const chip = (t: { key: string; name: string; color: string }) => (
    <button key={t.key} className={`theme-chip ${props.theme === t.key ? 'active' : ''}`} title={t.name} onClick={() => props.onPick(t.key)}>
      <span className="theme-dot" style={{ background: t.color }} />
      <span className="theme-chip-name">{t.name}</span>
    </button>
  );

  return (
    <>
      <div
        style={{ position: 'fixed', inset: 0, zIndex: 299 }}
        onClick={close}
        onContextMenu={(e) => {
          e.preventDefault();
          close();
        }}
      />
      <div ref={ref} className="ctx-menu theme-pop" style={{ left: pos.left, top: pos.top }}>
        <div className="theme-pop-group">浅色</div>
        <div className="theme-pop-grid">{light.map(chip)}</div>
        <div className="theme-pop-group">深色</div>
        <div className="theme-pop-grid">{dark.map(chip)}</div>

        {props.myThemes.length > 0 && (
          <>
            <div className="theme-pop-group">我的主题</div>
            <div className="theme-pop-grid">
              {props.myThemes.map((t) => (
                <button
                  key={t.key}
                  className={`theme-chip ${props.theme === t.key ? 'active' : ''}`}
                  title={`${t.name}（右键删除）`}
                  onClick={() => props.onPick(t.key)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    props.onDelete(t.key);
                  }}
                >
                  <span className="theme-dot" style={{ background: t.panel, borderColor: t.accent }} />
                  <span className="theme-chip-name">{t.name}</span>
                </button>
              ))}
            </div>
          </>
        )}

        <div className="ctx-sep" />
        <button className="theme-custom-toggle" onClick={() => setCustomOpen((v) => !v)}>
          <IconPalette /> 自定义配色 {customOpen ? '▾' : '▸'}
        </button>
        {customOpen && (
          <div className="theme-custom">
            {EDITABLE.map((f) => (
              <label key={f.key} className="theme-color-row">
                <input type="color" value={draft[f.key]} onChange={(e) => edit(f.key, e.target.value)} />
                <span>{f.label}</span>
                <span className="dim small mono">{draft[f.key]}</span>
              </label>
            ))}
            <div className="row" style={{ gap: 6, marginTop: 8 }}>
              {/* type="text" 不能漏：全局输入框样式挂在 input[type=text] 上，漏了就落成浏览器默认样式 */}
              <input type="text" placeholder="主题名称" value={name} onChange={(e) => setName(e.target.value)} style={{ flex: 1, minWidth: 0 }} />
              <button
                className="mini"
                disabled={!name.trim()}
                onClick={() => {
                  props.onSave({ key: `my-${Date.now().toString(36)}`, name: name.trim(), ...draft });
                  props.onPreview(null);
                  props.onClose();
                }}
              >
                保存
              </button>
            </div>
            <div className="dim small" style={{ marginTop: 4 }}>改色即时预览；保存后出现在「我的主题」，右键可删。</div>
          </div>
        )}
      </div>
    </>
  );
}
