/** 前端模块边界检查（src/client）。
 *
 *  ── 层级模型 ──────────────────────────────────────────────────────────
 *  src/client 下的顶层目录分两类：
 *    基础层 BASE_LAYERS = ['shared', 'ui', 'animations', 'shell']
 *    业务域 DOMAINS     = 其余所有顶层目录（自动从目录推导，不硬编码）
 *  文件（main.tsx / style.css / index.html）不参与检查。
 *
 *  ── 方向规则 ──────────────────────────────────────────────────────────
 *    业务域 → shared / ui / animations       ✅
 *    业务域 → 另一个业务域                    ❌ domain-domain
 *    业务域 → shell                          ❌ domain-shell（暂时入基线）
 *    shared → ui / shell / animations / 业务域 ❌（shared 必须是纯逻辑）
 *    ui → shell / 业务域                     ❌
 *    ui → shared / animations                ✅（基础层内部）
 *    animations → shared                     ✅
 *    animations → ui / shell / 业务域        ❌
 *    shell → 任何层                          ✅（组合根）
 *    同一层内部（ui → ui、shared → shared）  ✅
 *
 *  ── 解析范围 ──────────────────────────────────────────────────────────
 *    单/双引号、import/export ... from、副作用 import、import()、require()，
 *    以及 ../、../../ 等相对路径；.js 会尝试解析同名 .ts/.tsx。
 *    项目没有路径别名，不做别名处理。
 *
 *  用法：
 *    node scripts/check-boundaries.mjs            检查，新增违规时退出码 1
 *    node scripts/check-boundaries.mjs --update   重新生成 client 基线
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  ROOT,
  relRepo,
  walk,
  extractSpecifiers,
  resolveSpecifier,
  dedupeViolations,
  reportViolations,
  updateBaselineForScope,
} from './boundary-common.mjs';

const CLIENT = path.join(ROOT, 'src/client');
const BASE_LAYERS = ['shared', 'ui', 'animations', 'shell'];
const DOMAINS = fs
  .readdirSync(CLIENT, { withFileTypes: true })
  .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
  .map((e) => e.name)
  .filter((name) => !BASE_LAYERS.includes(name))
  .sort();

const RULE_LABELS = {
  'domain-domain': '业务域 → 另一个业务域',
  'domain-shell': '业务域 → shell',
  'shared-ui': 'shared → ui',
  'shared-shell': 'shared → shell',
  'shared-animations': 'shared → animations',
  'shared-domain': 'shared → 业务域',
  'ui-shell': 'ui → shell',
  'ui-domain': 'ui → 业务域',
  'animations-ui': 'animations → ui',
  'animations-shell': 'animations → shell',
  'animations-domain': 'animations → 业务域',
};

/** 取 src/client 内的顶层目录名；文件或 src/client 之外返回 null。 */
function topLayer(absFile) {
  const rel = path.relative(CLIENT, absFile);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  const segs = rel.split(path.sep).filter(Boolean);
  if (segs.length < 2) return null; // src/client 根下的文件，不参与检查
  const top = segs[0];
  try {
    if (!fs.statSync(path.join(CLIENT, top)).isDirectory()) return null;
  } catch {
    return null;
  }
  return top;
}

function classify(srcTop, tgtTop) {
  if (!srcTop || !tgtTop || srcTop === tgtTop) return null;
  if (srcTop === 'shell') return null; // 组合根，任何方向都允许

  const srcDomain = DOMAINS.includes(srcTop);
  const tgtDomain = DOMAINS.includes(tgtTop);

  if (srcDomain) {
    if (tgtDomain) return 'domain-domain';
    if (tgtTop === 'shell') return 'domain-shell';
    return null; // shared / ui / animations
  }

  if (srcTop === 'shared') {
    return tgtDomain ? 'shared-domain' : `shared-${tgtTop}`;
  }

  if (srcTop === 'ui') {
    if (tgtTop === 'shell') return 'ui-shell';
    if (tgtDomain) return 'ui-domain';
    return null; // shared / animations：基础层内部允许
  }

  if (srcTop === 'animations') {
    if (tgtDomain) return 'animations-domain';
    if (tgtTop === 'ui') return 'animations-ui';
    if (tgtTop === 'shell') return 'animations-shell';
    return null; // shared
  }

  return null;
}

const violations = [];
for (const file of walk(CLIENT)) {
  const srcTop = topLayer(file);
  if (!srcTop) continue; // main.tsx 等根文件不检查
  for (const spec of extractSpecifiers(file)) {
    if (!spec.startsWith('.')) continue; // 只检查客户端内部相对依赖
    const target = resolveSpecifier(file, spec);
    const tgtTop = topLayer(target);
    if (!tgtTop) continue; // 指向 src/client 之外（如 ../../shared）
    const rule = classify(srcTop, tgtTop);
    if (rule) {
      violations.push({ rule, file: relRepo(file), target: spec });
    }
  }
}

const current = dedupeViolations(violations);

if (process.argv.includes('--update')) {
  const total = updateBaselineForScope('client', current);
  console.log(
    `✅ 已更新前端基线：client ${current.length} 条；基线文件共 ${total} 条（已保留 server 条目）`,
  );
  process.exit(0);
}

reportViolations({
  label: '前端',
  scope: 'client',
  current,
  ruleLabels: RULE_LABELS,
});
