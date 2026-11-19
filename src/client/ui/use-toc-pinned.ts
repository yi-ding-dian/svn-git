/** 目录浮层的「固定」状态（Markdown 文档目录 / 代码大纲共用）。
 *
 *  固定后：浮层下的遮罩不再拦截鼠标（点正文、选中文字、滚轮滚正文都不关），
 *  正文滚动时目录自动跟随当前章节；偏好存 localStorage，跨文件、跨视图保持。
 *  做成模块级 store（useSyncExternalStore）：按钮与浮层往往不在同一组件里，
 *  右键按钮菜单改状态后浮层要立刻生效，不能各存各的。
 */
import { useSyncExternalStore } from 'react';

const KEY = 'svn-git:md-toc-pinned';

function read(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false; // 隐私模式 / 禁用存储：本次会话内仍然可固定，只是不记得
  }
}

let pinned = read();
const subs = new Set<() => void>();

export function setTocPinned(value: boolean): void {
  if (pinned === value) return;
  pinned = value;
  try {
    localStorage.setItem(KEY, value ? '1' : '0');
  } catch {
    /* 写不进去不影响本次会话 */
  }
  for (const fn of subs) fn();
}

export function toggleTocPinned(): void {
  setTocPinned(!pinned);
}

export function useTocPinned(): boolean {
  return useSyncExternalStore(
    (fn) => {
      subs.add(fn);
      return () => subs.delete(fn);
    },
    () => pinned,
  );
}
