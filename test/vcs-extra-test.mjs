/** 版本管理扩展功能测试：分支/标签/Stash/合并/清理/Blame/忽略/锁定/创建仓库 */
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

  const cr = await vcs.branchCreate('test-feat');
  check('创建分支 test-feat', cr.ok);
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

console.log('== SVN 分支/标签/切换 ==');
{
  const vcs = new SvnVcs(detectRepo(SVN_DIR), null);
  // 重置到仓库根（测试仓库无标准 trunk 布局；避免上次中断的残留分支干扰）
  const rootUrl = (await vcs.info()).url?.replace(/\/branches\/.*$/, '').replace(/\/tags\/.*$/, '') ?? '';
  await run('svn', ['switch', '-q', rootUrl], { cwd: SVN_DIR });

  const bl = await vcs.branchList();
  check('分支列表返回', bl.current && Array.isArray(bl.branches));

  const bc = await vcs.branchCreate('test-branch');
  check('创建分支 test-branch', bc.ok);
  const bl2 = await vcs.branchList();
  check('分支列表含 test-branch', bl2.branches.some((b) => b.name === 'test-branch'));

  const sw = await vcs.branchSwitch('test-branch');
  check('切换分支 test-branch', sw.ok);

  const tc = await vcs.tagCreate('rel-test');
  check('创建标签 rel-test', tc.ok);
  const tl = await vcs.tagList();
  check('标签列表含 rel-test', tl.includes('rel-test'));
  await vcs.tagDelete('rel-test');
  const tl2 = await vcs.tagList();
  check('删除标签', !tl2.includes('rel-test'));

  // 回到仓库根并删除测试分支
  await run('svn', ['switch', '-q', rootUrl], { cwd: SVN_DIR });
  await vcs.branchDelete('test-branch');
  const bl3 = await vcs.branchList();
  check('删除分支', !bl3.branches.some((b) => b.name === 'test-branch'));
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

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
