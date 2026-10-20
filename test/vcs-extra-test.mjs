/** 版本管理扩展功能测试：分支/标签/Stash/合并/清理/Blame/忽略/锁定/创建仓库 */
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { run } from '../dist/vcs/exec.js';
import { detectRepo } from '../dist/vcs/detect.js';
import { GitVcs } from '../dist/vcs/git.js';
import { SvnVcs } from '../dist/vcs/svn.js';

// 测试仓库位置：相对脚本推导（项目根/svngit-test），clone 到任何路径都能跑
const TEST_BASE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'svngit-test');
const GIT_DIR = path.join(TEST_BASE, 'git-repo');
const SVN_DIR = path.join(TEST_BASE, 'svn-wc'); // 非标准布局（无 trunk，测试拒绝创建分支）
const SVN_STD_DIR = path.join(TEST_BASE, 'svn-std-wc'); // 标准布局（trunk/branches/tags，测试分支创建/切换）

// 标准布局 fixture 自建并**每次重建**（与 vcs-test 的 svn-wc 同口径）。
// 以前这份 fixture 靠手工准备、不入库，换台机器或清理过就没有了——SVN 段会在 `spawn svn` 上
// 以 ENOENT 崩掉（cwd 不存在，报错还长得像"svn 没装"），整条 npm test 链断在这儿。
// 注意 URL 必须走 pathToFileURL：`file://` 拼 Windows 路径（反斜杠）会被 svn 判成非法 URL
const SVN_STD_REPO = path.join(TEST_BASE, 'svn-std-repo');
fs.rmSync(SVN_STD_REPO, { recursive: true, force: true });
fs.rmSync(SVN_STD_DIR, { recursive: true, force: true });
const svnStdUrl = pathToFileURL(SVN_STD_REPO).href;
await run('svnadmin', ['create', SVN_STD_REPO]);
await run('svn', ['mkdir', '-q', `${svnStdUrl}/trunk`, `${svnStdUrl}/branches`, `${svnStdUrl}/tags`, '-m', 'init standard layout']);
await run('svn', ['checkout', '-q', `${svnStdUrl}/trunk`, SVN_STD_DIR]);
// trunk 里得有东西：后面要断言"新建的分支是从 trunk 复制来的，含 readme.md"
fs.writeFileSync(path.join(SVN_STD_DIR, 'readme.md'), 'project doc\n');
await run('svn', ['add', '-q', 'readme.md'], { cwd: SVN_STD_DIR });
await run('svn', ['commit', '-qm', 'initial commit'], { cwd: SVN_STD_DIR });

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

console.log('== Git 分支/标签/Stash ==');
{
  const vcs = new GitVcs(detectRepo(GIT_DIR));
  await run('git', ['checkout', '-q', 'master'], { cwd: GIT_DIR });
  const bl = await vcs.branchList();
  check('分支列表（master 当前，无星号）', bl.current === 'master' && bl.branches.some((b) => b.name === 'master'));

  // 历史详情弹窗靠 isRoot 给根提交选"前一版本"（空树）；根提交不能同时被当成合并提交
  const logs = await vcs.log(0);
  const root = logs[logs.length - 1];
  check('根提交带 isRoot 标记', root?.isRoot === true && !root?.isMerge);

  const cr = await vcs.branchCreate('test-feat');
  check('创建分支 test-feat', cr.ok);
  // 带基点创建（从主干 master 拉新分支）
  const cb = await vcs.branchCreate('base-feat', 'master');
  check('带基点创建分支（基于 master）', cb.ok && cb.message.includes('master'));
  await vcs.branchDelete('base-feat');
  const sw = await vcs.branchSwitch('test-feat');
  check('切换分支', sw.ok && (await vcs.branch()).includes('test-feat'));
  const sw2 = await vcs.branchSwitch('master');
  check('切回 master', sw2.ok);
  const mg = await vcs.merge('test-feat');
  check('合并 test-feat', mg.ok);
  const dl = await vcs.branchDelete('test-feat');
  check('删除分支', dl.ok);

  const tc = await vcs.tagCreate('v-test');
  check('创建标签 v-test', tc.ok);
  const tl = await vcs.tagList();
  check('标签列表', tl.includes('v-test'));
  const td = await vcs.tagDelete('v-test');
  check('删除标签', td.ok);

  fs.writeFileSync(`${GIT_DIR}/stash-test.txt`, 'stash me');
  const sp = await vcs.stashPush('unit test');
  check('stash push', sp.ok);
  const sl = await vcs.stashList();
  check('stash 列表', sl.length >= 1);
  const sPop = await vcs.stashPop(0);
  check('stash pop', sPop.ok);
  fs.rmSync(`${GIT_DIR}/stash-test.txt`, { force: true });
}

console.log('== Git 合并冲突 + 中止合并 ==');
{
  const vcs = new GitVcs(detectRepo(GIT_DIR));
  await run('git', ['checkout', '-q', 'master'], { cwd: GIT_DIR });
  const cb = await vcs.branchCreate('conflict-feat');
  check('创建冲突分支', cb.ok);
  await vcs.branchSwitch('conflict-feat');
  fs.writeFileSync(`${GIT_DIR}/readme.md`, 'hello v0\nconflict-by-feat\n');
  await vcs.add(['readme.md']);
  await vcs.commit([], 'feat conflict');
  await vcs.branchSwitch('master');
  fs.writeFileSync(`${GIT_DIR}/readme.md`, 'hello v0\nconflict-by-master\n');
  await vcs.add(['readme.md']);
  await vcs.commit([], 'master conflict');
  const mg = await vcs.merge('conflict-feat');
  check('同位置修改合并产生冲突', !mg.ok);
  const stC = await vcs.status();
  check('冲突文件为 C', stC.some((s) => s.path === 'readme.md' && s.code === 'C'));
  const ab = await vcs.mergeAbort();
  check('中止合并成功', ab.ok, ab.message);
  const mh = await run('git', ['rev-parse', '--verify', '--quiet', 'MERGE_HEAD'], { cwd: GIT_DIR });
  check('MERGE_HEAD 已清除', mh.code !== 0);
  const st2 = await vcs.status();
  check('中止后工作区干净', !st2.some((s) => s.path === 'readme.md'));
  const dl = await vcs.branchDelete('conflict-feat', true);
  check('删除冲突分支（-D）', dl.ok);
  // 清理：撤销 master 上的冲突构造提交，恢复测试前基线（后续测试不依赖 master 多余提交）
  const rs = await run('git', ['reset', '-q', '--hard', 'HEAD~1'], { cwd: GIT_DIR });
  check('清理构造提交', rs.code === 0);
  const st3 = await vcs.status();
  check('最终状态干净', st3.length === 0);
}

console.log('== Git Blame / 忽略 / 清理 ==');
{
  const vcs = new GitVcs(detectRepo(GIT_DIR));
  // 自包含构造：readme 固定写 3 行再 blame——历史版本 readme 可能只有 1 行（依赖 vcs-test 先跑的提交链会导致单独跑 vcs-extra 时失败）。
  // 未提交行 blame 输出 rev=40 个 0（解析后 '0000000'）、author='Not Committed Yet'，满足字段非空断言。
  fs.writeFileSync(`${GIT_DIR}/readme.md`, 'hello v1\nhello v2\nblame-test\n');
  const blame = await vcs.blame('readme.md');
  check('blame 解析', blame.length >= 3 && blame[0]?.rev && blame[0]?.author);
  await vcs.revert(['readme.md']); // 复原工作区到 HEAD 版（checkout HEAD --），避免残留改动影响后续块

  const ig = await vcs.ignoreAdd('*.unit-test');
  check('忽略规则写入 .gitignore', ig.ok && fs.existsSync(`${GIT_DIR}/.gitignore`));
  fs.rmSync(`${GIT_DIR}/.gitignore`, { force: true });

  fs.writeFileSync(`${GIT_DIR}/clean-me.txt`, 'x');
  const cl = await vcs.cleanList();
  check('clean 预览含 clean-me.txt', cl.some((f) => f.includes('clean-me.txt')));
  const cc = await vcs.clean();
  check('clean 执行', cc.ok && !fs.existsSync(`${GIT_DIR}/clean-me.txt`));
}

console.log('== Git 合并预检 mergeCheck（L1 文件级 + L2 提交级试算） ==');
{
  const vcs = new GitVcs(detectRepo(GIT_DIR));
  await run('git', ['checkout', '-q', 'master'], { cwd: GIT_DIR });
  const orig = (await run('git', ['rev-parse', 'HEAD'], { cwd: GIT_DIR })).stdout.trim();
  // setup：20 行文件（行距足够时 hunk 分离可自动合；同一行必冲突）
  const lines = Array.from({ length: 20 }, (_, i) => `line-${i + 1}`).join('\n') + '\n';
  fs.writeFileSync(`${GIT_DIR}/f-mc.txt`, lines);
  await run('git', ['add', 'f-mc.txt'], { cwd: GIT_DIR });
  await run('git', ['commit', '-qm', 'mergecheck: add f-mc.txt'], { cwd: GIT_DIR });
  const base1 = (await run('git', ['rev-parse', 'HEAD'], { cwd: GIT_DIR })).stdout.trim();
  // 分支 mc-far：改第 15 行（与 master 第 5 行改动不同区域 → 可自动合并）
  await run('git', ['checkout', '-qb', 'mc-far', base1], { cwd: GIT_DIR });
  fs.writeFileSync(`${GIT_DIR}/f-mc.txt`, lines.replace('line-15', 'far-15'));
  await run('git', ['commit', '-aqm', 'mergecheck: far change'], { cwd: GIT_DIR });
  // 分支 mc-near：改第 5 行（与 master 同区域 → 提交级必冲突）
  await run('git', ['checkout', '-qb', 'mc-near', base1], { cwd: GIT_DIR });
  fs.writeFileSync(`${GIT_DIR}/f-mc.txt`, lines.replace('line-5', 'near-5'));
  await run('git', ['commit', '-aqm', 'mergecheck: near change'], { cwd: GIT_DIR });
  // master：改第 5 行并提交（形成两边同区域已提交改动）
  await run('git', ['checkout', '-q', 'master'], { cwd: GIT_DIR });
  fs.writeFileSync(`${GIT_DIR}/f-mc.txt`, lines.replace('line-5', 'master-5'));
  await run('git', ['commit', '-aqm', 'mergecheck: master line5'], { cwd: GIT_DIR });
  // L2：不同区域 → 无提交级冲突
  const far = await vcs.mergeCheck('mc-far');
  check('提交级不同区域可自动合并', far.lineConflicts.length === 0 && far.conflicts.length === 0);
  // L2：同区域 → 提交级冲突预告（回答"提交后再合还是冲突"）
  const near = await vcs.mergeCheck('mc-near');
  check('提交级同区域冲突预告', near.lineConflicts.includes('f-mc.txt'));
  // L1：工作区脏改 f-mc.txt（与 mc-near 重叠 → 文件级必拒拦截）
  fs.writeFileSync(`${GIT_DIR}/f-mc.txt`, lines.replace('line-5', 'master-5').replace('line-6', 'dirty-6'));
  const dirty = await vcs.mergeCheck('mc-near');
  check('工作区重叠 → L1 文件级拦截', dirty.conflicts.includes('f-mc.txt') && dirty.changed > 0);
  // 清理：回到 setup 前状态 + 删除测试分支
  await run('git', ['reset', '-q', '--hard', orig], { cwd: GIT_DIR });
  await run('git', ['branch', '-D', 'mc-far', 'mc-near'], { cwd: GIT_DIR });
}

console.log('== SVN 标准布局（trunk/branches/tags）==');
{
  const vcs = new SvnVcs(detectRepo(SVN_STD_DIR), null);
  const rootUrl = (await vcs.info()).url?.replace(/\/trunk.*$/, '').replace(/\/branches\/.*$/, '').replace(/\/tags\/.*$/, '') ?? '';

  const bl = await vcs.branchList();
  check('分支列表返回', bl.current && Array.isArray(bl.branches));

  const bc = await vcs.branchCreate('test-branch');
  check('创建分支 test-branch', bc.ok);
  const bl2 = await vcs.branchList();
  check('分支列表含 test-branch', bl2.branches.some((b) => b.name === 'test-branch'));
  // 分支内容 = trunk 复制（创建时 trunk 里的 readme.md 应出现在分支中）
  const lst = await run('svn', ['list', `${rootUrl}/branches/test-branch/`], { cwd: SVN_STD_DIR });
  check('分支从 trunk 复制（含 readme.md）', lst.code === 0 && lst.stdout.includes('readme.md'));

  const sw = await vcs.branchSwitch('test-branch');
  check('切换分支 test-branch', sw.ok);
  const swBack = await vcs.branchSwitch('trunk');
  check('切回 trunk', swBack.ok);

  const tc = await vcs.tagCreate('rel-test');
  check('创建标签 rel-test', tc.ok);
  const tl = await vcs.tagList();
  check('标签列表含 rel-test', tl.includes('rel-test'));
  await vcs.tagDelete('rel-test');
  const tl2 = await vcs.tagList();
  check('删除标签', !tl2.includes('rel-test'));

  // 回到 trunk 并删除测试分支
  await run('svn', ['switch', '-q', rootUrl], { cwd: SVN_STD_DIR });
  await vcs.branchDelete('test-branch');
  const bl3 = await vcs.branchList();
  check('删除分支', !bl3.branches.some((b) => b.name === 'test-branch'));
}

console.log('== SVN 非标准布局（无 trunk）：创建分支拒绝 ==');
{
  const vcs = new SvnVcs(detectRepo(SVN_DIR), null);
  // 重置到仓库根（无 trunk 仓库；避免上次中断的残留分支干扰）
  const rootUrl = (await vcs.info()).url?.replace(/\/branches\/.*$/, '').replace(/\/tags\/.*$/, '') ?? '';
  await run('svn', ['switch', '-q', rootUrl], { cwd: SVN_DIR });

  const noT = await vcs.branchCreate('no-trunk-branch');
  check('无 trunk 仓库创建分支被拒绝', !noT.ok);
}

console.log('== SVN Blame / 锁定 / 忽略 / 清理 ==');
{
  const vcs = new SvnVcs(detectRepo(SVN_DIR), null);
  const blame = await vcs.blame('readme.md');
  check('blame 解析', blame.length >= 1 && blame[0]?.rev && blame[0]?.author);

  const lk = await vcs.lock('readme.md');
  check('锁定', lk.ok);
  const uk = await vcs.unlock('readme.md');
  check('解锁', uk.ok);

  const ig = await vcs.propSetIgnore('.', '*.unit-test');
  check('svn:ignore 设置', ig.ok);
  await run('svn', ['propdel', 'svn:ignore', '.'], { cwd: SVN_DIR });

  const cl = await vcs.cleanup();
  check('cleanup', cl.ok);
}

console.log('== SVN 合并预检 mergeCheck ==');
{
  const vcs = new SvnVcs(detectRepo(SVN_DIR), null);
  // 回到仓库根并保证干净（repos-root-url 兜底提取）
  const rootUrl = (await run('svn', ['info', '--show-item', 'repos-root-url'], { cwd: SVN_DIR })).stdout.trim();
  await run('svn', ['switch', '-q', rootUrl], { cwd: SVN_DIR });
  // 本地改动：未跟踪文件
  fs.writeFileSync(`${SVN_DIR}/merge-check-tmp.txt`, 'x');
  let mc = await vcs.mergeCheck('any');
  check('本地未跟踪改动计入 changed/untracked', mc.changed >= 1 && mc.untracked >= 1);
  fs.rmSync(`${SVN_DIR}/merge-check-tmp.txt`, { force: true });
  mc = await vcs.mergeCheck('any');
  check('工作区干净且同步 changed=0 无 outdated', mc.changed === 0 && !mc.outdated);
  // 落后：服务器侧直接 mkdir 提交推进 HEAD（WC 不动 → wcRev < headRev）
  await run('svn', ['delete', `${rootUrl}/merge-check-marker`, '-m', 'merge-check cleanup'], { cwd: SVN_DIR });
  await run('svn', ['mkdir', `${rootUrl}/merge-check-marker`, '-m', 'merge-check test'], { cwd: SVN_DIR });
  mc = await vcs.mergeCheck('any');
  check('WC 落后检出 outdated', mc.outdated && Number(mc.outdated.wcRev) < Number(mc.outdated.headRev));
  // 清理服务器 marker + update 到最新后不再落后
  await run('svn', ['delete', `${rootUrl}/merge-check-marker`, '-m', 'merge-check cleanup'], { cwd: SVN_DIR });
  await run('svn', ['update', '-q'], { cwd: SVN_DIR });
  mc = await vcs.mergeCheck('any');
  check('更新后 outdated=null', !mc.outdated);
}

console.log('== Git 远程缓存失效（pull / 切分支 / 合并后立即重查）==');
{
  // 本地裸仓库充当 origin：不依赖网络，也能把"操作前先让 60s 缓存记住旧 behind"这条路走一遍。
  // 回归的是：pull / branchSwitch / merge 成功后必须主动失效 remoteCache，否则界面在缓存
  // 过期前仍显示旧的 ↓ 数字（用户实报"更新完仍显示 ↓12"）。
  const REMOTE_BASE = fs.mkdtempSync(path.join(os.tmpdir(), 'svngit-remote-'));
  try {
    const origin = path.join(REMOTE_BASE, 'origin.git');
    const seed = path.join(REMOTE_BASE, 'seed');
    const w1 = path.join(REMOTE_BASE, 'w1');
    const w2 = path.join(REMOTE_BASE, 'w2');
    const git = (cwd, args) => run('git', args, { cwd });
    fs.mkdirSync(seed, { recursive: true });
    await git(REMOTE_BASE, ['init', '--bare', '-q', origin]);
    await git(seed, ['init', '-q']); // -b 需 git>=2.28，分支名从 symbolic-ref 取
    await git(seed, ['config', 'user.email', 'test@svngit.local']);
    await git(seed, ['config', 'user.name', 'svngit-test']);
    fs.writeFileSync(path.join(seed, 'a.txt'), '1\n');
    await git(seed, ['add', '.']);
    await git(seed, ['commit', '-qm', 'c1']);
    const mainBranch = (await git(seed, ['symbolic-ref', '--short', 'HEAD'])).stdout.trim();
    await git(seed, ['remote', 'add', 'origin', origin]);
    await git(seed, ['push', '-qu', 'origin', mainBranch]);
    await git(REMOTE_BASE, ['clone', '-q', origin, w1]);
    await git(REMOTE_BASE, ['clone', '-q', origin, w2]);
    for (const w of [w1, w2]) {
      await git(w, ['config', 'user.email', 'test@svngit.local']);
      await git(w, ['config', 'user.name', 'svngit-test']);
    }

    // 1) pull：缓存里记着 behind=1，拉完立即重查必须是 0
    fs.writeFileSync(path.join(w2, 'a.txt'), '2\n');
    await git(w2, ['commit', '-aqm', 'c2']);
    await git(w2, ['push', '-q']);
    const vcsPull = new GitVcs(detectRepo(w1));
    const beforePull = await vcsPull.preflight();
    check('pull 前 behind=1', beforePull.behind === 1, `behind=${beforePull.behind}`);
    const pulled = await vcsPull.pull();
    check('pull 成功', pulled.ok, pulled.message);
    check('pull 后立即重查 behind=0', (await vcsPull.preflight()).behind === 0);

    // 2) 切分支：本地 feature 停在 f1，远端已到 f2 → 切过去后必须是 1（不能沿用 master 的 0）
    await git(w2, ['checkout', '-qb', 'feature']);
    fs.writeFileSync(path.join(w2, 'b.txt'), 'x\n');
    await git(w2, ['add', '.']);
    await git(w2, ['commit', '-qm', 'f1']);
    await git(w2, ['push', '-qu', 'origin', 'feature']);
    await git(w1, ['fetch', '-q', 'origin']);
    await git(w1, ['branch', '-q', 'feature', 'origin/feature']);
    fs.writeFileSync(path.join(w2, 'b.txt'), 'y\n');
    await git(w2, ['commit', '-aqm', 'f2']);
    await git(w2, ['push', '-q']);
    const vcsSwitch = new GitVcs(detectRepo(w1));
    await vcsSwitch.preflight(); // 先把 master 的 behind=0 写进缓存
    const sw1 = await vcsSwitch.branchSwitch('feature');
    check('切到 feature 成功', sw1.ok, sw1.message);
    check('切到落后分支后立即重查 behind=1', (await vcsSwitch.preflight()).behind === 1);
    const sw2 = await vcsSwitch.branchSwitch(mainBranch);
    check('切回主干成功', sw2.ok, sw2.message);
    check('切回主干后立即重查 behind=0', (await vcsSwitch.preflight()).behind === 0);

    // 3) 合并：缓存 behind=1，合并完立即重查必须是 0
    await git(w2, ['checkout', '-q', mainBranch]);
    fs.writeFileSync(path.join(w2, 'a.txt'), '3\n');
    await git(w2, ['commit', '-aqm', 'c3']);
    await git(w2, ['push', '-q']);
    const vcsMerge = new GitVcs(detectRepo(w1));
    check('合并前 behind=1', (await vcsMerge.preflight()).behind === 1);
    const merged = await vcsMerge.merge(`origin/${mainBranch}`);
    check('合并成功', merged.ok, merged.message);
    check('合并后立即重查 behind=0', (await vcsMerge.preflight()).behind === 0);
  } finally {
    fs.rmSync(REMOTE_BASE, { recursive: true, force: true });
  }
}

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
