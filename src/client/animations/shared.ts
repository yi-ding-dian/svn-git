/** 动画域（animations）共用原语：减动效判断、时序工具、行元素定位。
 *  各动画模块只 import 这里 + 写自己的编排；样式（keyframes/class）在 animations.css，构建时拼进 style.css。 */

/** 系统「减少动效」偏好：降级为无动画（直接生效，无障碍与老机器友好）。
 *  纯缩放类的小反馈可保留（如落点脉冲），位移/飞行类一律跳过。 */
export const prefersReducedMotion = () =>
  typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** 等 n 帧（DOM 更新后取新节点/位置用；减少动效时 rAF 照常走，不受影响） */
export const nextFrames = (n = 2) =>
  new Promise<void>((resolve) => {
    const tick = (left: number) => (left <= 0 ? resolve() : requestAnimationFrame(() => tick(left - 1)));
    tick(n);
  });

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** 按 rel 找文件列表里的行（tree-row/grid-item 由渲染组件挂 data-fs-rel——文件树/列表/网格三视图统一） */
export function findRowEl(rel: string): HTMLElement | null {
  const esc = CSS.escape(rel);
  return document.querySelector<HTMLElement>(`.tree-row[data-fs-rel="${esc}"], .grid-item[data-fs-rel="${esc}"]`);
}

/** 等行出现：操作成功后列表刷新是异步的（还要拉一次文件列表），轮询等 React 把行挂上 DOM。
 *  超时返回 null —— 调用方静默跳过（行已不在当前视图属正常场景，不是错误）。 */
export async function waitRowEl(rel: string, maxMs = 800): Promise<HTMLElement | null> {
  const t0 = performance.now();
  for (;;) {
    const el = findRowEl(rel);
    if (el) return el;
    if (performance.now() - t0 > maxMs) return null;
    await nextFrames(1);
  }
}

/** 等行位置稳定：操作成功后列表还要重新拉数据再渲染，行可能换位（有改动/干净分组排序，
 *  revert/commit 后常移动——若此刻按旧位置建浮层就会错位）。位置连续 3 帧不变才认为就位；
 *  最多等 maxMs（列表刷新慢时超时开播，后续移动由 playOnRow 的跟随兜底）。 */
async function waitRowStable(el: HTMLElement, maxMs = 500): Promise<void> {
  const t0 = performance.now();
  let last = '';
  let same = 0;
  while (performance.now() - t0 < maxMs) {
    const r = el.getBoundingClientRect();
    const key = `${r.left},${r.top},${r.width}`;
    same = key === last ? same + 1 : 0;
    if (same >= 3) return;
    last = key;
    await nextFrames(1);
  }
}

/** 行浮层编排（盖章/扫过/对勾/落座共用）：
 *  等行出现 → 等行位置稳定 → 在行的位置放一个覆盖行矩形的 fixed 浮层（pointer-events:none，
 *  不入布局）→ 跑 build 里的动画（返回的动画会被等待）→ 全部结束后移除浮层。
 *  播放期间浮层跟随行（列表后续刷新/滚动导致行移动时不脱位）。
 *  行没等到、或在视口外（滚动掉/不在当前目录）：静默跳过——看不见的动画没有意义。 */
export async function playOnRow(
  rel: string,
  build: (ctx: { layer: HTMLElement; row: HTMLElement; rect: DOMRect }) => Animation[] | void,
): Promise<void> {
  const row = await waitRowEl(rel);
  if (!row) return;
  await waitRowStable(row);
  const rect = row.getBoundingClientRect();
  if (rect.width < 8 || rect.bottom < 0 || rect.top > window.innerHeight || rect.right < 0 || rect.left > window.innerWidth) return;

  const layer = document.createElement('div');
  layer.className = 'anim-row-layer';
  Object.assign(layer.style, {
    position: 'fixed',
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
    pointerEvents: 'none',
    zIndex: '290',
  });
  document.body.appendChild(layer);

  // 跟随行：行被 React 移动（重排）或页面滚动时，浮层跟着对齐，动画不脱位
  let raf = 0;
  let px = rect.left;
  let py = rect.top;
  const follow = () => {
    if (!row.isConnected || !layer.isConnected) return;
    const r = row.getBoundingClientRect();
    if (r.left !== px || r.top !== py) {
      px = r.left;
      py = r.top;
      layer.style.left = `${px}px`;
      layer.style.top = `${py}px`;
    }
    raf = requestAnimationFrame(follow);
  };
  raf = requestAnimationFrame(follow);

  const anims = build({ layer, row, rect }) ?? [];
  if (anims.length) {
    await Promise.all(
      anims.map(
        (a) =>
          new Promise<void>((resolve) => {
            a.addEventListener('finish', () => resolve());
            a.addEventListener('cancel', () => resolve());
          }),
      ),
    );
  }
  cancelAnimationFrame(raf);
  layer.remove();
}

/** 多行错峰步长 → 本行的延迟（行多时封顶，总窗口不拖长） */
export const staggerDelay = (i: number, stepMs: number, capMs: number) => Math.min(i * stepMs, capMs);
