/** 分支远程同步测试：branchList 的 ahead/behind/upstream、fetchRemote、branchUpdate
 *  用本地 bare 仓库模拟远端，不依赖网络。 */
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { run } from '../dist/vcs/exec.js';
import { detectRepo } from '../dist/vcs/detect.js';
import { GitVcs } from '../dist/vcs/git.js';

const BASE = fs.mkdtempSync(path.join(os.tmpdir(), 'svngit-branch-track-'));
const REMOTE = path.join(BASE, 'remote.git');
const WORK_A = path.join(BASE, 'work-a');
const WORK_B = path.join(BASE, 'work-b');

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

async function git(args, cwd) {
  const r = await run('git', args, { cwd });
  if (r.code !== 0) throw new Error(`git ${args.join(' ')} 失败: ${r.stderr || r.stdout}`);
  return r;
}

try {
  console.log('== 分支远程同步（fetch / ahead-behind / 快进更新） ==');

  // bare 远端固定用 main，避免不同 git 版本的默认分支名差异（本机 2.20 默认 master）
  await git(['init', '--bare', '-q', REMOTE], BASE);
  await git(['-C', REMOTE, 'symbolic-ref', 'HEAD', 'refs/heads/main'], BASE);
  await git(['clone', '-q', REMOTE, WORK_A], BASE);
  // clone 空仓库时本地未出生分支名受 init.defaultBranch 影响（本机 git 2.20 默认 master），
  // 统一切成 main，保证后面 push -u origin main 有效
  await git(['symbolic-ref', 'HEAD', 'refs/heads/main'], WORK_A);
  for (const dir of [WORK_A]) {
    await git(['config', 'user.name', 'Branch Track Test'], dir);
    await git(['config', 'user.email', 'branch-track@example.com'], dir);
  }
  fs.writeFileSync(path.join(WORK_A, 'a.txt'), 'v1\n');
  await git(['add', 'a.txt'], WORK_A);
  await git(['commit', '-qm', 'init'], WORK_A);
  await git(['push', '-q', '-u', 'origin', 'main'], WORK_A);

  // 远端已有 main 后再 clone：自动建立 origin/main 跟踪关系
  await git(['clone', '-q', REMOTE, WORK_B], BASE);
  await git(['config', 'user.name', 'Branch Track Test'], WORK_B);
  await git(['config', 'user.email', 'branch-track@example.com'], WORK_B);

  const vcs = new GitVcs(detectRepo(WORK_B));

  // 1) 同步状态 = ✓（ahead/behind 都是 0，upstream 存在）
  let bl = await vcs.branchList();
  let mainB = bl.branches.find((b) => !b.remote && b.name === 'main');
  check('同步时 ahead/behind 为 0 且带 upstream', mainB?.ahead === 0 && mainB?.behind === 0 && mainB?.upstream === 'origin/main', JSON.stringify(mainB));

  // 2) 远端前进 1：fetch 前 branchList 还是旧的（克隆时的快照），fetch 后看到 behind=1
  fs.writeFileSync(path.join(WORK_A, 'a.txt'), 'v2\n');
  await git(['commit', '-qam', 'remote update'], WORK_A);
  await git(['push', '-q', 'origin', 'main'], WORK_A);
  bl = await vcs.branchList();
  mainB = bl.branches.find((b) => !b.remote && b.name === 'main');
  check('fetch 前仍是旧快照（behind=0）', mainB?.behind === 0, JSON.stringify(mainB));

  const fetched = await vcs.fetchRemote();
  check('获取远程成功', fetched.ok === true, fetched.message);
  bl = await vcs.branchList();
  mainB = bl.branches.find((b) => !b.remote && b.name === 'main');
  check('获取远程后显示 behind=1', mainB?.behind === 1 && mainB?.ahead === 0, JSON.stringify(mainB));

  // 3) 当前分支快进更新：工作区文件应变成远端内容
  const upd = await vcs.branchUpdate('main', 0, 1);
  check('当前分支快进更新成功', upd.ok === true, upd.message);
  // 按行尾无关比较：Windows 全局 core.autocrlf=true 时检出会把 LF 写成 CRLF（git 的正常行为），
  // 直接比 'v2\n' 只会在 Linux 上成立
  const eolInsensitive = (s) => s.replace(/\r\n/g, '\n');
  check('工作区已更新到远端内容', eolInsensitive(fs.readFileSync(path.join(WORK_B, 'a.txt'), 'utf8')) === 'v2\n');
  bl = await vcs.branchList();
  mainB = bl.branches.find((b) => !b.remote && b.name === 'main');
  check('更新后 ahead/behind 归零', mainB?.ahead === 0 && mainB?.behind === 0, JSON.stringify(mainB));

  // 4) 非当前分支快进更新：人在 main，更新 feature（不切换）
  await git(['checkout', '-q', '-b', 'feature'], WORK_B);
  await git(['push', '-q', '-u', 'origin', 'feature'], WORK_B);
  await git(['checkout', '-q', 'main'], WORK_B);

  await git(['fetch', '-q', 'origin'], WORK_A);
  await git(['checkout', '-q', '-b', 'feature', 'origin/feature'], WORK_A);
  fs.writeFileSync(path.join(WORK_A, 'feature.txt'), 'feature v1\n');
  await git(['add', 'feature.txt'], WORK_A);
  await git(['commit', '-qm', 'feature update'], WORK_A);
  await git(['push', '-q', 'origin', 'feature'], WORK_A);
  await git(['checkout', '-q', 'main'], WORK_A);

  await vcs.fetchRemote();
  bl = await vcs.branchList();
  const featB = bl.branches.find((b) => !b.remote && b.name === 'feature');
  check('feature 显示 behind=1', featB?.behind === 1 && featB?.ahead === 0, JSON.stringify(featB));

  const updOther = await vcs.branchUpdate('feature', 0, 1);
  check('非当前分支快进更新成功', updOther.ok === true, updOther.message);
  const featHead = (await git(['rev-parse', 'feature'], WORK_B)).stdout.trim();
  const featRemote = (await git(['rev-parse', 'origin/feature'], WORK_B)).stdout.trim();
  check('本地 feature 已与 origin/feature 一致（且未切换分支）', featHead === featRemote);
  const curBranch = (await git(['rev-parse', '--abbrev-ref', 'HEAD'], WORK_B)).stdout.trim();
  check('更新非当前分支后仍停在 main', curBranch === 'main', curBranch);

  // 5) 分叉：本地 + 远端各有新提交 → branchUpdate 拒绝，本地 HEAD 不动
  fs.writeFileSync(path.join(WORK_B, 'local.txt'), 'local only\n');
  await git(['add', 'local.txt'], WORK_B);
  await git(['commit', '-qm', 'local only'], WORK_B);
  const headBefore = (await git(['rev-parse', 'HEAD'], WORK_B)).stdout.trim();

  fs.writeFileSync(path.join(WORK_A, 'a.txt'), 'v3\n');
  await git(['commit', '-qam', 'remote again'], WORK_A);
  await git(['push', '-q', 'origin', 'main'], WORK_A);
  await vcs.fetchRemote();
  bl = await vcs.branchList();
  mainB = bl.branches.find((b) => !b.remote && b.name === 'main');
  check('分叉时 ahead=1 behind=1', mainB?.ahead === 1 && mainB?.behind === 1, JSON.stringify(mainB));

  const divergedUpd = await vcs.branchUpdate('main', 1, 1);
  check('分叉时拒绝快进更新', divergedUpd.ok === false, divergedUpd.message);
  const headAfter = (await git(['rev-parse', 'HEAD'], WORK_B)).stdout.trim();
  check('分叉拒绝后本地 HEAD 未移动', headBefore === headAfter);

  console.log(`\n结果：${pass} 通过，${fail} 失败`);
} finally {
  fs.rmSync(BASE, { recursive: true, force: true });
}
if (fail > 0) process.exit(1);
