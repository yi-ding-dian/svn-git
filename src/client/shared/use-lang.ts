/** 界面语言：React 侧订阅 + 本地持久化 + 与主进程同步。
 *
 *  分工（核心逻辑在 `src/shared/i18n/index.ts`，那边是纯 TS、无 React）：
 *  - 本文件只管**浏览器侧**：把语言存进 localStorage、并在变化时通知主进程。
 *  - 主进程（server / vcs / main 共享同一模块实例）收到 `POST /api/lang` 后 `setLang`，
 *    于是服务端返回的消息语言随之切换 —— 否则会出现「按钮变英文、报错还是中文」。
 *
 *  两个客户端（Electron 窗口 / 外部浏览器）localStorage 各自独立，但都通过 POST 汇到同一个主进程。
 *  故对齐规则是：**本地有偏好就用本地的**（该客户端自己的选择），本地没有才跟随主进程。
 */
import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { getLang, setLang, subscribeLang, isLang, t, type Lang } from '../../shared/i18n/index.js';
import { get, post } from './api.js';

const LS_KEY = 'svngit-lang';

function readLocal(): Lang | null {
  try {
    const v = localStorage.getItem(LS_KEY);
    return isLang(v) ? v : null;
  } catch {
    return null; // 隐私模式等 localStorage 不可用：当作无偏好
  }
}

function writeLocal(lang: Lang): void {
  try {
    localStorage.setItem(LS_KEY, lang);
  } catch {
    /* ignore */
  }
}

/** 应用本地偏好。在 `main.tsx` 的 `createRoot` **之前**调用：晚一步会先渲染中文再跳英文（闪一下）。 */
export function initLang(): void {
  const local = readLocal();
  if (local) setLang(local);
}

/** 挂载后对齐一次。本地已存偏好时直接返回，不打扰主进程（正常切换流程里两边早已一致）。 */
export function syncLangFromServer(): void {
  if (readLocal()) return;
  void get
    .lang()
    .then((r) => {
      if (isLang(r.lang)) {
        setLang(r.lang);
        writeLocal(r.lang);
      }
    })
    .catch(() => {
      /* 服务未就绪：保持默认语言，首次切换时会自然对齐 */
    });
}

/** 当前语言 + 切换。切语言会重渲染整棵树（`useSyncExternalStore` 订阅模块级变量）。
 *
 *  ⚠️ 必须在 **App 根组件**也调用一次：本 hook 只在调用它的组件里触发重渲染，
 *  若只有 Header 订阅，Filesystem / History 等兄弟视图的 `t()` 不会重算、界面只变一半。
 */
export function useLang(): { lang: Lang; changeLang: (next: Lang) => void } {
  const lang = useSyncExternalStore(subscribeLang, getLang);
  // 标签页 / Electron 窗口标题（Electron 默认让页面的 document.title 覆盖窗口标题，
  // 故不必在主进程 setTitle —— 主进程的语言只影响系统对话框等原生 UI）
  useEffect(() => {
    // svn-git文件版本管理
    document.title = t('main.title');
  }, [lang]);
  const changeLang = useCallback((next: Lang) => {
    setLang(next); // 本地立即生效，不等网络
    writeLocal(next);
    // 通知主进程（server/vcs/main 的消息语言随之切换）。失败不阻断界面：本地已切，
    // 下次 POST（或下次启动同步）会再对上。
    void post.lang(next).catch(() => {});
  }, []);
  return { lang, changeLang };
}
