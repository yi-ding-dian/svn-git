/** HTTP API 集成测试：起真实服务，对 30+ 端点中安全/状态关键面发请求断言。
 * 测试仓库：svnkit-test/git-repo（setup/teardown 均硬重置到固定提交,保证可重复）。
 * 覆盖本轮回归重点：路径越界拦截 ×6、CSRF、localhost 放行、软删 keep、写后缓存失效、核心数据结构。 */
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { run } from '../dist/vcs/exec.js';
import { startServer } from '../dist/server.js';

// 测试仓库位置（与 vcs-test.mjs 同一约定）
const TEST_BASE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'svnkit-test');
const GIT_DIR = path.join(TEST_BASE, 'git-repo');
const GIT_BASE_COMMIT = 'b4f4eef2ffcf01bbb063c7a7a25d745d4818f39d';
const SVN_DIR = path.join(TEST_BASE, 'svn-wc');

let pass = 0;
let fail = 0;
function check(name, cond, extra = '') {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ' | ' + extra : ''}`);
  if (cond) pass++;
  else fail++;
}

// ---------- setup：重置测试仓库（fixture 不入库,CI 首次自建仓库） ----------
console.log('== API 测试:构造测试状态 ==');
if (!fs.existsSync(path.join(GIT_DIR, '.git'))) {
  console.log('  git-repo 不存在,自建测试仓库…');
  fs.mkdirSync(GIT_DIR, { recursive: true });
  await run('git', ['init', '-q'], { cwd: GIT_DIR }); // 分支名无关断言(porcelain 相对路径); -b 需 git>=2.28 故不用
  await run('git', ['config', 'user.email', 'test@svnkit.local'], { cwd: GIT_DIR });
  await run('git', ['config', 'user.name', 'svnkit-test'], { cwd: GIT_DIR });
  fs.writeFileSync(`${GIT_DIR}/readme.md`, 'hello v0\n');
  fs.mkdirSync(`${GIT_DIR}/src`, { recursive: true });
  fs.writeFileSync(`${GIT_DIR}/src/app.js`, 'console.log(1)\n');
  await run('git', ['add', 'readme.md', 'src'], { cwd: GIT_DIR });
  await run('git', ['commit', '-qm', 'initial'], { cwd: GIT_DIR });
  fs.writeFileSync(`${GIT_DIR}/del.txt`, 'del\n');
  await run('git', ['add', 'del.txt'], { cwd: GIT_DIR });
  await run('git', ['commit', '-qm', 'add del.txt'], { cwd: GIT_DIR });
}
// 固定 hash 存在则用其重置（本地维护的仓库）;CI 自建仓库 hash 不同 → 重置当前 HEAD
const b4 = await run('git', ['cat-file', '-t', GIT_BASE_COMMIT], { cwd: GIT_DIR });
await run('git', ['reset', '-q', '--hard', b4.code === 0 ? GIT_BASE_COMMIT : 'HEAD'], { cwd: GIT_DIR });
process.env.SVNKIT_REPO_DIR = GIT_DIR;

const handle = await startServer();
const B = `http://127.0.0.1:${handle.port}`;
const get = async (p) => {
  const r = await fetch(B + p);
  return { code: r.status, body: await r.json().catch(() => ({})) };
};
const post = async (p, body = {}, headers = {}) => {
  const r = await fetch(B + p, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  return { code: r.status, body: await r.json().catch(() => ({})) };
};

try {
  // ---------- 1. 核心结构 ----------
  {
    const { code, body } = await get('/api/info');
    check('GET /api/info 200 且 root 正确', code === 200 && body.root === GIT_DIR, `code=${code} root=${body.root}`);
    const st = await get('/api/status');
    check('GET /api/status 200 且 items 为数组', st.code === 200 && Array.isArray(st.body.items));
    const pf = await get('/api/preflight');
    check(
      'GET /api/preflight 结构完整',
      pf.code === 200 && 'conflictRisk' in pf.body && 'remoteHasUpdate' in pf.body && 'updatedFiles' in pf.body
    );
    const br = await get('/api/branches');
    check('GET /api/branches 含 current/branches', br.code === 200 && typeof br.body.current === 'string' && Array.isArray(br.body.branches));
    // merge-check：git 无 mergeCheck 方法，回退 switchCheck（交集判断与合并阻塞定义相同）
    const cur = br.body.current;
    const mc = await get(`/api/merge-check?branch=${encodeURIComponent(cur)}`);
    check('GET /api/merge-check 结构完整', mc.code === 200 && typeof mc.body.changed === 'number' && Array.isArray(mc.body.conflicts) && Array.isArray(mc.body.lineConflicts));
    fs.writeFileSync(`${GIT_DIR}/merge-check-tmp.txt`, 'x');
    const mc2 = await get(`/api/merge-check?branch=${encodeURIComponent(cur)}`);
    check('merge-check 检出未跟踪改动', mc2.body.untracked >= 1 && mc2.body.changed >= 1);
    fs.rmSync(`${GIT_DIR}/merge-check-tmp.txt`, { force: true });
  }

  // ---------- 2. 路径越界拦截（本轮修复核心） ----------
  {
    const P = '../'.repeat(7); // 仓库深 7 层,出到根
    const cases = [
      ['/api/cat?path=' + encodeURIComponent(P + 'etc/hostname'), 400],
      ['/api/log?path=' + encodeURIComponent(P), 400],
      ['/api/diff?path=' + encodeURIComponent(P + 'etc/hostname'), 400],
      ['/api/ls?dir=' + encodeURIComponent(P), 400],
      ['/api/file-versions?path=' + encodeURIComponent(P + 'etc/hostname'), 403],
      ['/api/fs?dir=' + encodeURIComponent(P), 403],
    ];
    for (const [p, want] of cases) {
      const { code } = await get(p);
      check(`越界拦截 ${p.split('?')[0]} → ${want}`, code === want, `got=${code}`);
    }
  }

  // ---------- 3. CSRF 与 Origin 放行 ----------
  {
    const evil = await post('/api/shutdown', {}, { Origin: 'http://evil.com' });
    check('跨站 Origin → 403', evil.code === 403, `got=${evil.code}`);
    const local = await post('/api/config', {}, { Origin: 'http://localhost:23456' });
    check('localhost Origin 放行（非 403）', local.code !== 403, `got=${local.code}`);
  }

  // ---------- 4. 写后缓存失效（30s 缓存 bug 回归） ----------
  {
    const f = 'api-cache-test.txt';
    fs.writeFileSync(path.join(GIT_DIR, f), 'x');
    await get('/api/status?force=1'); // 注入 ? 缓存
    const before = await get('/api/status'); // 无 force,读缓存
    check('注入后状态为 ?（RAG-缓存生效）', before.body.items.some((i) => i.path === f && i.code === '?'));
    const addRes = await post('/api/add', { paths: [f] });
    check('add 成功', addRes.code === 200 && addRes.body.ok === true);
    const after = await get('/api/status'); // 无 force:缓存已被写后失效 → 必须重扫
    check('add 后立即变 A（缓存已失效）', after.body.items.some((i) => i.path === f && i.code === 'A'));
    await run('git', ['reset', '-q', 'HEAD', '--', f], { cwd: GIT_DIR });
  }

  // ---------- 5. 软删除 keep=本地保留 ----------
  {
    const f = 'api-keep-test.txt';
    fs.writeFileSync(path.join(GIT_DIR, f), 'keep');
    await post('/api/add', { paths: [f] });
    const okHas = fs.existsSync(path.join(GIT_DIR, f));
    const delKeep = await post('/api/delete', { paths: [f], keep: true });
    check('软删 keep 成功', delKeep.code === 200 && delKeep.body.ok === true);
    check('软删后磁盘文件保留', okHas && fs.existsSync(path.join(GIT_DIR, f)));
    // 清理（索引与磁盘均还原）
    await run('git', ['reset', '-q', 'HEAD', '--', f], { cwd: GIT_DIR });
    fs.rmSync(path.join(GIT_DIR, f), { force: true });
  }

  // ---------- 6. 认证识别字段与网络检测 ----------
  {
    const nc = await get('/api/net-check');
    check('net-check 返回 ok/reason 字段', nc.code === 200 && typeof nc.body.ok === 'boolean' && typeof nc.body.reason === 'string');
    const uc = await get('/api/git-unpushed-count');
    check('git-unpushed-count 数值', uc.code === 200 && typeof uc.body.count === 'number');
  }

  // ---------- 7. SVN 侧:net-check 用 vcs.info URL（恒"未配置"bug 回归） ----------
  if (fs.existsSync(SVN_DIR)) {
    process.env.SVNKIT_REPO_DIR = SVN_DIR;
    const nc = await get('/api/net-check');
    check(
      'SVN net-check 正常（ok=true, reason=网络正常）',
      nc.code === 200 && nc.body.ok === true && nc.body.reason === '网络正常',
      `ok=${nc.body.ok} reason=${nc.body.reason}`
    );
  } else {
    console.log('⚠️ 跳过 SVN net-check 断言（svn-wc 不存在,先跑 vcs-test 生成）');
  }
} finally {
  // ---------- teardown：重置仓库,仅保留 api 测试文件之外的状态 ----------
  process.env.SVNKIT_REPO_DIR = GIT_DIR;
  const b4t = await run('git', ['cat-file', '-t', GIT_BASE_COMMIT], { cwd: GIT_DIR });
  await run('git', ['reset', '-q', '--hard', b4t.code === 0 ? GIT_BASE_COMMIT : 'HEAD'], { cwd: GIT_DIR });
  fs.rmSync(path.join(GIT_DIR, 'api-cache-test.txt'), { force: true });
  fs.rmSync(path.join(GIT_DIR, 'api-keep-test.txt'), { force: true });
  await handle.close();
}

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
