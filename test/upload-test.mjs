/** 拖入上传接口测试：落盘 / 目录结构保留 / 三种冲突策略 / 越界拒绝 / 二进制完整性。
 *  用独立的 svngit-test/upload-repo（每次重建），不干扰 api-test 的 git-repo fixture。 */
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { run } from '../dist/vcs/exec.js';
import { startServer } from '../dist/server/index.js';

const TEST_BASE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'svngit-test');
const REPO = path.join(TEST_BASE, 'upload-repo');

let pass = 0;
let fail = 0;
function check(name, cond, extra = '') {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ' | ' + extra : ''}`);
  if (cond) pass++;
  else fail++;
}

// ---------- setup：重建独立测试仓库 ----------
fs.rmSync(REPO, { recursive: true, force: true });
fs.mkdirSync(REPO, { recursive: true });
await run('git', ['init', '-q'], { cwd: REPO });
await run('git', ['config', 'user.email', 'upload-test@svngit.local'], { cwd: REPO });
await run('git', ['config', 'user.name', 'upload-test'], { cwd: REPO });
fs.writeFileSync(path.join(REPO, 'keep.txt'), 'keep\n');
await run('git', ['add', '-A'], { cwd: REPO });
await run('git', ['commit', '-qm', 'init'], { cwd: REPO });

process.env.SVNGIT_REPO_DIR = REPO;
const handle = await startServer();
const B = `http://127.0.0.1:${handle.port}`;
const read = (rel) => {
  const p = path.join(REPO, rel);
  return fs.existsSync(p) ? fs.readFileSync(p) : null;
};

/** 上传一个文件（body 原样传字节） */
const upload = async (dir, rel, content, mode = 'overwrite') => {
  const qs = `dir=${encodeURIComponent(dir)}&path=${encodeURIComponent(rel)}&mode=${mode}`;
  const r = await fetch(`${B}/api/upload?${qs}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: content,
  });
  return { code: r.status, body: await r.json().catch(() => ({})) };
};
const checkConflicts = async (dir, paths) => {
  const r = await fetch(`${B}/api/upload-check`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dir, paths }),
  });
  return { code: r.status, body: await r.json().catch(() => ({})) };
};

try {
  // ---------- 1. 基本上传 ----------
  let r = await upload('', 'a.txt', 'hello upload\n');
  check('基本上传 200 且落盘', r.code === 200 && r.body.ok === true, `code=${r.code} body=${JSON.stringify(r.body)}`);
  check('基本上传内容正确', read('a.txt')?.toString() === 'hello upload\n');

  // ---------- 2. 目录结构保留（拖入文件夹时前端把相对路径放进 path） ----------
  r = await upload('', 'sub/deep/b.txt', 'nested\n');
  check('子目录自动创建并落盘', r.code === 200 && read('sub/deep/b.txt')?.toString() === 'nested\n', `code=${r.code}`);

  // ---------- 3. 冲突预检 ----------
  let c = await checkConflicts('', ['a.txt', 'brand-new.txt', 'sub/deep/b.txt']);
  check(
    '预检只报已存在的',
    c.code === 200 && c.body.conflicts.length === 2 && c.body.conflicts.includes('a.txt') && c.body.conflicts.includes('sub/deep/b.txt'),
    `conflicts=${JSON.stringify(c.body.conflicts)}`,
  );

  // ---------- 4. 三种冲突策略 ----------
  r = await upload('', 'a.txt', 'OVERWRITTEN\n', 'overwrite');
  check('overwrite 覆盖成功', r.code === 200 && read('a.txt')?.toString() === 'OVERWRITTEN\n');

  r = await upload('', 'a.txt', 'SHOULD-NOT-WIN\n', 'skip');
  check('skip 不改动原文件', r.code === 200 && r.body.skipped === true && read('a.txt')?.toString() === 'OVERWRITTEN\n', `code=${r.code}`);

  r = await upload('', 'a.txt', 'RENAMED\n', 'rename');
  check(
    'rename 生成 a (1).txt 且原文件不动',
    r.code === 200 && read('a (1).txt')?.toString() === 'RENAMED\n' && read('a.txt')?.toString() === 'OVERWRITTEN\n',
    `savedAs=${r.body.savedAs}`,
  );

  // ---------- 5. 越界拒绝 ----------
  r = await upload('', '../outside.txt', 'evil');
  check('path 含 ../ 越界被拒（403）', r.code === 403, `code=${r.code}`);
  r = await upload('', '/tmp/abs-evil.txt', 'evil');
  check('path 绝对路径被拒（403）', r.code === 403, `code=${r.code}`);
  r = await upload('', '', 'evil');
  check('path 为空被拒（403）', r.code === 403, `code=${r.code}`);
  r = await upload('../', 'x.txt', 'evil');
  check('dir 越界被拒（403）', r.code === 403, `code=${r.code}`);
  c = await checkConflicts('', ['../outside.txt']);
  check('预检同样拦截越界（403）', c.code === 403, `code=${c.code}`);
  check('越界文件未落盘', !fs.existsSync(path.join(TEST_BASE, 'outside.txt')) && !fs.existsSync('/tmp/abs-evil.txt'));

  // ---------- 打包版快路径 /api/copy-into：源已在磁盘上，直接 fs.cp ----------
  const SRC = path.join(os.tmpdir(), 'svngit-copy-src');
  fs.rmSync(SRC, { recursive: true, force: true });
  fs.mkdirSync(path.join(SRC, 'tree/inner'), { recursive: true });
  fs.writeFileSync(path.join(SRC, 'one.txt'), 'ONE\n');
  fs.writeFileSync(path.join(SRC, 'tree/a.sh'), '#!/bin/sh\necho hi\n', { mode: 0o755 });
  fs.writeFileSync(path.join(SRC, 'tree/inner/b.txt'), 'BBB\n');
  const copyInto = async (dir, src, rel, mode = 'overwrite') => {
    const r = await fetch(`${B}/api/copy-into`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dir, src, path: rel, mode }),
    });
    return { code: r.status, body: await r.json().catch(() => ({})) };
  };

  let cp = await copyInto('', path.join(SRC, 'one.txt'), 'copied.txt');
  check('copy-into 复制单文件', cp.code === 200 && read('copied.txt')?.toString() === 'ONE\n', `code=${cp.code}`);
  cp = await copyInto('', path.join(SRC, 'tree'), 'tree');
  check(
    'copy-into 整树复制（含子目录）',
    cp.code === 200 && read('tree/inner/b.txt')?.toString() === 'BBB\n' && read('tree/a.sh') !== null,
    `code=${cp.code}`,
  );
  check(
    'copy-into 保留可执行位（走 HTTP 上传会丢）',
    (fs.statSync(path.join(REPO, 'tree/a.sh')).mode & 0o777) === 0o755,
    `mode=${(fs.statSync(path.join(REPO, 'tree/a.sh')).mode & 0o777).toString(8)}`,
  );
  cp = await copyInto('', path.join(SRC, 'one.txt'), 'copied.txt', 'skip');
  check('copy-into skip 不覆盖', cp.body.skipped === true && read('copied.txt')?.toString() === 'ONE\n');
  fs.writeFileSync(path.join(SRC, 'one.txt'), 'ONE-V2\n');
  cp = await copyInto('', path.join(SRC, 'one.txt'), 'copied.txt', 'overwrite');
  check('copy-into overwrite 覆盖', cp.code === 200 && read('copied.txt')?.toString() === 'ONE-V2\n');
  cp = await copyInto('', path.join(SRC, 'one.txt'), 'copied.txt', 'rename');
  check('copy-into rename 生成 (1)', cp.code === 200 && read('copied (1).txt')?.toString() === 'ONE-V2\n', `savedAs=${cp.body.savedAs}`);

  cp = await copyInto('', path.join(SRC, 'nope.txt'), 'x.txt');
  check('copy-into 源不存在被拒（400）', cp.code === 400, `code=${cp.code}`);
  cp = await copyInto('', 'relative/path.txt', 'x.txt');
  check('copy-into 源非绝对路径被拒（400）', cp.code === 400, `code=${cp.code}`);
  cp = await copyInto('', path.join(SRC, 'one.txt'), '../escape.txt');
  check('copy-into 目标越界被拒（403）', cp.code === 403, `code=${cp.code}`);
  cp = await copyInto('', REPO, 'self');
  check('copy-into 拒绝复制到自己里面（400）', cp.code === 400, `code=${cp.code}`);
  fs.rmSync(SRC, { recursive: true, force: true });

  // ---------- 6. 二进制与空文件 ----------
  const bin = Buffer.from([0x00, 0x01, 0xff, 0xfe, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);
  r = await upload('', 'img/binary.bin', bin);
  check('二进制字节完整落盘', r.code === 200 && Buffer.compare(read('img/binary.bin'), bin) === 0, `code=${r.code}`);

  r = await upload('', 'empty.txt', '');
  check('空文件落盘为 0 字节', r.code === 200 && read('empty.txt')?.length === 0, `code=${r.code}`);

  // ---------- 7. 落地后是未跟踪状态（不自动 add——前端不调 add 接口，后端也不该动 index） ----------
  const st = await run('git', ['status', '--porcelain=v1'], { cwd: REPO });
  const lines = st.stdout.split('\n').filter(Boolean);
  const tracked = lines.filter((l) => !l.startsWith('??'));
  check('上传的文件均为未跟踪 ?（未进 index）', lines.length > 0 && tracked.length === 0, `status=${JSON.stringify(lines.slice(0, 4))}`);

  // ---------- 8. 覆盖时不残留临时文件 ----------
  const leftovers = fs.readdirSync(REPO).filter((f) => f.includes('.tmp') || f.includes('.part'));
  check('无临时/半截文件残留', leftovers.length === 0, leftovers.join(','));
} catch (e) {
  console.error('❌ 测试异常:', e);
  fail++;
} finally {
  fs.rmSync(REPO, { recursive: true, force: true }); // 清理测试仓库
  fs.rmSync(path.join(TEST_BASE, 'outside.txt'), { force: true });
}

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
