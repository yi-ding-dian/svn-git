/** 更新/拉取完成：新来文件的「落座」动画。
 *  时机：update 成功后，对本次更新带来的文件行（update 返回的 files 列表）——
 *  行从上方 10px 滑入 + 淡入（像新到的文件"落到"列表里），左侧滑出一小段绿色竖条
 *  标记"新入列"后收起。错峰 40ms，自上而下依次落座。 */
import { playOnRow, staggerDelay } from './shared.js';

const STAGGER_MS = 40;
const STAGGER_CAP_MS = 600;
const MAX_ROWS = 60;

export function settleUpdatedRows(rels: string[]): void {
  rels.slice(0, MAX_ROWS).forEach((rel, i) => {
    void playOnRow(rel, ({ layer, row }) => {
      const delay = staggerDelay(i, STAGGER_MS, STAGGER_CAP_MS);
      // 行滑入：delay 期间保持"透明+上移"（fill backwards），播完自动归位不残留
      const a1 = row.animate(
        [
          { transform: 'translateY(-10px)', opacity: 0 },
          { transform: 'none', opacity: 1 },
        ],
        { duration: 340, delay, easing: 'cubic-bezier(.2,.8,.3,1)', fill: 'backwards' },
      );
      // 左侧绿竖条：滑出 → 停留 → 淡出
      const bar = document.createElement('span');
      bar.className = 'anim-arrive-bar';
      layer.appendChild(bar);
      const a2 = bar.animate(
        [
          { transform: 'translateX(-6px) scaleY(0.4)', opacity: 0, easing: 'ease-out' },
          { transform: 'none', opacity: 1, offset: 0.26 },
          { transform: 'none', opacity: 1, offset: 0.72, easing: 'ease-in' },
          { transform: 'none', opacity: 0 },
        ],
        { duration: 950, delay, fill: 'both' },
      );
      return [a1, a2];
    });
  });
}
