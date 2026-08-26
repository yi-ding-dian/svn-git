/** 定位/跳转动画编排：面包屑点亮 + 文件卡片脉冲。
 * CSS 动画（.crumb-flash / .file-pulse 的 keyframes）在 style.css；本文件只做时序编排与无障碍降级。
 * 用法示例：角标跳转 = flashBreadcrumbs(面包屑链) → setDir/setPendingLocate；卡片脉冲由渲染组件用状态
 * 挂 .file-pulse class（动画必然触发，不依赖 DOM 引用时序）。 */

/** 系统「减少动效」偏好：降级为无动画（直接跳转/选中，无障碍与老机器友好） */
export const prefersReducedMotion = () =>
  typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** 面包屑逐级点亮：按 rels 顺序逐个元素加 .crumb-flash（每级闪光约 560ms，间隔 stepMs；减动效时快速跳过） */
export async function flashBreadcrumbs(ref: HTMLElement | null, rels: string[], stepMs = 220): Promise<void> {
  if (!ref || prefersReducedMotion()) return;
  for (const rel of rels) {
    const el = ref.querySelector<HTMLElement>(`[data-rel="${CSS.escape(rel)}"]`);
    if (el) {
      el.classList.add('crumb-flash');
      setTimeout(() => el.classList.remove('crumb-flash'), 560);
    }
    await sleep(stepMs);
  }
}
