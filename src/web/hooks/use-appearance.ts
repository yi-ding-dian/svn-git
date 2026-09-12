/** 外观状态与应用（主题 / 我的主题 / 字号 / 界面与代码字体）：从 App 抽出（原 app.tsx:71-201）。
 *
 *  - 主题：内置主题靠 CSS 的 `body[data-theme=xxx]` 提供变量；自定义主题（`my-xxx`）由 6 色推导后
 *    写到 body 的 **inline** 变量上。inline 优先级最高会盖住 CSS，所以切回内置主题时必须逐个清掉。
 *  - 我的主题：localStorage 持久化（`svngit-my-themes`），可保存/删除；删除当前主题则回退浅白。
 *  - 字号 / 字体：写 CSS 变量 + localStorage，空字体值表示回退 CSS 默认栈。
 */
import { useCallback, useEffect, useState } from 'react';
import { THEMES } from '../header.js';
import { deriveThemeVars, THEME_VAR_KEYS, type MyTheme } from '../modals/theme-popover.js';
import { FONT_MIN, FONT_MAX } from '../modals/font-modal.js';

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

  // 应用字号
  useEffect(() => {
    document.documentElement.style.setProperty('--font-size', `${fontSize}px`);
    try {
      localStorage.setItem('svngit-fontsize', String(fontSize));
    } catch {
      /* ignore */
    }
  }, [fontSize]);

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
    uiFont,
    setUiFont,
    codeFont,
    setCodeFont,
  };
}
