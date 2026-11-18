/** 远程检查缓存的竞态测试：拉取/更新与 preflight 撞车时，界面必须马上同步（不能挂旧值 60s）。
 *
 *  背景（用户实报）：点「拉取」后通知显示已更新，顶栏横条和侧栏 ⬇55 却还挂着，过一阵才消失。
 *  原因：失效缓存只清结果，挡不住**已经在跑**的探测——它算完会无条件写回，用更新前的 refs
 *  把刚清掉的缓存重新撑满 60s。
 *
 *  本测试用"命令计数 + 人为延迟"把竞态固定成确定时序：
 *   1) 探测进行中调用 invalidatePreflight（= 拉取完成）
 *   2) 这次探测必须丢弃结果并重算（fetch 跑两次），不能把旧值交回去
 */
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { run } from '../dist/vcs/exec.js';
import { detectRepo } from '../dist/vcs/detect.js';
import { GitVcs } from '../dist/vcs/git.js';
import { SvnVcs } from '../dist/vcs/svn.js';

const TEST_BASE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'svngit-test');
const GIT_REMOTE = path.join(TEST_BASE, 'race-remote.git');
const GIT_SEED = path.join(TEST_BASE, 'race-seed');
const GIT_WORK = path.join(TEST_BASE, 'race-work');
const SVN_REPO = path.join(TEST_BASE, 'race-svn-repo');
const SVN_WC = path.join(TEST_BASE, 'race-svn-wc');
const SVN_WC2 = path.join(TEST_BASE, 'race-svn-wc2');

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

/** 让 await 睡 ms 毫秒（构造"探测进行中"的窗口） */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- 构造 git 场景：工作副本落后远程 2 个提交 ----------
console.log('== 构造工程 ==');
console.log('   git 仓库 + 裸远程…');
for (const d of [GIT_REMOTE, GIT_SEED, GIT_WORK]) fs.rmSync(d, { recursive: true, force: true });
await run('git', ['init', '-q', '--bare', GIT_REMOTE]);
await run('git', ['init', '-q', GIT_SEED]);
await run('git', ['config', 'user.email', 'test@svngit.local'], { cwd: GIT_SEED });
await run('git', ['config', 'user.name', 'svngit-test'], { cwd: GIT_SEED });
fs.writeFileSync(path.join(GIT_SEED, 'a.txt'), 'v1\n');
await run('git', ['add', 'a.txt'], { cwd: GIT_SEED });
await run('git', ['commit', '-qm', 'c1'], { cwd: GIT_SEED });
await run('git', ['push', '-q', GIT_REMOTE, 'HEAD:main'], { cwd: GIT_SEED });
await run('git', ['clone', '-q', '-b', 'main', GIT_REMOTE, GIT_WORK]);
await run('git', ['config', 'user.email', 'test@svngit.local'], { cwd: GIT_WORK });
await run('git', ['config', 'user.name', 'svngit-test'], { cwd: GIT_WORK });
// 远程再走两个提交（克隆后再推，工作副本就落后 2 个）
for (const n of [2, 3]) {
  fs.writeFileSync(path.join(GIT_SEED, 'a.txt'), `v${n}\n`);
  await run('git', ['commit', '-qam', `c${n}`], { cwd: GIT_SEED });
  await run('git', ['push', '-q', GIT_REMOTE, 'HEAD:main'], { cwd: GIT_SEED });
}

console.log('   svn 仓库 + 两个工作副本…');
for (const d of [SVN_REPO, SVN_WC, SVN_WC2]) fs.rmSync(d, { recursive: true, force: true });
await run('svnadmin', ['create', SVN_REPO]);
const svnUrl = pathToFileURL(SVN_REPO).href;
await run('svn', ['checkout', '-q', svnUrl, SVN_WC]);
fs.writeFileSync(path.join(SVN_WC, 'b.txt'), 'v1\n');
await run('svn', ['add', '-q', 'b.txt'], { cwd: SVN_WC });
await run('svn', ['commit', '-qm', 'c1'], { cwd: SVN_WC });
await run('svn', ['checkout', '-q', svnUrl, SVN_WC2]);
// 第二个副本提交：第一个副本就落后 1 个提交
fs.writeFileSync(path.join(SVN_WC2, 'b.txt'), 'v2\n');
await run('svn', ['commit', '-qm', 'c2'], { cwd: SVN_WC2 });
console.log('   完成');

// ---------- git：探测进行中被失效 → 丢弃旧结果、重算 ----------
console.log('== git preflight 竞态 ==');
{
  const vcs = new GitVcs(detectRepo(GIT_WORK));
  // 让 fetch 慢下来，制造"探测进行中"的窗口（真实环境里 fetch 就是 5s 量级）
  const origExec = vcs.exec.bind(vcs);
  let fetchCount = 0;
  vcs.exec = async (args, opts) => {
    if (args[0] === 'fetch') {
      fetchCount += 1;
      await sleep(300);
    }
    return origExec(args, opts);
  };

  vcs.invalidatePreflight();
  fetchCount = 0;
  const first = vcs.preflight();
  await sleep(50); // 此刻 preflight 已在 fetch 中
  vcs.invalidatePreflight(); // 模拟拉取完成时的缓存失效
  const r = await first;

  check('探测被失效后重算（fetch 至少两次）', fetchCount >= 2, `fetch=${fetchCount}`);
  check('返回的是重算后的真实 behind（远程领先 2 个提交）', r.behind === 2, `behind=${r.behind}`);
  // 重算那一次写的缓存必须是新值：紧接着的一次 preflight 命中缓存，值仍是 2
  const again = await vcs.preflight();
  check('缓存里没有残留旧结果（再查仍为 2）', again.behind === 2, `behind=${again.behind}`);

  // pull 前后都要失效：pull 内含 fetch，进行中发起的探测同样可能算旧值
  const epochBefore = vcs.remoteEpoch;
  await vcs.pull();
  check('pull 开始与结束各失效一次（代次 +2）', vcs.remoteEpoch === epochBefore + 2, `+${vcs.remoteEpoch - epochBefore}`);
  check('pull 结束后缓存已清空', vcs.remoteCache === null);
}

// ---------- git：拉取期间后台检查不发 fetch / 并发检查合并 / 超时 tmp_pack 清理 ----------
//  背景（用户实报）：拉取时后台远程检查也在 fetch 同一批对象，抢带宽；15s 超时被杀后
//  .git/objects/pack 里攒了 19 个 tmp_pack。这里把三个行为钉死。
console.log('== git 后台检查与拉取互斥 ==');
{
  const vcs = new GitVcs(detectRepo(GIT_WORK));
  const origExec = vcs.exec.bind(vcs);
  let fetchCount = 0;
  vcs.exec = async (args, opts) => {
    if (args[0] === 'fetch') {
      fetchCount += 1;
      await sleep(300); // 制造"检查进行中"的窗口（真实环境 fetch 是秒级）
    }
    return origExec(args, opts);
  };

  // 1) 拉取进行中：后台检查必须跳过 fetch，只用本地 refs 算
  const origRunPull = vcs.runPull.bind(vcs);
  vcs.runPull = async (signal) => {
    await sleep(500); // 把 pull 固定在"进行中"，好在这个窗口里发起检查
    return origRunPull(signal);
  };
  vcs.invalidatePreflight();
  fetchCount = 0;
  const pullP = vcs.pull();
  await sleep(50);
  const during = await vcs.preflight();
  check('拉取进行中：后台检查不发起 fetch', fetchCount === 0, `fetch=${fetchCount}`);
  check('拉取进行中：仍能用本地 refs 算出 behind', during.behind === 0, `behind=${during.behind}`);
  await pullP;
  vcs.runPull = origRunPull;

  // 2) 两个入口同时请求：合并成一次 fetch（原先会各起一条）
  vcs.invalidatePreflight();
  fetchCount = 0;
  await Promise.all([vcs.preflight(), vcs.preflight()]);
  check('并发远程检查合并为一次 fetch', fetchCount === 1, `fetch=${fetchCount}`);

  // 3) fetch 超时被杀：清掉本次新产生的 tmp_pack，不动已有残骸
  const packDir = path.join(GIT_WORK, '.git', 'objects', 'pack');
  const oldTmp = path.join(packDir, 'tmp_pack_old_garbage');
  fs.writeFileSync(oldTmp, 'old');
  let fakeTmp = '';
  vcs.exec = async (args) => {
    if (args[0] === 'fetch') {
      fakeTmp = path.join(packDir, `tmp_pack_test_${Date.now()}`);
      fs.writeFileSync(fakeTmp, 'partial');
      return { code: -1, stdout: '', stderr: 'timed out', timedOut: true };
    }
    return { code: 0, stdout: '', stderr: '' };
  };
  await vcs.backgroundFetch();
  check('fetch 超时后清掉本次 tmp_pack', fakeTmp !== '' && !fs.existsSync(fakeTmp));
  check('不误删已有的 tmp_pack 残骸', fs.existsSync(oldTmp));
  fs.rmSync(oldTmp, { force: true });
}

// ---------- svn：同一竞态 ----------
console.log('== svn preflight 竞态 ==');
{
  const vcs = new SvnVcs(detectRepo(SVN_WC), null);
  const origExec = vcs.exec.bind(vcs);
  let statusCount = 0;
  vcs.exec = async (args, opts) => {
    if (args[0] === 'status' && args[1] === '-u') {
      statusCount += 1;
      await sleep(300);
    }
    return origExec(args, opts);
  };

  vcs.invalidatePreflight();
  statusCount = 0;
  const first = vcs.preflight();
  await sleep(50);
  vcs.invalidatePreflight(); // 模拟更新完成时的缓存失效
  const r = await first;

  check('探测被失效后重算（status -u 至少两次）', statusCount >= 2, `status=${statusCount}`);
  check('返回的是重算后的真实 behind（服务器领先 1 个提交）', r.behind === 1, `behind=${r.behind}`);
  const again = await vcs.preflight();
  check('缓存里没有残留旧结果（再查仍为 1）', again.behind === 1, `behind=${again.behind}`);
}

// ---------- HTTP 层：拉取后两个接口都必须立刻给新值 ----------
// 顶栏横条读 /api/preflight（会话单例实例的缓存），侧栏 ⬇ 读 /api/remote-probe（模块级缓存）——
// 两边各有一份缓存，任一边没失效都会让界面挂旧数字。这里走真实服务验证"拉完立刻归零"。
console.log('== HTTP：拉取后立即重查 ==');
{
  // 远程再走一个提交，让工作副本重新落后（上面单测里的 pull 已把工作副本同步了）
  fs.writeFileSync(path.join(GIT_SEED, 'a.txt'), 'v4\n');
  await run('git', ['commit', '-qam', 'c4'], { cwd: GIT_SEED });
  await run('git', ['push', '-q', GIT_REMOTE, 'HEAD:main'], { cwd: GIT_SEED });

  process.env.SVNGIT_REPO_DIR = GIT_WORK;
  process.env.SVNGIT_NO_PORT_TAKEOVER = '1'; // 别接管用户正在用的 23456
  const { startServer } = await import('../dist/server/index.js');
  const handle = await startServer();
  const base = `http://127.0.0.1:${handle.port}`;
  const getJson = async (p) => {
    const r = await fetch(base + p);
    return { code: r.status, body: await r.json().catch(() => ({})) };
  };
  const probePath = `/api/remote-probe?path=${encodeURIComponent(GIT_WORK)}`;
  try {
    const before = await getJson('/api/preflight');
    check('拉取前 preflight：远程领先 1', before.body.behind === 1, `behind=${before.body.behind}`);
    const probeBefore = await getJson(probePath);
    check('拉取前 remote-probe：远程领先 1', probeBefore.body.behind === 1, `behind=${probeBefore.body.behind}`);

    const pull = await fetch(base + '/api/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    }).then((r) => r.json());
    check('拉取成功', pull.ok === true, pull.message);

    // 两份缓存都已失效：立即重查必须是 0，不能等 60s 过期
    const after = await getJson('/api/preflight');
    check('拉取后立即 preflight：behind=0（横条能马上消失）', after.body.behind === 0, `behind=${after.body.behind}`);
    const probeAfter = await getJson(probePath);
    check('拉取后立即 remote-probe：behind=0（侧栏 ⬇ 能马上消失）', probeAfter.body.behind === 0, `behind=${probeAfter.body.behind}`);
  } finally {
    await handle.close();
  }
}

console.log('');
console.log(`结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
