/** i18n 完成度检查：统计还有多少「用户可见中文」没搬进语言包。
 *
 *  为什么需要它：约 2000 条文案分散在 100+ 文件里，靠人眼无法回答"搬完了没有"。
 *
 *  判定规则：
 *  - **只算代码里的中文，不算注释**（注释里的中文是给开发者看的，不翻译）。
 *    逐行扫描并剥离注释，且字符串感知 —— `const u = 'http://x'` 里的 `//` 不会被当注释。
 *  - 行内 `i18n-ignore` 标记的行**整行跳过**：给 vcs 层「逻辑中文」用 ——
 *    `svn.ts` 的 `CN_MAP`（已更新/已添加…）和 `parseUpdateFiles` 里的正则是**解析 svn 命令行输出**的，
 *    不是界面文案，翻了直接坏功能。这类必须显式标记，让后来人能一眼看出"这里是故意留的"。
 *  - 中文标点（，。：（）「」…）单独出现不算 —— 代码里拿它们做分隔符是常事。
 *
 *  用法：node scripts/check-i18n.mjs [--list]   —— `--list` 打印每处明细（默认只给汇总）
 *  退出码：始终 0（这是进度条不是闸门；要当闸门用可改最后一行）。
 */
import fs from 'node:fs';
import path from 'node:path';

const SRC = path.resolve('src');
const LIST = process.argv.includes('--list');

/** 只认 CJK 汉字，不认中文标点（避免把 `split('，')` 这类当文案） */
const CJK = /[一-鿿]/;

function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (/\.tsx?$/.test(e.name)) acc.push(p);
  }
  return acc;
}

/** 剥离一行的注释，字符串感知。state 跨行传递（块注释 / 模板字符串）。 */
function stripLine(line, state, lineNo) {
  let code = '';
  let i = 0;
  while (i < line.length) {
    if (state.block) {
      const end = line.indexOf('*/', i);
      if (end === -1) return code;
      state.block = false;
      i = end + 2;
      continue;
    }
    const ch = line[i];
    if (state.str) {
      code += ch;
      if (ch === '\\') {
        code += line[i + 1] ?? '';
        i += 2;
        continue;
      }
      if (ch === state.str) state.str = null;
      // 模板字符串里的 ${...} 按普通字符处理：其内容多为表达式，且我们只找中文
      i++;
      continue;
    }
    if (ch === '/' && line[i + 1] === '/') return code; // 行注释：本行到此为止
    if (ch === '/' && line[i + 1] === '*') {
      state.block = true;
      i += 2;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      state.str = ch;
      code += ch;
      i++;
      continue;
    }
    code += ch;
    i++;
  }
  return code;
}

const perFile = new Map();
let ignored = 0;
const details = [];

for (const file of walk(SRC)) {
  const rel = path.relative(SRC, file);
  // 语言包自身就是中文的（zh.ts 的每一项值），不该被算成"未搬运"
  if (rel.startsWith(path.join('shared', 'i18n'))) continue;
  const src = fs.readFileSync(file, 'utf8');
  const state = { block: false, str: null };
  const lines = src.split('\n');
  let count = 0;

  lines.forEach((raw, idx) => {
    // 行内白名单：整行跳过（含标记所在行的代码，标记就该和它豁免的代码同行）
    if (raw.includes('i18n-ignore')) {
      ignored += 1;
      return;
    }
    state.str = null; // 普通字符串不跨行；跨行模板串极少见，跨行时当无字符串处理
    const code = stripLine(raw, state, idx + 1);
    if (!CJK.test(code)) return;
    count += 1;
    if (LIST) details.push(`${rel}:${idx + 1}  ${code.trim().slice(0, 110)}`);
  });

  if (count > 0) perFile.set(rel, count);
}

// 语言包条目数（进度参考：搬进去多少 key）。语言包按域拆分到子目录，故要遍历该目录下所有 .ts
const packCount = (lang) => {
  const dir = path.join(SRC, 'shared', 'i18n', lang);
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.ts'))
    .reduce((n, f) => n + (fs.readFileSync(path.join(dir, f), 'utf8').match(/^\s*'[^']+':/gm) ?? []).length, 0);
};

const total = [...perFile.values()].reduce((a, b) => a + b, 0);
const byDomain = new Map();
for (const [rel, n] of perFile) {
  const parts = rel.split(path.sep);
  const domain = parts[0] === 'client' && parts.length > 2 ? `client/${parts[1]}` : parts[0];
  byDomain.set(domain, (byDomain.get(domain) ?? 0) + n);
}

console.log('📊 i18n 完成度');
console.log(`  语言包：zh ${packCount('zh')} 条 / en ${packCount('en')} 条`);
console.log(`  未搬运中文行：${total} 处，分布于 ${perFile.size} 个文件`);
console.log(`  已豁免（i18n-ignore）：${ignored} 行`);
console.log('');
console.log('  按域：');
for (const [d, n] of [...byDomain].sort((a, b) => b[1] - a[1])) {
  console.log(`    ${d.padEnd(22)} ${n}`);
}
if (LIST) {
  console.log('');
  console.log('  明细：');
  for (const d of details) console.log('    ' + d);
}
