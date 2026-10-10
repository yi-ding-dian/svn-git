/** 中文语言包 · 平台层（src/platform）：打开方式 / 系统菜单集成 / 安装引导。
 *  key 前缀 `plat.`；规范见 docs/i18n-搬运规范.md。
 *
 *  ⚠️ 源码里以下中文**故意没搬**（是给程序看的，不是文案），已逐行标 `// i18n-ignore`：
 *   - `win32.ts` 的 `REG_NOT_SET` 正则（`(数值未设置)` / `(value not set)` / `(未設定)`…）——
 *     解析 reg.exe 在各国语言系统下的「空值」输出，翻了会认不出占位符、
 *     把空值当成程序名显示成列表第一项。
 */
export const plat = {
  // ---- 打开方式（util.ts / linux.ts / win32.ts 共用）----
  'plat.launchFail': '启动失败: {msg}',
  'plat.execEmpty': 'Exec 为空',
  'plat.openedDefault': '已用系统默认程序打开: {rel}',
  'plat.openedWith': '已用 {app} 打开: {rel}',
  'plat.openedChooser': '已打开系统「打开方式」选择器: {rel}',
  'plat.openUrlFail': '[svngit] 打开浏览器失败({cmd}): {msg}',

  // ---- 系统应用菜单集成（Linux：生成 .desktop + hicolor 图标）----
  /** .desktop 的 Name= 值（系统菜单里显示的应用名，与 main.title 一致） */
  'plat.desktopName': 'svn-git文件版本管理',
  /** .desktop 的 Comment= 值（系统菜单里的应用说明） */
  'plat.desktopComment': 'SVN/Git 状态检测与操作工具',
  'plat.installedMenu': '已安装到系统应用菜单（注销/重登后系统菜单刷新生效）',
  'plat.installedMenuNoIcon': '已安装到系统应用菜单（图标未找到，菜单项显示默认图标）（注销/重登后系统菜单刷新生效）',
  'plat.installFail': '安装失败: {msg}',
  'plat.uninstalledMenu': '已从系统应用菜单卸载',
  'plat.uninstallFail': '卸载失败: {msg}',
  'plat.winInstallHint': 'Windows 请使用安装包（NSIS 自动创建开始菜单/桌面快捷方式）',
  'plat.winUninstallHint': 'Windows 请使用安装包的卸载程序',

  // ---- 环境安装引导（envInstall 流式输出到界面日志）----
  'plat.winEnvHint': 'Windows 环境：请在终端以管理员身份执行以下命令安装：',
  'plat.distroUnknown': '未知发行版',
  'plat.sudoOk': '检测 root 权限… ✓ 可用',
  'plat.sudoNeedPassword': '检测 root 权限… ✗ 需要密码（请用下方手动命令）',
  'plat.distro': '发行版: {name}（{manager}）',
  'plat.installStart': '开始安装: {pkgs}…',
  'plat.installDone': '✅ 安装完成',
  'plat.installFailed': '❌ 安装失败（退出码 {code}）',
} as const;
