/** 外观状态与应用（主题 / 我的主题 / 字号 / 文字缩放 / 界面与代码字体）：从 App 抽出（原 app.tsx:71-201）。
 *
 *  - 主题：内置主题靠 CSS 的 `body[data-theme=xxx]` 提供变量；自定义主题（`my-xxx`）由 6 色推导后
 *    写到 body 的 **inline** 变量上。inline 优先级最高会盖住 CSS，所以切回内置主题时必须逐个清掉。
 *  - 我的主题：localStorage 持久化（`svngit-my-themes`），可保存/删除；删除当前主题则回退浅白。
 *  - 字号 / 字体：写 CSS 变量 + localStorage，空字体值表示回退 CSS 默认栈。
 *  - 文字缩放：Ctrl+滚轮改比例（100% = 字号设置值），与字号相乘后写 `--font-size`；比例同样持久化。
 *  - 文件内容缩放：另一套比例（`--content-zoom`），只作用于标了 `data-content-zoom` 的内容容器，
 *    鼠标悬停在文件内容区时由 app.tsx 的 Ctrl+滚轮调它，界面字号保持不动。
 */
import { useCallback, useEffect, useState } from 'react';
import { THEMES } from '../shell/header/index.js';
import { deriveThemeVars, THEME_VAR_KEYS, type MyTheme } from '../shared/theme.js';
import { FONT_MIN, FONT_MAX } from './font-modal.js';

/** 文字缩放（Ctrl+滚轮）：百分比步进，100% = 字体设置里的字号。
 *  范围收在 60%–200% —— 再大时固定高度的布局（顶栏、列表行）会开始挤。 */
export const ZOOM_MIN = 60;
export const ZOOM_MAX = 200;
export const ZOOM_STEP = 10;
export const ZOOM_DEFAULT = 100;

/** 文件内容缩放（Ctrl+滚轮悬停在内容区）：只作用于标了 `data-content-zoom` 的容器，界面不动。
 *  内容区是阅读代码/差异的主场，范围放宽到 300%。 */
export const CONTENT_ZOOM_MIN = 60;
export const CONTENT_ZOOM_MAX = 300;
export const CONTENT_ZOOM_DEFAULT = 100;

/** 把当前主题的面板色/文字色同步给原生标题栏按钮区（Windows 自绘标题栏的覆盖层，见 main/index.ts）。
 *  浏览器里没有 preload 注入的 bridge → 静默跳过。 */
function syncTitleBarOverlay(): void {
  const bridge = (window as unknown as {
    svngit?: { setTitleBarOverlay?: (options: { color: string; symbolColor: string }) => void };
  }).svngit;
  if (!bridge?.setTitleBarOverlay) return;
  const style = getComputedStyle(document.body);
  bridge.setTitleBarOverlay({
    color: style.getPropertyValue('--panel').trim(),
    symbolColor: style.getPropertyValue('--text').trim(),
  });
}

export function useAppearance() {
  const [theme, setTheme] = useState(() => {
    try {
      return localStorage.getItem('svngit-theme') ?? 'light'; // 内置 key 或 my-xxx，有效性在下方 effect 校验
    } catch {
      return 'light';
    }
  });
  /** 「我的主题」：自定义配色（6 色 + 名称），持久化 localStorage */
  const [myThemes, setMyThemes] = useState<MyTheme[]>(() => {
    try {
      const arr = JSON.parse(localStorage.getItem('svngit-my-themes') ?? '[]');
      return Array.isArray(arr) ? (arr.filter((t) => t && typeof t.key === 'string' && typeof t.bg === 'string') as MyTheme[]) : [];
    } catch {
      return [];
    }
  });
  /** 主题气泡位置（null = 未打开） */
  const [themePop, setThemePop] = useState<{ x: number; y: number } | null>(null);
  const [fontSize, setFontSize] = useState(() => {
    try {
      const n = Number(localStorage.getItem('svngit-fontsize'));
      return Number.isFinite(n) && n >= FONT_MIN && n <= FONT_MAX ? n : 16;
    } catch {
      return 14;
    }
  });
  /** 文字缩放比例（Ctrl+滚轮调整、Ctrl+0 复原；100% = 上面设置的字号）。
   *  存 localStorage 是为了重启后仍保持上次的比例（与浏览器页面缩放的习惯一致）。 */
  const [zoom, setZoom] = useState(() => {
    try {
      const n = Number(localStorage.getItem('svngit-zoom'));
      return Number.isFinite(n) && n >= ZOOM_MIN && n <= ZOOM_MAX
        ? Math.round(n / ZOOM_STEP) * ZOOM_STEP
        : ZOOM_DEFAULT;
    } catch {
      return ZOOM_DEFAULT;
    }
  });
  /** 文件内容缩放比例（鼠标在文件内容区时 Ctrl+滚轮调整；100% = 内容区原字号） */
  const [contentZoom, setContentZoom] = useState(() => {
    try {
      const n = Number(localStorage.getItem('svngit-content-zoom'));
      return Number.isFinite(n) && n >= CONTENT_ZOOM_MIN && n <= CONTENT_ZOOM_MAX
        ? Math.round(n / ZOOM_STEP) * ZOOM_STEP
        : CONTENT_ZOOM_DEFAULT;
    } catch {
      return CONTENT_ZOOM_DEFAULT;
    }
  });
  /** 界面字体 / 代码字体（空 = 系统默认，随弹窗即时应用并持久化） */
  const [uiFont, setUiFont] = useState(() => {
    try {
      return localStorage.getItem('svngit-uifont') ?? '';
    } catch {
      return '';
    }
  });
  const [codeFont, setCodeFont] = useState(() => {
    try {
      return localStorage.getItem('svngit-codefont') ?? '';
    } catch {
      return '';
    }
  });

  // 应用主题
  useEffect(() => {
    const my = myThemes.find((t) => t.key === theme);
    // 主题已失效（"我的主题"被删 / 换了浏览器 / 旧 key）：回退默认浅白
    if (!my && !THEMES.some((t) => t.key === theme)) {
      setTheme('light');
      return;
    }
    document.body.dataset.theme = my ? '' : theme;
    if (my) {
      for (const [k, v] of Object.entries(deriveThemeVars(my))) document.body.style.setProperty(k, v);
    } else {
      for (const k of THEME_VAR_KEYS) document.body.style.removeProperty(k);
    }
    try {
      localStorage.setItem('svngit-theme', theme);
    } catch {
      /* ignore */
    }
    // 标题栏按钮区跟着换色（写在变量落地之后：上面刚改的 dataset/inline 变量这里才读得到）
    syncTitleBarOverlay();
  }, [theme, myThemes]);

  /** 自定义配色的实时预览：临时写变量（不落库）；传 null 时恢复正式主题的变量 */
  const previewTheme = useCallback(
    (t: Omit<MyTheme, 'key' | 'name'> | null) => {
      if (t) {
        for (const [k, v] of Object.entries(deriveThemeVars(t))) document.body.style.setProperty(k, v);
        return;
      }
      const my = myThemes.find((x) => x.key === theme);
      if (my) {
        for (const [k, v] of Object.entries(deriveThemeVars(my))) document.body.style.setProperty(k, v);
      } else {
        for (const k of THEME_VAR_KEYS) document.body.style.removeProperty(k);
      }
    },
    [myThemes, theme],
  );

  /** 保存「我的主题」并立即应用 */
  const saveMyTheme = useCallback((t: MyTheme) => {
    setMyThemes((prev) => {
      const next = [...prev, t];
      try {
        localStorage.setItem('svngit-my-themes', JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
    setTheme(t.key);
  }, []);

  /** 删除「我的主题」；删的若是当前主题则回退浅白 */
  const deleteMyTheme = useCallback((key: string) => {
    setMyThemes((prev) => {
      const next = prev.filter((t) => t.key !== key);
      try {
        localStorage.setItem('svngit-my-themes', JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
    setTheme((cur) => (cur === key ? 'light' : cur));
  }, []);

  // 应用字号：实际字号 = 设置的字号 × 缩放比例（字号设置仍是 100% 时的基准）
  useEffect(() => {
    const px = Math.round((fontSize * zoom) / 10) / 10;
    document.documentElement.style.setProperty('--font-size', `${px}px`);
    try {
      localStorage.setItem('svngit-fontsize', String(fontSize));
      localStorage.setItem('svngit-zoom', String(zoom));
    } catch {
      /* ignore */
    }
  }, [fontSize, zoom]);

  // 应用文件内容缩放：CSS 变量只有标了 data-content-zoom 的容器读取，界面字号不受影响
  useEffect(() => {
    document.documentElement.style.setProperty('--content-zoom', String(contentZoom / 100));
    try {
      localStorage.setItem('svngit-content-zoom', String(contentZoom));
    } catch {
      /* ignore */
    }
  }, [contentZoom]);

  // 应用界面/代码字体：空值移除 inline 覆盖，回退 CSS 默认栈
  useEffect(() => {
    document.body.style.fontFamily = uiFont || '';
    document.documentElement.style.setProperty('--code-font', codeFont || '');
    try {
      localStorage.setItem('svngit-uifont', uiFont);
      localStorage.setItem('svngit-codefont', codeFont);
    } catch {
      /* ignore */
    }
  }, [uiFont, codeFont]);

  return {
    theme,
    setTheme,
    myThemes,
    previewTheme,
    saveMyTheme,
    deleteMyTheme,
    themePop,
    setThemePop,
    fontSize,
    setFontSize,
    zoom,
    setZoom,
    contentZoom,
    setContentZoom,
    uiFont,
    setUiFont,
    codeFont,
    setCodeFont,
  };
}
