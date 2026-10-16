/** 删除到回收站：把行「丢出屏幕」的动画。
 *  时机：确认弹窗点「移到回收站」的瞬间**立即**播（不等删除结果——本地删除很快，
 *  失败的行会随列表刷新回来，错误另有 toast）。
 *  视觉：行的替身沿右侧加速甩出屏幕 + 顺时针旋转 + 轻微缩小；多选按 35ms 错峰依次
 *  起飞（行多时错峰窗口封顶 560ms）——「哗啦一把扫出去」。
 *  实现要点：文件列表容器是 overflow:auto，行就地 transform 飞出会被裁剪——先在原位
 *  克隆 fixed 替身（脱离容器），原行加 .anim-fly-hidden 隐藏（visibility 保留占位不塌缩，
 *  等刷新自然重排；动画结束移除隐藏类兜底：删除失败行还在时恢复显示）。 */
import { findRowEl, prefersReducedMotion } from './shared.js';

const FLY_MS = 620; // 单行飞行时长
const STAGGER_MS = 35; // 多选错峰步长
const STAGGER_CAP_MS = 560; // 错峰窗口封顶（行多时不拖长）

export function flyRowsToTrash(rels: string[]): void {
  if (prefersReducedMotion()) return; // 减少动效：不飞，列表照常刷新
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  // 先收集可见的行（视口外/滚动掉的行不飞——飞出去也看不见，纯浪费）
  const targets: { el: HTMLElement; rect: DOMRect }[] = [];
  for (const rel of rels) {
    const el = findRowEl(rel);
    if (!el) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width < 8 || rect.bottom < 0 || rect.top > vh) continue;
    targets.push({ el, rect });
  }
  if (!targets.length) return;

  targets.forEach(({ el, rect }, i) => {
    const ghost = el.cloneNode(true) as HTMLElement;
    // 逐属性设置（不能 cssText 整体覆盖——行自带 inline style：缩进/选中底色要照抄）
    Object.assign(ghost.style, {
      position: 'fixed',
      left: `${rect.left}px`,
      top: `${rect.top}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
      margin: '0',
      pointerEvents: 'none',
      zIndex: '290',
    });
    // 替身不再是"列表里的行"：摘掉定位属性，后续动画查询不会误抓它
    ghost.removeAttribute('data-fs-rel');
    ghost.removeAttribute('data-dir-rel');
    ghost.classList.add('anim-fly-ghost');
    document.body.appendChild(ghost);
    el.classList.add('anim-fly-hidden'); // 原行隐藏（占位），刷新后行被移除、列表一次重排

    // 飞出目标：屏幕右缘之外；轻微上飘 + 顺时针旋转（每行随机一点，成排飞出更自然）
    const dx = vw + rect.width * 0.6 - rect.left;
    const dy = -6 - Math.random() * 18;
    const rot = 12 + Math.random() * 13;
    const anim = ghost.animate(
      [
        { transform: 'translate(0, 0) rotate(0deg) scale(1)' },
        // 中段过半：放一点水平位移和旋转，让加速曲线更"甩"（起步缓、末端冲出去）
        { transform: `translate(${(dx * 0.5).toFixed(1)}px, ${(dy * 0.45).toFixed(1)}px) rotate(${(rot * 0.3).toFixed(1)}deg) scale(0.985)`, offset: 0.5 },
        { transform: `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px) rotate(${rot.toFixed(1)}deg) scale(0.9)` },
      ],
      {
        duration: FLY_MS,
        delay: Math.min(i * STAGGER_MS, STAGGER_CAP_MS),
        easing: 'cubic-bezier(.45,.05,.85,.3)', // 加速甩出（末端冲出去）
        fill: 'both', // delay 期间停原位（原行已隐藏，衔接不闪）、结束保持出屏
      },
    );
    const done = () => {
      ghost.remove();
      // 兜底恢复：删除失败/取消时行还在列表里（React 复用 DOM 不会清手动类）——别让它一直隐形
      el.classList.remove('anim-fly-hidden');
    };
    anim.addEventListener('finish', done);
    anim.addEventListener('cancel', done);
  });
}
