/** hunk 解析/构造的测试：纯函数断言 + 真实 git apply 端到端验证。
 *  跑法：npm run build && node test/hunks-test.mjs（已挂进 npm test）
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { run } from '../dist/vcs/exec.js';
import { parseDiff, buildPatch, hunkSummary } from '../dist/vcs/hunks.js';

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

console.log('== parseDiff / buildPatch（纯函数）==');
const DIFF_2HUNKS = `diff --git a/a.txt b/a.txt
index 4083766..0f43c6a 100644
--- a/a.txt
+++ b/a.txt
@@ -1,3 +1,3 @@
 line1
-line2
+CHANGED2
 line3
@@ -6,3 +6,3 @@ line5
 line6
-line7
+CHANGED7
 line8
`;
const p = parseDiff(DIFF_2HUNKS);
check('解析出 2 个 hunk', p.hunks.length === 2, `(实际 ${p.hunks.length})`);
check('文件头保留 4 行', p.fileHeader.split('\n').length === 4, `(实际 ${p.fileHeader.split('\n').length})`);
check('第 1 块起始行 = 1', p.hunks[0].oldStart === 1);
check('第 2 块起始行 = 6', p.hunks[1].oldStart === 6);
check('块摘要', hunkSummary(p.hunks[0]) === '第 1 行 · +1 −1', `(${hunkSummary(p.hunks[0])})`);

const patch1 = buildPatch(p, [0]);
check('只含选中块（不含未选的）', patch1.includes('CHANGED2') && !patch1.includes('CHANGED7'));
check('保留文件头', patch1.startsWith('diff --git a/a.txt b/a.txt'));
check('hunk 尾部上下文完整（截断会报"补丁损坏"）', patch1.trimEnd().endsWith(' line3'));
check('未选中任何块 → 无 @@ 行', !buildPatch(p, []).includes('@@'));
check('选中序号去重', patch1 === buildPatch(p, [0, 0]));

check('空 diff 不崩', parseDiff('').hunks.length === 0);
check('无 \n 结尾标记行原样保留', parseDiff('@@ -1 +1 @@\n-a\n+b\n\\ No newline at end of file\n').hunks[0].lines.some((l) => l.type === 'meta'));

console.log('== 真实仓库里 apply --cached（端到端）==');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'svngit-hunks-'));
const git = (args) => run('git', args, { cwd: TMP });
await git(['init', '-q']);
await git(['config', 'user.email', 't@t.local']);
await git(['config', 'user.name', 't']);
fs.writeFileSync(path.join(TMP, 'a.txt'), 'l1\nl2\nl3\nl4\nl5\nl6\nl7\nl8\nl9\nl10\n');
await git(['add', '-A']);
await git(['commit', '-qm', 'init']);
// 两处相距较远的改动（-U1 下会分成两块）
fs.writeFileSync(path.join(TMP, 'a.txt'), 'l1\nX2\nl3\nl4\nl5\nl6\nX7\nl8\nl9\nl10\n');

const d = await git(['diff', '-U1', '--', 'a.txt']);
const parsed = parseDiff(d.stdout);
check('真实 diff 解析出 2 块', parsed.hunks.length === 2, `(实际 ${parsed.hunks.length})`);

fs.writeFileSync(path.join(TMP, 'p.patch'), buildPatch(parsed, [0]));
const ap = await git(['apply', '--cached', 'p.patch']);
check('apply --cached 成功', ap.code === 0, ap.stderr.trim());

const staged = await git(['diff', '--cached']);
check('暂存区只含第 1 块', staged.stdout.includes('X2') && !staged.stdout.includes('X7'));
const work = await git(['diff']);
check('工作区仍保留第 2 块改动', work.stdout.includes('X7'));

// 两块全选时应能一次全部暂存
await git(['reset', '-q']);
fs.writeFileSync(path.join(TMP, 'p2.patch'), buildPatch(parsed, [0, 1]));
const ap2 = await git(['apply', '--cached', 'p2.patch']);
check('全选也能 apply', ap2.code === 0, ap2.stderr.trim());
check('全选后暂存区含两块', (await git(['diff', '--cached'])).stdout.includes('X7'));

fs.rmSync(TMP, { recursive: true, force: true });
console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
