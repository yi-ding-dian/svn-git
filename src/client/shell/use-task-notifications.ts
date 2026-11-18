/** 后台任务完成通知：从 app.tsx 原样抽出。
 *
 *  统一走「铃铛气泡」（header：气泡弹出 3.5 秒 + 铃铛留档，见 notices）。
 *  取消不通知（用户自己点的）；结果任何时候都在铃铛里可翻。
 */
import { useEffect, useRef } from 'react';
import { addNotice } from '../shared/notices.js';
import { useTasks, type BgTask } from '../shared/tasks.js';

export function useTaskNotifications(): BgTask[] {
  // 后台任务完成通知：统一走「铃铛气泡」（header：气泡弹出 3.5 秒 + 铃铛留档，见 notices）。
  // 取消不通知（用户自己点的）；结果任何时候都在铃铛里可翻
  const bgTasks = useTasks();
  const notifiedTaskIdsRef = useRef<Set<number>>(new Set());
  useEffect(() => {
    for (const tk of bgTasks) {
      if (tk.status === 'running' || notifiedTaskIdsRef.current.has(tk.id)) continue;
      notifiedTaskIdsRef.current.add(tk.id);
      if (tk.status === 'cancelled') continue;
      // 铃铛留档（携带任务详情——更新结果可在面板里点开）+ 气泡由 header 按最新通知弹出
      addNotice({ title: tk.title, message: tk.message ?? '', err: tk.status === 'error', detail: tk.data, taskId: tk.id });
    }
  }, [bgTasks]);
  return bgTasks;
}
