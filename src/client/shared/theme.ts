/** 主题变量派生（纯函数，无 React）：appearance 的自定义主题 与 filesystem 的 md 阅读主题共用。
 *  放 shared 是因为两边都要用 —— 放任何一边都会造成跨域依赖（依赖检查脚本抓到过这一处）。 */

/** 自定义主题：只存 6 个自选色，其余变量由 deriveThemeVars 推导 */
export interface MyTheme {
  key: string;
  name: string;
  bg: string;
  panel: string;
  border: string;
  text: string;
  dim: string;
  accent: string;
}

// ---------- 颜色工具 ----------

/** '#rgb' / '#rrggbb' / 'rgb(r,g,b)' → [r,g,b]（取色器回填与亮度计算共用） */
function rgbOf(c: string): [number, number, number] {
  const s = c.trim();
  if (s.startsWith('#')) {
    const h = s.length === 4 ? s.replace(/#(.)(.)(.)/, '#$1$1$2$2$3$3') : s;
    return [parseInt(h.slice(1, 3), 16) || 0, parseInt(h.slice(3, 5), 16) || 0, parseInt(h.slice(5, 7), 16) || 0];
  }
  const m = s.match(/(\d+)\D+(\d+)\D+(\d+)/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [0, 0, 0];
}
const h2 = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
/** 任意 CSS 颜色 → '#rrggbb'（input[type=color] 只认十六进制） */
export function toHex(c: string): string {
  const [r, g, b] = rgbOf(c);
  return `#${h2(r)}${h2(g)}${h2(b)}`;
}
/** 感知亮度（0=黑 1=白）：决定语义色/高亮色该用深色版还是亮色版 */
function luminance(c: string): number {
  const [r, g, b] = rgbOf(c).map((v) => v / 255) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
/** a、b 按 t（0-1）混合，用于推导 panel2/border2 */
function mix(a: string, b: string, t: number): string {
  const [r1, g1, b1] = rgbOf(a);
  const [r2, g2, b2] = rgbOf(b);
  return `#${h2(r1 + (r2 - r1) * t)}${h2(g1 + (g2 - g1) * t)}${h2(b1 + (b2 - b1) * t)}`;
}

/** 6 个自选色 → 整套 CSS 变量（14 个主题变量 + 9 个代码高亮变量）。
 *  语义色（成功/警告/错误/紫/SVN/Git）与代码高亮按背景明暗自动切深/亮版本。 */
export function deriveThemeVars(t: Omit<MyTheme, 'key' | 'name'>): Record<string, string> {
  const dark = luminance(t.bg) < 0.5;
  return {
    '--bg': t.bg,
    '--panel': t.panel,
    '--panel2': mix(t.panel, dark ? '#ffffff' : '#000000', dark ? 0.08 : 0.06),
    '--border': t.border,
    '--border2': mix(t.border, t.bg, 0.35),
    '--accent': t.accent,
    '--text': t.text,
    '--dim': t.dim,
    '--ok': dark ? '#3fb950' : '#1a7f37',
    '--warn': dark ? '#d29922' : '#9a6700',
    '--err': dark ? '#f85149' : '#cf222e',
    '--purple': dark ? '#a371f7' : '#8250df',
    '--svn': dark ? '#a371f7' : '#8a2be2',
    '--git': dark ? '#ff8c5a' : '#e85d26',
    '--hl-keyword': dark ? '#ff7b72' : '#cf222e',
    '--hl-string': dark ? '#a5d6ff' : '#0a3069',
    '--hl-comment': dark ? '#8b949e' : '#6e7781',
    '--hl-number': dark ? '#79c0ff' : '#0550ae',
    '--hl-title': dark ? '#d2a8ff' : '#8250df',
    '--hl-type': dark ? '#ffa657' : '#953800',
    '--hl-attr': dark ? '#79c0ff' : '#0550ae',
    '--hl-meta': dark ? '#7ee787' : '#1a7f37',
    '--hl-section': dark ? '#d2a8ff' : '#8250df',
  };
}

/** 自定义主题会覆盖的全部变量名：切回内置主题时需逐个清掉 body 上的 inline 值，
 *  否则残留的自定义色会盖住新主题（inline 优先级高于 CSS 里 body[data-theme] 的变量）。 */
export const THEME_VAR_KEYS = Object.keys(
  deriveThemeVars({ bg: '#ffffff', panel: '#ffffff', border: '#ffffff', text: '#ffffff', dim: '#ffffff', accent: '#ffffff' }),
);
