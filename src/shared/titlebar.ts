/** 自绘标题栏的公共常量：主进程建窗与前端渲染必须用同一个值，否则标题条和系统按钮区会错位。 */

/** 标题条高度（px）= 主进程 titleBarOverlay.height：系统的最小化/最大化/关闭画在这一高度内。
 *  Windows 专用（其他平台走原生标题栏，用不到这个值）。 */
export const TITLE_BAR_HEIGHT = 32;
