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

console.log('== Git Blame / 忽略 / 清理 ==');
{
  const vcs = new GitVcs(detectRepo(GIT_DIR));
  const blame = await vcs.blame('readme.md');
  check('blame 解析', blame.length >= 3 && blame[0]?.rev && blame[0]?.author);

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
