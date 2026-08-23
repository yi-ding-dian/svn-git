/** 平台接口与公共类型（系统集成：打开方式/图标/文件管理/浏览器/环境安装） */

/** 一个“可用来打开文件”的程序 */
export interface OpenWithApp {
  name: string;
  exec: string;
  icon: string;
}

export type InstallTool = 'svn' | 'git' | 'both';

/** 图标查询结果：图片字节 + 对应的 Content-Type */
export interface IconData {
  data: Buffer;
  contentType: string;
}

/** 启动结果：ok=true 时 message 为成功文案；失败时 message 为错误说明 */
export interface LaunchResult {
  ok: boolean;
  message: string;
}

/**
 * 平台抽象：调用方只依赖此接口，由 src/platform/index.ts 按 process.platform 组装
 * win32(Windows) 与 linux(Linux) 两套实现；不接触任何 process.platform 判断。
 */
export interface Platform {
  /** 当前是否 Windows（App 外壳一些平台专属开关也用它） */
  readonly isWindows: boolean;
  /** Windows 的「选择其他应用…」哨兵命令；非 Windows 为 null */
  readonly chooseOpenCmd: string | null;
  /** 按扩展名 + 可用 MIME 枚举该平台的可选打开方式程序 */
  listOpenWithApps(ext: string, mimes: Set<string>): OpenWithApp[];
  /** 用系统默认程序打开文件；rel 仅用于生成成功文案 */
  openDefault(abs: string, rel: string): Promise<LaunchResult>;
  /** 用指定程序打开文件：exec 为空=默认，'__CHOOSE__'=系统「打开方式」选择器(仅 Windows) */
  openWithApp(abs: string, exec: string, rel: string): Promise<LaunchResult>;
  /** 按图标 key 返回图标图片（win 提取 .exe 嵌入图标；linux 查主题图标目录），无则 null */
  resolveAppIcon(key: string): IconData | null;
  /** 在系统文件管理器中定位文件 / 打开其所在文件夹 */
  revealPath(abs: string): Promise<void>;
  /** 用系统默认浏览器打开 URL */
  openUrl(url: string): void;
  /** 环境安装引导/自动安装（流式 SSE；调用方已设好 SSE 头，send 写事件、done 结束响应） */
  envInstall(tool: InstallTool, send: (data: Record<string, unknown>) => void, done: () => void): Promise<void>;
}
