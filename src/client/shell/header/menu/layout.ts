/** 顶栏布局：默认布局 + localStorage 读写 + 分隔符工具。 */
import type { ToolbarLayout } from './types.js';
import { TOOLS } from './index.js';

export const LAYOUT_KEY = 'svngit-toolbar';

/** 默认布局：工具栏按钮（可见时按此顺序渲染，sep=分隔符可拖拽调整），其余固定项默认收在 ⋯ 菜单 */
export const DEFAULT_LAYOUT: ToolbarLayout = {
  // 标签紧跟分支（都是仓库级操作，放在一起）：默认可见，不再收在 ⋯ 菜单
  shown: ['conflicts', 'pull', 'update', 'push', 'stash', 'sep-1', 'branch', 'tags', 'sep-2', 'clean', 'refresh', 'sep-3', 'exit'],
  hidden: ['open', 'create', 'get', 'terminal', 'font', 'git-info', 'svn-info'],
};

/** 新分隔符唯一 id（Date.now 毫秒，工具内足够） */
export function newSepId() {
  return `sep-${Date.now()}`;
}
export const isSepItem = (k: string) => k.startsWith('sep-');

export function loadLayout(): ToolbarLayout {
  try {
    const raw = localStorage.getItem(LAYOUT_KEY);
    if (raw) {
      const p = JSON.parse(raw) as ToolbarLayout;
      if (Array.isArray(p.shown) && Array.isArray(p.hidden)) {
        const known = (k: string) => isSepItem(k) || TOOLS.some((d) => d.key === k);
        // 兼容旧数据：无编号分隔符 'sep' → 唯一化 'sep-1'；SVN 信息旧 key 'login' → 'svn-info'
        const norm = (k: string) => (k === 'sep' ? 'sep-1' : k === 'login' ? 'svn-info' : k);
        return {
          shown: p.shown.filter((k) => known(k) || k === 'login').map(norm),
          hidden: p.hidden.filter((k) => (known(k) && !isSepItem(k)) || k === 'login').map(norm),
        };
      }
    }
  } catch {
    /* 配置损坏按默认处理 */
  }
  return { shown: [...DEFAULT_LAYOUT.shown], hidden: [...DEFAULT_LAYOUT.hidden] };
}
