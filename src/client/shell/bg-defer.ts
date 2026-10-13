/** 「3 秒延迟后台化」：发起操作后若 slowAfterMs（默认 3 秒）内没完成，自动转入后台——
 *  用户定稿："等待超过 3s 没有完成就后台运行，然后通知用户当前操作已后台运行、完成会通知您。"
 *
 *  形态：任务从发起起就在 store 里（沙漏/可取消/完成通知都现成）；
 *   - 3 秒内完成：调用方照常收尾（弹窗内显示结果等），用户无感、零变化；
 *   - 超时未完成：自动调 onSlow **一次**（调用方在此收起弹窗、放飞线、轻提示"已转入后台"）。
 *  任何结局（成功/失败/取消）都会掐掉慢计时，避免完成后误触发。 */
import { startTask, type TaskRunResult } from '../shared/tasks.js';

export function startTaskDeferred(opts: {
  kind?: string;
  title: string;
  run: (signal: AbortSignal) => Promise<TaskRunResult>;
  /** 3 秒未完成 → 收起弹窗 + 飞线（起点=发起按钮 rect）+「已转入后台运行」轻提示 */
  onSlow: () => void;
  slowAfterMs?: number;
}): number {
  let slowTimer: ReturnType<typeof setTimeout> | null = null;
  const id = startTask({
    kind: opts.kind,
    title: opts.title,
    run: async (signal) => {
      try {
        return await opts.run(signal);
      } finally {
        // 任何结局都要掐掉慢计时（成功了就不该再提示"已转入后台"）
        if (slowTimer) clearTimeout(slowTimer);
      }
    },
  });
  slowTimer = setTimeout(() => opts.onSlow(), opts.slowAfterMs ?? 3000);
  return id;
}
