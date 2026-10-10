/** 依赖方向检查：扫 client 下所有相对 import，报告两类违规。
 *
 *  规则（见 record.md）：
 *    业务域 → shared / ui / shell        可以
 *    业务域 → 另一个业务域                违规（确有需要应提升到 shared）
 *    shared / ui → 业务域                 违规（分层倒置）
 *
 *  用法：node scripts/check-boundaries.mjs   —— 有违规时退出码 1 */
import fs from 'node:fs';
import path from 'node:path';

const CLIENT = path.resolve('src/client');
const DOMAINS = ['filesystem', 'conflicts', 'ops', 'repo', 'appearance', 'history', 'terminal'];

function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (/\.tsx?$/.test(e.name)) acc.push(p);
  }
  return acc;
}

const topOf = (abs) => path.relative(CLIENT, abs).split(path.sep)[0];

const violations = [];
for (const file of walk(CLIENT)) {
  const srcTop = topOf(file);
  const src = fs.readFileSync(file, 'utf8');
  for (const m of src.matchAll(/\bfrom\s+'(\.[^']+)'/g)) {
    const tgt = path.resolve(path.dirname(file), m[1]);
    const tgtTop = topOf(tgt);
    if ((srcTop === 'shared' || srcTop === 'ui') && DOMAINS.includes(tgtTop)) {
      violations.push(`[分层倒置] ${path.relative(CLIENT, file)}：${srcTop}/ 引用了业务域 ${tgtTop}/`);
    } else if (DOMAINS.includes(srcTop) && DOMAINS.includes(tgtTop) && srcTop !== tgtTop) {
      violations.push(`[跨域引用] ${path.relative(CLIENT, file)}：${srcTop}/ → ${tgtTop}/`);
    }
  }
}

if (violations.length === 0) {
  console.log('✅ 依赖方向检查通过：没有跨域引用，也没有分层倒置');
} else {
  console.log(`❌ 发现 ${violations.length} 处违规：`);
  for (const v of violations) console.log('  ' + v);
  process.exitCode = 1;
}
