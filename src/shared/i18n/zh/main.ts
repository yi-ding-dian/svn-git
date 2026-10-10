/** 中文语言包 · 主进程（窗口标题 / 系统对话框 / 启动日志） */
export const main = {
  'main.title': 'svn-git文件版本管理',
  'main.pickDir': '选择 SVN/Git 项目目录',
  'main.dedupe': '  已清理最近项目中的 {n} 条重复记录',
  'main.repoHint': '（检测到 {type} 仓库: {root}）',
  'main.serverStarted': '  服务已启动: {url}',
  'main.startDir': '  启动目录: {dir} {hint}',
  'main.openingWindow': '  正在打开应用窗口…（无需浏览器，关闭窗口即退出）',
  'main.openingBrowser': '  正在打开浏览器…（关闭浏览器标签后服务仍在后台，停止请用页面右上角「退出」）',
  'main.pickDirFail': '[svngit] 注入系统目录选择失败（浏览器模式将无法选择目录）:',
} as const;
