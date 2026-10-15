/** 子进程执行封装：支持 stdin 传参（svn --password-from-stdin）、超时、输出上限 */
import { spawn, type ChildProcess } from 'node:child_process';
import { decodeMixedText } from '../shared/text.js';

/** 还活着的子进程（run / runStream 共用）。
 *  **为什么留着这个集合**：app 退出时要把它们收掉——否则会留下孤儿：git/svn 还在往目标目录写，
 *  那个目录就被占住删不掉（用户实报：关掉 app 后 D:\gitProjects\Ai-desktop-pet 删不动）。
 *  进程自然退出时从集合里摘掉，正常状态下它是空的。 */
const liveChildren = new Set<ChildProcess>();

/** 登记子进程，退出即摘除（run / runStream 的 spawn 之后各调一次） */
function trackChild(child: ChildProcess): void {
  liveChildren.add(child);
  const drop = () => liveChildren.delete(child);
  child.once('exit', drop);
  child.once('error', drop);
}

/** 收掉所有还活着的子进程（app 退出前调用，见 main/index.ts 的 exit/SIGINT 钩子）。
 *  与 killTree 同一套杀法：POSIX 杀进程组（连孙进程），Windows 只能单杀（无进程组语义）。
 *  异常退出（强杀/崩溃）走不到这里 —— 那条路由 inflight.ts 的 recoverInflight 在下次启动时兜底。 */
export function killAllChildren(): void {
  for (const child of liveChildren) {
    try {
      if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGKILL');
      else child.kill('SIGKILL');
    } catch {
      /* ESRCH（已退出）等：忽略 */
    }
  }
  liveChildren.clear();
}

export interface RunOptions {
  cwd?: string;
  /** 写入 stdin 的数据（如密码），写后关闭 */
  stdinData?: string;
  timeoutMs?: number;
  /** 输出上限，默认 64MB */
  maxBuffer?: number;
  /** 取消信号（如前端请求断开），触发后杀掉子进程 */
  signal?: AbortSignal;
  /** 用 shell 执行：`cmd` 作为**完整命令行**（支持管道 / 重定向 / &&），`args` 忽略。
   *  **只给终端用** —— 其他调用点都走"命令 + 参数"数组形式，不经 shell 是刻意的
   *  （避免文件名/用户输入被当成 shell 语法解释）。 */
  shell?: boolean;
  /** 额外环境变量（合并到 process.env，如 GIT_ASKPASS） */
  env?: Record<string, string>;
  /** 输出解码方式：
   *  - 'utf8'（默认，与改动前完全一致）：一律按 UTF-8 解。
   *    **凡是带路径的机器输出都必须保持这个**（status / log --name-status / ls-tree / --xml …）——
   *    路径是"字节身份"，猜编码解出来的字符串在 Linux 上永远匹配不上 fs 里的真实文件名；
   *    Windows 上 git 本来就用 UTF-8 输出路径，猜只会引入误判。
   *  - 'auto'：先按 UTF-8 试，不是合法 UTF-8 再按 GB18030（见 shared/text.ts）。
   *    **只给"内容型"调用点用**：cat / show / diff / blame / diffHunks 等，以及 stderr（本地化报错消息）。 */
  decode?: 'utf8' | 'auto';
  /** 原样保留 stdout 字节（在结果里给 stdoutBuf）：二进制搬运专用（svn cat 写回工作区），不经字符串往返 */
  raw?: boolean;
}

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
  /** raw 模式下的原始 stdout 字节 */
  stdoutBuf?: Buffer;
  /** 超时被杀 */
  timedOut?: boolean;
  /** 被取消（signal abort） */
  aborted?: boolean;
}

/** 流式执行（spawn/超时/取消/组杀与 run 一致）：
 *  stdout **按行回调**（字节层按 \n 拆行、剥行尾 \r、decodeMixedText 解码），不累积——
 *  给"边收边筛、够数就停"的大输出场景用（如远程仓库递归搜索：匹配满上限立即杀进程，
 *  大目录不用遍历完）。onLine 返回 true = 提前停止（杀进程组；调用方自己记早停标记）。
 *  结果里 stdout 恒为空串（内容已随行消费）；stderr 照常收集（报错消息用）。 */
export interface StreamRunOptions extends RunOptions {
  onLine: (line: string) => boolean | void;
}

export function runStream(cmd: string, args: string[], opts: StreamRunOptions): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const spawnOpts = {
      cwd: opts.cwd,
      stdio: ['pipe', 'pipe', 'pipe'] as ['pipe', 'pipe', 'pipe'],
      env: opts.env ? { ...process.env, ...opts.env } : process.env,
      // 独立进程组：超时/取消/早停都要能连孙进程一起杀（与 run 一致）
      detached: process.platform !== 'win32',
    };
    const child = spawn(cmd, args, spawnOpts);
    trackChild(child);

    const killTree = () => {
      try {
        if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGKILL');
        else child.kill('SIGKILL');
      } catch {
        /* ESRCH（进程已退出）等：忽略 */
      }
    };

    const stderr: Buffer[] = [];
    let stderrLen = 0;
    let done = false;
    /** onLine 返回过 true（提前停止）：之后的输出不再回调 */
    let stopped = false;
    /** 未成行的残留字节（一个 chunk 可能截断在多字节字符/行中间） */
    let pending: Buffer = Buffer.alloc(0);
    const finish = (code: number, extra: Partial<RunResult> = {}): RunResult => ({
      code,
      stdout: '',
      // 行/错误都走 decodeMixedText（UTF-8 优先，GB18030 兜底）——Windows 上 svn 的本地化报错是 GBK
      stderr: decodeMixedText(Buffer.concat(stderr)),
      ...extra,
    });

    const maxStderr = opts.maxBuffer ?? 1024 * 1024;
    const timeout = opts.timeoutMs
      ? setTimeout(() => {
          if (!done) {
            killTree();
            resolve(finish(-1, { timedOut: true }));
          }
        }, opts.timeoutMs)
      : null;

    const onAbort = () => {
      if (!done) {
        killTree();
        resolve(finish(-1, { aborted: true }));
      }
    };
    if (opts.signal) {
      if (opts.signal.aborted) onAbort();
      else opts.signal.addEventListener('abort', onAbort, { once: true });
    }

    const finalize = () => {
      if (done) return;
      done = true;
      if (timeout) clearTimeout(timeout);
      opts.signal?.removeEventListener('abort', onAbort);
    };

    child.stdout.on('data', (d: Buffer) => {
      if (stopped) return;
      pending = pending.length > 0 ? Buffer.concat([pending, d]) : d;
      for (;;) {
        const nl = pending.indexOf(10); // \n
        if (nl < 0) break;
        let line = pending.subarray(0, nl);
        pending = pending.subarray(nl + 1);
        if (line.length > 0 && line[line.length - 1] === 13) line = line.subarray(0, line.length - 1); // \r
        if (opts.onLine(decodeMixedText(line)) === true) {
          stopped = true;
          killTree(); // 够数了：不再等它跑完
          break;
        }
      }
    });
    child.stderr.on('data', (d: Buffer) => {
      if (stderrLen < maxStderr) {
        stderr.push(d);
        stderrLen += d.length;
      }
    });

    child.on('error', (err) => {
      finalize();
      reject(err);
    });

    child.on('close', (code) => {
      finalize();
      resolve(finish(code ?? -1));
    });

    if (opts.stdinData !== undefined) {
      child.stdin.on('error', () => {
        /* 子进程提前退出时忽略 */
      });
      child.stdin.write(opts.stdinData);
      child.stdin.end();
    } else {
      child.stdin.end();
    }
  });
}

export function run(cmd: string, args: string[], opts: RunOptions = {}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    // 继承系统 locale（不能强制 LC_ALL=C：C locale 下 svn 无法转换中文文件名导致 E000022）
    // 解析全部使用 XML/porcelain 机器格式，与输出语言无关
    const spawnOpts = {
      cwd: opts.cwd,
      stdio: ['pipe', 'pipe', 'pipe'] as ['pipe', 'pipe', 'pipe'],
      env: opts.env ? { ...process.env, ...opts.env } : process.env,
      // 独立进程组（Unix）：取消/超时能连**孙进程**一起杀——如 git push 派生的
      // git-remote-https helper，只杀直接子进程会留下孤儿 helper 挂到 TCP 超时。
      // Windows 无进程组语义，保持原行为（child.kill 单杀）
      detached: process.platform !== 'win32',
    };
    // shell 模式见 RunOptions.shell：cmd 是完整命令行，args 忽略
    const child = opts.shell ? spawn(cmd, { ...spawnOpts, shell: true }) : spawn(cmd, args, spawnOpts);
    trackChild(child);

    /** 杀整个进程组（detached 起的子进程是组长，负 pid = 组）；已退出/无 pid 时静默 */
    const killTree = () => {
      try {
        if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGKILL');
        else child.kill('SIGKILL');
      } catch {
        /* ESRCH（进程已退出）等：忽略 */
      }
    };

    // 输出解码：默认 utf8（与改动前一致）；'auto' 走探测（UTF-8 → GB18030），只给内容型调用点用
    const dec = (b: Buffer) => (opts.decode === 'auto' ? decodeMixedText(b) : b.toString('utf8'));
    const finish = (code: number, extra: Partial<RunResult> = {}): RunResult => {
      const out = Buffer.concat(stdout);
      const err = Buffer.concat(stderr);
      return { code, stdout: dec(out), stderr: dec(err), ...(opts.raw ? { stdoutBuf: out } : {}), ...extra };
    };

    const maxBuffer = opts.maxBuffer ?? 64 * 1024 * 1024;
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let stdoutLen = 0;
    let stderrLen = 0;
    let done = false;

    const timeout = opts.timeoutMs
      ? setTimeout(() => {
          if (!done) {
            killTree();
            resolve(finish(-1, { timedOut: true }));
          }
        }, opts.timeoutMs)
      : null;

    // 取消信号：请求断开（如用户取消更新/推送）→ 杀掉子进程（整组，含孙进程）
    const onAbort = () => {
      if (!done) {
        killTree();
        resolve(finish(-1, { aborted: true }));
      }
    };
    if (opts.signal) {
      if (opts.signal.aborted) onAbort();
      else opts.signal.addEventListener('abort', onAbort, { once: true });
    }

    const finalize = () => {
      if (done) return;
      done = true;
      if (timeout) clearTimeout(timeout);
      opts.signal?.removeEventListener('abort', onAbort);
    };

    child.stdout.on('data', (d: Buffer) => {
      if (stdoutLen < maxBuffer) {
        stdout.push(d);
        stdoutLen += d.length;
      }
    });
    child.stderr.on('data', (d: Buffer) => {
      if (stderrLen < maxBuffer) {
        stderr.push(d);
        stderrLen += d.length;
      }
    });

    child.on('error', (err) => {
      finalize();
      reject(err);
    });

    child.on('close', (code) => {
      finalize();
      resolve(finish(code ?? -1));
    });

    if (opts.stdinData !== undefined) {
      child.stdin.on('error', () => {
        /* 子进程提前退出时忽略 */
      });
      child.stdin.write(opts.stdinData);
      child.stdin.end();
    } else {
      child.stdin.end();
    }
  });
}
