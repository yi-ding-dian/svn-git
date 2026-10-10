/** i18n 核心：模块级语言状态 + `t()`。
 *
 *  **本文件是纯 TS、禁止 import React** —— `src/shared` 被两个 tsconfig 同时编译
 *  （node 端 `tsconfig.json` 与 web 端 `tsconfig.web.json`），一旦引入 React，
 *  server / vcs / main 的构建会被拖进 React 依赖。React 侧订阅见 `client/shared/use-lang.ts`。
 *
 *  为什么用「模块级变量」而不是 context / props：
 *  Electron 下 `server` + `vcs` + `main` 同属主进程，**共享同一个模块实例**，
 *  改一个变量三处同时生效；client 虽在渲染进程（另一实例），但 `t()` 是纯函数调用，
 *  组件里直接 `{t('x.y')}` 即可，**2000 个调用点不必逐个穿透 props**，
 *  只需在 App 顶层挂一个 `useLang()` 订阅、语言变了整树重渲染。
 *
 *  ⚠️ 陷阱：模块顶层求值的文案（如 `const TOOLS = [{ label: t('x') }]`）只算一次，
 *  切语言不会跟着变。这类常量表要把取值写成函数（`label: () => t('x')`）或放进 render 回调。
 */
import { zh, type I18nKey } from './zh/index.js';
import { en } from './en/index.js';

export type { I18nKey };

export type Lang = 'zh' | 'en';

/** 语言清单（供 UI 循环渲染菜单项）。**加一门语言只改这里 + 新增语言包文件 + 下面 PACKS 注册一行。** */
export const LANGS: { key: Lang; labelKey: I18nKey }[] = [
  { key: 'zh', labelKey: 'lang.zh' },
  { key: 'en', labelKey: 'lang.en' },
];

const PACKS: Record<Lang, Record<I18nKey, string>> = { zh, en };

/** 默认语言：中文（main 进程启动时会按 ~/.config/svngit/config.json 覆盖） */
export const DEFAULT_LANG: Lang = 'zh';

let current: Lang = DEFAULT_LANG;

export function getLang(): Lang {
  return current;
}

/** 切语言。同值直接返回；变化时通知所有订阅者（React 侧据此重渲染）。 */
export function setLang(lang: Lang): void {
  if (lang === current) return;
  current = lang;
  for (const fn of [...listeners]) fn();
}

const listeners = new Set<() => void>();

/** 订阅语言变化，返回取消订阅函数。 */
export function subscribeLang(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** 取当前语言的 key 是否合法（用于校验来自 localStorage / HTTP 的未知字符串） */
export function isLang(v: unknown): v is Lang {
  return v === 'zh' || v === 'en';
}

/** 取文案 + 插值。
 *
 *  - `{name}` → `params.name`
 *  - 值含 `|` 时按 `params.n` 选单复数：`n === 1` 取前段，否则取后段（英文用，中文包不写 `|`）
 *
 *  `key` 是 `I18nKey` 字面量联合，写错 key 编译期就报错。
 */
export function t(key: I18nKey, params?: Record<string, string | number>): string {
  const raw = PACKS[current][key];
  let s = raw;
  if (raw.includes('|')) {
    const n = typeof params?.n === 'number' ? params.n : 1;
    const parts = raw.split('|');
    s = (n === 1 ? parts[0] : parts[1]) ?? raw;
  }
  if (params) {
    for (const [k, v] of Object.entries(params)) s = s.replaceAll(`{${k}}`, String(v));
  }
  return s;
}
