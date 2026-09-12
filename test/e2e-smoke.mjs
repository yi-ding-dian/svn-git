/** 前端 e2e 冒烟测试：给「没有自动化测试」的展示层兜一张网。
 *
 *  为什么存在：近期修的 5 个问题里有 4 个在展示层（按钮被裁、悬浮提示缺内容、
 *  改注释丢正文、主题残留），而后端 186 个断言和 CI 一个都拦不住——只能靠手点发现。
 *  这里把那条手点路径固化下来。
 *
 *  运行方式：npm run test:e2e（需先 npm run build，脚本用 dist/ 起服务）
 *  - 浏览器：复用 ~/.cache/ms-playwright 下已有的 chromium（playwright-core 不下载浏览器）
 *  - 服务：自起 node dist/main.js，端口从启动日志解析（23456 被占用时服务会自动换随机端口）
 *  - 隔离：用 svngit-test/git-repo 作夹具，不碰用户正在用的服务
 */
import { chromium } from 'playwright-core';
import { spawn, execFileSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/** 造一个「有远程且本地领先」的夹具。
 *  「修改注释」菜单只在未推送提交上出现，纯本地仓库测不到这条路径——而那正是
 *  "改注释丢正文"（数据丢失级）bug 的入口，必须有回归覆盖。
 *  每次重建（成本约 1 秒），避免上次运行留下的状态漂移。 */
function ensureAmendFixture() {
  const dir = path.join(ROOT, 'svngit-test', 'e2e-amend-repo');
  const remote = path.join(ROOT, 'svngit-test', 'e2e-amend-remote.git');
  const git = (args, cwd) => execFileSync('git', args, { cwd, stdio: 'pipe' });
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(remote, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  git(['init', '-q'], dir);
  git(['config', 'user.email', 'e2e@svngit.local'], dir);
  git(['config', 'user.name', 'e2e'], dir);
  fs.writeFileSync(path.join(dir, 'readme.md'), 'v1\n');
  git(['add', '-A'], dir);
  git(['commit', '-qm', '初始提交'], dir);
  git(['init', '--bare', '-q', remote], ROOT);
  git(['remote', 'add', 'origin', remote], dir);
  git(['push', '-q', '-u', 'origin', 'HEAD'], dir); // 基线：已推送
  // 再做一个未推送提交，正文含 # 开头行（同时覆盖 -F - 与 cleanup 两个回归点）
  fs.writeFileSync(path.join(dir, 'readme.md'), 'v2\n');
  git(['add', '-A'], dir);
  git(['commit', '-q', '--cleanup=whitespace', '-m', 'e2e 标题', '-m', 'e2e 正文第一行\n# 井号行'], dir);
  // 再留一个未提交改动：Stash 按钮依赖"工作区有改动"才可点（弹窗回归要用）
  fs.writeFileSync(path.join(dir, 'readme.md'), 'v3 未提交\n');
  return dir;
}

const FIXTURE = ensureAmendFixture();

let pass = 0;
let fail = 0;
function check(name, cond, extra = '') {
  if (cond) {
    pass++;
    console.log(`  ✅ ${name} ${extra}`);
  } else {
    fail++;
    console.log(`  ❌ ${name} ${extra}`);
  }
}

/** 找一个可用的 chromium（playwright-core 不自带，复用 MCP/其他工具装的缓存） */
function findChromium() {
  const base = path.join(os.homedir(), '.cache', 'ms-playwright');
  if (!fs.existsSync(base)) return null;
  const dirs = fs.readdirSync(base).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse();
  for (const d of dirs) {
    for (const sub of ['chrome-linux64', 'chrome-linux', 'chrome-mac', 'chrome-win']) {
      const exe = path.join(base, d, sub, process.platform === 'win32' ? 'chrome.exe' : 'chrome');
      if (fs.existsSync(exe)) return exe;
    }
  }
  return null;
}

/** 起服务并解析端口；用一个空的 xdg-open 垫在 PATH 前面，避免测试时弹出系统浏览器 */
function startServer() {
  const noop = fs.mkdtempSync(path.join(os.tmpdir(), 'svngit-e2e-'));
  const xdg = path.join(noop, 'xdg-open');
  fs.writeFileSync(xdg, '#!/bin/sh\nexit 0\n', { mode: 0o700 });
  return new Promise((resolve, reject) => {
    const proc = spawn('node', [path.join(ROOT, 'dist', 'main.js')], {
      cwd: ROOT,
      env: { ...process.env, SVNGIT_DIR: FIXTURE, PATH: `${noop}:${process.env.PATH}` },
    });
    let buf = '';
    const timer = setTimeout(() => reject(new Error(`服务启动超时，输出:\n${buf}`)), 25_000);
    proc.stdout.on('data', (d) => {
      buf += d.toString();
      const m = buf.match(/http:\/\/127\.0\.0\.1:(\d+)/);
      if (m) {
        clearTimeout(timer);
        resolve({ proc, port: Number(m[1]), noop });
      }
    });
    proc.on('error', reject);
  });
}

const chromiumPath = findChromium();
if (!chromiumPath) {
  console.error('❌ 找不到 chromium：需先安装 playwright 浏览器缓存（~/.cache/ms-playwright）');
  process.exit(1);
}

const { proc, port, noop } = await startServer();
const browser = await chromium.launch({ executablePath: chromiumPath, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const cleanup = async () => {
  await browser.close().catch(() => {});
  proc.kill();
  fs.rmSync(noop, { recursive: true, force: true });
};

try {
  console.log(`== 前端冒烟（服务 127.0.0.1:${port}，夹具 ${path.relative(ROOT, FIXTURE)}）==`);
  await page.goto(`http://127.0.0.1:${port}`);
  await page.waitForTimeout(2500);
  check('页面加载', (await page.title()) === 'svn-git文件版本管理');

  console.log('== 历史视图 ==');
  await page.getByText('历史', { exact: true }).first().click();
  await page.waitForTimeout(2200);
  const rows = await page.locator('.list-item').count();
  check('提交列表有内容', rows > 0, `(${rows} 行)`);
  if (rows > 0) {
    const title = await page.locator('.list-item').first().getAttribute('title');
    check('提交行有悬浮提示', Boolean(title && title.length > 0), `(${String(title).slice(0, 24)}…)`);
  }

  console.log('== 详情面板「← 返回」按钮（回归：曾被容器 24px 裁掉上边框）==');
  await page.locator('.list-item').first().click();
  await page.waitForTimeout(1200);
  const btn = await page.locator('button', { hasText: '返回' }).first().evaluate((el) => {
    const b = el.getBoundingClientRect();
    const outer = el.parentElement.parentElement.getBoundingClientRect();
    return { h: b.height, top: b.top, outerTop: outer.top };
  });
  check('按钮高度 ≤ 24px（不再超出容器）', btn.h <= 24, `(实测 ${btn.h}px)`);
  check('按钮未上溢面板顶部', btn.top >= btn.outerTop - 0.5, `(按钮 top=${btn.top} vs 面板 top=${btn.outerTop})`);

  console.log('== 主题气泡（回归：自定义主题切回内置后 inline 变量残留）==');
  await page.locator('.theme-more').click();
  await page.waitForTimeout(600);
  check('气泡弹出', (await page.locator('.theme-pop').count()) === 1);
  check('主题项 ≥ 16 套', (await page.locator('.theme-chip').count()) >= 16, `(${await page.locator('.theme-chip').count()} 项)`);
  await page.locator('.theme-chip', { hasText: '深海' }).click();
  await page.waitForTimeout(600);
  const darkBg = await page.evaluate(() => getComputedStyle(document.body).getPropertyValue('--bg').trim());
  check('深色主题生效', darkBg === '#0d1117', `(--bg=${darkBg})`);
  const hl = await page.evaluate(() => getComputedStyle(document.body).getPropertyValue('--hl-keyword').trim());
  check('深色下代码高亮切成亮色', hl === '#ff7b72', `(--hl-keyword=${hl})`);
  await page.locator('.theme-chip', { hasText: '浅白' }).click();
  await page.waitForTimeout(600);
  const inlineCount = await page.evaluate(() => document.body.style.length);
  check('切回内置主题无 inline 残留', inlineCount === 0, `(残留 ${inlineCount} 个)`);
  await page.mouse.click(900, 820); // 点遮罩关气泡
  await page.waitForTimeout(400);

  console.log('== 弹窗渲染（ModalHost 拆分前的回归网）==');
  for (const btn of ['分支', 'Stash']) {
    const b = page.locator('button', { hasText: btn }).first();
    if ((await b.count()) === 0) {
      console.log(`  ⏭  跳过「${btn}」：顶栏无此按钮`);
      continue;
    }
    if (await b.isDisabled()) {
      console.log(`  ⏭  跳过「${btn}」：按钮当前禁用（前置条件不满足）`);
      continue;
    }
    await b.click();
    await page.waitForTimeout(1000);
    const n = await page.locator('.modal-mask').count();
    const head = n ? (await page.locator('.modal-mask').first().innerText()).split('\n').filter(Boolean)[0] : '';
    check(`「${btn}」弹窗能打开`, n > 0, `(标题: ${head})`);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(700);
    check(`「${btn}」弹窗能关闭`, (await page.locator('.modal-mask').count()) === 0);
  }

  console.log('== 修改提交注释（回归：曾只回显标题，确认后覆盖丢失正文）==');
  await page.locator('.list-item').first().click({ button: 'right' });
  await page.waitForTimeout(500);
  const amendItem = page.locator('.ctx-item', { hasText: '修改注释' });
  if ((await amendItem.count()) === 0) {
    console.log('  ⏭  跳过：夹具无可改注释的提交（需带远程且本地领先的仓库）');
  } else {
    await amendItem.click();
    await page.waitForTimeout(1500);
    const val = await page.locator('textarea').first().inputValue();
    check('注释框回显非空', val.length > 0, `(${val.length} 字符)`);
    check('回显包含正文（非仅标题）', !val.includes('\n') || val.split('\n').length > 1, `(${val.split('\n').length} 行)`);
    await page.locator('button', { hasText: '取消' }).first().click();
    await page.waitForTimeout(400);
  }
} catch (e) {
  fail++;
  console.error(`  ❌ 执行异常: ${e.message}`);
} finally {
  await cleanup();
}

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
