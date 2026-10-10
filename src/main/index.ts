/** 入口：启动本地 HTTP 服务。Electron 打包版用内嵌窗口展示（不依赖系统浏览器）；纯 node 用外部浏览器 */
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { createRequire } from 'node:module';
import { startServer, setPickDirHandler } from '../server/index.js';
import { detectRepo } from '../vcs/detect.js';
import { platform } from '../platform/index.js';
import { dedupeHistory } from '../server/routes/recent.js';
import { loadConfig } from '../config.js';
import { t, setLang } from '../shared/i18n/index.js';

const require = createRequire(import.meta.url);

/** 启动目录（命令行参数或环境变量） */
const START_DIR = process.env.SVNGIT_DIR ?? process.cwd();

/**
 * 打开界面：
 * - Electron 打包版：内嵌 BrowserWindow（自带渲染引擎，无浏览器也能用）
 * - 纯 node（开发）或 --browser 参数：xdg-open 外部浏览器（服务常驻，页面右上角「退出」停止）
 */
const BROWSER = process.argv.includes('--browser');

async function openUI(url: string) {
  if (process.versions.electron && !BROWSER) {
    const electron = require('electron') as {
      BrowserWindow: typeof import('electron').BrowserWindow;
      Menu: typeof import('electron').Menu;
      app: typeof import('electron').app;
    };
    electron.Menu.setApplicationMenu(null);
    const win = new electron.BrowserWindow({
      width: 1280,
      height: 820,
      minWidth: 960,
      minHeight: 600,
      // svn-git文件版本管理
      title: t('main.title'),
      autoHideMenuBar: true,
      // import.meta.dirname = 编译产物 main/index.js 所在目录（dist/main/）——
      // icon 和 preload 都在它的上一级（dist/client/、dist/preload.cjs），所以要先 '..'
      icon: path.join(import.meta.dirname ?? '.', '..', 'client', 'icon.png'),
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(import.meta.dirname ?? '.', '..', 'preload.cjs'),
      },
    });
    win.setMenuBarVisibility(false);
    // 关闭窗口 = 退出应用（停止服务）
    win.on('closed', () => electron.app.quit());
    await win.loadURL(url);
    return;
  }
  // 纯 node：打开系统默认浏览器（跨平台，平台逻辑下沉到 src/platform）
  platform.openUrl(url);
}

// 忽略 SIGHUP：关闭启动它的终端后服务保持运行（浏览器页面继续可用）
process.on('SIGHUP', () => {
  /* 服务常驻，忽略终端关闭信号 */
});

async function boot() {
  // 语言：从 ~/.config/svngit/config.json 读，早于一切输出/窗口创建。
  // 主进程与 server / vcs 共享同一个 i18n 模块实例，故这一句就把三者的消息语言都定了。
  // （渲染进程是另一个实例，由前端 localStorage + POST /api/lang 自行对齐，见 client/shared/use-lang.ts）
  setLang(loadConfig().lang);

  // 启动时清理最近项目里的重复记录（同一目录的别名路径，如 bind mount 的 /data/home/x 与 /home/x）。
  // 放在最前面：下面"启动目录不是仓库时打开常用项目"要读这份清单
  const dup = dedupeHistory();
  //   已清理最近项目中的 {n} 条重复记录
  if (dup > 0) console.log(t('main.dedupe', { n: dup }));
  // 预检测仓库（仅提示用，界面内可重新选择）
  let repo = detectRepo(START_DIR);
  // 启动目录不是仓库时，优先打开最近使用的常用项目（星号标记）；显式指定目录则尊重指定
  if (!repo) {
    try {
      const histPath = path.join(os.homedir(), '.config', 'svngit', 'history.json');
      if (fs.existsSync(histPath)) {
        const hist = JSON.parse(fs.readFileSync(histPath, 'utf8')) as { path: string; fav?: boolean; lastOpened: number }[];
        const favs = (Array.isArray(hist) ? hist : []).filter((h) => h.fav && h.path);
        if (favs.length) {
          favs.sort((a, b) => b.lastOpened - a.lastOpened); // 最近打开的常用项目优先
          process.env.SVNGIT_REPO_DIR = favs[0]!.path;
          repo = detectRepo(favs[0]!.path);
        }
      }
    } catch {
      /* 历史文件损坏时忽略，走默认启动 */
    }
  }
  // （检测到 {type} 仓库: {root}）
  const repoHint = repo ? t('main.repoHint', { type: repo.type.toUpperCase(), root: repo.root }) : '';

  // Electron 环境：注入系统目录选择对话框（供网页"选择目录"使用）
  // 注意：必须静态导入 setPickDirHandler（ESM 动态 import 在 asar 打包下可能失败导致注入不生效）
  if (process.versions.electron) {
    try {
      const { dialog } = require('electron') as {
        dialog: { showOpenDialog(opts: unknown): Promise<{ canceled: boolean; filePaths: string[] }> };
      };
      setPickDirHandler(async () => {
        const r = await dialog.showOpenDialog({
          // 选择 SVN/Git 项目目录
          title: t('main.pickDir'), // 取实时值：用户在界面切过语言后，这里要跟着变
          properties: ['openDirectory'],
        });
        return r.canceled || !r.filePaths[0] ? null : r.filePaths[0];
      });
    } catch (e) {
      /* 纯 node 运行时无对话框 */
      // [svngit] 注入系统目录选择失败（浏览器模式将无法选择目录）:
      console.error(t('main.pickDirFail'), e);
    }
  }

  const handle = await startServer();
  console.log('');
  // svn-git文件版本管理
  console.log(`  ⬢ ${t('main.title')}`);
  //   服务已启动: {url}
  console.log(t('main.serverStarted', { url: handle.url }));
  //   启动目录: {dir} {hint}
  console.log(t('main.startDir', { dir: START_DIR, hint: repoHint }));
  console.log(t(process.versions.electron && !BROWSER ? 'main.openingWindow' : 'main.openingBrowser'));
  console.log('');

  await openUI(handle.url);
}

// Electron 打包版：等 app ready 后再启动（窗口创建要求 ready）；纯 node 直接启动
if (process.versions.electron) {
  const { app } = require('electron') as { app: { whenReady(): Promise<unknown>; disableHardwareAcceleration(): void } };
  // 仅 Windows：部分 Windows 环境（虚拟机/远程桌面/驱动缺失）下 GPU 进程崩溃
  // 会导致渲染进程崩溃、窗口立即关闭退出；软件渲染更稳定（仅影响 2D 渲染性能）
  // Linux 上硬件加速正常，不做此降级
  if (platform.isWindows) app.disableHardwareAcceleration();
  void app.whenReady().then(boot);
} else {
  void boot();
}
