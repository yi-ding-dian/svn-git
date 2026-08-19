/** 子进程执行封装：支持 stdin 传参（svn --password-from-stdin）、超时、输出上限 */
import { spawn } from 'node:child_process';

export interface RunOptions {
  cwd?: string;
  /** 写入 stdin 的数据（如密码），写后关闭 */
  stdinData?: string;
  timeoutMs?: number;
  /** 输出上限，默认 64MB */
  maxBuffer?: number;
  /** 取消信号（如前端请求断开），触发后杀掉子进程 */
  signal?: AbortSignal;
  /** 额外环境变量（合并到 process.env，如 GIT_ASKPASS） */
  env?: Record<string, string>;
}

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
  /** 超时被杀 */
  timedOut?: boolean;
  /** 被取消（signal abort） */
  aborted?: boolean;
}

export function run(cmd: string, args: string[], opts: RunOptions = {}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    // 继承系统 locale（不能强制 LC_ALL=C：C locale 下 svn 无法转换中文文件名导致 E000022）
    // 解析全部使用 XML/porcelain 机器格式，与输出语言无关
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: opts.env ? { ...process.env, ...opts.env } : process.env,
    });

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
            resolve({ code: -1, stdout: Buffer.concat(stdout).toString(), stderr: Buffer.concat(stderr).toString(), timedOut: true });
          }
        }, opts.timeoutMs)
      : null;

    // 取消信号：请求断开（如用户取消更新）→ 杀掉子进程
    const onAbort = () => {
      if (!done) {
        child.kill('SIGKILL');
        resolve({ code: -1, stdout: Buffer.concat(stdout).toString(), stderr: Buffer.concat(stderr).toString(), aborted: true });
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
      resolve({ code: code ?? -1, stdout: Buffer.concat(stdout).toString(), stderr: Buffer.concat(stderr).toString() });
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
