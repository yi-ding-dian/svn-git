/** 终端：在仓库目录下执行命令。
 *
 *  **这是有意"不带护栏"的**（用户决策：终端是给熟悉的人用的，后果自己负责）：
 *  任意命令都能跑，支持管道 / 重定向 / &&。早先版本的「白名单（只放行 git/svn）/
 *  危险命令二次确认 / 交互式命令拦截 / 管道重定向拒绝」已按用户要求全部去掉 ——
 *  跟 GUI 按钮不同，**打开终端本身就是"我要直接操作"的声明**，再拦就是过度保护。
 *
 *  仍然保留的几项**不是防呆**（去掉反而难受）：
 *   - 超时 + Ctrl+C：挂住的命令总得有个收场办法
 *   - 输出走 `decode: 'auto'`：GBK 内容行不乱码（本工具比系统终端强的地方）
 *   - 执行目录的越界校验：这是**安全边界**（防恶意构造的请求在任意路径执行），不是防呆
 *   - 执行后失效状态缓存：命令可能改了工作区，界面不能还显示旧状态
 *
 *  **颜色**：git 只在输出到真终端时才上色，而这里是管道 → 用 `GIT_CONFIG_PARAMETERS`
 *  强制 `color.ui=always`（本机 git 2.20，用不了 2.31+ 的 GIT_CONFIG_COUNT 那套）。
 *  输出里的 ANSI 序列由前端渲染成彩色（见 web/modals/terminal.tsx）。
 *
 *  **交互式命令**（`rebase -i` / `add -p` / 不带 `-m` 的 commit）在这里仍然跑不了：
 *  子进程拿到的是管道而不是 TTY，git 一问 `isatty()` 就拒绝进交互模式 —— 这跟护栏无关，
 *  要支持得另上 PTY + WebSocket + xterm.js（用户已决定暂不做）。 */

import fs from 'node:fs';
import path from 'node:path';
import { run } from '../../vcs/exec.js';
import { sendJson, readBody, vcsOf, inRepoRoot, invalidateStatusCache, type Ctx } from './util.js';

/** 命令超时：30 秒（用户定的）。超时只是兜底 —— 长命令随时可以 Ctrl+C 中断 */
const TIMEOUT_MS = 30_000;

export async function handle(ctx: Ctx): Promise<boolean> {
  const { req, res, p } = ctx;
  if (p !== '/api/terminal/run' || req.method !== 'POST') return false;

  const { repo } = vcsOf();
  const body = await readBody(req);
  const cmdline = String(body.cmd ?? '').trim();
  if (!cmdline) {
    sendJson(res, 400, { error: '命令为空' });
    return true;
  }

  // 执行目录：默认仓库根；前端传「文件浏览器的当前目录」（相对仓库根）。
  // **必须校验边界** —— 不校验的话 dir 传 `../..` 就能在仓库外执行命令（安全边界，不是防呆）
  let cwd = repo.root;
  const dirRel = String(body.dir ?? '').trim();
  if (dirRel) {
    const abs = path.resolve(repo.root, dirRel);
    if (!inRepoRoot(repo.root, abs) || !fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) {
      sendJson(res, 400, { error: '执行目录无效（不存在或超出仓库范围）' });
      return true;
    }
    cwd = abs;
  }

  // 前端断开（用户 Ctrl+C 中断）→ 杀子进程（与 pull/push 同一套）
  const ac = new AbortController();
  res.on('close', () => {
    if (!res.writableEnded) ac.abort();
  });

  const r = await run(cmdline, [], {
    shell: true, // 完整命令行：管道 / 重定向 / && 都能用
    cwd,
    decode: 'auto', // 内容型输出走编码探测（GBK 内容行不乱码）
    timeoutMs: TIMEOUT_MS,
    signal: ac.signal,
    env: {
      GIT_TERMINAL_PROMPT: '0', // 要账号密码时直接失败，别卡到 30 秒超时
      GIT_PAGER: 'cat', // 管道里跑分页器会挂住；cat 等价于 --no-pager
      GIT_CONFIG_PARAMETERS: "'color.ui=always'", // 强制上色（见文件头）
    },
  });

  // 命令可能改了工作区/索引（哪怕是失败的中间状态）—— 一律失效状态缓存，否则界面显示旧状态
  invalidateStatusCache(repo.root);

  sendJson(res, 200, {
    ok: r.code === 0,
    code: r.code,
    stdout: r.stdout,
    stderr: r.stderr,
    aborted: r.aborted,
    timedOut: r.timedOut,
  });
  return true;
}
