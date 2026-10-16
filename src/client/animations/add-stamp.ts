/** 添加到版本库：行的「盖章」动画。
 *  时机：add 成功后（行数据已是「已添加」）——在行左端盖下一枚绿色圆章，像把这行"收进册子"。
 *  视觉：印章从 1.9 倍压到 1 倍（过冲回落 = 压印手感）+ 行周圆角描边环扩散一圈；错峰 60ms。 */
import { playOnRow, staggerDelay } from './shared.js';

const STAGGER_MS = 60;
const STAGGER_CAP_MS = 600;
const MAX_ROWS = 50; // 一次操作播动画的行数上限（再多也只是列表刷新，不逐行盖）

export function stampAddedRows(rels: string[]): void {
  rels.slice(0, MAX_ROWS).forEach((rel, i) => {
    void playOnRow(rel, ({ layer }) => {
      const delay = staggerDelay(i, STAGGER_MS, STAGGER_CAP_MS);
      // 印章：行左端，快速压下（带过冲）→ 停留 → 收走
      const seal = document.createElement('span');
      seal.className = 'anim-seal';
      seal.textContent = '✓';
      layer.appendChild(seal);
      const a1 = seal.animate(
        [
          { transform: 'scale(1.9) rotate(-10deg)', opacity: 0, easing: 'cubic-bezier(.2,1.5,.4,1)' },
          { transform: 'scale(1) rotate(0deg)', opacity: 1, offset: 0.2 },
          { transform: 'scale(1) rotate(0deg)', opacity: 1, offset: 0.78, easing: 'ease-in' },
          { transform: 'scale(0.8) rotate(0deg)', opacity: 0 },
        ],
        { duration: 1000, delay, fill: 'both' },
      );
      // 描边环：整行一圈绿光扩散（"盖下去、墨晕开"）
      const ring = document.createElement('div');
      ring.className = 'anim-seal-ring';
      layer.appendChild(ring);
      const a2 = ring.animate(
        [
          { transform: 'scale(0.975)', opacity: 0 },
          { transform: 'scale(1.012)', opacity: 0.95, offset: 0.45, easing: 'ease-out' },
          { transform: 'scale(1.035)', opacity: 0 },
        ],
        { duration: 780, delay: delay + 90, fill: 'both' },
      );
      return [a1, a2];
    });
  });
}
