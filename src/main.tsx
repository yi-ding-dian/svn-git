/** 入口：启动本地 HTTP 服务。Electron 打包版用内嵌窗口展示（不依赖系统浏览器）；纯 node 用外部浏览器 */
import path from 'node:path';
import { createRequire } from 'node:module';
import { startServer, setPickDirHandler } from './server.js';
import { detectRepo } from './vcs/detect.js';

const require = createRequire(import.meta.url);

/** 启动目录（命令行参数或环境变量） */
const START_DIR = process.env.SVNKIT_DIR ?? process.cwd();

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
      title: 'svn-git文件版本管理',
      autoHideMenuBar: true,
      icon: path.join(import.meta.dirname ?? '.', 'web', 'icon.png'),
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(import.meta.dirname ?? '.', 'preload.cjs'),
      },
    });
    win.setMenuBarVisibility(false);
    // 关闭窗口 = 退出应用（停止服务）
    win.on('closed', () => electron.app.quit());
    await win.loadURL(url);
    return;
  }
  // 纯 node：打开系统默认浏览器（跨平台）
  const { spawn } = await import('node:child_process');
  if (process.platform === 'win32') {
    spawn('cmd', ['/c', 'start', '', url], { stdio: 'ignore', detached: true }).unref();
  } else {
    spawn('xdg-open', [url], { stdio: 'ignore', detached: true }).unref();
  }
}

// 忽略 SIGHUP：关闭启动它的终端后服务保持运行（浏览器页面继续可用）
process.on('SIGHUP', () => {
  /* 服务常驻，忽略终端关闭信号 */
});

async function boot() {
  // 预检测仓库（仅提示用，界面内可重新选择）
  const repo = detectRepo(START_DIR);
  const repoHint = repo ? `（检测到 ${repo.type.toUpperCase()} 仓库: ${repo.root}）` : '';

  // Electron 环境：注入系统目录选择对话框（供网页"选择目录"使用）
  // 注意：必须静态导入 setPickDirHandler（ESM 动态 import 在 asar 打包下可能失败导致注入不生效）
  if (process.versions.electron) {
    try {
      const { dialog } = require('electron') as {
        dialog: { showOpenDialog(opts: unknown): Promise<{ canceled: boolean; filePaths: string[] }> };
      };
      setPickDirHandler(async () => {
        const r = await dialog.showOpenDialog({
          title: '选择 SVN/Git 项目目录',
          properties: ['openDirectory'],
        });
        return r.canceled || !r.filePaths[0] ? null : r.filePaths[0];
      });
    } catch (e) {
      /* 纯 node 运行时无对话框 */
      console.error('[svnkit] 注入系统目录选择失败（浏览器模式将无法选择目录）:', e);
    }
  }

  const handle = await startServer();
  console.log('');
  console.log('  ⬢ svn-git文件版本管理');
  console.log(`  服务已启动: ${handle.url}`);
  console.log(`  启动目录: ${START_DIR} ${repoHint}`);
  if (process.versions.electron && !BROWSER) {
    console.log('  正在打开应用窗口…（无需浏览器，关闭窗口即退出）');
  } else {
    console.log('  正在打开浏览器…（关闭浏览器标签后服务仍在后台，停止请用页面右上角「退出」）');
  }
  console.log('');

  await openUI(handle.url);
}

// Electron 打包版：等 app ready 后再启动（窗口创建要求 ready）；纯 node 直接启动
if (process.versions.electron) {
  const { app } = require('electron') as { app: { whenReady(): Promise<unknown> } };
  void app.whenReady().then(boot);
} else {
  void boot();
}
