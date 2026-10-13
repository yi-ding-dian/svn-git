/** 后台任务 store（模块级，业务无关）：让耗时操作**活过发起它的弹窗**——
 *  检出弹窗点「−」最小化（或关掉）后任务继续跑；顶栏指示器/任务面板订阅本 store
 *  显示进度与结果，发起方（弹窗）也按任务状态渲染自己的界面。
 *
 *  任务 = { title + run(signal) }：run 抛出（含用户取消的 ApiError cancelled）→ 任务失败/取消；
 *  正常返回 { ok, message, data } → done / error（ok=false——如检出认证失败，data 带回业务细节）。
 *  订阅用 useSyncExternalStore：快照是不可变数组，任何变更都换新数组引用。 */
import { useSyncExternalStore } from 'react';

export interface BgTask {
  id: number;
  /** 面板/指示器显示用（如「检出到本地 · ui-test1」） */
  title: string;
  status: 'running' | 'done' | 'error' | 'cancelled';
  /** 开始时间（面板按它算"已用 n 秒"） */
  startedAt: number;
  /** 结束时间（完成的任务排序靠后：新的在前） */
  endedAt?: number;
  /** 结果消息（面板行内 + 完成 toast 用；如「已检出到 /path」/「已取消」） */
  message?: string;
  /** run 的返回值（业务侧读——如检出响应里的 authError/repoDir） */
  data?: unknown;
  /** 被最小化过（发起弹窗已收起）：完成时由 App 发"可点 toast"通知——
   *  弹窗还开着时结果就在眼前，不重复弹（避免噪音） */
  detached?: boolean;
}

export interface TaskRunResult {
  ok: boolean;
  message: string;
  data?: unknown;
}

let nextId = 1;
let tasks: BgTask[] = [];
const listeners = new Set<() => void>();
/** 取消句柄不进公开快照（快照只放可序列化状态） */
const aborts = new Map<number, AbortController>();

function emit() {
  for (const l of listeners) l();
}

/** 启动一个后台任务，返回任务 id（发起方拿它订阅状态/取消） */
export function startTask(opts: {
  title: string;
  run: (signal: AbortSignal) => Promise<TaskRunResult>;
}): number {
  const id = nextId++;
  const ac = new AbortController();
  aborts.set(id, ac);
  tasks = [{ id, title: opts.title, status: 'running', startedAt: Date.now() }, ...tasks];
  emit();
  void opts
    .run(ac.signal)
    .then((r) => {
      if (!aborts.has(id)) return; // 已被取消收尾过（cancel 先落地）
      aborts.delete(id);
      patch(id, { status: r.ok ? 'done' : 'error', message: r.message, data: r.data, endedAt: Date.now() });
    })
    .catch((e: unknown) => {
      if (!aborts.has(id)) return;
      aborts.delete(id);
      const err = e as Error & { cancelled?: boolean };
      // 已取消（用户点了取消——ApiError.cancelled）
      patch(id, { status: err.cancelled ? 'cancelled' : 'error', message: err.message, endedAt: Date.now() });
    });
  return id;
}

/** 取消进行中的任务（abort 请求/子进程；任务状态由 run 的收尾落到 cancelled） */
export function cancelTask(id: number): void {
  const ac = aborts.get(id);
  if (!ac) return;
  aborts.delete(id);
  ac.abort();
  patch(id, { status: 'cancelled', message: undefined, endedAt: Date.now() });
}

/** 从面板移除一条记录（进行中的不允许移除——需先取消） */
export function removeTask(id: number): void {
  const t = tasks.find((x) => x.id === id);
  if (!t || t.status === 'running') return;
  tasks = tasks.filter((x) => x.id !== id);
  emit();
}

/** 标记任务被最小化到后台（发起弹窗收起、任务继续）——完成通知据此决定是否弹 toast */
export function markDetached(id: number): void {
  patch(id, { detached: true });
}

function patch(id: number, p: Partial<BgTask>) {
  tasks = tasks.map((t) => (t.id === id ? { ...t, ...p } : t));
  emit();
}

/** 订阅全部任务（Header 指示器/面板、CheckoutDialog 等）：变更返回新数组 */
export function useTasks(): BgTask[] {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => tasks
  );
}
