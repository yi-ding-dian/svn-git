/** 练习仓库生成测试：Git/SVN 结构、场景状态、唯一目录与失败清理 */
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { run } from '../dist/vcs/exec.js';
import { detectRepo } from '../dist/vcs/detect.js';
import { GitVcs } from '../dist/vcs/git.js';
import { generatePracticeRepo } from '../dist/practice/index.js';

const PARENT = fs.mkdtempSync(path.join(os.tmpdir(), 'svngit-practice-'));
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

const git = (args, cwd) => run('git', args, { cwd });
const branchOf = (bl, name) => bl.branches.find((b) => !b.remote && b.name === name);

try {
  console.log('== 练习仓库生成 ==');

  // 1) Git 基础场景
  const g1 = await generatePracticeRepo({ type: 'git', parentDir: PARENT });
  check('Git 基础生成成功', g1.ok === true, g1.message);
  check('Git 工作副本存在', Boolean(g1.workDir && fs.existsSync(g1.workDir)));
  check('Git bare 远端存在', fs.existsSync(path.join(g1.root, 'remote.git')));
  const gv = new GitVcs(detectRepo(g1.workDir));
  let bl = await gv.branchList();
  check('main 已同步', branchOf(bl, 'main')?.ahead === 0 && branchOf(bl, 'main')?.behind === 0, JSON.stringify(branchOf(bl, 'main')));
  check('hotfix 领先 1（未推送）', branchOf(bl, 'hotfix')?.ahead === 1 && branchOf(bl, 'hotfix')?.behind === 0, JSON.stringify(branchOf(bl, 'hotfix')));
  check('feature/login 已同步', branchOf(bl, 'feature/login')?.ahead === 0 && branchOf(bl, 'feature/login')?.behind === 0);
  check('基础模式无 diverged 分支', !bl.branches.some((b) => b.name === 'diverged'));
  check('Git 工作区干净', (await gv.status()).length === 0);

  // 2) Git 远程同步 + 合并冲突
  const g2 = await generatePracticeRepo({ type: 'git', parentDir: PARENT, scenarios: { remote: true, conflict: true } });
  check('Git 远程/冲突生成成功', g2.ok === true, g2.message);
  const gv2 = new GitVcs(detectRepo(g2.workDir));
  bl = await gv2.branchList();
  check('fetch 前 main 仍是旧快照', branchOf(bl, 'main')?.behind === 0, JSON.stringify(branchOf(bl, 'main')));
  await gv2.fetchRemote();
  bl = await gv2.branchList();
  check('fetch 后 main 落后 1', branchOf(bl, 'main')?.behind === 1 && branchOf(bl, 'main')?.ahead === 0, JSON.stringify(branchOf(bl, 'main')));
  check('diverged 已分叉（↑1 ↓1）', branchOf(bl, 'diverged')?.ahead === 1 && branchOf(bl, 'diverged')?.behind === 1, JSON.stringify(branchOf(bl, 'diverged')));
  const mg = await git(['merge', '--no-commit', 'feature/login'], g2.workDir);
  check('合并 feature/login 产生冲突', mg.code !== 0, (mg.stderr || mg.stdout).slice(0, 80));
  await git(['merge', '--abort'], g2.workDir);
  check('中止合并后工作区干净', (await git(['status', '--porcelain'], g2.workDir)).stdout.trim() === '');

  // 3) 唯一目录：连续生成不覆盖
  const g3 = await generatePracticeRepo({ type: 'git', parentDir: PARENT });
  check('重复生成使用不同目录', g3.ok && g3.root !== g1.root, `${g1.root} vs ${g3.root}`);

  // 4) 父目录校验
  const bad = await generatePracticeRepo({ type: 'git', parentDir: path.join(PARENT, 'not-exist') });
  check('父目录不存在时报错', bad.ok === false);

  // 5) SVN 基础场景
  const s1 = await generatePracticeRepo({ type: 'svn', parentDir: PARENT });
  check('SVN 基础生成成功', s1.ok === true, s1.message);
  const svnRepo = path.join(s1.root, 'repo');
  // SVN 的分支/标签是版本库内的目录，不是文件系统目录——用 svn list 检查
  const s1url = pathToFileURL(svnRepo).href;
  const lRoot = await run('svn', ['list', s1url]);
  const lBranches = await run('svn', ['list', `${s1url}/branches`]);
  const lTags = await run('svn', ['list', `${s1url}/tags`]);
  check(
    'SVN 标准布局存在（trunk/branches/feature-a/tags/v1.0）',
    /trunk\//.test(lRoot.stdout) &&
      /branches\//.test(lRoot.stdout) &&
      /tags\//.test(lRoot.stdout) &&
      /feature-a\//.test(lBranches.stdout) &&
      /v1\.0\//.test(lTags.stdout),
    `${lRoot.stdout.trim()} | ${lBranches.stdout.trim()} | ${lTags.stdout.trim()}`,
  );
  check('SVN 工作副本可识别', detectRepo(s1.workDir)?.type === 'svn');
  const sst = await run('svn', ['status', '-q'], { cwd: s1.workDir });
  check('SVN 工作区干净', sst.stdout.trim() === '', sst.stdout);

  // 6) SVN 合并冲突场景
  const s2 = await generatePracticeRepo({ type: 'svn', parentDir: PARENT, scenarios: { conflict: true } });
  check('SVN 冲突生成成功', s2.ok === true, s2.message);
  const url2 = pathToFileURL(path.join(s2.root, 'repo')).href;
  const sm = await run('svn', ['merge', `${url2}/branches/feature-a`], { cwd: s2.workDir });
  const conflictSt = await run('svn', ['status', '-q'], { cwd: s2.workDir });
  check('SVN 合并产生冲突', sm.code !== 0 || /^\s*C/m.test(conflictSt.stdout), (sm.stderr || sm.stdout).slice(0, 80));
  await run('svn', ['revert', '-R', '.'], { cwd: s2.workDir });

  console.log(`\n结果：${pass} 通过，${fail} 失败`);
} finally {
  fs.rmSync(PARENT, { recursive: true, force: true });
}
if (fail > 0) process.exit(1);
