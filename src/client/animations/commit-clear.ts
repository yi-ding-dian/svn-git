/** 提交成功：行的「收走」动画。
 *  时机：commit 成功后——绿色对勾从行左端弹入（过冲落定）→ 停留 → 缩小收走，
 *  同时行的背景轻轻绿闪一下（"这一行入库了"）。与还原（revert-sweep 的擦除光带）
 *  刻意区分：这边是"收获"。错峰 70ms。 */
import { playOnRow, staggerDelay } from './shared.js';

const STAGGER_MS = 70;
const STAGGER_CAP_MS = 700;
const MAX_ROWS = 50;

export function clearCommittedRows(rels: string[]): void {
  rels.slice(0, MAX_ROWS).forEach((rel, i) => {
    void playOnRow(rel, ({ layer, row }) => {
      const delay = staggerDelay(i, STAGGER_MS, STAGGER_CAP_MS);
      // 对勾：弹入 → 停留 → 缩小收走
      const check = document.createElement('span');
      check.className = 'anim-clear-check';
      check.textContent = '✓';
      layer.appendChild(check);
      const a1 = check.animate(
        [
          { transform: 'scale(0) rotate(-25deg)', opacity: 0, easing: 'cubic-bezier(.2,1.6,.4,1)' },
          { transform: 'scale(1) rotate(0deg)', opacity: 1, offset: 0.28 },
          { transform: 'scale(1) rotate(0deg)', opacity: 1, offset: 0.74, easing: 'ease-in' },
          { transform: 'scale(0.5) rotate(0deg)', opacity: 0 },
        ],
        { duration: 1050, delay, fill: 'both' },
      );
      // 行背景绿闪（无 fill：放完自动撤销，不残留盖住行背景）
      const a2 = row.animate(
        [
          { backgroundColor: 'rgba(63, 185, 80, 0)' },
          { backgroundColor: 'rgba(63, 185, 80, 0.16)', offset: 0.3, easing: 'ease-out' },
          { backgroundColor: 'rgba(63, 185, 80, 0)' },
        ],
        { duration: 680, delay },
      );
      return [a1, a2];
    });
  });
}
