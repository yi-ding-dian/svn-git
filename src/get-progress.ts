/** 「获取」进度（内存态）：解析 git clone --progress 的输出，供 /api/get-progress 与顶栏任务面板用。
 *
 *  ⚠ 三处都是实测踩出来的，改之前先读：
 *   - **进度用 `\r` 原地刷新**，不是一行一条 —— 靠 exec 的 onStderrLine（把 \r 也当分隔）才拿得到；
 *   - **git 的百分比是按对象个数算的**，而对象大小极不均匀（一个 20 MB 的模型也只算 1 个对象），
 *     拿它当进度会长时间卡在 90% 多。所以界面的进度条按 **已收字节 ÷ 总大小** 算，这里只取字节与速度；
 *   - **阶段不止"接收"**：Counting / Compressing（服务端在算、在打包）→ Receiving（真下载，只有这段
 *     有字节和速度）→ Resolving（本地解包）→ **检出文件（完全静默，没有任何输出）**。
 *     最后那段的进度条只能停在原地，所以必须能说出"正在检出文件…"，否则又成了"不知道什么情况"。 */

export type GetPhase = 'counting' | 'compressing' | 'receiving' | 'resolving' | 'checkout';

export interface GetProgress {
  phase: GetPhase;
  /** 已接收字节（receiving 起才有意义） */
  bytes: number;
  /** 字节/秒（git 自己算的滑动平均） */
  speed: number;
  /** 总字节（GitHub API 的 size；未知为 0 → 界面不显示百分比，只显示已下载与速度） */
  total: number;
}

/** 目标目录 → 进度（同一个目标同时只会有一个获取任务） */
const map = new Map<string, GetProgress>();

/** 获取开始：登记一条（total 通常先给 0，查到再补——查总大小要发一次 GitHub 请求，不挡克隆开跑） */
export function progressStart(target: string, total = 0): void {
  map.set(target, { phase: 'counting', bytes: 0, speed: 0, total });
}

/** 补上总大小（查到了才调；没查到就一直 0，界面降级） */
export function progressSetTotal(target: string, total: number): void {
  const p = map.get(target);
  if (p && total > 0) p.total = total;
}

/** 获取结束（成功 / 失败 / 取消都调）：撤掉登记 */
export function progressDone(target: string): void {
  map.delete(target);
}

/** 前端轮询用；没在跑 = ok:false（正常情况：任务已结束 / 是 SVN 检出这种没有进度的获取） */
export function progressGet(target: string): ({ ok: true } & GetProgress) | { ok: false } {
  const p = map.get(target);
  return p ? { ok: true, ...p } : { ok: false };
}

/** "2.62 MiB" → 字节 */
function toBytes(n: string, unit: string): number {
  const v = Number(n) || 0;
  const mul = unit === 'GiB' ? 1024 ** 3 : unit === 'MiB' ? 1024 ** 2 : 1024;
  return Math.round(v * mul);
}

/** git clone 的一行 stderr → 更新进度；认不出的行直接忽略（认证提示等都在其中） */
export function progressFromStderr(target: string, line: string): void {
  const p = map.get(target);
  if (!p) return;
  if (/^remote:\s*Counting objects/.test(line)) {
    p.phase = 'counting';
    return;
  }
  if (/^remote:\s*Compressing objects/.test(line)) {
    p.phase = 'compressing';
    return;
  }
  if (/^Receiving objects/.test(line)) {
    p.phase = 'receiving';
    // `Receiving objects:  23% (831/3609), 2.62 MiB | 4.87 MiB/s`
    const m = /([\d.]+)\s*(KiB|MiB|GiB) \|\s*([\d.]+)\s*(KiB|MiB|GiB)\/s/.exec(line);
    if (m) {
      p.bytes = toBytes(m[1]!, m[2]!);
      p.speed = toBytes(m[3]!, m[4]!);
    }
    return; // 开头几行还没有字节/速度：只更新阶段，数值保持上一次的
  }
  if (/^Resolving deltas/.test(line)) {
    // 解包 100% done 之后就进入**静默的检出阶段**（没有任何输出）——如实切成"检出文件"
    p.phase = /done/.test(line) ? 'checkout' : 'resolving';
  }
}
