/** diffChangedLines 行冲突算法单测：隔离验证 BASE 行号计算（回归防护）。 */
import { diffChangedLines } from '../dist/vcs/diff-lines.js';

let fail = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${detail ? ' | ' + detail : ''}`);
  if (!cond) fail++;
};

// 场景1: hunk 内内容行以 --- 开头（markdown 分隔行被删除）—— 历史 bug：被误判为文件头,行号偏移
// 行号推进: @@-1,5 cur=1; ' line1'→2; '---- a'(内容--- a 删除)→del{2},cur=3; '+line3'→ins{3}
const d1 = '--- readme.md\t(版本 5)\n+++ readme.md\t(工作副本)\n@@ -1,5 +1,5 @@\n line1\n---- a\n+line3\n line4\n line5\n';
const r1 = diffChangedLines(d1);
check('内容---行：del 计入且行号不错位', r1.del.has(2) && r1.ins.has(3), `del={${[...r1.del]}} ins={${[...r1.ins]}}`);

// 场景2: git 文件头带空格仍跳过
const d2 = '--- a/x.txt\n+++ b/x.txt\n@@ -1,3 +1,3 @@\n a\n-b\n+c\n';
const r2 = diffChangedLines(d2);
check('git 文件头跳过+普通 hunk', r2.del.has(2) && r2.ins.has(3), `del={${[...r2.del]}} ins={${[...r2.ins]}}`);

// 场景3: svn 文件头 `--- x (版本 34)` 跳过
const d3 = '--- x.txt\t(版本 34)\n+++ x.txt\t(工作副本)\n@@ -1,2 +1,2 @@\n-old\n+new\n';
const r3 = diffChangedLines(d3);
check('svn 文件头跳过', r3.del.has(1) && r3.ins.has(2), `del={${[...r3.del]}} ins={${[...r3.ins]}}`);

// 场景4: 纯插入（@@-5,2 +5,3): cur=5 ' p'→6 '+q'→ins{6}
const d4 = '@@ -5,2 +5,3 @@\n p\n+q\n r\n';
const r4 = diffChangedLines(d4);
check('纯插入行号', r4.ins.has(6) && r4.del.size === 0, `del={${[...r4.del]}} ins={${[...r4.ins]}}`);

// 场景5: 多 hunk 行号分别成段
const d5 = '@@ -1,2 +1,2 @@\n-a\n+b\n@@ -10,3 +10,3 @@\n x\n-y\n+z\n';
const r5 = diffChangedLines(d5);
// hunk1 行1 被删、行2 后插入;hunk2 的 context 行10 推进后行11 被删、行12 后插入
check('多 hunk 行号分段', r5.del.has(1) && r5.ins.has(2) && r5.del.has(11) && r5.ins.has(12),
  `del={${[...r5.del]}} ins={${[...r5.ins]}}`);

// 场景6: 内容行以 +++ 开头被插入（渲染为 ++++ 四加号起）,不得误判为文件头
const d6 = '@@ -1,4 +1,4 @@\n-aaa\n+ +++ x\n a\n b\n'.replace('+ +++ x', '++++ x');
const r6 = diffChangedLines(d6);
// aaa 删第 1 行(cur=2),++++ x 是内容 "+++ x" 的插入行 → ins 记于 BASE 第 2 行位置
check('内容+++行：ins 计入且不误判文件头', r6.ins.has(2), `del={${[...r6.del]}} ins={${[...r6.ins]}}`);

console.log(fail === 0 ? '\n全部通过' : `\n${fail} 项失败`);
process.exit(fail === 0 ? 0 : 1);
