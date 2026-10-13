/** 魔法飞行线：后台任务「起飞」特效——从触发按钮的位置腾起一颗发光光点，
 *  沿一条**向上拱起**的弧线飞向顶栏的任务锚点（沙漏指示器 [data-task-anchor]），
 *  一路洒落星屑尾迹；抵达时爆散一圈小星星、并给锚点一个脉冲（.task-anchor-pulse）。
 *  用户定稿："点击后飞到后台的沙漏那里，一条很酷的魔法飞行线"。
 *
 *  实现：纯 canvas 全屏浮层（pointer-events:none——不挡任何操作、不碰布局），播完自卸；
 *  顶栏没渲染锚点（如未打开仓库）就静默跳过；prefers-reduced-motion 只做锚点脉冲。
 *  入口：推送确认按钮 / 检出按钮的 onClick（传 getBoundingClientRect()）。 */

/** 星屑/爆散的颜色池（青 → 紫 → 粉 → 白，与顶栏图标同色系） */
const COLORS = ['#7dd3fc', '#a78bfa', '#f0abfc', '#fda4af', '#ffffff'];

interface Particle {
  x: number; y: number; vx: number; vy: number;
  life: number; max: number; r: number; c: string;
}

/** 起飞（from = 按钮的屏幕坐标）。锚点 = 顶栏沙漏指示器 [data-task-anchor]——
 *  它**只在任务运行期间存在**：点确认的瞬间任务刚 startTask、React 还没把指示器挂上 DOM，
 *  这里轮询等它出现（最多约 400ms；任务瞬间失败/取消导致指示器从未出现则放弃动画）。
 *  锚点缺失不是错误场景——静默跳过。 */
export function launchMagicFlight(from: { x: number; y: number }): void {
  void flyToAnchor(from);
}

/** 等锚点出现：逐帧轮询直到出现或超时 */
function findAnchor(maxMs = 400): Promise<HTMLElement | null> {
  const t0 = performance.now();
  return new Promise((resolve) => {
    const tick = () => {
      const el = document.querySelector<HTMLElement>('[data-task-anchor]');
      if (el) return resolve(el);
      if (performance.now() - t0 > maxMs) return resolve(null);
      requestAnimationFrame(tick);
    };
    tick();
  });
}

async function flyToAnchor(from: { x: number; y: number }): Promise<void> {
  const anchor = await findAnchor();
  if (!anchor) return;
  const rect = anchor.getBoundingClientRect();
  const to = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };

  /** 抵达反馈：锚点脉冲（reduced-motion 也保留——纯缩放，无位移） */
  const pulse = () => {
    anchor.classList.add('task-anchor-pulse');
    anchor.addEventListener('animationend', () => anchor.classList.remove('task-anchor-pulse'), { once: true });
  };
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
    pulse();
    return;
  }

  const FLIGHT = 780; // 飞行时长 ms
  const BURST = 420; // 抵达爆散收尾 ms
  const W = window.innerWidth;
  const H = window.innerHeight;

  // 起点 → 终点：二次贝塞尔，控制点向上拱（弧高随距离、落在合理区间）
  const dist = Math.hypot(to.x - from.x, to.y - from.y);
  const arc = Math.min(240, Math.max(70, dist * 0.32));
  const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 - arc };
  const bez = (u: number) => {
    const v = 1 - u;
    return {
      x: v * v * from.x + 2 * v * u * mid.x + u * u * to.x,
      y: v * v * from.y + 2 * v * u * mid.y + u * u * to.y,
    };
  };
  const easeInOut = (u: number) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);

  // 全屏浮层 canvas（DPR 缩放保证清晰；dataset 标记仅供自动化测试识别）
  const cv = document.createElement('canvas');
  cv.dataset.flight = '1';
  cv.style.cssText = 'position:fixed;left:0;top:0;pointer-events:none;z-index:600;';
  const dpr = window.devicePixelRatio || 1;
  cv.width = Math.round(W * dpr);
  cv.height = Math.round(H * dpr);
  cv.style.width = `${W}px`;
  cv.style.height = `${H}px`;
  document.body.appendChild(cv);
  const ctx = cv.getContext('2d');
  if (!ctx) {
    cv.remove();
    return;
  }
  ctx.scale(dpr, dpr);

  const parts: Particle[] = [];
  const trail: { x: number; y: number }[] = []; // 核心轨迹（"魔法飞行线"本体）
  const t0 = performance.now();
  let fired = false;

  const spawn = (x: number, y: number, spread: number, speed: number, up = 0.25) => {
    const a = Math.random() * Math.PI * 2;
    const sp = Math.random() * speed;
    parts.push({
      x: x + (Math.random() - 0.5) * spread,
      y: y + (Math.random() - 0.5) * spread,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp + up, // 轻微下坠，像星屑飘落
      life: 0,
      max: 0.35 + Math.random() * 0.3,
      r: 1.2 + Math.random() * 1.6,
      c: COLORS[(Math.random() * COLORS.length) | 0]!,
    });
  };

  const frame = (now: number) => {
    const t = now - t0;
    ctx.clearRect(0, 0, W, H);
    const f = Math.min(1, t / FLIGHT);
    const p = bez(easeInOut(f));

    // 飞行中：铺轨迹点 + 每帧撒星屑；抵达瞬间：脉冲 + 径向爆散
    if (f < 1) {
      trail.push(p);
      if (trail.length > 16) trail.shift();
      for (let i = 0; i < 3; i++) spawn(p.x, p.y, 5, 0.9);
    } else if (!fired) {
      fired = true;
      pulse();
      for (let i = 0; i < 30; i++) {
        const a = (i / 30) * Math.PI * 2 + Math.random() * 0.3;
        const sp = 1.6 + Math.random() * 2.4;
        parts.push({
          x: to.x, y: to.y,
          vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
          life: 0, max: 0.45 + Math.random() * 0.3,
          r: 1.2 + Math.random() * 1.8,
          c: COLORS[(Math.random() * COLORS.length) | 0]!,
        });
      }
    }

    // 粒子推进 + 死亡回收
    const dt = 1 / 60;
    for (const pt of parts) {
      pt.life += dt;
      pt.x += pt.vx;
      pt.y += pt.vy;
      pt.vx *= 0.98;
      pt.vy *= 0.98;
    }
    for (let i = parts.length - 1; i >= 0; i--) if (parts[i]!.life >= parts[i]!.max) parts.splice(i, 1);

    // ① 尾迹线：由细到粗、由青到白、发光（越新越亮）
    if (trail.length > 1 && f < 1) {
      ctx.save();
      ctx.lineCap = 'round';
      ctx.shadowColor = '#7dd3fc';
      ctx.shadowBlur = 9;
      for (let i = 1; i < trail.length; i++) {
        const a = i / (trail.length - 1);
        const p0 = trail[i - 1]!;
        const p1 = trail[i]!;
        ctx.strokeStyle = a > 0.72 ? `rgba(255,255,255,${(a * 0.92).toFixed(3)})` : `rgba(125,211,252,${(a * 0.85).toFixed(3)})`;
        ctx.lineWidth = 0.6 + a * 3.6;
        ctx.beginPath();
        ctx.moveTo(p0.x, p0.y);
        ctx.lineTo(p1.x, p1.y);
        ctx.stroke();
      }
      ctx.restore();
    }

    // ② 星屑粒子
    for (const pt of parts) {
      const a = Math.max(0, 1 - pt.life / pt.max);
      ctx.globalAlpha = a * 0.9;
      ctx.fillStyle = pt.c;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, pt.r * (0.5 + a * 0.5), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // ③ 核心光点（飞行中）/ 抵达后的收敛光晕 + 扩散环
    if (f < 1) {
      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, 17);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(0.35, 'rgba(125,211,252,.9)');
      g.addColorStop(1, 'rgba(125,211,252,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 17, 0, Math.PI * 2);
      ctx.fill();
    } else {
      const b = Math.min(1, (t - FLIGHT) / BURST);
      const rad = 26 * (1 - b * 0.6);
      const g = ctx.createRadialGradient(to.x, to.y, 0, to.x, to.y, rad);
      g.addColorStop(0, `rgba(255,255,255,${(0.9 * (1 - b)).toFixed(3)})`);
      g.addColorStop(0.5, `rgba(167,139,250,${(0.5 * (1 - b)).toFixed(3)})`);
      g.addColorStop(1, 'rgba(167,139,250,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(to.x, to.y, rad, 0, Math.PI * 2);
      ctx.fill();
      // 扩散环
      ctx.strokeStyle = `rgba(167,139,250,${(0.7 * (1 - b)).toFixed(3)})`;
      ctx.lineWidth = 2 * (1 - b) + 0.5;
      ctx.beginPath();
      ctx.arc(to.x, to.y, 6 + b * 26, 0, Math.PI * 2);
      ctx.stroke();
    }

    if (t < FLIGHT + BURST + 60) requestAnimationFrame(frame);
    else cv.remove();
  };
  requestAnimationFrame(frame);
}
