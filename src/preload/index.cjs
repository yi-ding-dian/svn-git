// Electron preload：注入拖拽文件路径获取（webUtils.getPathForFile 替代已移除的 File.path）
// 以及自绘标题栏需要的能力（仅 Windows 打包版用得到）
const { contextBridge, ipcRenderer, webUtils } = require('electron');
console.log('[svngit] preload loaded');

contextBridge.exposeInMainWorld('svngit', {
  getPathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file);
    } catch {
      return null;
    }
  },
  /** 运行平台：前端据此决定要不要画自绘标题条（只有 Windows 打包版藏掉了系统标题栏） */
  platform: process.platform,
  /** 同步系统标题栏按钮区的底色/符号色（跟随界面主题；非 Windows 主进程直接忽略） */
  setTitleBarOverlay: (options) => ipcRenderer.send('svngit:titlebar-overlay', options),
});
