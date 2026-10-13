/** 任务通知 store（模块级）：后台任务完成/失败后**留档**，供顶栏「铃铛」——
 *  完成瞬间已有顶部横幅（3 秒）做即时反馈；没看到也不丢，这里存到用户逐条关闭为止，
 *  全部关完铃铛随之消失（**没有消息时铃铛不存在**——用户定稿）。
 *  取消的任务不进通知（用户自己点的，面板里任务消失即反馈）。
 *  订阅用 useSyncExternalStore：快照是不可变数组，任何变更都换新数组引用。 */
import { useSyncExternalStore } from 'react';

export interface Notice {
  id: number;
  /** 任务标题（如「推送 · main」） */
  title: string;
  /** 结果消息（后端返回的业务消息） */
  message: string;
  /** 失败（true = 红色 ✗；false = 绿色 ✓） */
  err: boolean;
  /** 完成时间（面板显示 HH:MM） */
  at: number;
  /** 已读（点开铃铛面板即全部置读——红点消失） */
  read: boolean;
}

let nextId = 1;
let notices: Notice[] = [];
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

/** 新增一条通知（新的在前） */
export function addNotice(n: { title: string; message: string; err: boolean }): void {
  notices = [{ id: nextId++, title: n.title, message: n.message, err: n.err, at: Date.now(), read: false }, ...notices];
  emit();
}

/** 全部标记已读（铃铛面板打开时调用） */
export function markAllRead(): void {
  if (!notices.some((n) => !n.read)) return;
  notices = notices.map((n) => (n.read ? n : { ...n, read: true }));
  emit();
}

/** 关闭（移除）一条通知 */
export function removeNotice(id: number): void {
  notices = notices.filter((n) => n.id !== id);
  emit();
}

/** 订阅全部通知：变更返回新数组 */
export function useNotices(): Notice[] {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => notices
  );
}
