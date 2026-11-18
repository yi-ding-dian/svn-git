/** 服务监听与端口接管：固定端口 23456 → 识别本工具旧实例 → 接管或退回随机端口。 */
import type http from 'node:http';
import type { AddressInfo } from 'node:net';
import { platform } from '../platform/index.js';
import { loadConfig } from '../config.js';
import { t } from '../shared/i18n/index.js';

export interface ServerHandle {
  port: number;
  url: string;
  close: () => Promise<void>;
}

/** 这个端口上跑的是不是**本工具的旧实例**：探一次 /api/info，看响应是不是本工具的形状。
 *  instanceId（每个服务进程启动时随机生成）+ startDir（本工具特有字段）同时存在，
 *  基本只可能是本工具——**先自证再动手**，别的程序恰好占了 23456 时绝不动它。 */
async function isOurInstance(port: number): Promise<boolean> {
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 1500);
    const res = await fetch(`http://127.0.0.1:${port}/api/info`, { signal: ctl.signal });
    clearTimeout(timer);
    if (!res.ok) return false;
    const j = (await res.json()) as Record<string, unknown>;
    return typeof j.instanceId === 'string' && typeof j.startDir === 'string';
  } catch {
    return false; // 连不上 / 超时 / 不是 JSON（或压根不是 HTTP 服务）：一律当"不是我们"
  }
}

/** 端口被占时的接管：确认占用者是本工具的旧实例 → 关掉它 → 等端口真的空出来。
 *  返回 false = 没接管（占用者不是我们 / 查不到 PID / 关不掉），调用方退回随机端口。
 *  ⚠ 卡死的旧实例（进程在、HTTP 不响应）探不通 → 也走 false。不做"按进程名/命令行杀"的兜底：
 *  那类匹配误杀面太大，不值得为少见情形冒这个险。
 *  **导出是给回归脚本用的**：它带端口参数，可以拿临时端口自测接管与"不误杀"，不碰 23456。 */
export async function takeOverPort(port: number): Promise<boolean> {
  if (!(await isOurInstance(port))) return false;
  const pids = await platform.portOwnerPids(port);
  if (pids.length === 0) return false;
  await platform.killProcesses(pids);
  // 等端口真空出来（进程退出 + 内核释放监听；Windows 上通常几百毫秒）
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 200));
    if ((await platform.portOwnerPids(port)).length === 0) return true;
  }
  return false;
}

/** 开始监听并返回可用地址。端口接管/随机退回逻辑与拆分前一致。
 *  close 由调用方在退出时执行（服务进程退出前等连接关闭）。 */
export function listenServer(server: http.Server): Promise<ServerHandle> {
  return new Promise((resolve) => {
    // 固定端口(可预期、便于收藏)：被**本工具的旧实例**占着就关掉它继续用 23456；
    // 换了别的程序占用则退回随机端口（原行为）
    const DEFAULT_PORT = 23456;
    // 共享配置：local 只监听回环，其余监听所有网卡（IP 白名单在 access-control 里校验）
    const HOST = loadConfig().share.mode === 'local' ? '127.0.0.1' : '0.0.0.0';
    const onListen = () => {
      const port = (server.address() as AddressInfo).port;
      resolve({
        port,
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise((r) => server.close(() => r())),
      });
    };
    /** 测试脚本用（test/*.mjs 都置 1）：跑测试不该把用户正在用的实例关掉——
     *  测试只要"随便一个能用的端口"，接管对它们毫无价值、只剩副作用 */
    if (process.env.SVNGIT_NO_PORT_TAKEOVER === '1') {
      server.once('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE') server.listen(0, HOST, onListen);
        else throw err;
      });
      server.listen(DEFAULT_PORT, HOST, onListen);
      return;
    }
    /** 只处理第一次 EADDRINUSE（接管成功后再失败说明另有问题，照旧抛出） */
    let handled = false;
    server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code !== 'EADDRINUSE' || handled) throw err;
      handled = true;
      void (async () => {
        if (await takeOverPort(DEFAULT_PORT)) {
          // 端口 {port} 被本工具的旧实例占用——已关掉旧实例并接管
          console.warn(t('srv.portTakenOver', { port: DEFAULT_PORT }));
          server.listen(DEFAULT_PORT, HOST, onListen);
          return;
        }
        // 端口 {port} 被占用，改用随机端口
        console.warn(t('srv.portInUse', { port: DEFAULT_PORT }));
        server.listen(0, HOST, onListen);
      })();
    });
    server.listen(DEFAULT_PORT, HOST, onListen);
  });
}
