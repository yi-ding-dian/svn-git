/** 冲突合并模型单测：解析工作区冲突标记 / 按选择生成结果 / 冲突块在两侧完整文件中的定位。
 *
 *  为什么要有测试：三栏合并编辑器的每个按钮都只是在改"结果行数组"，如果块边界或行尾
 *  处理错了，保存会把错误内容写进工作区（甚至把冲突标记留在文件里）。这里把口径钉死：
 *  - 只有完整的 <<<<<<< … ======= … >>>>>>> 才算冲突块，畸形标记按普通内容处理
 *  - 未选择时保留原标记（用户能一眼看出还有几处）；选择后标记全部消失
 *  - CRLF 文件的行尾必须原样带回去
 */
import { parseConflictWork, blockResultLines, buildResultLines, joinResultLines, locateBlocks, countConflictBlocks } from '../dist/shared/conflict-merge.js';

let fail = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${detail ? ' | ' + detail : ''}`);
  if (!cond) fail++;
};
const texts = (lines) => lines.map((l) => l.text);
const kinds = (lines) => lines.map((l) => l.kind);

// ============ 场景1：标准 git 冲突标记（一个块 + 前后普通内容） ============
const gitWork = [
  'line1',
  'line2',
  '<<<<<<< HEAD',
  'line3-main',
  'line4',
  '=======',
  'line3-feat',
  'line4',
  '>>>>>>> feat',
  'line5',
].join('\n');
const g = parseConflictWork(gitWork);
check('标准标记：解析出 1 个冲突块', g.filter((s) => s.kind === 'conflict').length === 1);
const gb = g.find((s) => s.kind === 'conflict').block;
check('标准标记：本地段 2 行 / 对方段 2 行', gb.ours.length === 2 && gb.theirs.length === 2, `ours=${gb.ours.length} theirs=${gb.theirs.length}`);
check('标准标记：两侧 label 正确', gb.labelOurs === 'HEAD' && gb.labelTheirs === 'feat', `${gb.labelOurs}/${gb.labelTheirs}`);

// ============ 场景2：选择三种结果 ============
const plainBefore = g[0].lines.length;
const rNone = buildResultLines(g, {});
check(
  '未选择：保留全部三行标记',
  kinds(rNone).filter((k) => k === 'marker').length === 3,
  JSON.stringify(kinds(rNone)),
);
const rOurs = buildResultLines(g, { 1: 'ours' });
check(
  '采用本地：没有标记行，内容=本地段',
  rOurs.every((l) => l.kind !== 'marker') && texts(rOurs).join('|') === ['line1', 'line2', 'line3-main', 'line4', 'line5'].join('|'),
  texts(rOurs).join('|'),
);
const rTheirs = buildResultLines(g, { 1: 'theirs' });
check(
  '采用对方：内容=对方段',
  texts(rTheirs).join('|') === ['line1', 'line2', 'line3-feat', 'line4', 'line5'].join('|'),
  texts(rTheirs).join('|'),
);
const rBoth = buildResultLines(g, { 1: 'both' });
check(
  '两边都要：本地段+对方段都保留',
  texts(rBoth).join('|') === ['line1', 'line2', 'line3-main', 'line4', 'line3-feat', 'line4', 'line5'].join('|'),
  texts(rBoth).join('|'),
);
check('未选择时普通段位置不变（前 2 行）', plainBefore === 2 && rNone[0].text === 'line1');

// ============ 场景3：SVN 标记（.mine / .rN） ============
const svn = parseConflictWork(['a', '<<<<<<< .mine', 'mine1', '=======', 'theirs1', '>>>>>>> .r123', 'b'].join('\n'));
const sb = svn.find((s) => s.kind === 'conflict').block;
check('SVN 标记：label 正确', sb.labelOurs === '.mine' && sb.labelTheirs === '.r123', `${sb.labelOurs}/${sb.labelTheirs}`);

// ============ 场景4：diff3 格式（带公共祖先段） ============
const d3 = parseConflictWork(
  ['x', '<<<<<<< ours', 'o1', '||||||| base', 'b1', '=======', 't1', '>>>>>>> theirs', 'y'].join('\n'),
);
const db = d3.find((s) => s.kind === 'conflict').block;
check('diff3：解析出祖先段', db.base !== null && db.base[0] === 'b1');
check('diff3：选边后祖先段一并消失', texts(buildResultLines(d3, { 1: 'ours' })).join('|') === 'x|o1|y');

// ============ 场景5：畸形标记按普通内容处理 ============
const broken = parseConflictWork(['a', '<<<<<<< HEAD', 'o1', 'no separators here'].join('\n'));
check('畸形标记（缺 =======/>>>>>>>）：整份当普通内容', broken.length === 1 && broken[0].kind === 'plain');

const empty = parseConflictWork('');
check('空文件：没有冲突块', empty.every((s) => s.kind === 'plain'));
check('空文件：join 回空串', joinResultLines(buildResultLines(empty, {})) === '');

// ============ 场景6：CRLF 行尾原样保留 ============
const crlfWork = ['l1\r', '<<<<<<< HEAD\r', 'o1\r', '=======\r', 't1\r', '>>>>>>> feat\r', 'l2\r'].join('\n');
const c = parseConflictWork(crlfWork);
const cOurs = buildResultLines(c, { 1: 'ours' });
check(
  'CRLF：选择后内容行仍带 \\r（保存不换行尾）',
  cOurs.every((l) => l.text.endsWith('\r')),
  JSON.stringify(texts(cOurs)),
);
check('CRLF：标记行本身也带 \\r', c.find((s) => s.kind === 'conflict').block.markers.open.endsWith('\r'));

// ============ 场景7：两块冲突（编号唯一、块间普通段保留） ============
const two = parseConflictWork(
  ['a', '<<<<<<< o', 'o1', '=======', 't1', '>>>>>>> t', 'm', '<<<<<<< o', 'o2', '=======', 't2', '>>>>>>> t', 'z'].join('\n'),
);
const twoBlocks = two.filter((s) => s.kind === 'conflict');
check('两个冲突块：编号 1、2', twoBlocks.length === 2 && twoBlocks[0].block.id === 1 && twoBlocks[1].block.id === 2);
check(
  '两个冲突块：分别选边互不影响',
  texts(buildResultLines(two, { 1: 'ours', 2: 'theirs' })).join('|') === 'a|o1|m|t2|z',
  texts(buildResultLines(two, { 1: 'ours', 2: 'theirs' })).join('|'),
);

// ============ 场景8：块在两侧完整文件中的定位 ============
const oursFile = ['line1', 'line2', 'line3-main', 'line4', 'line5-main', 'line6', 'line7', 'line8', 'line9-main', 'line10', ''];
const theirsFile = ['line1', 'line2', 'line3-feat', 'line4', 'line5-feat', 'line6', 'line7', 'line8', 'line9-feat', 'line10', ''];
const seg = parseConflictWork(
  ['line1', 'line2', '<<<<<<< HEAD', 'line3-main', 'line4', 'line5-main', 'line6', 'line7', 'line8', 'line9-main', '=======', 'line3-feat', 'line4', 'line5-feat', 'line6', 'line7', 'line8', 'line9-feat', '>>>>>>> feat', 'line10', ''].join('\n'),
);
const oRanges = locateBlocks(seg, 'ours', oursFile);
const tRanges = locateBlocks(seg, 'theirs', theirsFile);
check('定位：本地段在本地文件中的行区间', oRanges.get(1).start === 2 && oRanges.get(1).end === 8, JSON.stringify([...oRanges]));
check('定位：对方段在对方文件中的行区间', tRanges.get(1).start === 2 && tRanges.get(1).end === 8, JSON.stringify([...tRanges]));

// 重复内容：两个冲突块内容相同，游标要往后找，不能都定位到第一处
const dup = parseConflictWork(['x', '<<<<<<< a', 'dup', '=======', 'dup', '>>>>>>> b', 'x', '<<<<<<< a', 'dup', '=======', 'dup', '>>>>>>> b'].join('\n'));
const dupOurs = locateBlocks(dup, 'ours', ['x', 'dup', 'x', 'dup']);
check('定位：重复内容按块顺序往后匹配', dupOurs.get(1).start === 1 && dupOurs.get(2).start === 3, JSON.stringify([...dupOurs]));

// CRLF 与 LF 混用也能定位（行尾差异不该影响块定位）
check('定位：行尾差异不影响匹配', locateBlocks(seg, 'ours', oursFile.map((l) => l + '\r')).get(1).start === 2);

// ============ 场景9：一行都没有匹配上时返回空区间（不画连接带，不报错） ============
check('定位：内容对不上时返回空 Map', locateBlocks(seg, 'ours', ['zzz', 'yyy']).size === 0);

// ============ 场景10：手动编辑后的未处理块计数（决定能否保存） ============
check('计数：未选择的文本有 1 个冲突块', countConflictBlocks(gitWork) === 1);
check('计数：选边后的文本没有冲突块', countConflictBlocks(joinResultLines(buildResultLines(g, { 1: 'ours' }))) === 0);
check(
  '计数：两个冲突块 → 2',
  countConflictBlocks(['<<<<<<< a', 'x', '=======', 'y', '>>>>>>> b', '<<<<<<< a', 'z', '=======', 'w', '>>>>>>> b'].join('\n')) === 2,
);
check('计数：普通文本 → 0', countConflictBlocks('line1\nline2\n') === 0);
check('计数：畸形标记不算（缺结束行）', countConflictBlocks('<<<<<<< HEAD\nonly-ours\n') === 0);

console.log(fail === 0 ? '\n✅ conflict-merge 全部通过' : `\n❌ ${fail} 项失败`);
process.exit(fail ? 1 : 0);
