// Electron preload：注入拖拽文件路径获取（webUtils.getPathForFile 替代已移除的 File.path）
const { contextBridge, webUtils } = require('electron');
console.log('[svnkit] preload loaded');

contextBridge.exposeInMainWorld('svnkit', {
  getPathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file);
    } catch {
      return null;
    }
  },
});
