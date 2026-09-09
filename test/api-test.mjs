/** HTTP API 集成测试：起真实服务，对 30+ 端点中安全/状态关键面发请求断言。
 * 测试仓库：svngit-test/git-repo（setup/teardown 均硬重置到固定提交,保证可重复）。
 * 覆盖本轮回归重点：路径越界拦截 ×6、CSRF、localhost 放行、软删 keep、写后缓存失效、核心数据结构。 */
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { run } from '../dist/vcs/exec.js';
import { startServer } from '../dist/server.js';

// 测试仓库位置（与 vcs-test.mjs 同一约定）
const TEST_BASE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'svngit-test');
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
  await run('git', ['config', 'user.email', 'test@svngit.local'], { cwd: GIT_DIR });
  await run('git', ['config', 'user.name', 'svngit-test'], { cwd: GIT_DIR });
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
process.env.SVNGIT_REPO_DIR = GIT_DIR;

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

  // ---------- 5.1 重命名：版本化 git mv + 磁盘改名 fs-move ----------
  {
    // vcs 重命名：版本化文件
    const f = 'api-move-old.txt';
    fs.writeFileSync(path.join(GIT_DIR, f), 'mv');
    await post('/api/add', { paths: [f] });
    const mv = await post('/api/move', { from: f, to: 'api-move-new.txt' });
    check('git mv API 成功', mv.code === 200 && mv.body.ok === true, mv.body?.message);
    check('git mv API 磁盘新名存在', fs.existsSync(path.join(GIT_DIR, 'api-move-new.txt')));
    check('git mv API 磁盘旧名不存在', !fs.existsSync(path.join(GIT_DIR, f)));
    const bad = await post('/api/move', { from: f, to: '../escape.txt' });
    check('git mv API 越界 400', bad.code === 400);
    const same = await post('/api/move', { from: 'api-move-new.txt', to: 'api-move-new.txt' });
    check('git mv API 同路径 400', same.code === 400);
    const dup = await post('/api/move', { from: 'api-move-new.txt', to: 'readme.md' });
    check('git mv API 目标已存在报错', dup.code === 200 && dup.body.ok === false);
    // 清理（索引还原 + 删文件）
    await run('git', ['reset', '-q', 'HEAD', '--', 'api-move-new.txt'], { cwd: GIT_DIR });
    fs.rmSync(path.join(GIT_DIR, 'api-move-new.txt'), { force: true });

    // 磁盘改名：未版本化文件（状态不变仍 ?）
    const uf = 'api-fsmove-old.txt';
    fs.writeFileSync(path.join(GIT_DIR, uf), 'x');
    const fmv = await post('/api/fs-move', { from: uf, to: 'api-fsmove-new.txt' });
    check('fs-move API 成功', fmv.code === 200 && fmv.body.ok === true, fmv.body?.message);
    check('fs-move API 磁盘新名存在', fs.existsSync(path.join(GIT_DIR, 'api-fsmove-new.txt')));
    const dupF = await post('/api/fs-move', { from: 'api-fsmove-new.txt', to: 'readme.md' });
    check('fs-move API 目标已存在 400', dupF.code === 400);
    const badge = await get('/api/status');
    check('fs-move 后状态仍 ?', badge.code === 200 && badge.body.items.some((i) => i.path === 'api-fsmove-new.txt' && i.code === '?'));
    fs.rmSync(path.join(GIT_DIR, 'api-fsmove-new.txt'), { force: true });
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
    process.env.SVNGIT_REPO_DIR = SVN_DIR;
    const nc = await get('/api/net-check');
    check(
      'SVN net-check 正常（ok=true, reason=网络正常）',
      nc.code === 200 && nc.body.ok === true && nc.body.reason === '网络正常',
      `ok=${nc.body.ok} reason=${nc.body.reason}`
    );
    // svn 缺失条目（磁盘删除已跟踪文件/目录 → status '!' missing）→ /api/fs miss 行 + revert 恢复
    {
      const svnDel = path.join(SVN_DIR, 'readme.md');
      if (fs.existsSync(svnDel)) fs.rmSync(svnDel, { force: true });
      const fsSvn = await get('/api/fs?dir=&force=1');
      const svnEntry = fsSvn.body.entries?.find((e) => e.name === 'readme.md');
      check(
        'svn 缺失文件显示 ! + miss 标记',
        fsSvn.code === 200 && svnEntry?.code === '!' && svnEntry?.miss === true && svnEntry?.isDir === false,
        `entry=${JSON.stringify(svnEntry)}`,
      );
      const svnRev = await post('/api/revert', { paths: ['readme.md'] });
      check('svn 缺失文件还原成功（svn revert 拉回）', svnRev.code === 200 && svnRev.body.ok === true, `msg=${svnRev.body.message}`);
      check('svn 还原后文件回到磁盘', fs.existsSync(svnDel));
      const fsSvn2 = await get('/api/fs?dir=');
      const svnEntry2 = fsSvn2.body.entries?.find((e) => e.name === 'readme.md');
      check('svn 还原后 miss 行消失（回到干净）', fsSvn2.code === 200 && !svnEntry2?.miss, `entry=${JSON.stringify(svnEntry2)}`);
      // 缺失文件"从版本库删除"（有意删除未走移除流程）：svn delete --keep-local → 显示 D 调度行 → revert 可恢复
      if (fs.existsSync(svnDel)) fs.rmSync(svnDel, { force: true });
      const delSvn = await post('/api/delete', { paths: ['readme.md'] });
      check('svn 缺失文件从版本库删除成功', delSvn.code === 200 && delSvn.body.ok === true, `msg=${delSvn.body.message}`);
      const fsSvnD = await get('/api/fs?dir=&force=1');
      const svnD = fsSvnD.body.entries?.find((e) => e.name === 'readme.md');
      check('svn 删除后显示 D 调度行（非 miss）', fsSvnD.code === 200 && svnD?.code === 'D' && !svnD?.miss, `entry=${JSON.stringify(svnD)}`);
      const svnRevD = await post('/api/revert', { paths: ['readme.md'] });
      check('svn 从版本库删除后可再还原', svnRevD.code === 200 && svnRevD.body.ok === true && fs.existsSync(svnDel), `msg=${svnRevD.body.message}`);
      // 缺失目录（kind=dir '!'）：目录整棵磁盘删除 → revert 走 --depth infinity（isDir 判定用状态 kind 兜底）
      const svnDir = path.join(SVN_DIR, 'src');
      if (fs.existsSync(svnDir)) fs.rmSync(svnDir, { recursive: true, force: true });
      const fsSvnDir = await get('/api/fs?dir=&force=1');
      const svnDirEntry = fsSvnDir.body.entries?.find((e) => e.name === 'src');
      check(
        'svn 缺失目录显示 ! miss（isDir=true）',
        fsSvnDir.code === 200 && svnDirEntry?.code === '!' && svnDirEntry?.miss === true && svnDirEntry?.isDir === true,
        `entry=${JSON.stringify(svnDirEntry)}`,
      );
      const svnDirRev = await post('/api/revert', { paths: ['src'] });
      check('svn 缺失目录还原成功（--depth infinity）', svnDirRev.code === 200 && svnDirRev.body.ok === true, `msg=${svnDirRev.body.message}`);
      check('svn 目录还原后回到磁盘', fs.existsSync(svnDir));
      const fsSvnDir2 = await get('/api/fs?dir=');
      const svnDirEntry2 = fsSvnDir2.body.entries?.find((e) => e.name === 'src');
      check('svn 缺失目录还原后 miss 行消失', fsSvnDir2.code === 200 && !svnDirEntry2?.miss, `entry=${JSON.stringify(svnDirEntry2)}`);
    }
  } else {
    console.log('⚠️ 跳过 SVN net-check 断言（svn-wc 不存在,先跑 vcs-test 生成）');
  }
  // ---------- 8. 模块索引（md 文件说明注入）：注入/勾选过滤/清除 ----------
  {
    // 第 7 段 SVN 检查切换过 SVNGIT_REPO_DIR，本段恢复 git 仓库
    process.env.SVNGIT_REPO_DIR = GIT_DIR;
    fs.writeFileSync(
      path.join(GIT_DIR, 'api-index-demo.md'),
      `# Api Index Demo
\`\`\`
api-index-demo.md   ← 测试 md 自身
src/
├── app.js          ← 测试应用入口
└── helper.js       ← 测试辅助函数
\`\`\`
| util.js | 测试工具 |
`
    );
    const idxFile = path.join(GIT_DIR, 'api-index-demo.md');
    const preview = await get(`/api/module-index/preview?md=${encodeURIComponent('api-index-demo.md')}`);
    check(
      'module-index preview 解析树图+表格（层级：src/app.js）',
      preview.code === 200 && preview.body.entries?.length === 4 && preview.body.entries.some((e) => e.path === 'src/app.js'),
      `code=${preview.code} entries=${preview.body.entries?.length}`
    );
    const inj = await post('/api/module-index', { dir: '', md: 'api-index-demo.md', included: null });
    check('module-index 注入成功（全保留 4 条）', inj.code === 200 && inj.body.ok === true && inj.body.count === 4, `count=${inj.body.count}`);
    const rd = await get('/api/module-index');
    check(
      'module-index 读取命中（src/app.js → 描述）',
      rd.code === 200 && rd.body.indexes?.['']?.entries?.some((e) => e.path === 'src/app.js' && e.desc.includes('应用入口')),
    );
    const inj2 = await post('/api/module-index', { dir: '', md: 'api-index-demo.md', included: ['util.js'] });
    check('module-index 更新（勾选过滤为 1 条）', inj2.code === 200 && inj2.body.count === 1, `count=${inj2.body.count}`);
    const rd2 = await get('/api/module-index');
    check('module-index 过滤后读取（仅 util.js）', rd2.code === 200 && rd2.body.indexes?.['']?.entries?.length === 1 && rd2.body.indexes[''].entries[0].path === 'util.js');
    const clear = await post('/api/module-index/clear', { dir: '' });
    check('module-index 清除成功', clear.code === 200 && clear.body.ok === true);
    const rd3 = await get('/api/module-index');
    check('module-index 清除后为空', rd3.code === 200 && (rd3.body.indexes?.[''] ?? null) === null);
    fs.rmSync(idxFile, { force: true });
  }
  // ---------- 9. 忽略三向（git）：.gitignore 与 .git/info/exclude 写入/删除（global 涉及用户全局配置，不在此测） ----------
  {
    // target=exclude：写入测试仓库 .git/info/exclude
    const demoFile = path.join(GIT_DIR, 'api-exclude-demo.txt');
    fs.writeFileSync(demoFile, 'x');
    const ex1 = await post('/api/ignore', { path: '', pattern: 'api-exclude-demo.txt', target: 'exclude' });
    check('ignore exclude 写入成功', ex1.code === 200 && ex1.body.ok === true && /info\/exclude/.test(ex1.body.message), `msg=${ex1.body.message}`);
    // 渲染侧兜底：status 无条目文件（exclude 来源）→ /api/fs 标 I（三来源检测回归：此前只认 .gitignore）
    const fsI = await get('/api/fs?dir=');
    check(
      '/api/fs 对 exclude 忽略文件标 I（非 √）',
      fsI.code === 200 && fsI.body.entries?.some((e) => e.name === 'api-exclude-demo.txt' && e.code === 'I'),
      `code=${JSON.stringify(fsI.body.entries?.find((e) => e.name === 'api-exclude-demo.txt')?.code)}`,
    );
    const rd = await get('/api/ignore');
    check(
      'ignore GET 含来源（sources 标 .git/info/exclude）',
      rd.code === 200 && rd.body.rules?.includes('api-exclude-demo.txt') && rd.body.sources?.some((s) => s.pattern === 'api-exclude-demo.txt' && s.where.includes('info/exclude')),
    );
    // target=gitignore（默认）写入仓库 .gitignore
    const gi1 = await post('/api/ignore', { path: '', pattern: 'api-gitignore-demo.txt' });
    check('ignore .gitignore 写入成功', gi1.code === 200 && gi1.body.ok === true && /\.gitignore/.test(gi1.body.message), `msg=${gi1.body.message}`);
    // 删除：ignore-remove 扫三处（exclude 中的规则）
    const rm1 = await post('/api/ignore-remove', { path: '', pattern: 'api-exclude-demo.txt' });
    check('ignore-remove 删除（扫到 exclude）', rm1.code === 200 && rm1.body.ok === true && /info\/exclude/.test(rm1.body.message), `msg=${rm1.body.message}`);
    const rm2 = await post('/api/ignore-remove', { path: '', pattern: 'api-gitignore-demo.txt' });
    check('ignore-remove 删除（.gitignore）', rm2.code === 200 && rm2.body.ok === true, `msg=${rm2.body.message}`);
    fs.rmSync(demoFile, { force: true });

    // 循环守卫：忽略→取消（! 行真实写入测试仓库）→再忽略（清 ! 重写，非"规则已存在"）
    const cyc = await post('/api/ignore', { path: '', pattern: 'api-cyc-demo.txt', target: 'exclude' });
    check('循环-1 忽略写入', cyc.code === 200 && cyc.body.ok === true, `msg=${cyc.body.message}`);
    const cycU = await post('/api/unignore', { path: 'api-cyc-demo.txt' });
    const mockExclude = fs.readFileSync(path.join(GIT_DIR, '.git', 'info', 'exclude'), 'utf8');
    const mainExclude = path.join(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), '.git', 'info', 'exclude');
    check(
      '循环-2 取消忽略写对仓库（! 行入测试仓库且不污染主仓库）',
      cycU.code === 200 && cycU.body.ok === true &&
        mockExclude.split('\n').some((l) => l.trim() === '!api-cyc-demo.txt') &&
        (!fs.existsSync(mainExclude) || !fs.readFileSync(mainExclude, 'utf8').includes('api-cyc-demo')),
    );
    const cyc2 = await post('/api/ignore', { path: '', pattern: 'api-cyc-demo.txt', target: 'exclude' });
    const mockExclude2 = fs.readFileSync(path.join(GIT_DIR, '.git', 'info', 'exclude'), 'utf8').split('\n').filter((l) => l.includes('api-cyc-demo'));
    // 有效判定标准：! 行已清（文件仅剩正规则）且 git 判定确实忽略——正规则已存在时提示"已恢复生效"同样算成功
    const igCyc = await run('git', ['check-ignore', '-q', '--', 'api-cyc-demo.txt'], { cwd: GIT_DIR });
    check(
      '循环-3 再忽略生效（! 清掉且 git 判定忽略）',
      cyc2.code === 200 && cyc2.body.ok === true &&
        mockExclude2.length === 1 && mockExclude2[0] === 'api-cyc-demo.txt' && igCyc.code === 0,
      `msg=${cyc2.body.message}`,
    );
    const cycRm = await post('/api/ignore-remove', { path: '', pattern: 'api-cyc-demo.txt' });
    check('循环-4 清理', cycRm.code === 200 && cycRm.body.ok === true, `msg=${cycRm.body.message}`);
    // 跨档取反治理：高层 .gitignore 的 !（优先级高于 exclude）→ target=exclude 忽略应清掉它并生效
    const gifile = path.join(GIT_DIR, '.gitignore');
    const giOrig = fs.readFileSync(gifile, 'utf8');
    fs.writeFileSync(gifile, giOrig.replace(/\n*$/, '') + '\n!api-cyc2-demo.txt\n');
    const c3 = await post('/api/ignore', { path: '', pattern: 'api-cyc2-demo.txt', target: 'exclude' });
    const giAfter = fs.readFileSync(gifile, 'utf8');
    const ig = await run('git', ['check-ignore', '-q', '--', 'api-cyc2-demo.txt'], { cwd: GIT_DIR });
    check(
      '跨档取反被清（高层 ! 移除且 git 判定忽略）',
      c3.code === 200 && c3.body.ok === true && !giAfter.includes('!api-cyc2-demo') && ig.code === 0,
      `msg=${c3.body.message} checkIgnoreCode=${ig.code}`,
    );
    fs.writeFileSync(gifile, giOrig); // 还原 .gitignore 原始内容
    const c3Rm = await post('/api/ignore-remove', { path: '', pattern: 'api-cyc2-demo.txt' });
    check('跨档取反清理', c3Rm.code === 200 && c3Rm.body.ok === true, `msg=${c3Rm.body.message}`);
  }
  // ---------- 10. 目录全忽略 → I（.claude 场景：目录名不命中规则,内部文件全部被忽略） ----------
  {
    const gif = path.join(GIT_DIR, '.gitignore');
    const giBackup = fs.readFileSync(gif, 'utf8');
    fs.writeFileSync(gif, giBackup.replace(/\n*$/, '') + '\n*.local.json\n');
    fs.mkdirSync(path.join(GIT_DIR, 'cfg-dir'), { recursive: true });
    fs.writeFileSync(path.join(GIT_DIR, 'cfg-dir', 'settings.local.json'), '{}');
    const fsDir = await get('/api/fs?dir=');
    check(
      '目录全忽略显示 I（.claude 场景）',
      fsDir.code === 200 && fsDir.body.entries?.some((e) => e.name === 'cfg-dir' && e.code === 'I'),
      `code=${JSON.stringify(fsDir.body.entries?.find((e) => e.name === 'cfg-dir')?.code)}`,
    );
    fs.rmSync(path.join(GIT_DIR, 'cfg-dir'), { recursive: true, force: true });
    fs.writeFileSync(gif, giBackup);
  }

  // ---------- 11. 磁盘缺失条目（git " D" → '!'）：/api/fs 合并 miss 行 + revert 拉回 ----------
  {
    const delFile = path.join(GIT_DIR, 'del.txt');
    if (fs.existsSync(delFile)) fs.rmSync(delFile, { force: true });
    const fsRoot = await get('/api/fs?dir=&force=1');
    const entry = fsRoot.body.entries?.find((e) => e.name === 'del.txt');
    check(
      'git 缺失文件显示 ! + miss 标记',
      fsRoot.code === 200 && entry?.code === '!' && entry?.miss === true,
      `entry=${JSON.stringify(entry)}`,
    );
    const rev = await post('/api/revert', { paths: ['del.txt'] });
    check('git 缺失文件还原成功（checkout 拉回）', rev.code === 200 && rev.body.ok === true, `msg=${rev.body.message}`);
    check('git 还原后文件回到磁盘', fs.existsSync(delFile));
    const fsRoot2 = await get('/api/fs?dir=');
    const entry2 = fsRoot2.body.entries?.find((e) => e.name === 'del.txt');
    check('git 还原后 miss 行消失（回到干净）', fsRoot2.code === 200 && !entry2?.miss && (entry2?.code ?? '') === '', `entry=${JSON.stringify(entry2)}`);
    // 缺失文件"从版本库删除"（有意删除未走移除流程）：git rm --cached 只清索引、不碰磁盘 → 行消失
    if (fs.existsSync(delFile)) fs.rmSync(delFile, { force: true });
    const del2 = await post('/api/delete', { paths: ['del.txt'] });
    check('git 缺失文件从版本库删除成功', del2.code === 200 && del2.body.ok === true, `msg=${del2.body.message}`);
    const fsRootD = await get('/api/fs?dir=');
    const entryD = fsRootD.body.entries?.find((e) => e.name === 'del.txt');
    check('git 删除后缺失行消失（版本库记录已清）', fsRootD.code === 200 && (entryD === undefined || !entryD?.miss), `entry=${JSON.stringify(entryD)}`);
    // 删除后仍可改主意：HEAD 还在，还原可拉回文件
    const rev2 = await post('/api/revert', { paths: ['del.txt'] });
    check('git 从版本库删除后可再还原（HEAD 仍在）', rev2.code === 200 && rev2.body.ok === true && fs.existsSync(delFile), `msg=${rev2.body.message}`);
    const fsRoot3 = await get('/api/fs?dir=');
    check('git 再还原后干净', fsRoot3.code === 200 && (fsRoot3.body.entries?.find((e) => e.name === 'del.txt')?.code ?? '') === '', `entry=${JSON.stringify(fsRoot3.body.entries?.find((e) => e.name === 'del.txt'))}`);
  }
} finally {
  // ---------- teardown：重置仓库,仅保留 api 测试文件之外的状态 ----------
  process.env.SVNGIT_REPO_DIR = GIT_DIR;
  const b4t = await run('git', ['cat-file', '-t', GIT_BASE_COMMIT], { cwd: GIT_DIR });
  await run('git', ['reset', '-q', '--hard', b4t.code === 0 ? GIT_BASE_COMMIT : 'HEAD'], { cwd: GIT_DIR });
  fs.rmSync(path.join(GIT_DIR, 'api-cache-test.txt'), { force: true });
  fs.rmSync(path.join(GIT_DIR, 'api-keep-test.txt'), { force: true });
  await handle.close();
}

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
