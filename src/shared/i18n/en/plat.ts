/** 英文语言包 · 平台层（src/platform）：打开方式 / 系统菜单集成 / 安装引导。
 *  key 前缀 `plat.`；规范见 docs/i18n-搬运规范.md。
 */
export const plat = {
  // ---- Open with (shared by util.ts / linux.ts / win32.ts) ----
  'plat.launchFail': 'Failed to launch: {msg}',
  'plat.execEmpty': 'Exec is empty',
  'plat.openedDefault': 'Opened with the system default application: {rel}',
  'plat.openedWith': 'Opened with {app}: {rel}',
  'plat.openedChooser': 'Opened the system "Open with" chooser: {rel}',
  'plat.openUrlFail': '[svngit] Failed to open the browser ({cmd}): {msg}',

  // ---- System application menu integration (Linux: .desktop + hicolor icon) ----
  /** Value of the .desktop Name= field (app name shown in the system menu) */
  'plat.desktopName': 'svn-git Version Control',
  /** Value of the .desktop Comment= field (app description in the system menu) */
  'plat.desktopComment': 'SVN/Git status inspection and operations',
  'plat.installedMenu': 'Installed to the system application menu (takes effect after you log out and back in)',
  'plat.installedMenuNoIcon':
    'Installed to the system application menu (icon not found, the menu entry will use the default icon) (takes effect after you log out and back in)',
  'plat.installFail': 'Installation failed: {msg}',
  'plat.uninstalledMenu': 'Removed from the system application menu',
  'plat.uninstallFail': 'Uninstall failed: {msg}',
  'plat.winInstallHint': 'On Windows, use the installer (NSIS creates the Start Menu / desktop shortcuts automatically)',
  'plat.winUninstallHint': "On Windows, use the installer's uninstaller",

  // ---- Environment install guide (streamed to the UI log by envInstall) ----
  'plat.winEnvHint': 'Windows environment: run the following commands in a terminal as administrator:',
  'plat.distroUnknown': 'Unknown distribution',
  'plat.sudoOk': 'Checking root privileges… ✓ available',
  'plat.sudoNeedPassword': 'Checking root privileges… ✗ password required (use the manual command below)',
  'plat.distro': 'Distribution: {name} ({manager})',
  'plat.installStart': 'Installing: {pkgs}…',
  'plat.installDone': '✅ Installation complete',
  'plat.installFailed': '❌ Installation failed (exit code {code})',
};
