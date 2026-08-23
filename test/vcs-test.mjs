/** VCS 层冒烟测试：每次运行前重置仓库并构造确定状态，保证可重复执行 */
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { run } from '../dist/vcs/exec.js';
import { detectRepo } from '../dist/vcs/detect.js';
import { GitVcs } from '../dist/vcs/git.js';
import { SvnVcs } from '../dist/vcs/svn.js';

// 测试仓库位置：相对脚本推导（项目根/svnkit-test），clone 到任何路径都能跑
const TEST_BASE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'svnkit-test');
const GIT_DIR = path.join(TEST_BASE, 'git-repo');
const SVN_DIR = path.join(TEST_BASE, 'svn-wc');

// ---------- 重置并构造确定状态 ----------
console.log('== 构造测试状态 ==');
// git 测试仓库自举：CI clone 没有 svnkit-test/git-repo（fixture 不入库），首次运行自建固定提交历史的仓库。
// 本地已存在（手工保存的 b4f4eef 历史）则沿用原逻辑。
if (!fs.existsSync(path.join(GIT_DIR, '.git'))) {
  console.log('  git-repo 不存在,自建测试仓库…');
  fs.mkdirSync(GIT_DIR, { recursive: true });
  await run('git', ['init', '-q'], { cwd: GIT_DIR }); // 分支名无关断言(porcelain 相对路径); -b 需 git>=2.28 故不用
  await run('git', ['config', 'user.email', 'test@svnkit.local'], { cwd: GIT_DIR });
  await run('git', ['config', 'user.name', 'svnkit-test'], { cwd: GIT_DIR });
  fs.writeFileSync(`${GIT_DIR}/readme.md`, 'hello v0\n');
  fs.mkdirSync(`${GIT_DIR}/src`, { recursive: true });
  fs.writeFileSync(`${GIT_DIR}/src/app.js`, 'console.log(1)\n');
  await run('git', ['add', 'readme.md', 'src'], { cwd: GIT_DIR });
  await run('git', ['commit', '-qm', 'initial'], { cwd: GIT_DIR });
  fs.writeFileSync(`${GIT_DIR}/del.txt`, 'del\n');
  await run('git', ['add', 'del.txt'], { cwd: GIT_DIR });
  await run('git', ['commit', '-qm', 'add del.txt'], { cwd: GIT_DIR });
}
// git 历史固定：2f872e3 initial -> b4f4eef add del.txt -> 测试提交。硬重置到 b4f4eef。
await run('git', ['reset', '-q', '--hard', 'b4f4eef2ffcf01bbb063c7a7a25d745d4818f39d'], { cwd: GIT_DIR });
// 自建分支（CI 时 hash 不同,reset 到自建 HEAD 后再由上面的 b4f4eef fallback? 简单: 自建时记录 HEAD
// 但 b4f4eef 断言依赖固定提交——CI 下 hash 不同会导致 reset 失败,故自建后用当前 HEAD,保留固定 hash 检查仅在本地。
// 修正: 若 reset b4f4eef 失败（自建仓库 hash 不同）→ 重置到当前 HEAD
const b4 = await run('git', ['cat-file', '-t', 'b4f4eef2ffcf01bbb063c7a7a25d745d4818f39d'], { cwd: GIT_DIR });
if (b4.code !== 0) {
  await run('git', ['reset', '-q', '--hard', 'HEAD'], { cwd: GIT_DIR });
  console.log('  （CI 自建仓库,固定 hash b4f4eef 不存在,改用当前 HEAD 作为基线）');
}
fs.writeFileSync(`${GIT_DIR}/readme.md`, `hello v1\nhello v2\nTEST-MARKER-${Date.now()}\n`); // -> M（内容与 HEAD 不同）
fs.writeFileSync(`${GIT_DIR}/tmp-test.txt`, 'x'); // -> ??

// SVN：重建仓库 + 工作副本（每次运行完全干净）
fs.rmSync(path.join(TEST_BASE, 'svn-repo'), { recursive: true, force: true });
fs.rmSync(SVN_DIR, { recursive: true, force: true });
await run('svnadmin', ['create', path.join(TEST_BASE, 'svn-repo')]);
await run('svn', ['checkout', '-q', `file://${path.join(TEST_BASE, 'svn-repo')}`, SVN_DIR]);
fs.writeFileSync(`${SVN_DIR}/readme.md`, 'project doc');
fs.mkdirSync(`${SVN_DIR}/src`, { recursive: true });
fs.writeFileSync(`${SVN_DIR}/src/main.c`, 'main() {}');
await run('svn', ['add', '-q', 'readme.md', 'src'], { cwd: SVN_DIR });
await run('svn', ['commit', '-qm', 'initial commit'], { cwd: SVN_DIR });
fs.writeFileSync(`${SVN_DIR}/readme.md`, `project doc\nTEST-MARKER-${Date.now()}\n`); // -> M
fs.writeFileSync(`${SVN_DIR}/tmp-svn.txt`, 'x'); // -> ??
fs.rmSync(`${SVN_DIR}/src/main.c`); // -> !（缺失）
console.log('   完成');

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

console.log('== 仓库识别 ==');
{
  const r = detectRepo(GIT_DIR);
  check('git 识别', r?.type === 'git' && r.root === GIT_DIR);
  const s = detectRepo(SVN_DIR);
  check('svn 识别', s?.type === 'svn' && s.root === SVN_DIR);
  check('非仓库返回 null', detectRepo('/tmp') === null);
}

console.log('== Git status 解析 ==');
{
  const vcs = new GitVcs(detectRepo(GIT_DIR));
  const st = await vcs.status();
  const names = st.map((s) => `${s.code}:${s.path}`);
  console.log('   ' + names.join('  '));
  check('M readme.md', st.some((s) => s.code === 'M' && s.path === 'readme.md'));
  check('? tmp-test.txt', st.some((s) => s.code === '?' && s.path === 'tmp-test.txt'));
}

console.log('== Git log 解析 ==');
{
  const vcs = new GitVcs(detectRepo(GIT_DIR));
  const logs = await vcs.log(5);
  check('log 条数 >= 2', logs.length >= 2);
  check('log 字段', logs[0]?.rev && logs[0]?.author && logs[0]?.msg);
  const c0 = logs[0]?.changed?.[0];
  check('changed 解析', c0 && c0.action && c0.path);
  console.log(`   最新: ${logs[0]?.rev} | ${logs[0]?.author} | ${logs[0]?.msg} | changed=${JSON.stringify(logs[0]?.changed)}`);
}

console.log('== Git diff / ls ==');
{
  const vcs = new GitVcs(detectRepo(GIT_DIR));
  const d = await vcs.diff();
  check('diff 输出非空', d.ok && d.output.length > 0);
  const ls = await vcs.ls('');
  check('ls 根目录', ls.some((i) => i.name === 'readme.md'));
  const lsSrc = await vcs.ls('src');
  check('ls src 目录', lsSrc.some((i) => i.name === 'app.js' && !i.isDir));
}

console.log('== SVN status 解析 ==');
{
  const vcs = new SvnVcs(detectRepo(SVN_DIR), null);
  const st = await vcs.status();
  const names = st.map((s) => `${s.code}:${s.path}`);
  console.log('   ' + names.join('  '));
  check('M readme.md', st.some((s) => s.code === 'M' && s.path === 'readme.md'));
  check('? tmp-svn.txt', st.some((s) => s.code === '?' && s.path === 'tmp-svn.txt'));
  check('! src/main.c', st.some((s) => s.code === '!' && s.path === 'src/main.c'));
}

console.log('== SVN log 解析 ==');
{
  const vcs = new SvnVcs(detectRepo(SVN_DIR), null);
  const logs = await vcs.log(5);
  check('log 条数 >= 1', logs.length >= 1);
  check('log 字段', logs[0]?.rev && logs[0]?.author && logs[0]?.msg);
  console.log(`   r${logs[0]?.rev} | ${logs[0]?.author} | ${logs[0]?.msg} | changed=${JSON.stringify(logs[0]?.changed)}`);
}

console.log('== SVN info / diff / ls ==');
{
  const vcs = new SvnVcs(detectRepo(SVN_DIR), null);
  const info = await vcs.info();
  check('info url', info.url?.startsWith('file://'));
  const d = await vcs.diff();
  check('diff 输出非空', d.ok && d.output.length > 0);
  const ls = await vcs.ls(info.url + '/');
  check('ls 根', ls.some((i) => i.name === 'readme.md'));
  check('ls 目录标记', ls.some((i) => i.name === 'src' && i.isDir));
}

console.log('== Git 操作 ==');
{
  const vcs = new GitVcs(detectRepo(GIT_DIR));
  const addRes = await vcs.add(['tmp-test.txt']);
  check('git add', addRes.ok);
  const commitRes = await vcs.commit([], 'test commit from svnkit');
  check('git commit', commitRes.ok, commitRes.message);
  const st = await vcs.status();
  check('提交后 tmp-test 不再是 ?', !st.some((s) => s.path === 'tmp-test.txt'));
  const revertRes = await vcs.revert(['readme.md']);
  check('git revert', revertRes.ok);
  const st2 = await vcs.status();
  check('revert 后 readme 不再 M', !st2.some((s) => s.path === 'readme.md'));
  const rmRes = await vcs.remove(['tmp-test.txt']);
  check('git rm', rmRes.ok);
  await vcs.commit([], 'cleanup');
  const st3 = await vcs.status();
  check('删除后 tmp-test 消失', !st3.some((s) => s.path === 'tmp-test.txt'));
}

console.log('== SVN 操作 ==');
{
  const vcs = new SvnVcs(detectRepo(SVN_DIR), null);
  const addRes = await vcs.add(['tmp-svn.txt']);
  check('svn add', addRes.ok);
  const commitRes = await vcs.commit([], 'test commit from svnkit');
  check('svn commit', commitRes.ok, commitRes.message);
  const st = await vcs.status();
  check('提交后 tmp-svn 不再是 ?', !st.some((s) => s.path === 'tmp-svn.txt'));
  const revertRes = await vcs.revert(['readme.md']);
  check('svn revert', revertRes.ok);
  const st2 = await vcs.status();
  check('revert 后 readme 不再 M', !st2.some((s) => s.path === 'readme.md'));
}

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
