/** 还原（revert）：行的「擦掉」动画。
 *  时机：revert 成功后——一道绿色光带自左向右扫过整行，像把改动从行上"抹掉擦干净"。
 *  与提交（commit-clear 的对勾）刻意区分：这边是"擦除"，那边是"收走入库"。错峰 60ms。 */
import { playOnRow, staggerDelay } from './shared.js';

const STAGGER_MS = 60;
const STAGGER_CAP_MS = 600;
const MAX_ROWS = 50;

export function sweepRevertedRows(rels: string[]): void {
  rels.slice(0, MAX_ROWS).forEach((rel, i) => {
    void playOnRow(rel, ({ layer }) => {
      const delay = staggerDelay(i, STAGGER_MS, STAGGER_CAP_MS);
      const beam = document.createElement('div');
      beam.className = 'anim-sweep-beam';
      layer.appendChild(beam);
      // 从行左外扫到右外（translateX 百分比相对光带自身宽 = 行宽的 40%）
      return [
        beam.animate(
          [
            { transform: 'translateX(-130%)', opacity: 0, easing: 'cubic-bezier(.45,.05,.6,1)' },
            { transform: 'translateX(30%)', opacity: 1, offset: 0.22 },
            { transform: 'translateX(170%)', opacity: 1, offset: 0.8 },
            { transform: 'translateX(300%)', opacity: 0 },
          ],
          { duration: 620, delay, fill: 'both' },
        ),
      ];
    });
  });
}
