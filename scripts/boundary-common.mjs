/** 模块边界检查的公共工具：源码遍历、import 解析、路径解析与基线读写。
 *
 *  解析覆盖（前后端共用）：
 *    - import ... from 'x' / export ... from 'x'
 *    - 副作用导入 import 'x'
 *    - 动态导入 import('x')
 *    - require('x')
 *    - 单引号 / 双引号
 *    - 相对路径（./、../、../../...）
 *    - 源码里写 .js、实际文件是 .ts/.tsx 的 ESM 习惯
 *
 *  基线文件：scripts/boundary-baseline.json
 *    - 前端条目：{ "rule", "file", "target" }（缺省 scope = client）
 *    - 后端条目：{ "scope": "server", "rule", "file", "target" }
 *    - 两个脚本各自 --update 时只替换自己 scope 的条目，互不覆盖。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(SCRIPT_DIR, '..');
export const BASELINE_FILE = path.join(SCRIPT_DIR, 'boundary-baseline.json');

export const toPosix = (p) => p.split(path.sep).join('/');
export const relRepo = (abs) => toPosix(path.relative(ROOT, abs));

/** 递归收集目录下的 .ts/.tsx 文件（不进入 node_modules 等非常规顶层目录）。 */
export function walk(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (/\.tsx?$/.test(e.name)) acc.push(p);
  }
  return acc;
}

/** 把注释替换成空格（保留换行），避免注释里的 import 被误判。 */
export function maskComments(src) {
  let out = '';
  let state = 'code'; // code | line | block | single | double | template
  for (let i = 0; i < src.length; ) {
    const c = src[i];
    const n = src[i + 1];

    if (state === 'code') {
      if (c === '/' && n === '/') {
        out += '  ';
        i += 2;
        state = 'line';
        continue;
      }
      if (c === '/' && n === '*') {
        out += '  ';
        i += 2;
        state = 'block';
        continue;
      }
      if (c === "'") state = 'single';
      else if (c === '"') state = 'double';
      else if (c === '`') state = 'template';
      out += c;
      i++;
      continue;
    }

    if (state === 'line') {
      if (c === '\n') {
        out += c;
        state = 'code';
      } else {
        out += ' ';
      }
      i++;
      continue;
    }

    if (state === 'block') {
      if (c === '*' && n === '/') {
        out += '  ';
        i += 2;
        state = 'code';
      } else {
        out += c === '\n' ? '\n' : ' ';
        i++;
      }
      continue;
    }

    // 字符串 / 模板字符串：原样保留，处理转义
    out += c;
    if (c === '\\' && i + 1 < src.length) {
      out += src[i + 1];
      i += 2;
      continue;
    }
    if (
      (state === 'single' && c === "'") ||
      (state === 'double' && c === '"') ||
      (state === 'template' && c === '`')
    ) {
      state = 'code';
    }
    i++;
  }
  return out;
}

/** 提取文件内所有 import 目标（去重，保留出现顺序）。 */
export function extractSpecifiers(file) {
  const src = maskComments(fs.readFileSync(file, 'utf8'));
  const specs = new Set();
  const patterns = [
    /\bfrom\s*(['"])([^'"]+)\1/g, // import/export ... from 'x'
    /\bimport\s*(['"])([^'"]+)\1/g, // 副作用导入 import 'x'
    /\bimport\s*\(\s*(['"])([^'"]+)\1\s*\)/g, // 动态导入 import('x')
    /\brequire\s*\(\s*(['"])([^'"]+)\1\s*\)/g, // require('x')
  ];
  for (const re of patterns) {
    for (const m of src.matchAll(re)) specs.add(m[2]);
  }
  return [...specs];
}

/** 把 import 说明符解析成真实文件路径；.js → .ts/.tsx，目录 → index.ts(x)。
 *  解析不到时返回按字面量计算的路径（用于确定目标层级）。 */
export function resolveSpecifier(fromFile, spec) {
  const base = path.resolve(path.dirname(fromFile), spec);
  const candidates = [];
  if (path.extname(spec)) {
    candidates.push(base);
    if (spec.endsWith('.js')) {
      const noExt = base.slice(0, -3);
      candidates.push(noExt + '.ts', noExt + '.tsx');
    }
  } else {
    candidates.push(base, base + '.ts', base + '.tsx');
  }
  candidates.push(
    path.join(base, 'index.ts'),
    path.join(base, 'index.tsx'),
    path.join(base, 'index.js'),
  );
  for (const c of candidates) {
    try {
      if (fs.statSync(c).isFile()) return c;
    } catch {
      // 继续尝试
    }
  }
  return base;
}

/** abs 是否位于 dir 内（不含 dir 自身）。 */
export function isInside(dir, abs) {
  const rel = path.relative(dir, abs);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

// ---------------------------------------------------------------- 基线

export function baselineScope(entry) {
  return entry && entry.scope === 'server' ? 'server' : 'client';
}

export function entryKey(entry) {
  return [baselineScope(entry), entry.rule, entry.file, entry.target].join('\0');
}

export function loadBaseline() {
  try {
    const data = JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8'));
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function sortEntries(a, b) {
  const fields = ['scope', 'rule', 'file', 'target'];
  for (const f of fields) {
    const av = f === 'scope' ? baselineScope(a) : String(a[f] ?? '');
    const bv = f === 'scope' ? baselineScope(b) : String(b[f] ?? '');
    const cmp = av.localeCompare(bv, 'en');
    if (cmp !== 0) return cmp;
  }
  return 0;
}

/** 用当前 scope 的违规替换基线中同 scope 的条目（其他 scope 原样保留）。 */
export function updateBaselineForScope(scope, violations) {
  const others = loadBaseline().filter((e) => baselineScope(e) !== scope);
  const merged = [...others];
  for (const v of violations) {
    merged.push(
      scope === 'server'
        ? { scope: 'server', rule: v.rule, file: v.file, target: v.target }
        : { rule: v.rule, file: v.file, target: v.target },
    );
  }
  const seen = new Set();
  const deduped = merged.filter((e) => {
    const k = entryKey(e);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  deduped.sort(sortEntries);
  fs.mkdirSync(path.dirname(BASELINE_FILE), { recursive: true });
  fs.writeFileSync(BASELINE_FILE, JSON.stringify(deduped, null, 2) + '\n', 'utf8');
  return deduped.length;
}

/** 去重当前违规（同 scope/rule/file/target 只算一条）。 */
export function dedupeViolations(violations) {
  const seen = new Set();
  return violations.filter((v) => {
    const k = entryKey(v);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export function groupByRule(list) {
  const groups = new Map();
  for (const v of list) groups.set(v.rule, (groups.get(v.rule) ?? 0) + 1);
  return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0], 'en'));
}

export function formatGroupStats(list) {
  return groupByRule(list)
    .map(([rule, n]) => `${rule} ${n}`)
    .join('，');
}

/** 统一的违规对比与输出。返回新增违规条数（0 表示通过）。 */
export function reportViolations({ label, scope = 'client', current, ruleLabels = {} }) {
  const allBaseline = loadBaseline();
  const baseline = dedupeViolations(allBaseline.filter((e) => baselineScope(e) === scope));
  // 当前违规本身不带 scope，这里补上，保证与基线 key 一致
  const currentDeduped = dedupeViolations(
    current.map((v) => ({ scope, rule: v.rule, file: v.file, target: v.target })),
  );
  const baselineKeys = new Set(baseline.map(entryKey));
  const currentKeys = new Set(currentDeduped.map(entryKey));

  const added = currentDeduped.filter((v) => !baselineKeys.has(entryKey(v)));
  const leftover = baseline.filter((v) => currentKeys.has(entryKey(v)));
  const removed = baseline.filter((v) => !currentKeys.has(entryKey(v)));

  const describe = (v) =>
    `[${v.rule}${ruleLabels[v.rule] ? ` ${ruleLabels[v.rule]}` : ''}] ${v.file} → ${v.target}`;

  if (added.length > 0) {
    console.log(`❌ 新增违规 ${added.length} 条（${formatGroupStats(added)}）：`);
    for (const v of [...added].sort(sortEntries)) console.log('  · ' + describe(v));
  }

  if (leftover.length > 0) {
    console.log(`⚠️ 基线遗留 ${leftover.length} 条（${formatGroupStats(leftover)}）`);
  }

  if (removed.length > 0) {
    console.log(`✅ 已消除 ${removed.length} 条，可从基线删除：`);
    for (const v of [...removed].sort(sortEntries)) console.log('  · ' + describe(v));
  }

  if (added.length === 0) {
    if (leftover.length === 0 && removed.length === 0) {
      console.log(`✅ ${label}依赖方向检查通过：没有违规`);
    } else {
      console.log(
        `✅ ${label}依赖方向检查通过：无新增违规` +
          (leftover.length ? `（基线遗留 ${leftover.length} 条）` : ''),
      );
    }
  } else {
    process.exitCode = 1;
  }
  return added.length;
}
