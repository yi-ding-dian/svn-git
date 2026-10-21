/** 传输进度（内存态）：解析 git 的 `--progress` 输出，供 /api/transfer-progress 与顶栏任务面板用。
 *  获取（克隆/检出）、推送、拉取三处共用——它们吐的是同一套格式，只是阶段名不同：
 *   克隆/拉取： Counting → Compressing（**服务端**在算、在打包）→ Receiving（下载，有字节与速度）
 *              → Resolving（本地解包）→ 检出文件（git 完全静默）
 *   推送：     Enumerating → Counting → Compressing（**本地**）→ Writing objects（上传，有字节与速度）
 *              → 之后静默（服务器接收、算引用、回执）
 *
 *  ⚠ 三处都是实测踩出来的，改之前先读：
 *   - **进度用 `\r` 原地刷新**，不是一行一条 —— 靠 exec 的 onStderrLine（把 \r 也当分隔）才拿得到；
 *   - **git 的百分比是按对象个数算的**，而对象大小极不均匀（一个 20 MB 的模型也只算 1 个对象），
 *     拿它当进度会长时间卡住。所以获取的进度条按 **已收字节 ÷ 总大小** 算（分母来自 GitHub API），
 *     这里只取字节与速度；**推送没有分母**（要传多少是本地现算的，事先不知道），
 *     所以推送不画进度条，只显示"已上传多少、多快"；
 *   - **阶段性静默**必须说出来（"检出文件"、"等待服务器"），否则又成了"不知道什么情况"——
 *     这个功能本身就是为用户那句"一直获取不了"加的。
 *
 *  阶段文案用中性措辞（"正在统计对象…"而不是"服务端正在…"）：同一行 push 是本地、clone 是远端，
 *  写死"服务端"在推送时就是错的。 */

export type TransferPhase =
  | 'counting'
  | 'compressing'
  | 'receiving'
  | 'resolving'
  | 'uploading'
  | 'waiting'
  | 'checkout'
  /** svn switch：按输出行统计已处理的文件数（没有字节/总大小） */
  | 'switch';

export interface TransferProgress {
  phase: TransferPhase;
  /** 已传输字节（receiving / uploading 起才有意义） */
  bytes: number;
  /** 字节/秒（git 自己算的滑动平均） */
  speed: number;
  /** 总字节；0 = 未知（推送恒为 0；获取时 GitHub API 查不到也是 0）→ 界面不显示百分比 */
  total: number;
  /** 已检出文件数（SVN 检出：靠周期扫盘上报，见 progressReport；git 流的进度里没有） */
  files?: number;
  /** 阶段式进度（无字节/文件级进度的长操作，如项目迁移）：全部阶段名 */
  steps?: string[];
  /** 当前进行中的阶段索引（0-based；= steps.length 表示已全部完成） */
  currentStep?: number;
}

/** 通道名 → 进度。通道是"哪一次传输"：获取用目标目录（可并发多个），
 *  推送/拉取用 'push' / 'pull'（同一时刻只对一个仓库做，app 侧另有防重入） */
const map = new Map<string, TransferProgress>();

/** 传输开始：登记一条（total 通常先给 0，查到再补——查总大小要发一次 GitHub 请求，不挡克隆开跑） */
export function progressStart(chan: string, total = 0): void {
  map.set(chan, { phase: 'counting', bytes: 0, speed: 0, total });
}

/** 补上总大小（查到了才调；没查到就一直 0，界面降级成只显示已传输与速度） */
export function progressSetTotal(chan: string, total: number): void {
  const p = map.get(chan);
  if (p && total > 0) p.total = total;
}

/** SVN 检出等"没有原生进度输出"的场景：外部**周期扫盘**后上报累计（已落盘文件数 + 字节）。
 *  置 phase='checkout'（界面显示"正在检出文件"）；没登记过（任务已收尾）则忽略 */
export function progressReport(chan: string, files: number, bytes: number, phase: 'checkout' | 'switch' = 'checkout'): void {
  const p = map.get(chan);
  if (p) {
    p.phase = phase;
    p.files = files;
    p.bytes = bytes;
  }
}

/** 阶段式进度：项目迁移这类"服务器端操作、没有字节/文件进度"的长任务用。
 *  前端轮询后显示 ✓ 已完成阶段 + ⟳ 当前阶段；不画假进度条 */
export function progressStepsStart(chan: string, steps: string[]): void {
  map.set(chan, { phase: 'waiting', bytes: 0, speed: 0, total: 0, steps, currentStep: 0 });
}

/** 当前阶段完成，进入下一步（越界封顶在 steps.length） */
export function progressStepsAdvance(chan: string): void {
  const p = map.get(chan);
  if (p?.steps && p.currentStep !== undefined && p.currentStep < p.steps.length) p.currentStep += 1;
}

/** 传输结束（成功 / 失败 / 取消都调）：撤掉登记 */
export function progressDone(chan: string): void {
  map.delete(chan);
}

/** 前端轮询用；没在跑 = ok:false（任务已结束，或这种操作没有传输进度——如 SVN 检出/更新） */
export function progressGet(chan: string): ({ ok: true } & TransferProgress) | { ok: false } {
  const p = map.get(chan);
  return p ? { ok: true, ...p } : { ok: false };
}

/** "2.62 MiB" → 字节 */
function toBytes(n: string, unit: string): number {
  const v = Number(n) || 0;
  const mul = unit === 'GiB' ? 1024 ** 3 : unit === 'MiB' ? 1024 ** 2 : 1024;
  return Math.round(v * mul);
}

/** git 的一行 stderr → 更新进度；认不出的行直接忽略（认证提示、远端 hook 输出都在其中） */
export function progressFromStderr(chan: string, line: string): void {
  const p = map.get(chan);
  if (!p) return;
  // 克隆/拉取时这些行带 `remote: ` 前缀（那是远端进程的输出），推送时不带——前缀可选
  if (/^(remote:\s*)?(Enumerating|Counting) objects/.test(line)) {
    p.phase = 'counting';
    return;
  }
  if (/^(remote:\s*)?Compressing objects/.test(line)) {
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
  if (/^Writing objects/.test(line)) {
    p.phase = 'uploading';
    // 推送的中间几行常常**没有**字节和速度（本地传输太快，git 来不及算平均），
    // 只有收尾那行 `Writing objects: 100% (4/4), 2.86 MiB | 33.69 MiB/s, done.` 一定带
    const m = /([\d.]+)\s*(KiB|MiB|GiB) \|\s*([\d.]+)\s*(KiB|MiB|GiB)\/s/.exec(line);
    if (m) {
      p.bytes = toBytes(m[1]!, m[2]!);
      p.speed = toBytes(m[3]!, m[4]!);
    }
    // 上传完 → 进入静默的"等服务器"（接收、算引用、回执）
    if (/done\./.test(line)) p.phase = 'waiting';
    return;
  }
  if (/^Resolving deltas/.test(line)) {
    // 解包 100% done 之后就进入**静默的检出阶段**（没有任何输出）——如实切成"检出文件"
    p.phase = /done/.test(line) ? 'checkout' : 'resolving';
  }
}
