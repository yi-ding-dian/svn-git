/** 平台共享工具：.desktop / Windows 注册命令的 Exec 模板解析、detach 启动 */

import { spawn } from 'node:child_process';
import { t } from '../shared/i18n/index.js';
import type { LaunchResult } from './types.js';

/** POSIX 单引号引用（runScript 拼 bash 命令用）：内部 ' 用 '\'' 转义。
 *  拼出来只含单引号，外层包双引号喂给 Windows 命令行 / 终端 -c 参数时不会嵌套打架。 */
export const shq = (s: string): string => `'${s.replace(/'/g, "'\\''")}'`;

/** 文件占位符哨兵：先替换进 exec 再拆分 argv（保证含空格路径是一个整体参数），最后还原为绝对路径 */
const FILE_TOK = '__SVNGIT_FILE__';

/**
 * 还原 Exec 模板并拆成 argv 数组。
 * 文件占位符 %f/%u/%1/%F/%U 用无空格的哨兵替换，避免系统命令未给 %1/%f 加引号
 * （如 notepad 的 %SystemRoot%\system32\NOTEPAD.EXE %1）时，含空格的文件路径被拆成
 * 多个参数 → Notepad 报“文件名无效”。
 */
export function parseAppCommand(exec: string, abs: string): string[] {
  const ex = exec
    .replace(/%[fFuU]/g, FILE_TOK)
    .replace(/%1/g, FILE_TOK)
    .replace(/%(?:[cikdDnNvm]|[fFuU]+)/g, '');
  const argv = ex.match(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\S+/g) ?? [];
  const cmd = argv.map((s) => s.replace(/^["']|["']$/g, '').split(FILE_TOK).join(abs));
  // 原命令没有 %1/%f 等占位符时,才把文件路径作为末位参数附上(已占位替换的不重复附)
  if (!/%[fFUu1]/.test(exec)) cmd.push(abs);
  return cmd;
}

/** 以 detached + stdio ignore 启动命令；成功(SPAWN 事件)即视为已启动，失败(ERROR 事件)返回错误。
 *  okMsg 为成功文案（调用方传入 `t(...)` 的成品）；失败文案在此统一取 `plat.launchFail`。
 *  opts.windowsHide：隐藏启动器自身的控制台窗口（如经 PowerShell 中转发起的场景——目标程序
 *  由 Start-Process 另开新窗口，隐藏的只是中转的 powershell，避免闪一下黑框）。POSIX 上无此概念，忽略。
 *  opts.detach：默认 true；**经 `powershell -Command` 中转的调用必须传 false** —— 实测（Win11 + PS 5.1）
 *  detached（DETACHED_PROCESS）下 powershell 连 -Command 都不执行就静默 exit 0：spawn 事件照常触发，
 *  调用方拿到的是假成功，外部看不到任何报错。中转 powershell 秒退，本就不需要 detached 保活。 */
export function launchDetached(cmd: string[], okMsg: string, opts?: { windowsHide?: boolean; detach?: boolean }): Promise<LaunchResult> {
  return new Promise((resolve) => {
    const child = spawn(cmd[0]!, cmd.slice(1), { detached: opts?.detach !== false, stdio: 'ignore', windowsHide: opts?.windowsHide === true });
    // 启动失败: {msg}
    child.once('error', (e) => resolve({ ok: false, message: t('plat.launchFail', { msg: e.message }) }));
    child.once('spawn', () => {
      child.unref();
      resolve({ ok: true, message: okMsg });
    });
  });
}
