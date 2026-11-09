/** 应用自身在线升级的共享类型与常量（main / server 路由 / 前端共用）。
 *
 *  只放类型和常量，不放逻辑：main 里的 electron-updater 不能被打进前端，
 *  server 路由只负责转发给 main 注入的处理器，纯 Node（WSL）运行时没有处理器。 */

/** 更新源仓库（公开仓库，electron-updater 匿名拉 Release 资产） */
export const APP_GITHUB_OWNER = 'yi-ding-dian';
export const APP_GITHUB_REPO = 'svn-git';

/** 默认 GitHub 下载加速前缀（第三方中转；空配置时用它） */
export const DEFAULT_GITHUB_DOWNLOAD_PROXY = 'https://gh-proxy.com/';

/** 浏览器里「查看发布页」用的地址 */
export const APP_RELEASES_LATEST_URL = `https://github.com/${APP_GITHUB_OWNER}/${APP_GITHUB_REPO}/releases/latest`;

/** 运行方式：决定「关于」里更新区的文案与按钮 */
export type AppUpdateMode =
  /** Windows NSIS 安装版 / Linux 其他安装形态（可自动更新） */
  | 'installed'
  /** Windows 免安装单文件（electron-updater 不支持替换运行中的 exe） */
  | 'portable'
  /** Linux AppImage（可自动更新） */
  | 'appimage'
  /** Linux 解包运行（不是 AppImage）：没有可替换的安装包 */
  | 'unpacked'
  /** Electron 打包版但以 --browser / -d 方式启动：退出会带走服务，不在这种模式装更新 */
  | 'browser'
  /** 源码运行（npm start / run.sh） */
  | 'source'
  /** 纯 Node（WSL tar.gz 包）：没有 Electron，离线更新需另做 */
  | 'node';

export type AppUpdatePhase =
  | 'idle'
  | 'checking'
  | 'latest'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'error'
  | 'unsupported';

/** GitHub 下载加速设置（与 git 下载加速分开存：默认值不同） */
export interface AppUpdateProxySettings {
  enabled: boolean;
  /** 空串 = 默认 https://gh-proxy.com/ */
  prefix: string;
}

/** 「关于」弹窗轮询的完整状态（每次都是快照） */
export interface AppUpdateStatus {
  mode: AppUpdateMode;
  supported: boolean;
  phase: AppUpdatePhase;
  /** 新版本号（phase=available / downloading / downloaded 时有） */
  version?: string;
  /** Release 的发布时间（ISO 字符串） */
  releaseDate?: string;
  /** 更新包大小（字节） */
  sizeBytes?: number;
  /** 新版本的发布日志（GitHub Release 正文；拿不到时不显示） */
  notes?: string;
  /** 下载进度 0–100 */
  percent?: number;
  bytesPerSecond?: number;
  transferred?: number;
  total?: number;
  error?: string;
  proxy: AppUpdateProxySettings;
}

/** main 注入给 server 路由的处理器；纯 Node 运行时为 null */
export interface AppUpdateHandlers {
  status(): AppUpdateStatus;
  check(): Promise<AppUpdateStatus>;
  /** 启动下载后立即返回（进度靠轮询 status） */
  download(): AppUpdateStatus;
  /** 下载完成后安装并退出；返回 ok=false 表示当前状态不允许 */
  install(): { ok: boolean; error?: string };
  /** 设置变更后重新指向更新源（下一次检查生效） */
  setProxy(settings: AppUpdateProxySettings): void;
}
