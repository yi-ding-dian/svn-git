/** 后端模块边界检查（src/server、src/vcs、src/main、src/shared）。
 *
 *  ── 规则（只做静态 import 检查）────────────────────────────────────────
 *    1. routes-cross-domain  src/server/routes 内部不得跨命名域互相 import。
 *       命名域 = routes/ 下的第一段：
 *         routes/a.ts            → a
 *         routes/browse/*.ts     → browse
 *       同域内允许（如 browse/index.ts → browse/search.ts）。
 *    2. vcs-server           src/vcs/** 不得 import src/server/**（依赖方向）。
 *    3. main-routes          src/main/** 不得 import src/server/routes/**。
 *    4. shared-node          src/shared/** 不得 import 'node:*'（无环境依赖）。
 *
 *  解析覆盖单/双引号、import/export from、副作用 import、import()、require()，
 *  .js 会尝试解析同名 .ts/.tsx；不做路径别名处理。
 *
 *  基线：与前端共用 scripts/boundary-baseline.json，条目带 "scope":"server"。
 *
 *  用法：
 *    node scripts/check-boundaries-server.mjs            检查，新增违规时退出码 1
 *    node scripts/check-boundaries-server.mjs --update   重新生成 server 基线
 */
import path from 'node:path';
import {
  ROOT,
  relRepo,
  walk,
  extractSpecifiers,
  resolveSpecifier,
  isInside,
  dedupeViolations,
  reportViolations,
  updateBaselineForScope,
} from './boundary-common.mjs';

const SERVER = path.join(ROOT, 'src/server');
const ROUTES = path.join(ROOT, 'src/server/routes');
const VCS = path.join(ROOT, 'src/vcs');
const MAIN = path.join(ROOT, 'src/main');
const SHARED = path.join(ROOT, 'src/shared');

const RULE_LABELS = {
  'routes-cross-domain': 'routes 跨命名域',
  'vcs-server': 'vcs → server',
  'main-routes': 'main → server/routes',
  'shared-node': 'shared → node:*',
};

/** routes/ 下的命名域：有子目录取第一段目录名，顶层文件取文件名（去扩展名）。 */
function routeDomain(absFile) {
  const rel = path.relative(ROUTES, absFile);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  const segs = rel.split(path.sep).filter(Boolean);
  if (segs.length === 0) return null;
  if (segs.length > 1) return segs[0];
  return segs[0].replace(/\.(?:tsx?|jsx?)$/, '');
}

const violations = [];

// 1. routes 之间不得跨命名域互相 import
for (const file of walk(ROUTES)) {
  const srcDomain = routeDomain(file);
  if (!srcDomain) continue;
  for (const spec of extractSpecifiers(file)) {
    if (!spec.startsWith('.')) continue;
    const target = resolveSpecifier(file, spec);
    const tgtDomain = routeDomain(target);
    if (!tgtDomain) continue;
    if (tgtDomain !== srcDomain) {
      violations.push({
        rule: 'routes-cross-domain',
        file: relRepo(file),
        target: spec,
      });
    }
  }
}

// 2. vcs 不得 import server
for (const file of walk(VCS)) {
  for (const spec of extractSpecifiers(file)) {
    if (!spec.startsWith('.')) continue;
    const target = resolveSpecifier(file, spec);
    if (isInside(SERVER, target)) {
      violations.push({ rule: 'vcs-server', file: relRepo(file), target: spec });
    }
  }
}

// 3. main 不得 import server/routes
for (const file of walk(MAIN)) {
  for (const spec of extractSpecifiers(file)) {
    if (!spec.startsWith('.')) continue;
    const target = resolveSpecifier(file, spec);
    if (isInside(ROUTES, target)) {
      violations.push({ rule: 'main-routes', file: relRepo(file), target: spec });
    }
  }
}

// 4. shared 不得 import 'node:*'
for (const file of walk(SHARED)) {
  for (const spec of extractSpecifiers(file)) {
    if (spec.startsWith('node:')) {
      violations.push({ rule: 'shared-node', file: relRepo(file), target: spec });
    }
  }
}

const current = dedupeViolations(violations);

if (process.argv.includes('--update')) {
  const total = updateBaselineForScope('server', current);
  console.log(
    `✅ 已更新后端基线：server ${current.length} 条；基线文件共 ${total} 条（已保留 client 条目）`,
  );
  process.exit(0);
}

reportViolations({
  label: '后端',
  scope: 'server',
  current,
  ruleLabels: RULE_LABELS,
});
