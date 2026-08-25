/** 平台共享工具：.desktop / Windows 注册命令的 Exec 模板解析、detach 启动 */

import { spawn } from 'node:child_process';
import type { LaunchResult } from './types.js';

/** 文件占位符哨兵：先替换进 exec 再拆分 argv（保证含空格路径是一个整体参数），最后还原为绝对路径 */
const FILE_TOK = '__SVNKIT_FILE__';

/**
 * 还原 Exec 模板并拆成 argv 数组。
 * 文件占位符 %f/%u/%1/%F/%U 用无空格的哨兵替换，避免系统命令未给 %1/%f 加引号
 * （如 notepad 的 %SystemRoot%\system32\NOTEPAD.EXE %1）时，含空格的文件路径被拆成
 * 多个参数 → Notepad 报“文件名无效”。
 */
export function parseAppCommand(exec: string, abs: string): string[] {
  let ex = exec
    .replace(/%[fFuU]/g, FILE_TOK)
    .replace(/%1/g, FILE_TOK)
    .replace(/%(?:[cikdDnNvm]|[fFuU]+)/g, '');
  const argv = ex.match(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\S+/g) ?? [];
  const cmd = argv.map((s) => s.replace(/^["']|["']$/g, '').split(FILE_TOK).join(abs));
  // 原命令没有 %1/%f 等占位符时,才把文件路径作为末位参数附上(已占位替换的不重复附)
  if (!/%[fFUu1]/.test(exec)) cmd.push(abs);
  return cmd;
}

/** 以 detached + stdio ignore 启动命令；成功(SPAWN 事件)即视为已启动，失败(ERROR 事件)返回错误。okMsg 为成功文案。 */
export function launchDetached(cmd: string[], okMsg: string): Promise<LaunchResult> {
  return new Promise((resolve) => {
    const child = spawn(cmd[0]!, cmd.slice(1), { detached: true, stdio: 'ignore' });
    child.once('error', (e) => resolve({ ok: false, message: `启动失败: ${e.message}` }));
    child.once('spawn', () => {
      child.unref();
      resolve({ ok: true, message: okMsg });
    });
  });
}
