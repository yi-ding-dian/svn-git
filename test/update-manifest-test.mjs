/** 更新清单预扫描单测：`git ls-tree` 解析 + 「本地树 vs 远端树」比对。
 *
 *  为什么存在：拉取时 git 协议不给文件名/单文件大小，清单是拿 GitHub tree API 的
 *  path/sha/size 与本地 ls-tree 比出来的。口径错了会把"没变的文件"列进更新、
 *  把删除当新增，或者在中文/空格路径上解析失败——这些都只发生在下载前，
 *  用户没别的地方能核对，必须锁死。
 */
import { parseLsTreeOutput, buildUpdateManifest } from '../dist/vcs/update-manifest.js';
import { progressStart, progressFromStderr, progressGet, progressDone } from '../dist/transfer-progress.js';

let fail = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${detail ? ' | ' + detail : ''}`);
  if (!cond) fail++;
};

// ============ 1. ls-tree -r -l -z 解析：普通文件 / 中文+空格路径 / 子模块（size 为 -） ============
const local = parseLsTreeOutput(
  [
    '100644 blob aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa   100\tREADME.md',
    '100644 blob bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb   200\tsrc/old.ts',
    '100644 blob cccccccccccccccccccccccccccccccccccccccc  1234\tdocs/截图 1.png',
    '160000 commit dddddddddddddddddddddddddddddddddddddddd     -\tvendor/sub',
    '',
  ].join('\0'),
);
check('ls-tree：4 条都解析出来', local.size === 4, `size=${local.size}`);
check('ls-tree：普通文件 sha/size', local.get('README.md')?.sha === 'a'.repeat(40) && local.get('README.md')?.size === 100);
check('ls-tree：中文+空格路径原样保留', local.get('docs/截图 1.png')?.size === 1234);
check('ls-tree：子模块 size 记为 0', local.get('vendor/sub')?.size === 0);
check('ls-tree：空输出不炸', parseLsTreeOutput('').size === 0);

// ============ 2. 比对口径：未变的不进清单；A/M/D 计数、总大小只算 A/M、按大小降序 ============
const remote = [
  { path: 'README.md', sha: 'a'.repeat(40), type: 'blob', size: 100 }, // 未变
  { path: 'src/old.ts', sha: 'e'.repeat(40), type: 'blob', size: 200 }, // M（sha 变了）
  { path: 'new.png', sha: 'f'.repeat(40), type: 'blob', size: 5000 }, // A
  { path: 'src/added.ts', sha: '1'.repeat(40), type: 'blob', size: 30 }, // A
  { path: 'docs/截图 1.png', sha: 'c'.repeat(40), type: 'blob', size: 1234 }, // 未变
  { path: 'vendor/sub', sha: 'd'.repeat(40), type: 'commit', size: 0 }, // 未变
];
// 本地有、远端没有 → D（单独加一条，别影响上面的 ls-tree 解析断言）
const localForDiff = new Map(local);
localForDiff.set('gone.ts', { sha: '9'.repeat(40), size: 40 });
const m = buildUpdateManifest(localForDiff, remote);
check('比对：有差异返回清单', m !== null);
check('比对：未变文件不在清单', !m.files.some((f) => f.path === 'README.md'));
check(
  '比对：计数 A2/M1/D1',
  m.counts.A === 2 && m.counts.M === 1 && m.counts.D === 1,
  JSON.stringify(m.counts),
);
check('比对：总大小只算新增+修改（5000+200+30）', m.totalBytes === 5230, `totalBytes=${m.totalBytes}`);
check('比对：按大小降序（最大的 new.png 在前）', m.files[0]?.path === 'new.png', m.files.map((f) => f.path).join(','));
check('比对：删除项 size=0 且状态 D', m.files.find((f) => f.path === 'gone.ts')?.status === 'D' && m.files.find((f) => f.path === 'gone.ts')?.size === 0);
check('比对：修改项状态 M', m.files.find((f) => f.path === 'src/old.ts')?.status === 'M');
check('比对：新增项状态 A', m.files.find((f) => f.path === 'new.png')?.status === 'A');

// ============ 3. 完全一致 → null（界面不显示空清单） ============
const same = buildUpdateManifest(
  new Map([['a.md', { sha: 'a'.repeat(40), size: 1 }]]),
  [{ path: 'a.md', sha: 'a'.repeat(40), type: 'blob', size: 1 }],
);
check('比对：无差异返回 null', same === null);

// ============ 4. 清单截断：计数/总大小按全量，files 只放前 500 条 ============
const many = Array.from({ length: 600 }, (_, i) => ({
  path: `f${String(i).padStart(3, '0')}.txt`,
  sha: String(i).padStart(40, 'a'),
  type: 'blob',
  size: i + 1,
}));
const big = buildUpdateManifest(new Map(), many);
check('截断：counts 按全量 600', big.counts.A === 600);
check('截断：files 只带 500 条', big.files.length === 500, `files=${big.files.length}`);
check('截断：truncated 标记', big.truncated === true);

// ============ 5. git 进度行解析：对象计数只认 Receiving/Writing，不认 Counting ============
progressStart('pull:test');
progressFromStderr('pull:test', 'remote: Counting objects: 100% (352/352), done.');
const p1 = progressGet('pull:test');
check('解析：Counting 不当作已接收对象', p1.ok && p1.objectsTotal === undefined, JSON.stringify(p1));
progressFromStderr('pull:test', 'Receiving objects:  45% (159/352), 1.20 MiB | 25.00 KiB/s');
const p2 = progressGet('pull:test');
check(
  '解析：Receiving 带对象数/字节/速度',
  p2.ok && p2.phase === 'receiving' && p2.objectsDone === 159 && p2.objectsTotal === 352 && Math.round(p2.bytes) === Math.round(1.2 * 1024 * 1024) && Math.round(p2.speed) === 25 * 1024,
  JSON.stringify(p2),
);
progressFromStderr('pull:test', 'Writing objects: 100% (4/4), 2.86 MiB | 33.69 MiB/s, done.');
const p3 = progressGet('pull:test');
check(
  '解析：Writing 也记对象数（推送）',
  p3.ok && p3.objectsDone === 4 && p3.objectsTotal === 4 && p3.phase === 'waiting',
  JSON.stringify(p3),
);
progressDone('pull:test');

if (fail > 0) {
  console.log(`\n❌ ${fail} 项失败`);
  process.exit(1);
}
console.log('\n✅ 更新清单预扫描单测全部通过');
