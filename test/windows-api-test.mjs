/**
 * Windows 功能回归自测
 *   用法:  node test/windows-api-test.mjs        （需先 npm run build）
 *
 * 作用:
 *   - 在系统临时目录自建一个独立 git 测试仓库（含中文文件/分支/标签/修改/未跟踪，不碰正式项目）
 *   - 后台启动 HTTP 服务，把 UI 各按钮背后调用的 REST 接口逐个打一遍
 *   - 判定:  HTTP 状态 < 500（无崩溃/500）+ 中文不乱码（无 U+FFFD / 控制字符）+ 图片接口返回图片
 *   - 结束后关闭服务、删除临时仓库
 *
 * 说明:
 *   - 只测 git，不测 svn；不调用会改动本机配置/最近项目历史的接口（/api/config POST、/api/open、/api/history-fav）
 *   - “打开方式”只测接口与校验路径，/api/reveal、/api/open-with 真实启动不在脚本里（会弹系统窗口）
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// ---------- 1. 自建独立 git 测试仓库 ----------
function sh(cmd, args, cwd) {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', windowsHide: true });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} 失败: ${(r.stderr || r.stdout || '').slice(0, 200)}`);
}
function write(p, content) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, 'utf8');
}

const REPO = fs.mkdtempSync(path.join(os.tmpdir(), 'svnkit-win-test-'));
console.log('测试仓库:', REPO);
try {
  sh('git', ['init', '-q'], REPO);
  sh('git', ['config', 'user.email', 'test@test.com'], REPO);
  sh('git', ['config', 'user.name', 'test'], REPO);
  write(path.join(REPO, 'a.txt'), 'hello 中文测试');
  write(path.join(REPO, 'src', 'app.ts'), 'export const greeting: string = "你好，世界";\nconsole.log(greeting);');
  write(path.join(REPO, 'docs', '说明.md'), '# 测试文档\n这是中文内容。');
  write(path.join(REPO, 'docs', 'extra.md'), 'extra content');
  sh('git', ['add', '-A'], REPO);
  sh('git', ['commit', '-q', '-m', '初始提交：添加示例文件'], REPO);
  sh('git', ['branch', 'feature'], REPO);
  sh('git', ['tag', 'v1.0'], REPO);
  // 制造状态：一个修改 + 一个未跟踪
  write(path.join(REPO, 'a.txt'), 'hello 中文测试 已修改');
  write(path.join(REPO, 'new.txt'), 'untracked 未跟踪文件');
} catch (e) {
  console.error('测试仓库初始化失败:', e.message);
  process.exit(2);
}

// ---------- 2. 启动服务 ----------
process.env.SVNKIT_REPO_DIR = REPO;
const { startServer } = await import('../dist/server.js');
const handle = await startServer();
const base = handle.url;
console.log('服务已启动:', base);

// ---------- 3. 测试框架 ----------
const results = [];
/** 乱码检测：替换符 U+FFFD / 可见字符串里的控制字符 */
function scan(t) {
  if (!t) return [];
  const bad = [];
  if (t.includes('\uFFFD')) bad.push('U+FFFD替换符');
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(t)) bad.push('控制字符');
  return bad;
}
async function req(method, p, body) {
  const opt = { method, headers: {} };
  if (body) { opt.body = JSON.stringify(body); opt.headers['Content-Type'] = 'application/json'; }
  const r = await fetch(base + p, opt);
  const ct = r.headers.get('content-type') || '';
  const text = await r.text();
  return { status: r.status, ct, problems: ct.startsWith('image/') ? [] : scan(text) };
}
function record(name, method, p, body) {
  return req(method, p, body).then((res) => {
    const ok = res.status < 500 && res.problems.length === 0;
    results.push({ name, ok, status: res.status, problems: res.problems });
    if (!ok) console.log(`  ⬇ ${name} status=${res.status} problems=${JSON.stringify(res.problems)}`);
  }, (e) => { results.push({ name, ok: false, status: 'ERR', problems: [e.message] }); console.log(`  ⬇ ${name} 请求异常 ${e.message}`); });
}
const enc = (x) => encodeURIComponent(x);
const REPOBS = REPO.replace(/\\/g, '\\');

// ---------- 读取/信息 ----------
await record('info', 'GET', '/api/info');
await record('config GET', 'GET', '/api/config');
await record('env-check', 'GET', '/api/env-check');
await record('net-check', 'GET', '/api/net-check');
await record('status', 'GET', '/api/status');
await record('new-files', 'GET', '/api/new-files');
await record('filtered-tree', 'GET', '/api/filtered-tree?dir=');
await record('fs 根', 'GET', '/api/fs?dir=');
await record('fs src', 'GET', '/api/fs?dir=' + enc('src'));
await record('cat a.txt', 'GET', '/api/cat?path=' + enc('a.txt'));
await record('cat 中文文件', 'GET', '/api/cat?path=' + enc('docs/说明.md'));
await record('cat src/app.ts', 'GET', '/api/cat?path=' + enc('src/app.ts'));
await record('search add', 'GET', '/api/search?query=' + enc('add') + '&dir=');
await record('search 中文', 'GET', '/api/search?query=' + enc('中文') + '&dir=');
await record('file-mtime', 'GET', '/api/file-mtime?path=' + enc('src/app.ts'));
await record('file-versions', 'GET', '/api/file-versions?path=' + enc('src/app.ts'));
await record('ls src', 'GET', '/api/ls?path=' + enc('src'));
await record('show src/app.ts', 'GET', '/api/show?path=' + enc('src/app.ts'));
await record('log src/app.ts', 'GET', '/api/log?path=' + enc('src/app.ts'));
await record('diff a.txt(已修改)', 'GET', '/api/diff?path=' + enc('a.txt'));
await record('blame src/app.ts', 'GET', '/api/blame?path=' + enc('src/app.ts'));
await record('branches', 'GET', '/api/branches');
await record('tags', 'GET', '/api/tags');
await record('git-info', 'GET', '/api/git-info');
await record('git-unpushed-count', 'GET', '/api/git-unpushed-count');
await record('git-unpushed', 'GET', '/api/git-unpushed');
await record('stash 列表', 'GET', '/api/stash');
await record('remotes', 'GET', '/api/remotes');
await record('conflicts', 'GET', '/api/conflicts');
await record('preflight', 'GET', '/api/preflight');
await record('ignore GET', 'GET', '/api/ignore?path=' + enc('src/app.ts'));
await record('history', 'GET', '/api/history');
await record('apps-for ts', 'GET', '/api/apps-for?ext=ts');
await record('apps-for pdf', 'GET', '/api/apps-for?ext=pdf');
await record('icon notepad.exe', 'GET', '/api/icon?k=' + enc('C:\\WINDOWS\\system32\\notepad.exe'));

// ---------- 写入（仅在临时仓库上） ----------
await record('add new.txt', 'POST', '/api/add', { paths: ['new.txt'] });
await record('ignore new.txt', 'POST', '/api/ignore', { path: 'new.txt', pattern: '*.test' });
await record('unignore new.txt', 'POST', '/api/unignore', { path: 'new.txt' });
await record('ignore-remove new.txt', 'POST', '/api/ignore-remove', { path: 'new.txt', pattern: '*.test' });
await record('branch create', 'POST', '/api/branch', { action: 'create', name: 'win-test-branch' });
await record('branch switch feature', 'POST', '/api/branch', { action: 'switch', name: 'feature' });
await record('branch switch master', 'POST', '/api/branch', { action: 'switch', name: 'master' });
await record('switch-check feature', 'GET', '/api/switch-check?branch=' + enc('feature'));
await record('tag create v2.0', 'POST', '/api/tag', { action: 'create', name: 'v2.0' });
await record('commit a.txt', 'POST', '/api/commit', { paths: ['a.txt'], message: '提交修改' });
await record('mkdir', 'POST', '/api/mkdir', { path: REPOBS + '\\subdir' });
await record('rename extra.md', 'POST', '/api/rename', { from: REPOBS + '\\docs\\extra.md', to: REPOBS + '\\docs\\extra2.md' });
await record('text-diff', 'POST', '/api/text-diff', { left: 'a\nb\n', right: 'a\nb\nc\n' });
await record('git-auth GET', 'GET', '/api/git-auth');
await record('open-with(不存在→404)', 'POST', '/api/open-with', { path: 'no-such.txt', exec: '' });
await record('open-with(越界→400)', 'POST', '/api/open-with', { path: '../evil.txt', exec: '' });

// ---------- 静态文件 ----------
await record('GET /', 'GET', '/');
await record('GET app.js', 'GET', '/app.js');
await record('GET style.css', 'GET', '/style.css');

// ---------- 汇总与清理 ----------
await handle.close();
fs.rmSync(REPO, { recursive: true, force: true });

const pass = results.filter((r) => r.ok).length;
const fail = results.filter((r) => !r.ok).length;
console.log(`\n========== 汇总 ==========`);
console.log(`通过 ${pass} / ${results.length}，失败 ${fail}`);
for (const r of results.filter((r) => !r.ok)) console.log(`[${r.name}] status=${r.status} problems=${JSON.stringify(r.problems)}`);
process.exit(fail === 0 ? 0 : 1);
