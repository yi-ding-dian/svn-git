/** 平台入口：按 process.platform 组装唯一的 platform 实例，调用方不接触平台分支 */
import type { Platform } from './types.js';
import { win32, setOwnsAppWindow as setWin32OwnsAppWindow } from './win32.js';
import { linux } from './linux.js';

export const platform: Platform = process.platform === 'win32' ? win32 : linux;
export type { Platform, OpenWithApp, InstallTool, LaunchResult, IconData } from './types.js';

/** 通知平台层：本进程是否拥有自己的应用窗口（由 main 在创建 BrowserWindow 后调用）。
 *  **只有 Windows 用得上**：Windows 只把"窗口能不能到前台"的资格给前台进程启动的窗口，
 *  win32 的 revealPath 据此选路径；Linux 走 xdg-open，交桌面环境处理，这里是空操作。
 *  放在平台入口转发，是为了让 main 只跟 platform/index 打交道，不直接引平台实现。 */
export function setHostOwnsWindow(value: boolean): void {
  if (process.platform === 'win32') setWin32OwnsAppWindow(value);
}
