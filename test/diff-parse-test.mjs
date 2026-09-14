/** lineMarksOf 行级变更标记单测：隔离验证"哪些行算修改(M)/新增(+)/删除(-)"。
 *
 *  为什么存在：旧实现是块级判定（同一块内"有删有加"→ 整块标 M），而 unified diff 惯例是
 *  "先输出全部删除行、再输出全部新增行"，导致"删掉一大段 + 原地新增另一段无关代码"被整块
 *  标成 M（用户实报：docx_parser.py 删 49 行命名空间常量，全被标 M）。这里把判定口径钉死。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseUnifiedDiff, lineMarksOf } from '../dist/shared/diff-parse.js';

let fail = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${detail ? ' | ' + detail : ''}`);
  if (!cond) fail++;
};

/** diff 文本 → 标注后的行数组 */
function marks(diffText) {
  const lines = parseUnifiedDiff(diffText);
  const m = lineMarksOf(lines);
  return lines.map((l) => ({ ...l, mark: m.get(l) }));
}
/** 取某类行（del/add）的标记分布，便于断言"哪几行被判成了什么" */
const marksOf = (rows, type) => rows.filter((r) => r.type === type).map((r) => r.mark);
/** 找出内容含某片段的行的标记 */
const markOfText = (rows, frag) => rows.find((r) => r.text.includes(frag))?.mark;

// ============ 场景1（核心回归）：删一大段 + 原地新增无关代码 → 删除行必须是 del 而非 mod ============
// 取自真实案例（docx_parser.py）：命名空间常量整体搬到 ooxml.py，原地只留一行注释说明
const r1 = marks(
  [
    '@@ -31,20 +31,8 @@',
    ' import docx',
    ' ',
    '+from backend.normative.ooxml import (',
    '+    _IMG_DIR, _R_EMBED, _R_ID,',
    '+)',
    '+',
    ' logger = logging.getLogger(__name__)',
    ' ',
    '-# ---- 命名空间标签（python-docx 的 qn() 不含 VML 映射，用字面 URI）----',
    '-_W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"',
    '-_A_NS = "http://schemas.openxmlformats.org/drawingml/2006/main"',
    '-_V_NS = "urn:schemas-microsoft-com:vml"',
    '-_R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"',
    '-',
    '-_TAG_P = f"{{{_W_NS}}}p"',
    '-_TAG_TBL = f"{{{_W_NS}}}tbl"',
    '-_TAG_R = f"{{{_W_NS}}}r"',
    '+# OOXML 命名空间与标签常量见 ooxml.py（与 stamp.py 共用）',
    ' ',
  ].join('\n'),
);
check(
  '核心回归：被搬走的常量行标 del（不再整块 M）',
  ['_W_NS = ', '_A_NS = ', '_V_NS = ', '_R_NS = ', '_TAG_P = ', '_TAG_TBL = ', '_TAG_R = '].every(
    (f) => markOfText(r1, f) === 'del',
  ),
  `_W_NS=${markOfText(r1, '_W_NS = ')} _TAG_P=${markOfText(r1, '_TAG_P = ')}`,
);
check('核心回归：新增的 import 行标 add', markOfText(r1, 'from backend.normative.ooxml') === 'add');
check(
  '核心回归：删除行里没有一行被误标成 mod 之外……',
  marksOf(r1, 'del').filter((m) => m === 'add').length === 0,
  `del 行标记=${JSON.stringify(marksOf(r1, 'del'))}`,
);

// ============ 场景2：真正的行内小改 → mod（不能把正常修改搞坏） ============
const r2 = marks(
  ['@@ -1,4 +1,4 @@', ' import os', '-def foo(x):', '-    return x + 1', '+def foo(x, y):', '+    return x + y'].join('\n'),
);
check('小改：函数签名与返回表达式判为 mod', marksOf(r2, 'del').every((m) => m === 'mod') && marksOf(r2, 'add').every((m) => m === 'mod'), `del=${JSON.stringify(marksOf(r2, 'del'))}`);

// ============ 场景3/4：纯新增、纯删除 ============
const r3 = marks(['@@ -1,2 +1,5 @@', ' a', '+x1', '+x2', '+x3', ' b'].join('\n'));
check('纯新增块：全部 add', marksOf(r3, 'add').every((m) => m === 'add'));
const r4 = marks(['@@ -1,5 +1,2 @@', ' a', '-y1', '-y2', '-y3', ' b'].join('\n'));
check('纯删除块：全部 del', marksOf(r4, 'del').every((m) => m === 'del'));

// ============ 场景5：删块与增块被上下文行隔开（块号连续）→ 仍按行配对 ============
const r5 = marks(['@@ -1,5 +1,5 @@', ' a', '-b = 1', ' d', '+b = 2', ' f'].join('\n'));
check('相邻块（中间隔 ctx）：相似的删/增行配成 mod', marksOf(r5, 'del')[0] === 'mod' && marksOf(r5, 'add')[0] === 'mod', `${marksOf(r5, 'del')} / ${marksOf(r5, 'add')}`);

// ============ 场景6：行数悬殊 → 只有能对上的配对，其余落单 ============
const r6 = marks(['@@ -1,4 +1,2 @@', '-_a = 1', '-_b = 2', '-_c = 3', '+_a = 1'].join('\n'));
check(
  '行数悬殊：1 对 mod + 2 行落单 del',
  JSON.stringify(marksOf(r6, 'del')) === JSON.stringify(['mod', 'del', 'del']),
  JSON.stringify(marksOf(r6, 'del')),
);

// ============ 场景7：等量但完全无关 → 不配对（这是旧实现最大的误判来源） ============
const r7 = marks(['@@ -1,3 +1,3 @@', '-aaaaaaaaaa', '-bbbbbbbbbb', '-cccccccccc', '+xxxxxxxxxx', '+yyyyyyyyyy', '+zzzzzzzzzz'].join('\n'));
check('等量无关替换：不配对，标 del/add', marksOf(r7, 'del').every((m) => m === 'del') && marksOf(r7, 'add').every((m) => m === 'add'), `${JSON.stringify(marksOf(r7, 'del'))}`);

// ============ 场景8：超大块退化为纯删/纯增（保护：不做 O(n×m) 猜测） ============
const big = ['@@ -1,201 +1,201 @@'];
for (let i = 0; i < 201; i++) big.push(`-old line ${i}`);
for (let i = 0; i < 201; i++) big.push(`+old line ${i}`); // 内容完全相同也照样退化（>40000 格）
const r8 = marks(big.join('\n'));
check('超大块退化：不做配对（性能保护）', marksOf(r8, 'del').every((m) => m === 'del') && marksOf(r8, 'add').every((m) => m === 'add'));

// ============ 场景9：上下文行不参与标记 ============
const r9 = marks(['@@ -1,3 +1,3 @@', ' a', '-b', '+c', ' d'].join('\n'));
check('上下文行无标记', r9.filter((r) => r.type === 'ctx').every((r) => r.mark === undefined));

// ============ 场景10：block 编号语义未被改动（导航/滚动条/占位行依赖它） ============
const r10 = parseUnifiedDiff(['@@ -1,6 +1,7 @@', ' a', '-b', '+c', ' d', '+e', ' f'].join('\n'));
check(
  'block 编号：同块内先删后增同号，ctx 隔开才另开块',
  r10.find((r) => r.text === 'b')?.block === 1 &&
    r10.find((r) => r.text === 'c')?.block === 1 &&
    r10.find((r) => r.text === 'e')?.block === 2,
);

// ============ 场景11：真实案例（fixture 固化，不依赖外部仓库实时状态） ============
// 取自 my-RAG 仓库 e66778a「docx_parser 拆出 stamp 与 ooxml」：命名空间常量整体搬到 ooxml.py。
// 旧实现把 hunk1 的 49 行删除整块标成 M（用户实报的原始 bug），这里钉死修复后的口径。
const fixture = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'docx-parser-split.diff');
if (fs.existsSync(fixture)) {
  const rows = marks(fs.readFileSync(fixture, 'utf8'));
  const delMarks = marksOf(rows, 'del');
  const modCount = delMarks.filter((m) => m === 'mod').length;
  const addMarks = marksOf(rows, 'add');
  check(
    `真实案例：${delMarks.length} 行删除中仅 ${modCount} 行判 mod（旧行为是整块 M）`,
    delMarks.length > 100 && modCount < delMarks.length * 0.2,
    `mod=${modCount} 纯删=${delMarks.length - modCount}`,
  );
  check(
    `真实案例：${addMarks.length} 行新增中 ${addMarks.filter((m) => m === 'mod').length} 行判 mod（import 块应为纯 add）`,
    addMarks.filter((m) => m === 'add').length > addMarks.length * 0.5,
  );
  check('真实案例：核心被搬走的 `_W_NS = ` 行标 del', markOfText(rows, '_W_NS = "http') === 'del', String(markOfText(rows, '_W_NS = "')));
} else {
  console.log('⏭ 真实案例 fixture 缺失，跳过');
}

console.log(fail === 0 ? '\n✅ diff-parse 全部通过' : `\n❌ ${fail} 项失败`);
process.exit(fail ? 1 : 0);
