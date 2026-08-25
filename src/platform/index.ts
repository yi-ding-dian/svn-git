/** 平台入口：按 process.platform 组装唯一的 platform 实例，调用方不接触平台分支 */
import type { Platform } from './types.js';
import { win32 } from './win32.js';
import { linux } from './linux.js';

export const platform: Platform = process.platform === 'win32' ? win32 : linux;
export type { Platform, OpenWithApp, InstallTool, LaunchResult, IconData } from './types.js';
