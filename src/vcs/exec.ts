/** 子进程执行封装：支持 stdin 传参（svn --password-from-stdin）、超时、输出上限 */
import { spawn } from 'node:child_process';
import { decodeMixedText } from '../shared/text.js';

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

export function run(cmd: string, args: string[], opts: RunOptions = {}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    // 继承系统 locale（不能强制 LC_ALL=C：C locale 下 svn 无法转换中文文件名导致 E000022）
    // 解析全部使用 XML/porcelain 机器格式，与输出语言无关
    const spawnOpts = {
      cwd: opts.cwd,
      stdio: ['pipe', 'pipe', 'pipe'] as ['pipe', 'pipe', 'pipe'],
      env: opts.env ? { ...process.env, ...opts.env } : process.env,
    };
    // shell 模式见 RunOptions.shell：cmd 是完整命令行，args 忽略
    const child = opts.shell ? spawn(cmd, { ...spawnOpts, shell: true }) : spawn(cmd, args, spawnOpts);

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
            child.kill('SIGKILL');
            resolve(finish(-1, { timedOut: true }));
          }
        }, opts.timeoutMs)
      : null;

    // 取消信号：请求断开（如用户取消更新）→ 杀掉子进程
    const onAbort = () => {
      if (!done) {
        child.kill('SIGKILL');
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
