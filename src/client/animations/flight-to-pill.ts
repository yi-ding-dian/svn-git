/** 「稍后看」起飞特效：从点击位置飞向右侧刚出现的胶囊。
 *  胶囊是 addSession 之后才渲染的，这里轻量轮询等它挂上 DOM（最多约 500ms）；
 *  找不到（如已被删除/被 5 个上限挤掉）就静默跳过。 */
import { launchMagicFlight } from './magic-flight.js';

export function flyToSessionPill(from: { x: number; y: number }, key: string): void {
  const t0 = performance.now();
  const find = () => {
    const el = [...document.querySelectorAll<HTMLElement>('[data-session-pill]')].find(
      (x) => x.dataset.sessionPill === key,
    );
    if (el) {
      const r = el.getBoundingClientRect();
      launchMagicFlight(from, { x: r.left + r.width / 2, y: r.top + r.height / 2, pulseEl: el });
      return;
    }
    if (performance.now() - t0 < 500) requestAnimationFrame(find);
  };
  requestAnimationFrame(find);
}
