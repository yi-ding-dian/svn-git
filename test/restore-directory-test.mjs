/** 还原到指定版本（目录级）测试：每次新建独立的 git / svn 仓库，验证「整个目录回到某次提交」的行为。
 *
 *  覆盖点：
 *  - svn：目录反向合并（revert -R + merge -r HEAD:REV），删除/新增/修改一起还原，不产生提交
 *  - git：checkout 后还要删掉该版本之后新增的文件，回滚才彻底
 *  - 兄弟目录、子目录、文件级还原不受影响
 *  仓库每次运行重建，可重复执行。
 */
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { run } from '../dist/vcs/exec.js';
import { detectRepo } from '../dist/vcs/detect.js';
import { GitVcs } from '../dist/vcs/git.js';
import { SvnVcs } from '../dist/vcs/svn.js';

// 测试仓库位置：相对脚本推导（项目根/svngit-test），clone 到任何路径都能跑
const TEST_BASE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'svngit-test');

const read = (base, rel) => fs.readFileSync(path.join(base, rel), 'utf8').replace(/\r\n/g, '\n').trim();
const write = (base, rel, text) => {
  fs.mkdirSync(path.dirname(path.join(base, rel)), { recursive: true });
  fs.writeFileSync(path.join(base, rel), text);
};
const lines = (s) => s.split('\n').map((l) => l.trim()).filter(Boolean);

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

// ============ SVN ============
console.log('== SVN 目录还原 ==');
const SVN_REPO = path.join(TEST_BASE, 'restore-dir-svn-repo');
const SVN_WC = path.join(TEST_BASE, 'restore-dir-svn-wc');
// maxRetries：Windows 上终端若停在测试目录里，删除会短暂 EPERM
fs.rmSync(SVN_REPO, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
fs.rmSync(SVN_WC, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
await run('svnadmin', ['create', SVN_REPO]);
const svnUrl = pathToFileURL(SVN_REPO).href;
// 标准布局：仓库根建 trunk，工作副本检出 trunk（App 的常见形态）。
// 这样 svn log 的 changed 路径会带 /trunk 前缀，能验证「换成工作副本相对」是否生效。
await run('svn', ['mkdir', '-q', `${svnUrl}/trunk`, '-m', 'r1: init trunk']);
await run('svn', ['checkout', '-q', `${svnUrl}/trunk`, SVN_WC]);
const svn = (args, opts = {}) => run('svn', args, { cwd: SVN_WC, ...opts });
const svnStatus = async () => (await svn(['status'])).stdout.replace(/\\/g, '/');

const V1 = '2'; // 工作副本里第一次提交（r1 是建 trunk）
const V2 = '3';
// r2：目录 + 子目录 + 兄弟目录
write(SVN_WC, 'dir/a.txt', 'a1\n');
write(SVN_WC, 'dir/b.txt', 'b1\n');
write(SVN_WC, 'dir/sub/c.txt', 'c1\n');
write(SVN_WC, 'other/keep.txt', 'keep\n');
await svn(['add', '-q', 'dir', 'other']);
await svn(['commit', '-qm', 'r2: add dir']);
// r3：改 a.txt
write(SVN_WC, 'dir/a.txt', 'a2\n');
await svn(['commit', '-qm', 'r3: modify a']);
// r4：新增 new.txt、删除 b.txt
write(SVN_WC, 'dir/new.txt', 'new\n');
await svn(['add', '-q', 'dir/new.txt']);
await svn(['delete', '-q', 'dir/b.txt']);
await svn(['commit', '-qm', 'r4: add new, delete b']);

// 版本号看 dir 自己（工作副本根目录提交后仍停在旧版本，是混合版本，不能拿根目录判断）
const beforeRev = (await svn(['info', '--show-item', 'revision', 'dir'])).stdout.trim();
// 历史条数走仓库 URL：工作副本根目录在 r0 时 `svn log` 读不到历史
const beforeLogs = lines((await run('svn', ['log', '-q', pathToFileURL(SVN_REPO).href])).stdout).filter((l) => /^r\d+/.test(l)).length;
const vcsSvn = new SvnVcs(detectRepo(SVN_WC), null);

// 历史里的 changed 路径必须是工作副本相对：svn log 原始输出是 /trunk/dir/a.txt
const logs = await vcsSvn.log(10, 'dir');
const entryV1 = logs.find((l) => l.rev === V1);
check(
  'svn：日志 changed 路径换成工作副本相对（去掉 /trunk 前缀）',
  entryV1?.changed.some((c) => c.path === 'dir' && c.kind === 'dir') &&
    entryV1?.changed.some((c) => c.path === 'dir/a.txt' && c.kind === 'file'),
  JSON.stringify(entryV1?.changed ?? []),
);

// 预检：目录差异（修改 1、找回 1、删除 1）
const pv = await vcsSvn.restorePreview('dir', V1);
check(
  'svn：预检目录差异（修改/恢复/删除各 1）',
  pv.ok && pv.preview?.kind === 'dir' && !pv.preview.same &&
    pv.preview.files?.modify === 1 && pv.preview.files?.restore === 1 && pv.preview.files?.remove === 1,
  JSON.stringify(pv.preview ?? pv),
);

const rv = await vcsSvn.restoreToRev('dir', V1);
check('svn：目录还原返回成功', rv.ok, `msg=${rv.message}`);
check('svn：a.txt 回到第一次提交的内容', read(SVN_WC, 'dir/a.txt') === 'a1', `got=${read(SVN_WC, 'dir/a.txt')}`);
check('svn：r4 删除的 b.txt 被找回', fs.existsSync(path.join(SVN_WC, 'dir/b.txt')) && read(SVN_WC, 'dir/b.txt') === 'b1');
check('svn：r4 新增的 new.txt 被删除', !fs.existsSync(path.join(SVN_WC, 'dir/new.txt')));
check('svn：子目录 c.txt 未受影响', read(SVN_WC, 'dir/sub/c.txt') === 'c1');
check('svn：兄弟目录 other 未受影响', read(SVN_WC, 'other/keep.txt') === 'keep');

const st = await svnStatus();
const stLines = lines(st);
check(
  'svn：状态里出现 M / A / D',
  stLines.some((l) => l.startsWith('M') && l.includes('dir/a.txt')) &&
    stLines.some((l) => l.startsWith('A') && l.includes('dir/b.txt')) &&
    stLines.some((l) => l.startsWith('D') && l.includes('dir/new.txt')),
  st.trim(),
);
const afterRev = (await svn(['info', '--show-item', 'revision', 'dir'])).stdout.trim();
check('svn：工作副本版本号没变（没有改写历史）', afterRev === beforeRev, `before=${beforeRev} after=${afterRev}`);
const afterLogs = lines((await run('svn', ['log', '-q', pathToFileURL(SVN_REPO).href])).stdout).filter((l) => /^r\d+/.test(l)).length;
check('svn：提交历史条数没变', afterLogs === beforeLogs, `before=${beforeLogs} after=${afterLogs}`);

// 还原结果就是普通工作区改动：提交后 HEAD 内容等于第一次提交的目录
const commitRestore = await svn(['commit', '-qm', 'restore dir to first commit']);
check('svn：还原结果可以正常提交', commitRestore.code === 0, commitRestore.stderr.trim());
check('svn：提交后 a.txt = 第一次提交', (await svn(['cat', 'dir/a.txt'])).stdout.trim() === 'a1');
check('svn：提交后 b.txt = 第一次提交', (await svn(['cat', 'dir/b.txt'])).stdout.trim() === 'b1');
check('svn：提交后 new.txt 不存在', (await svn(['cat', 'dir/new.txt'])).code !== 0);

// 还原后与目标版本一致：预检应拦下（same=true）
const pvSame = await vcsSvn.restorePreview('dir', V1);
check('svn：还原后预检为「完全一致」', pvSame.ok && pvSame.preview?.same === true, JSON.stringify(pvSame.preview ?? pvSame));

// 文件级还原行为保持不变（cat 字节写回）；预检给出行数
write(SVN_WC, 'dir/a.txt', 'a3\n');
const pf = await vcsSvn.restorePreview('dir/a.txt', V2);
check(
  'svn：文件预检给出增删行数',
  pf.ok && pf.preview?.same === false && pf.preview?.added === 1 && pf.preview?.removed === 1,
  JSON.stringify(pf.preview ?? pf),
);
const rf = await vcsSvn.restoreToRev('dir/a.txt', V2);
check('svn：文件还原仍正常', rf.ok && read(SVN_WC, 'dir/a.txt') === 'a2', rf.message);

// ---- 父目录被后续提交整体删除后，只还原其中某个文件 ----
await svn(['revert', '-q', '-R', '.']);
// 先 update：混合版本下直接删除目录，提交会报 E155011 out of date（测试准备步骤，不是还原逻辑）
await svn(['update', '-q']);
await svn(['delete', '-q', 'dir']);
const delCommit = await svn(['commit', '-qm', 'delete whole dir']);
check('svn：删除整目录的提交成功', delCommit.code === 0, delCommit.stderr.trim());
await svn(['update', '-q']);
check('svn：整目录已被删除（工作区里没有了）', !fs.existsSync(path.join(SVN_WC, 'dir')));

const pmiss = await vcsSvn.restorePreview('dir/a.txt', V1);
check(
  'svn：预检识别为缺失文件',
  pmiss.ok && pmiss.preview?.kind === 'file' && pmiss.preview?.missing === true && pmiss.preview?.same === false,
  JSON.stringify(pmiss.preview ?? pmiss),
);
const rmiss = await vcsSvn.restoreToRev('dir/a.txt', V1);
check('svn：父目录不存在也能还原单个文件', rmiss.ok, rmiss.message);
check('svn：文件已找回且内容正确', fs.existsSync(path.join(SVN_WC, 'dir/a.txt')) && read(SVN_WC, 'dir/a.txt') === 'a1');
check(
  'svn：父目录被一并重建',
  fs.existsSync(path.join(SVN_WC, 'dir')) && fs.statSync(path.join(SVN_WC, 'dir')).isDirectory(),
);
const missStatus = lines(await svnStatus());
check(
  'svn：文件与父目录都被重新加入版本库（A）',
  missStatus.some((l) => l.startsWith('A') && l.includes('dir/a.txt')) &&
    missStatus.some((l) => l.startsWith('A') && l.trim().endsWith('dir')),
  missStatus.join(' | '),
);
const missCommit = await svn(['commit', '-qm', 'restore only a.txt']);
check('svn：还原后的单文件可以提交', missCommit.code === 0, missCommit.stderr.trim());
check('svn：提交后 a.txt 内容正确', (await svn(['cat', 'dir/a.txt'])).stdout.trim() === 'a1');
check('svn：目录里的其它文件没有被一起带回来', !fs.existsSync(path.join(SVN_WC, 'dir/b.txt')));

// ============ Git ============
console.log('== Git 目录还原 ==');
const GIT_DIR = path.join(TEST_BASE, 'restore-dir-git');
fs.rmSync(GIT_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
fs.mkdirSync(GIT_DIR, { recursive: true });
const git = (args) => run('git', args, { cwd: GIT_DIR });
await git(['init', '-q']);
await git(['config', 'user.email', 'restore-dir@svngit.local']);
await git(['config', 'user.name', 'restore-dir-test']);

// r1：目录 + 兄弟目录
write(GIT_DIR, 'dir/a.txt', 'a1\n');
write(GIT_DIR, 'dir/b.txt', 'b1\n');
write(GIT_DIR, 'other/keep.txt', 'keep\n');
await git(['add', '-A']);
await git(['commit', '-qm', 'r1: add dir']);
// r2：改 a.txt
write(GIT_DIR, 'dir/a.txt', 'a2\n');
await git(['add', '-A']);
await git(['commit', '-qm', 'r2: modify a']);
// r3：新增 new.txt
write(GIT_DIR, 'dir/new.txt', 'new\n');
await git(['add', '-A']);
await git(['commit', '-qm', 'r3: add new']);

const baseRev = (await git(['rev-list', '--max-parents=0', 'HEAD'])).stdout.trim();
const headBefore = (await git(['rev-parse', 'HEAD'])).stdout.trim();
const vcsGit = new GitVcs(detectRepo(GIT_DIR));

// 预检：目录差异（修改 a.txt 1 个、删除 new.txt 1 个）
const gpv = await vcsGit.restorePreview('dir', baseRev);
check(
  'git：预检目录差异（修改 1、删除 1）',
  gpv.ok && gpv.preview?.kind === 'dir' && !gpv.preview.same &&
    gpv.preview.files?.modify === 1 && gpv.preview.files?.restore === 0 && gpv.preview.files?.remove === 1,
  JSON.stringify(gpv.preview ?? gpv),
);

const rg = await vcsGit.restoreToRev('dir', baseRev);
check('git：目录还原返回成功', rg.ok, `msg=${rg.message}`);
check('git：a.txt 回到 r1 内容', read(GIT_DIR, 'dir/a.txt') === 'a1', `got=${read(GIT_DIR, 'dir/a.txt')}`);
check('git：b.txt 未受影响', read(GIT_DIR, 'dir/b.txt') === 'b1');
check('git：r1 之后新增的 new.txt 被删除（回滚才彻底）', !fs.existsSync(path.join(GIT_DIR, 'dir/new.txt')));
check('git：兄弟目录 other 未受影响', read(GIT_DIR, 'other/keep.txt') === 'keep');
const gst = (await git(['status', '--porcelain'])).stdout.replace(/\\/g, '/');
check('git：状态里出现 a.txt 修改与 new.txt 删除', /M\s+dir\/a\.txt|M dir\/a\.txt/.test(gst) && /D\s+dir\/new\.txt|D dir\/new\.txt/.test(gst), gst.trim());
const headAfter = (await git(['rev-parse', 'HEAD'])).stdout.trim();
check('git：HEAD 没变（没有改写历史）', headAfter === headBefore, `before=${headBefore.slice(0, 7)} after=${headAfter.slice(0, 7)}`);

// 还原结果提交后，目录内容与 r1 一致
await git(['add', '-A']);
await git(['commit', '-qm', 'restore dir to r1']);
const tree = lines((await git(['ls-tree', '-r', '--name-only', 'HEAD', '--', 'dir'])).stdout).sort();
check('git：提交后目录只剩 r1 的文件', JSON.stringify(tree) === JSON.stringify(['dir/a.txt', 'dir/b.txt']), tree.join(', '));

// 还原后与目标版本一致：预检应拦下
const gpvSame = await vcsGit.restorePreview('dir', baseRev);
check('git：还原后预检为「完全一致」', gpvSame.ok && gpvSame.preview?.same === true, JSON.stringify(gpvSame.preview ?? gpvSame));

// 文件级还原行为保持不变；预检给出行数
write(GIT_DIR, 'dir/a.txt', 'a3\n');
const gpf = await vcsGit.restorePreview('dir/a.txt', baseRev);
check(
  'git：文件预检给出增删行数',
  gpf.ok && gpf.preview?.same === false && gpf.preview?.added === 1 && gpf.preview?.removed === 1,
  JSON.stringify(gpf.preview ?? gpf),
);
const rfGit = await vcsGit.restoreToRev('dir/a.txt', baseRev);
check('git：文件还原仍正常', rfGit.ok && read(GIT_DIR, 'dir/a.txt') === 'a1', rfGit.message);

// ---- 父目录被后续提交整体删除后，只还原其中某个文件 ----
await git(['checkout', '--', '.']);
await git(['rm', '-r', '-q', 'dir']);
await git(['commit', '-qm', 'delete whole dir']);
check('git：整目录已被删除（工作区里没有了）', !fs.existsSync(path.join(GIT_DIR, 'dir')));

const gpm = await vcsGit.restorePreview('dir/a.txt', baseRev);
check(
  'git：预检识别为缺失文件',
  gpm.ok && gpm.preview?.kind === 'file' && gpm.preview?.missing === true && gpm.preview?.same === false,
  JSON.stringify(gpm.preview ?? gpm),
);
const grm = await vcsGit.restoreToRev('dir/a.txt', baseRev);
check('git：父目录不存在也能还原单个文件', grm.ok, grm.message);
check('git：文件已找回且内容正确', fs.existsSync(path.join(GIT_DIR, 'dir/a.txt')) && read(GIT_DIR, 'dir/a.txt') === 'a1');
check(
  'git：父目录被一并重建',
  fs.existsSync(path.join(GIT_DIR, 'dir')) && fs.statSync(path.join(GIT_DIR, 'dir')).isDirectory(),
);
const gst2 = (await git(['status', '--porcelain'])).stdout.replace(/\\/g, '/');
check('git：文件被重新纳入版本库（A）', /^A\s+dir\/a\.txt$/m.test(gst2), gst2.trim());
await git(['commit', '-qm', 'restore only a.txt']);
check('git：提交后 a.txt 内容正确', (await git(['show', 'HEAD:dir/a.txt'])).stdout.trim() === 'a1');
check('git：目录里的其它文件没有被一起带回来', !fs.existsSync(path.join(GIT_DIR, 'dir/b.txt')));

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
