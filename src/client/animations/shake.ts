/** 错误抖动（通用小工具）：元素轻轻左右晃几下（默认 3px、300ms）——
 *  「你以为可以，但不行」的瞬间用，比纯文字更醒目。
 *  接入点：错误 toast 出现、弹窗校验失败处按 Enter 等。 */
import { prefersReducedMotion } from './shared.js';

export function shakeEl(el: HTMLElement | null | undefined, amp = 3): void {
  if (!el || prefersReducedMotion()) return;
  el.animate(
    [
      { transform: 'translateX(0)' },
      { transform: `translateX(${-amp}px)` },
      { transform: `translateX(${amp * 0.8}px)` },
      { transform: `translateX(${-amp * 0.5}px)` },
      { transform: 'translateX(0)' },
    ],
    { duration: 300, easing: 'ease-in-out' },
  );
}
