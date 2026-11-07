/** 应用自身在线升级（仅 Electron 打包版）。
 *
 *  - Windows 安装版 / Linux AppImage：electron-updater 全自动（检查 → 下载 → 安装重启）；
 *  - Windows 免安装版：electron-updater 不支持替换运行中的 exe，界面引导去 Release 页手动下载；
 *  - 纯 Node（WSL tar.gz）：没有 Electron，返回 unsupported；
 *  - 源码运行 / --browser / -d：更新会退出服务进程，不在这些模式提供安装。
 *
 *  GitHub 访问默认走 gh-proxy 加速（「关于」里可关、可改地址）。加速的实现方式：
 *  把更新源切成 generic provider，指向
 *  `<prefix>/https://github.com/<owner>/<repo>/releases/latest/download/`；
 *  electron-updater 会从这个目录取 latest.yml（Linux 为 latest-linux.yml）和安装包。
 *  关闭加速时回到 github provider（即 resources/app-update.yml 里的配置）。
 *
 *  模块加载本身不 require electron-updater：纯 Node 包里它也会被 npm ci 装上（生产依赖），
 *  但只有 Electron 打包版真正用到，懒加载避免纯 Node 启动时碰 Electron 相关模块。
 */
import { createRequire } from 'node:module';
import { loadConfig } from '../config.js';
import {
  APP_GITHUB_OWNER,
  APP_GITHUB_REPO,
  DEFAULT_GITHUB_DOWNLOAD_PROXY,
  type AppUpdateHandlers,
  type AppUpdateMode,
  type AppUpdateProxySettings,
  type AppUpdateStatus,
} from '../shared/app-update.js';
import type { AppUpdater } from 'electron-updater';

const require = createRequire(import.meta.url);

let updater: AppUpdater | null = null;
let lastError = '';

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error ?? '');
}

/** 当前状态（可变；对外只返回快照） */
let status: AppUpdateStatus = {
  mode: 'source',
  supported: false,
  phase: 'unsupported',
  proxy: { enabled: true, prefix: '' },
};

function snapshot(): AppUpdateStatus {
  return { ...status, proxy: { ...status.proxy } };
}

function readProxy(): AppUpdateProxySettings {
  const cfg = loadConfig();
  return {
    // 缺省 true：老配置文件里没有 update 段时，升级默认走加速
    enabled: cfg.update?.githubDownloadProxy !== false,
    prefix: cfg.update?.githubDownloadProxyUrl ?? '',
  };
}

/** 加速后的更新源目录：gh-proxy 的形式是「前缀 + 完整 GitHub URL」 */
function proxyFeedUrl(prefix: string): string {
  const base = (prefix.trim() || DEFAULT_GITHUB_DOWNLOAD_PROXY).replace(/\/+$/, '');
  return `${base}/https://github.com/${APP_GITHUB_OWNER}/${APP_GITHUB_REPO}/releases/latest/download/`;
}

function detectMode(windowMode: boolean): AppUpdateMode {
  if (!process.versions.electron) return 'node';
  const { app } = require('electron') as { app: { isPackaged: boolean } };
  if (!app.isPackaged) return 'source';
  // --browser / -d：更新会退出服务进程，交给窗口版处理
  if (!windowMode) return 'browser';
  if (process.platform === 'win32') {
    // portable 包装器会把原 exe 解压到临时目录运行；覆盖运行中的原文件不可靠
    return process.env.PORTABLE_EXECUTABLE_FILE ? 'portable' : 'installed';
  }
  if (process.platform === 'linux') {
    // AppImage 才能被 electron-updater 原地替换；解包运行（非 AppImage）没有安装包可换
    return process.env.APPIMAGE ? 'appimage' : 'unpacked';
  }
  return 'installed';
}

function isSupported(mode: AppUpdateMode): boolean {
  return mode === 'installed' || mode === 'appimage';
}

/** 指向某个源。**不修改 status.proxy**：检查失败回退直连时，用户的加速设置要保持原样。 */
function applyFeed(useProxy: boolean): void {
  if (!updater) return;
  if (useProxy) {
    updater.setFeedURL({ provider: 'generic', url: proxyFeedUrl(status.proxy.prefix) });
    // 第三方中转的 Range 支持不稳定；走加速时放弃增量，整包下载更省事
    updater.disableDifferentialDownload = true;
  } else {
    updater.setFeedURL({ provider: 'github', owner: APP_GITHUB_OWNER, repo: APP_GITHUB_REPO });
    updater.disableDifferentialDownload = false;
  }
}

/** 清掉上一次检查留下的版本/进度，避免「重新检查」时界面还挂着旧版本号 */
function resetCheck(): void {
  status.phase = 'checking';
  status.version = undefined;
  status.releaseDate = undefined;
  status.sizeBytes = undefined;
  status.percent = undefined;
  status.bytesPerSecond = undefined;
  status.transferred = undefined;
  status.total = undefined;
  status.error = undefined;
  lastError = '';
}

function createUpdater(): AppUpdater {
  const { autoUpdater } = require('electron-updater') as { autoUpdater: AppUpdater };
  autoUpdater.autoDownload = false; // 75–90MB 的包：用户点「立即更新」才下
  // 下载完成后若用户直接关掉应用，也在退出时把更新装上（否则这次下载白费，下次还得重下）
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('checking-for-update', () => {
    if (status.phase !== 'downloading') status.phase = 'checking';
  });
  autoUpdater.on('update-available', (info) => {
    status.phase = 'available';
    status.version = info.version;
    status.releaseDate = info.releaseDate;
    status.sizeBytes = info.files?.[0]?.size;
    status.error = undefined;
  });
  autoUpdater.on('update-not-available', () => {
    status.phase = 'latest';
    status.version = undefined;
    status.error = undefined;
  });
  autoUpdater.on('download-progress', (progress) => {
    status.phase = 'downloading';
    status.percent = progress.percent;
    status.bytesPerSecond = progress.bytesPerSecond;
    status.transferred = progress.transferred;
    status.total = progress.total;
  });
  autoUpdater.on('update-downloaded', (info) => {
    status.phase = 'downloaded';
    status.version = info.version;
    status.percent = 100;
  });
  // EventEmitter 的 error 事件没有监听器会直接抛；这里只记下原因，由 check/download 的
  // Promise 拒绝统一收敛成界面文案（避免回退直连时把中转失败先显示出来）
  autoUpdater.on('error', (error) => {
    lastError = messageOf(error);
  });
  return autoUpdater;
}

/** 并发检查合并：弹窗自动检查与启动后静默检查可能同时发起，复用同一个 Promise */
let checkPromise: Promise<AppUpdateStatus> | null = null;

function check(): Promise<AppUpdateStatus> {
  if (!status.supported || !updater) return Promise.resolve(snapshot());
  if (checkPromise) return checkPromise;
  checkPromise = doCheck().finally(() => {
    checkPromise = null;
  });
  return checkPromise;
}

async function doCheck(): Promise<AppUpdateStatus> {
  // 闭包里的 updater 是模块级可变变量，先收进局部常量，避免 await 之后 TS 认为可能为 null
  const current = updater;
  if (!current) return snapshot();
  resetCheck();
  // 加速开着时先走中转，失败再直连；直连也失败才报错
  const feeds = status.proxy.enabled ? [true, false] : [false];
  for (const useProxy of feeds) {
    try {
      applyFeed(useProxy);
      const result = await current.checkForUpdates();
      // 事件通常会设置 phase；兜底处理 updater 被禁用（返回 null）的情况
      if (status.phase === 'checking') {
        status.phase = result?.updateInfo ? 'available' : 'latest';
      }
      return snapshot();
    } catch (error) {
      lastError = messageOf(error) || lastError;
    }
  }
  status.phase = 'error';
  status.error = lastError || 'update check failed';
  return snapshot();
}

function download(): AppUpdateStatus {
  if (!status.supported || !updater || status.phase !== 'available') return snapshot();
  status.phase = 'downloading';
  status.percent = 0;
  status.error = undefined;
  lastError = '';
  void updater.downloadUpdate().catch((error) => {
    status.phase = 'error';
    status.error = messageOf(error) || lastError || 'download failed';
  });
  return snapshot();
}

function install(): { ok: boolean; error?: string } {
  if (!status.supported || !updater) return { ok: false, error: 'unsupported' };
  if (status.phase !== 'downloaded') return { ok: false, error: 'not-downloaded' };
  // 先让 HTTP 响应返回，再退出进程（quitAndInstall 会立刻关闭所有窗口）
  setTimeout(() => {
    try {
      updater?.quitAndInstall(false, true);
    } catch (error) {
      lastError = messageOf(error);
    }
  }, 400);
  return { ok: true };
}

function setProxy(settings: AppUpdateProxySettings): void {
  status.proxy = { enabled: settings.enabled, prefix: settings.prefix };
  // 换了源，之前的检查结果作废，用户要重新点「检查更新」
  if (status.phase === 'available') {
    status.phase = 'idle';
    status.version = undefined;
    status.releaseDate = undefined;
    status.sizeBytes = undefined;
  }
  applyFeed(status.proxy.enabled);
}

/** 由 main 在 app ready 之后调用；返回给 server 路由注入 */
export function initAppUpdate(options: { windowMode: boolean }): AppUpdateHandlers {
  const mode = detectMode(options.windowMode);
  const supported = isSupported(mode);
  status = {
    mode,
    supported,
    phase: supported ? 'idle' : 'unsupported',
    proxy: readProxy(),
  };
  if (supported) {
    try {
      updater = createUpdater();
      applyFeed(status.proxy.enabled);
      // 启动后静默检查一次：用户打开「关于」前状态就已就绪，顶栏也能提示有新版；
      // 只检查不下载（更新包大，下载/安装都要用户点确认）。unref 避免拖住进程退出。
      const timer = setTimeout(() => {
        if (status.phase === 'idle') void check();
      }, 5000);
      timer.unref?.();
    } catch (error) {
      updater = null;
      status.supported = false;
      status.phase = 'error';
      status.error = messageOf(error);
    }
  }
  return {
    status: snapshot,
    check,
    download,
    install,
    setProxy,
  };
}
