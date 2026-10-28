/** 入口：启动本地 HTTP 服务。Electron 打包版用内嵌窗口展示（不依赖系统浏览器）；纯 node 用外部浏览器 */
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { spawn } from 'node:child_process';
import readline from 'node:readline';
import { createRequire } from 'node:module';
import { startServer, setPickDirHandler, setSaveFileHandler } from '../server/index.js';
import { killAllChildren } from '../vcs/exec.js';
import { recoverInflight } from '../inflight.js';
import { detectRepo } from '../vcs/detect.js';
import { platform, setHostOwnsWindow } from '../platform/index.js';
import { dedupeHistory } from '../server/routes/recent.js';
import { loadConfig } from '../config.js';
import { t, setLang } from '../shared/i18n/index.js';
import { TITLE_BAR_HEIGHT } from '../shared/titlebar.js';

const require = createRequire(import.meta.url);

// 退出前收掉还在跑的 git / svn 子进程：Node 退出**不会**连带杀子进程，孤儿会一直往目标目录写，
// 那个目录就被占住删不掉（用户实报）。强杀 / 崩溃走不到这里——那条路由 inflight.ts 的
// recoverInflight 在下次启动兜底（先杀残留进程、再删半截目录）。
process.on('exit', killAllChildren);
// 收到信号先收子进程再退（默认行为直接终止，'exit' 钩子不会跑）
process.on('SIGINT', () => process.exit(130));
process.on('SIGTERM', () => process.exit(0));

/** 启动目录（命令行参数或环境变量） */
const START_DIR = process.env.SVNGIT_DIR ?? process.cwd();

/**
 * 打开界面：
 * - Electron 打包版：内嵌 BrowserWindow（自带渲染引擎，无浏览器也能用）
 * - 纯 node（开发）或 --browser 参数：xdg-open 外部浏览器（服务常驻，页面右上角「退出」停止）
 */
let BROWSER = process.argv.includes('--browser');
// 后台常驻（-d），处理见文件末尾的 -d 分支
let DAEMON = process.argv.includes('-d');

// 运行方式交互菜单：终端里直接运行打包版（不带参数）时先问一下怎么跑。
// 不弹的三种情况：双击图标没有终端（isTTY 假）；带了 --browser / -d 参数（脚本友好）；
// 纯 node（run.sh / npm start）—— 否则源码启动流程会被菜单卡住。
if (process.versions.electron && !BROWSER && !DAEMON && process.stdin.isTTY && process.stdout.isTTY) {
  setLang(loadConfig().lang); // 早于输出定语言：boot() 里这一步还没跑到
  const mode = await askRunMode();
  BROWSER = mode !== '1'; // 2/3 都是"服务 + 浏览器"
  DAEMON = mode === '3';
}

async function openUI(url: string) {
  if (process.versions.electron && !BROWSER) {
    const electron = require('electron') as {
      BrowserWindow: typeof import('electron').BrowserWindow;
      Menu: typeof import('electron').Menu;
      ipcMain: typeof import('electron').ipcMain;
      app: typeof import('electron').app;
    };
    electron.Menu.setApplicationMenu(null);
    // 本进程从此有自己的窗口：平台层据此走"直接 spawn explorer"的快路（见 win32 的 revealPath）
    setHostOwnsWindow(true);
    const win = new electron.BrowserWindow({
      width: 1280,
      height: 820,
      minWidth: 960,
      minHeight: 600,
      // 窗口标题：svn-git-V1.1.0（版本取打进包里的 package.json）
      title: `svn-git-V${electron.app.getVersion()}`,
      autoHideMenuBar: true,
      // import.meta.dirname = 编译产物 main/index.js 所在目录（dist/main/）——
      // icon 和 preload 都在它的上一级（dist/client/、dist/preload.cjs），所以要先 '..'
      icon: path.join(import.meta.dirname ?? '.', '..', 'client', 'icon.png'),
      // Windows：藏掉系统标题栏，改由页面自绘一条居中的标题条（client/shell/title-strip.tsx）。
      // 系统标题永远左对齐贴图标，没有「居中」开关——只能自己画。
      // titleBarOverlay 让最小化/最大化/关闭仍由系统绘制：Snap 布局、双击最大化、悬停高亮都保留。
      // 其他平台（Linux）照旧用原生标题栏，一行不动。
      ...(process.platform === 'win32'
        ? {
            titleBarStyle: 'hidden' as const,
            // 初始配色取浅色主题的 --panel/--text；换主题后由渲染层经 IPC 同步（见下方 ipcMain）
            titleBarOverlay: { height: TITLE_BAR_HEIGHT, color: '#f6f8fa', symbolColor: '#1f2328' },
          }
        : {}),
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(import.meta.dirname ?? '.', '..', 'preload.cjs'),
      },
    });
    win.setMenuBarVisibility(false);
    // 页面里 <title> 一加载就会把上面的标题覆盖掉（Electron 默认行为），挡回去：标题只认上面那个
    win.on('page-title-updated', (e) => e.preventDefault());
    // 前端换主题时同步标题栏覆盖层的底色/符号色（否则右上角三颗系统按钮那块底色跟界面主题对不上）
    electron.ipcMain.on('svngit:titlebar-overlay', (e, options: { color?: string; symbolColor?: string }) => {
      // 只认本窗口的渲染进程
      if (e.sender !== win.webContents || process.platform !== 'win32') return;
      try {
        win.setTitleBarOverlay(options);
      } catch {
        /* 窗口已销毁：忽略 */
      }
    });
    // 关闭窗口 = 退出应用（停止服务）
    win.on('closed', () => electron.app.quit());
    await win.loadURL(url);
    return;
  }
  // 纯 node：打开系统默认浏览器（跨平台，平台逻辑下沉到 src/platform）
  platform.openUrl(url);
}

/** 交互菜单（仅终端直跑打包版时）：读一行选 1/2/3；回车或输入流关闭（Ctrl+D）按默认 1 走。
 *  用常驻的 line 监听（for await）而不是 rl.question —— question 在「多行一次到达」时会丢
 *  后续行（重挂一次性监听器赶不上同一批数据，粘贴多行 / 管道喂输入都会踩到）。 */
async function askRunMode(): Promise<'1' | '2' | '3'> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  // Ctrl+C 放弃启动：readline 缺省只是暂停输入流，会让人以为卡死
  rl.on('SIGINT', () => process.exit(130));
  const showMenu = () => {
    console.log('');
    //   请选择运行方式:
    console.log(t('main.menuTitle'));
    console.log(t('main.menuDirect'));
    console.log(t('main.menuBrowser'));
    console.log(t('main.menuDaemon'));
    rl.setPrompt(t('main.menuPrompt'));
    rl.prompt();
  };
  try {
    showMenu();
    for await (const line of rl) {
      const v = line.trim();
      if (v === '' || v === '1') return '1';
      if (v === '2' || v === '3') return v;
      //   无效选择，请输入 1、2 或 3
      console.log(t('main.menuInvalid'));
      showMenu();
    }
    return '1'; // 输入流关闭（Ctrl+D / 输入耗尽）：按默认走
  } finally {
    rl.close();
  }
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
        dialog: {
          showOpenDialog(opts: unknown): Promise<{ canceled: boolean; filePaths: string[] }>;
          showSaveDialog(opts: unknown): Promise<{ canceled: boolean; filePath?: string }>;
        };
      };
      setPickDirHandler(async () => {
        const r = await dialog.showOpenDialog({
          // 选择 SVN/Git 项目目录
          title: t('main.pickDir'), // 取实时值：用户在界面切过语言后，这里要跟着变
          properties: ['openDirectory'],
        });
        return r.canceled || !r.filePaths[0] ? null : r.filePaths[0];
      });
      // 导出报告用「另存为」：defaultPath 由调用方给（项目目录 + 建议文件名），
      // 用户打开时就直接落在当前项目里，不用从家目录一层层点过去
      setSaveFileHandler(async ({ defaultPath, filterName }) => {
        const r = await dialog.showSaveDialog({
          // 保存导出文件
          title: t('main.saveFile'),
          defaultPath,
          filters: [{ name: filterName, extensions: ['md', 'txt'] }],
        });
        return r.canceled || !r.filePath ? null : r.filePath;
      });
    } catch (e) {
      /* 纯 node 运行时无对话框 */
      // [svngit] 注入系统目录选择失败（浏览器模式将无法选择目录）:
      console.error(t('main.pickDirFail'), e);
    }
  }

  // 收拾上次异常退出留下的孤儿获取（残留进程 + 半截目录）；没有登记时是一次空读，不拖慢启动
  await recoverInflight();

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

// 后台常驻（-d）：重新拉起自身后父进程立即退出 —— 必须用「原文件」重新执行，不能 spawn 挂载点/
// 临时目录里的可执行文件：父进程一退出，AppImage 会卸载 FUSE 挂载、Windows portable 包装器会
// 清理临时目录，子进程将失去二进制。$APPIMAGE / $PORTABLE_EXECUTABLE_FILE 分别是这两种运行器
// 注入的原文件路径；纯 node（开发）退回 execPath + 脚本路径。窗口版关窗即退、没有常驻语义，
// 故 -d 自动补齐 --browser。停止方式不变：页面右上角「退出」（POST /api/shutdown）。
if (DAEMON) {
  const exe = process.env.APPIMAGE ?? process.env.PORTABLE_EXECUTABLE_FILE ?? process.execPath;
  const args = process.argv.slice(1).filter((a) => a !== '-d');
  if (!args.includes('--browser')) args.push('--browser');
  setLang(loadConfig().lang); // 早于输出定语言：boot() 里这一步还没跑到
  if (!fs.existsSync(exe)) {
    // [svngit] 找不到可执行文件，无法后台启动: {exe}
    console.error(t('main.daemonMissing', { exe }));
    process.exit(1);
  }
  // 已在后台启动（浏览器将自动打开）；停止：页面右上角「退出」
  console.log(t('main.daemonStarted'));
  spawn(exe, args, { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  process.exit(0);
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
