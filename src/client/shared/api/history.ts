/** 历史 / 差异 / 提交说明相关的 API。 */
import { api, json, type DiffResult, type LogEntry } from './core.js';
import type { ParsedDiff } from '../../../shared/types.js';

/** 最近项目记录（含常用标记） */
export interface HistoryItem {
  path: string;
  /** wsl：WSL/纯 Node 包的运行目录（不是版本库，点击走目录浏览） */
  type: 'svn' | 'git' | 'wsl';
  lastOpened: number;
  /** 打开时的操作范围（相对仓库根的子项目路径；空/缺省 = 整个工作副本）。
   *  点最近项目时拼回 path 下再打开，恢复上次的子项目范围 */
  scope?: string;
  fav?: boolean;
  /** 用户备注（右键「备注」设置）：显示在时间前，过长由 CSS 截断；空/缺省 = 无备注 */
  remark?: string;
}

export const getHistory = {
  log: (pathRel?: string, limit?: number, offset?: number, afterRev?: string) => {
    const q = new URLSearchParams();
    if (pathRel) q.set('path', pathRel);
    if (limit !== undefined) q.set('limit', String(limit)); // 0 = 全量
    if (offset) q.set('offset', String(offset)); // 续拉：已加载条数
    if (afterRev) q.set('afterRev', afterRev); // svn 续拉：已加载最老版本
    const qs = q.toString();
    return api<{ logs: LogEntry[]; unpushed: string[]; total: number; totalGt?: boolean }>(`/api/log${qs ? `?${qs}` : ''}`);
  },
  diff: (pathRel?: string, a?: string, b?: string) => {
    const q = new URLSearchParams();
    if (pathRel) q.set('path', pathRel);
    if (a) q.set('a', a);
    if (b) q.set('b', b);
    return api<DiffResult>(`/api/diff?${q}`);
  },
  fileVersions: (path: string, a?: string, b?: string) => {
    const q = new URLSearchParams({ path });
    if (a) q.set('a', a);
    if (b) q.set('b', b);
    return api<{ left: string; right: string; leftLabel: string; rightLabel: string }>(`/api/file-versions?${q}`);
  },
  fileMtime: (path: string) => api<{ mtime: number; size: number }>(`/api/file-mtime?path=${encodeURIComponent(path)}`),
  show: (rev: string, pathRel?: string) => {
    const q = new URLSearchParams({ rev });
    if (pathRel) q.set('path', pathRel);
    return api<DiffResult>(`/api/show?${q}`);
  },
  /** worktree=true：明确读工作区版本（内容搜索跳转用；git 默认读 HEAD 版，行号会与工作区对不上） */
  cat: (pathRel: string, worktree = false) =>
    api<DiffResult & { encoding?: string; truncated?: boolean }>(
      `/api/cat?path=${encodeURIComponent(pathRel)}${worktree ? '&source=worktree' : ''}`
    ),
  history: () => api<{ items: HistoryItem[] }>('/api/history'),
  blame: (path: string) => api<{ lines: { rev: string; author: string; date: string; line: number; text: string }[] }>(`/api/blame?path=${encodeURIComponent(path)}`),
  /** 提交完整说明（标题+正文）：改注释弹窗回显用（列表接口只带 %s 标题，不含正文） */
  commitMessage: (rev: string) => api<{ message: string }>(`/api/commit-message?rev=${encodeURIComponent(rev)}`),
  gitUnpushedCount: () => api<{ count: number }>('/api/git-unpushed-count'),
  gitUnpushed: () => api<{ count: number; unpushed: LogEntry[] }>('/api/git-unpushed'),
  /** 单文件的逐块差异（hunk 级部分提交用） */
  diffHunks: (path: string) => api<ParsedDiff>(`/api/diff-hunks?path=${encodeURIComponent(path)}`),
};

export const postHistory = {
  history: (path: string, type: 'svn' | 'git') => api<{ ok: boolean }>('/api/history', json({ path, type })),
  /** scope：同一仓库的不同子项目条目（大仓库按子项目分条记录） */
  historyRemove: (path: string, scope?: string) => api<{ ok: boolean; items: HistoryItem[] }>('/api/history-remove', json({ path, scope })),
  historyFav: (path: string, fav: boolean, scope?: string) => api<{ ok: boolean; items: HistoryItem[] }>('/api/history-fav', json({ path, scope, fav })),
  /** 设置/清除备注（侧边栏右键菜单）：传空串 = 清除；scope 区分子项目条目 */
  historyRemark: (path: string, remark: string, scope?: string) => api<{ ok: boolean; items: HistoryItem[] }>('/api/history-remark', json({ path, scope, remark })),
  /** 批量提交完整说明（rev → 标题+正文）：提交列表悬浮提示用 */
  commitMessages: (revs: string[]) => api<{ messages: Record<string, string> }>('/api/commit-messages', json({ revs })),
};
