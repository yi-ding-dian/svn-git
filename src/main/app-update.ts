/** 应用自身在线升级。两条后端：
 *
 *  **Electron 打包版**（Windows 安装版 / Linux AppImage）
 *    electron-updater：检查 → 下载 → 安装重启；portable 不支持替换运行中的 exe，只给发布页入口。
 *
 *  **WSL / 纯 Node tar.gz 包**
 *    没有 Electron，自己走 GitHub Release：
 *      检查：拉 latest.yml 里的 version（不是 GitHub API，避免限流）；
 *      下载：拉 checksums.txt 校验 sha256 → 下载 tar.gz → 解压到应用目录的兄弟目录；
 *      安装：写一个 /bin/sh 脚本，等本进程退出后把旧目录挪走、新目录换进来、用 run-wsl.sh
 *            重启；新服务起不来就回滚旧版（脚本日志在 ~/.cache/svngit/update.log）。
 *    包根目录必须有 .svngit-package.json（由 deploy/wsl-pack.mjs 写入）：没有标记的一律按
 *    源码运行处理，避免在开发机上误碰真实目录。
 *
 *  GitHub 访问默认走 gh-proxy 加速（「关于」里可关、可改地址）。Electron 用 generic provider；
 *  Node 后端直接把前缀拼在完整 GitHub URL 前面。两者都是「先用加速，失败回退直连」。
 *
 *  测试钩子（正常运行不设置）：
 *    SVNGIT_APP_ROOT              覆盖应用根目录（Node 后端读 marker / package.json 用）
 *    SVNGIT_UPDATE_GITHUB_BASE    覆盖 https://github.com/<owner>/<repo>（本地起假 Release 验收）
 *
 *  模块加载本身不 require electron-updater：纯 Node 包里它也会被 npm ci 装上（生产依赖），
 *  但只有 Electron 打包版真正用到，懒加载避免纯 Node 启动时碰 Electron 相关模块。
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import http from 'node:http';
import https from 'node:https';
import { execFile, spawn } from 'node:child_process';
import { loadConfig } from '../config.js';
import { t } from '../shared/i18n/index.js';
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

/** 清掉上一次检查留下的版本/进度，避免「重新检查」时界面还挂着旧版本号 */
function resetCheck(): void {
  status.phase = 'checking';
  status.version = undefined;
  status.releaseDate = undefined;
  status.sizeBytes = undefined;
  status.notes = undefined;
  status.percent = undefined;
  status.bytesPerSecond = undefined;
  status.transferred = undefined;
  status.total = undefined;
  status.error = undefined;
  lastError = '';
}

function scheduleAutoCheck(): void {
  // 启动后静默检查一次：用户打开「关于」前状态就已就绪，顶栏也能提示有新版；
  // 只检查不下载（更新包大，下载/安装都要用户点确认）。unref 避免拖住进程退出。
  const timer = setTimeout(() => {
    if (status.phase === 'idle') void check();
  }, 5000);
  timer.unref?.();
}

// ---------------------------------------------------------------- Electron 后端

let updater: AppUpdater | null = null;

/** 加速后的更新源目录：gh-proxy 的形式是「前缀 + 完整 GitHub URL」 */
function proxyFeedUrl(prefix: string): string {
  const base = (prefix.trim() || DEFAULT_GITHUB_DOWNLOAD_PROXY).replace(/\/+$/, '');
  return `${base}/https://github.com/${APP_GITHUB_OWNER}/${APP_GITHUB_REPO}/releases/latest/download/`;
}

function detectElectronMode(windowMode: boolean): AppUpdateMode {
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

function isElectronSupported(mode: AppUpdateMode): boolean {
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
    // 发布日志异步补：拉不到不影响更新（用户可能已经又点了一次检查，版本对不上就不写）
    void fetchReleaseNotes(info.version).then((notes) => {
      if (notes && status.version === info.version) status.notes = notes;
    });
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

async function doCheckElectron(): Promise<AppUpdateStatus> {
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
  status.error = lastError || t('main.updateCheckFailed');
  return snapshot();
}

function downloadElectron(): AppUpdateStatus {
  if (!updater || status.phase !== 'available') return snapshot();
  status.phase = 'downloading';
  status.percent = 0;
  status.error = undefined;
  lastError = '';
  void updater.downloadUpdate().catch((error) => {
    status.phase = 'error';
    status.error = messageOf(error) || lastError || t('main.updateDownloadFailed');
  });
  return snapshot();
}

function installElectron(): { ok: boolean; error?: string } {
  if (!updater) return { ok: false, error: 'unsupported' };
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

// ---------------------------------------------------------------- WSL / 纯 Node 后端

type PackageFlavor = 'wsl' | 'wsl-node';

interface NodePackageInfo {
  root: string;
  flavor: PackageFlavor;
  version: string;
}

let nodePackage: NodePackageInfo | null = null;
/** 当前服务实际监听端口（23456 被别的程序占用时是随机端口）：升级后的健康检查用它 */
let appPort = 23456;
export function setAppUpdatePort(port: number): void {
  appPort = port;
}
/** 检查成功用的源（true=加速）。下载优先用它，避免检查走加速、下载又去直连。 */
let nodeActiveProxy: boolean | null = null;
/** 已解压好的新版本目录（安装时整体换进应用根目录） */
let downloadedRoot: string | null = null;
/** 解压用的兄弟目录（换目录后清空） */
let updateTempRoot: string | null = null;
/** 已下载的压缩包（解压后删除；失败时清理） */
let updateArchive: string | null = null;

/** 应用根目录：编译产物在 <root>/dist/main，往上两级。测试可用 SVNGIT_APP_ROOT 覆盖。 */
function appRoot(): string {
  const override = process.env.SVNGIT_APP_ROOT?.trim();
  if (override) return path.resolve(override);
  return path.resolve(import.meta.dirname ?? '.', '..', '..');
}

function readNodePackage(): NodePackageInfo | null {
  try {
    const root = appRoot();
    const markerPath = path.join(root, '.svngit-package.json');
    if (!fs.existsSync(markerPath)) return null;
    const marker = JSON.parse(fs.readFileSync(markerPath, 'utf8')) as {
      kind?: unknown;
      flavor?: unknown;
      version?: unknown;
    };
    if (marker.kind !== 'svn-git-package') return null;
    const flavor: PackageFlavor | null = marker.flavor === 'wsl-node' ? 'wsl-node' : marker.flavor === 'wsl' ? 'wsl' : null;
    if (!flavor) return null;
    let version = '';
    try {
      version = String((JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as { version?: unknown }).version ?? '');
    } catch {
      version = String(marker.version ?? '');
    }
    if (!version) return null;
    return { root, flavor, version };
  } catch {
    return null;
  }
}

/** GitHub 仓库基地址。测试/镜像可用 SVNGIT_UPDATE_GITHUB_BASE 覆盖（指向本地假 Release）。 */
function githubBase(): string {
  const override = process.env.SVNGIT_UPDATE_GITHUB_BASE?.trim();
  if (override) return override.replace(/\/+$/, '');
  return `https://github.com/${APP_GITHUB_OWNER}/${APP_GITHUB_REPO}`;
}

function proxyPrefix(): string {
  return (status.proxy.prefix.trim() || DEFAULT_GITHUB_DOWNLOAD_PROXY).replace(/\/+$/, '');
}

/** 检查源：latest.yml 在 releases/latest/download/ 下 */
function checkBase(useProxy: boolean): string {
  const github = `${githubBase()}/releases/latest/download`;
  return useProxy ? `${proxyPrefix()}/${github}` : github;
}

/** 下载源：产物在 releases/download/v<版本>/ 下 */
function downloadBase(useProxy: boolean, version: string): string {
  const github = `${githubBase()}/releases/download/v${version}`;
  return useProxy ? `${proxyPrefix()}/${github}` : github;
}

/** 源顺序：加速开着就先加速再直连；检查已证明直连可用时直连优先。 */
function sourceOrder(): boolean[] {
  if (!status.proxy.enabled) return [false];
  if (nodeActiveProxy === false) return [false, true];
  return [true, false];
}

function assetName(version: string): string {
  const suffix = nodePackage?.flavor === 'wsl-node' ? '-node' : '';
  return `svn-git-${version}-wsl${suffix}.tar.gz`;
}

function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((x) => parseInt(x, 10) || 0);
  const pb = b.split('.').map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
}

/** 打开一个 HTTP(S) 响应并跟随重定向。
 *  **不用全局 fetch**：Node 22 的 undici 在下载大文件、写盘背压暂停底层流时可能抛
 *  assert(!this.paused) 直接把进程崩掉（本地 E2E 实测复现）；http/https 模块的 pause/resume
 *  是稳定路径。GitHub → S3、gh-proxy → 存储的 302 都靠这里跟。 */
function openResponse(url: string, method: 'GET' | 'HEAD', timeoutMs: number, redirects = 0): Promise<http.IncomingMessage> {
  return new Promise((resolve, reject) => {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      reject(new Error(t('main.updateBadUrl', { url })));
      return;
    }
    const client = parsed.protocol === 'https:' ? https : http;
    const req = client.request(parsed, { method, headers: { 'User-Agent': 'svn-git-updater' } }, (res) => {
      const status = res.statusCode ?? 0;
      const location = res.headers.location;
      if (status >= 300 && status < 400 && location && redirects < 5) {
        res.resume();
        openResponse(new URL(location, parsed).href, method, timeoutMs, redirects + 1).then(resolve, reject);
        return;
      }
      if (status < 200 || status >= 300) {
        res.resume();
        reject(new Error(t('main.updateHttpError', { status, url })));
        return;
      }
      resolve(res);
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error(t('main.updateTimeout', { url }))));
    req.on('error', reject);
    req.end();
  });
}

async function fetchText(url: string, timeoutMs: number): Promise<string> {
  const res = await openResponse(url, 'GET', timeoutMs);
  return await new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    res.on('data', (chunk: Buffer) => chunks.push(chunk));
    res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    res.on('error', reject);
    res.on('aborted', () => reject(new Error(t('main.updateConnectionAborted', { url }))));
  });
}

/** 更新包大小（尽力而为；拿不到就不显示，不影响更新） */
async function fetchSize(url: string): Promise<number | undefined> {
  try {
    const res = await openResponse(url, 'HEAD', 10_000);
    res.resume();
    const raw = res.headers['content-length'];
    const n = Number(Array.isArray(raw) ? raw[0] : raw);
    return Number.isFinite(n) && n > 0 ? n : undefined;
  } catch {
    return undefined;
  }
}

/** 拉取新版本的发布日志：GitHub Release 正文（匿名可读，CI 从 tag 注释写入）。
 *  失败静默返回 undefined——「关于」里少一段说明，不影响更新本身。 */
async function fetchReleaseNotes(version: string): Promise<string | undefined> {
  const api = `https://api.github.com/repos/${APP_GITHUB_OWNER}/${APP_GITHUB_REPO}/releases/tags/v${version}`;
  for (const useProxy of sourceOrder()) {
    const url = useProxy ? `${proxyPrefix()}/${api}` : api;
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'svn-git', Accept: 'application/vnd.github+json' },
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) continue;
      const body = ((await res.json()) as { body?: unknown }).body;
      if (typeof body === 'string' && body.trim()) return body.trim();
    } catch {
      /* 这个源失败：试下一个 */
    }
  }
  return undefined;
}

/** latest.yml 只需要 version / releaseDate（Node 包不关心 Windows 安装包字段） */
function parseLatest(text: string): { version: string; releaseDate?: string } | null {
  const version = /^version:\s*['"]?([^'"\s]+)['"]?/m.exec(text)?.[1];
  if (!version) return null;
  const releaseDate = /^releaseDate:\s*['"]?([^'"\r\n]+?)['"]?\s*$/m.exec(text)?.[1];
  return { version, releaseDate };
}

function parseChecksum(text: string, asset: string): string | null {
  for (const line of text.split('\n')) {
    // sha256sum 的两种格式：<hash>  <name> / <hash> *<name>
    const match = /^([a-fA-F0-9]{64})\s+\*?(.+?)\s*$/.exec(line.trim());
    if (match && match[2] === asset) return match[1]!.toLowerCase();
  }
  return null;
}

function cleanupDownload(): void {
  if (updateTempRoot) {
    fs.rmSync(updateTempRoot, { recursive: true, force: true });
    updateTempRoot = null;
  }
  if (updateArchive) {
    fs.rmSync(updateArchive, { force: true });
    updateArchive = null;
  }
  downloadedRoot = null;
}

/** 启动时清掉一小时前的残留（上次下载完没点安装就退出等） */
function cleanupStaleUpdateDirs(root: string): void {
  try {
    const parent = path.dirname(root);
    for (const name of fs.readdirSync(parent)) {
      if (!name.startsWith('.svngit-update-')) continue;
      const full = path.join(parent, name);
      try {
        if (Date.now() - fs.statSync(full).mtimeMs > 3600_000) fs.rmSync(full, { recursive: true, force: true });
      } catch {
        /* 单个目录清理失败不影响启动 */
      }
    }
  } catch {
    /* 父目录不可读等情况忽略 */
  }
}

async function doCheckNode(): Promise<AppUpdateStatus> {
  const pkg = nodePackage;
  if (!pkg) return snapshot();
  resetCheck();
  for (const useProxy of sourceOrder()) {
    try {
      const latest = parseLatest(await fetchText(`${checkBase(useProxy)}/latest.yml`, 15_000));
      if (!latest) throw new Error(t('main.updateLatestInvalid'));
      nodeActiveProxy = useProxy;
      if (compareVersions(latest.version, pkg.version) <= 0) {
        status.phase = 'latest';
        return snapshot();
      }
      status.phase = 'available';
      status.version = latest.version;
      status.releaseDate = latest.releaseDate;
      // 发布日志异步补：拉不到不影响更新
      void fetchReleaseNotes(latest.version).then((notes) => {
        if (notes && status.version === latest.version) status.notes = notes;
      });
      status.sizeBytes = await fetchSize(`${downloadBase(useProxy, latest.version)}/${assetName(latest.version)}`);
      return snapshot();
    } catch (error) {
      lastError = messageOf(error) || lastError;
    }
  }
  status.phase = 'error';
  status.error = lastError || t('main.updateCheckFailed');
  return snapshot();
}

async function downloadFile(url: string, dest: string, expectedSha256: string): Promise<void> {
  // 46MB 的包在慢网络下要几分钟；给 10 分钟的空闲超时（有数据流动就不会触发）
  const res = await openResponse(url, 'GET', 10 * 60 * 1000);
  const rawTotal = res.headers['content-length'];
  const total = Number(Array.isArray(rawTotal) ? rawTotal[0] : rawTotal) || 0;
  status.total = total || undefined;
  status.transferred = 0;
  status.percent = 0;
  const hash = crypto.createHash('sha256');
  const file = fs.createWriteStream(dest);
  let received = 0;
  let lastBytes = 0;
  let lastAt = Date.now();
  try {
    await new Promise<void>((resolve, reject) => {
      res.on('data', (chunk: Buffer) => {
        received += chunk.length;
        hash.update(chunk);
        status.transferred = received;
        if (total > 0) status.percent = Math.min(99, Math.round((received / total) * 100));
        const now = Date.now();
        if (now - lastAt >= 500) {
          status.bytesPerSecond = ((received - lastBytes) * 1000) / (now - lastAt);
          lastBytes = received;
          lastAt = now;
        }
        if (!file.write(chunk)) {
          // 写盘慢时暂停 socket，drain 后继续；这是 http 模块的背压标准用法
          res.pause();
          file.once('drain', () => res.resume());
        }
      });
      res.on('end', () => file.end((error?: Error | null) => (error ? reject(error) : resolve())));
      res.on('error', reject);
      res.on('aborted', () => reject(new Error(t('main.updateConnectionAborted', { url }))));
      file.on('error', reject);
    });
  } catch (error) {
    file.destroy();
    fs.rmSync(dest, { force: true });
    throw error;
  }
  const actual = hash.digest('hex');
  if (actual.toLowerCase() !== expectedSha256.toLowerCase()) {
    fs.rmSync(dest, { force: true });
    throw new Error(t('main.updateChecksumMismatch', { expected: expectedSha256, actual }));
  }
}

function extractTar(archive: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // 包可能在 /mnt/c（9p 文件系统，小文件很多），解压给足 5 分钟
    execFile('tar', ['-xzf', archive, '-C', dest], { timeout: 300_000 }, (error, _stdout, stderr) => {
      if (error) reject(new Error(t('main.updateExtractFailed', { msg: String(stderr || error.message).trim() })));
      else resolve();
    });
  });
}

async function doDownloadNode(version: string): Promise<void> {
  const pkg = nodePackage;
  if (!pkg) throw new Error(t('main.updateNotPackage'));
  const asset = assetName(version);
  // 应用根目录的父目录必须可写：换版本是「兄弟目录改名」，不是在原目录里覆盖文件
  try {
    fs.accessSync(path.dirname(pkg.root), fs.constants.W_OK);
  } catch {
    throw new Error(t('main.updateParentNotWritable'));
  }
  cleanupDownload();
  for (const useProxy of sourceOrder()) {
    try {
      const base = downloadBase(useProxy, version);
      const checksums = await fetchText(`${base}/checksums.txt`, 15_000);
      const expected = parseChecksum(checksums, asset);
      if (!expected) throw new Error(t('main.updateChecksumMissing', { asset }));
      const archive = path.join(os.tmpdir(), `svngit-${version}-${process.pid}.tar.gz`);
      updateArchive = archive;
      await downloadFile(`${base}/${asset}`, archive, expected);
      const tempRoot = path.join(path.dirname(pkg.root), `.svngit-update-${version}-${Date.now()}`);
      fs.mkdirSync(tempRoot, { recursive: true });
      updateTempRoot = tempRoot;
      await extractTar(archive, tempRoot);
      fs.rmSync(archive, { force: true });
      updateArchive = null;
      const dirs = fs.readdirSync(tempRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory());
      if (dirs.length !== 1) throw new Error(t('main.updateArchiveLayout'));
      downloadedRoot = path.join(tempRoot, dirs[0]!.name);
      status.phase = 'downloaded';
      status.percent = 100;
      status.bytesPerSecond = undefined;
      return;
    } catch (error) {
      lastError = messageOf(error) || lastError;
      cleanupDownload();
    }
  }
  throw new Error(lastError || t('main.updateDownloadFailed'));
}

function downloadNode(): AppUpdateStatus {
  if (!nodePackage || !status.version || status.phase !== 'available') return snapshot();
  const version = status.version;
  status.phase = 'downloading';
  status.percent = 0;
  status.error = undefined;
  lastError = '';
  void doDownloadNode(version).catch((error) => {
    status.phase = 'error';
    status.error = messageOf(error) || lastError || t('main.updateDownloadFailed');
    cleanupDownload();
  });
  return snapshot();
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** 换版本脚本：等旧进程退出 → 旧目录改名备份 → 新目录换到**带新版本号的目录名**里 →
 *  run-wsl.sh 重启 → 健康检查失败回滚。目录名跟着版本走（svn-git-<版本>-wsl），
 *  旧的带旧版本号的路径会消失，日志里会打印新路径。
 *  **不写成 Node 子进程**：本进程马上要退出，脚本必须在它退出后继续跑，/bin/sh 最省事。 */
function buildSwapScript(root: string, newRoot: string, targetRoot: string, pid: number, port: number): string {
  const oldRoot = `${root}.old-${Date.now()}`;
  const failedRoot = `${targetRoot}.failed-${Date.now()}`;
  return `#!/bin/sh
set -u
LOG="\${HOME:-/tmp}/.cache/svngit/update.log"
mkdir -p "$(dirname "$LOG")" 2>/dev/null || true
exec >>"$LOG" 2>&1
ROOT=${shellQuote(root)}
NEW=${shellQuote(newRoot)}
TARGET=${shellQuote(targetRoot)}
OLD=${shellQuote(oldRoot)}
FAILED=${shellQuote(failedRoot)}
PID=${pid}
PORT=${port}
echo "[$(date '+%F %T')] update start: $ROOT -> $TARGET"
i=0
while kill -0 "$PID" 2>/dev/null; do
  i=$((i+1))
  if [ "$i" -gt 150 ]; then
    echo "timeout waiting for old process; abort (nothing changed)"
    exit 1
  fi
  sleep 0.2
done
# 目标版本目录已存在（上次更新残留）：先清掉，否则 mv 会变成嵌套目录
if [ "$TARGET" != "$ROOT" ] && [ -e "$TARGET" ]; then
  rm -rf "$TARGET" || { echo "failed to remove stale target"; exit 1; }
fi
if ! mv "$ROOT" "$OLD"; then
  echo "failed to move old directory (parent not writable?)"
  exit 1
fi
if ! mv "$NEW" "$TARGET"; then
  echo "failed to move new directory in; rolling back"
  mv "$OLD" "$ROOT"
  exit 1
fi
rmdir "$(dirname "$NEW")" 2>/dev/null || true
cd "$TARGET" || exit 1
if [ -x ./run-wsl.sh ]; then
  ./run-wsl.sh >/dev/null 2>&1 || true
else
  bash ./run-wsl.sh >/dev/null 2>&1 || true
fi
if command -v curl >/dev/null 2>&1; then
  ok=0
  i=0
  while [ "$i" -lt 40 ]; do
    i=$((i+1))
    if curl -sf "http://127.0.0.1:$PORT/api/info" 2>/dev/null | grep -q '"instanceId"'; then
      ok=1
      break
    fi
    sleep 0.5
  done
  if [ "$ok" != "1" ]; then
    echo "new version failed to start; rolling back"
    mv "$TARGET" "$FAILED" 2>/dev/null || true
    mv "$OLD" "$ROOT" || exit 1
    cd "$ROOT" || exit 1
    if [ -x ./run-wsl.sh ]; then
      ./run-wsl.sh >/dev/null 2>&1 || true
    else
      bash ./run-wsl.sh >/dev/null 2>&1 || true
    fi
    exit 1
  fi
fi
rm -rf "$OLD"
echo "[$(date '+%F %T')] update finished: $TARGET"
`;
}

function installNode(): { ok: boolean; error?: string } {
  const pkg = nodePackage;
  if (!pkg) return { ok: false, error: 'unsupported' };
  if (!downloadedRoot || !fs.existsSync(downloadedRoot)) return { ok: false, error: 'not-downloaded' };
  try {
    fs.accessSync(path.dirname(pkg.root), fs.constants.W_OK);
  } catch {
    return { ok: false, error: 'read-only' };
  }
  cleanupStaleUpdateDirs(pkg.root);
  // 更新后的目录名跟着新版本走（父目录下 svn-git-<版本>-wsl）：旧版本号的目录名会消失，
  // 避免"里面是 1.7.1、文件夹还叫 1.6.0"的误导。
  const version = status.version || pkg.version;
  const targetRoot = path.join(
    path.dirname(pkg.root),
    `svn-git-${version}-wsl${pkg.flavor === 'wsl-node' ? '-node' : ''}`,
  );
  const script = path.join(os.tmpdir(), `svngit-update-${process.pid}.sh`);
  fs.writeFileSync(script, buildSwapScript(pkg.root, downloadedRoot, targetRoot, process.pid, appPort), { mode: 0o755 });
  // 先让 HTTP 响应返回，再 spawn 脚本并退出；脚本自己会等本进程消失后再换目录
  setTimeout(() => {
    const child = spawn('/bin/sh', [script], { detached: true, stdio: 'ignore' });
    child.unref();
    setTimeout(() => process.exit(0), 200);
  }, 400);
  return { ok: true };
}

// ---------------------------------------------------------------- 公共入口

/** 并发检查合并：弹窗自动检查与启动后静默检查可能同时发起，复用同一个 Promise */
let checkPromise: Promise<AppUpdateStatus> | null = null;

function check(): Promise<AppUpdateStatus> {
  if (!status.supported) return Promise.resolve(snapshot());
  if (checkPromise) return checkPromise;
  checkPromise = (process.versions.electron ? doCheckElectron() : doCheckNode()).finally(() => {
    checkPromise = null;
  });
  return checkPromise;
}

function download(): AppUpdateStatus {
  if (!status.supported || status.phase !== 'available') return snapshot();
  return process.versions.electron ? downloadElectron() : downloadNode();
}

function install(): { ok: boolean; error?: string } {
  if (!status.supported) return { ok: false, error: 'unsupported' };
  if (status.phase !== 'downloaded') return { ok: false, error: 'not-downloaded' };
  return process.versions.electron ? installElectron() : installNode();
}

function setProxy(settings: AppUpdateProxySettings): void {
  status.proxy = { enabled: settings.enabled, prefix: settings.prefix };
  nodeActiveProxy = null;
  // 换了源，之前的检查结果作废，用户要重新点「检查更新」
  if (status.phase === 'available') {
    status.phase = 'idle';
    status.version = undefined;
    status.releaseDate = undefined;
    status.sizeBytes = undefined;
  }
  if (process.versions.electron) applyFeed(status.proxy.enabled);
}

/** 由 main 在 boot 里调用；返回给 server 路由注入 */
export function initAppUpdate(options: { windowMode: boolean }): AppUpdateHandlers {
  const proxy = readProxy();
  if (process.versions.electron) {
    const mode = detectElectronMode(options.windowMode);
    const supported = isElectronSupported(mode);
    status = { mode, supported, phase: supported ? 'idle' : 'unsupported', proxy };
    if (supported) {
      try {
        updater = createUpdater();
        applyFeed(proxy.enabled);
        scheduleAutoCheck();
      } catch (error) {
        updater = null;
        status.supported = false;
        status.phase = 'error';
        status.error = messageOf(error);
      }
    }
  } else {
    // 纯 Node：只有带包标记的 WSL 发行包才启用（源码运行 / 随便某个 Node 进程不动真实目录）
    const pkg = process.platform === 'linux' ? readNodePackage() : null;
    if (pkg) {
      nodePackage = pkg;
      cleanupStaleUpdateDirs(pkg.root);
      status = { mode: 'node', supported: true, phase: 'idle', proxy };
      scheduleAutoCheck();
    } else {
      nodePackage = null;
      status = { mode: 'source', supported: false, phase: 'unsupported', proxy };
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
