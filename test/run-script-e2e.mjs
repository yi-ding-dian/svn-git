/** 「终端运行」Windows 端到端验证（手动跑，不进 npm test / CI）：
 *  为什么手动：正例会真的弹系统终端窗口（.sh 跑完按设计留一个 bash 窗口，需手动关），
 *  无头 CI 既没有终端模拟器、也不该弹窗——所以只把「拒绝侧」进 api-test（CI 安全）。
 *
 *  运行：npm run build && node test/run-script-e2e.mjs
 *  做什么：自起服务（SVNGIT_REPO_DIR=仓库根，23456 被占自动换随机端口），对真实 /api/run-script
 *  发请求，断言 .bat / .sh 真的执行（marker 落盘）+ 三类拒绝（非脚本 / 不存在 / 越界）。
 *  探针放 svngit-test/ 下（gitignore，不污染仓库）；跑完保留 marker 供人眼核对，下次运行前自动清。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
// 目录名故意带空格 + 中文：覆盖路径引用的回归（拼错一个引号就会露馅）
const PROBE_DIR = path.join(ROOT, 'svngit-test', 'run-script 探针');
const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');

process.env.SVNGIT_REPO_DIR = ROOT;
const { startServer } = await import(pathToFileURL(path.join(ROOT, 'dist', 'server', 'index.js')).href);

// ---------- 探针（每次重建，避免上次状态漂移） ----------
fs.rmSync(PROBE_DIR, { recursive: true, force: true });
fs.mkdirSync(PROBE_DIR, { recursive: true });
// .bat 用 CRLF（cmd 对 LF 换行的批处理容错性差）
fs.writeFileSync(path.join(PROBE_DIR, 'probe.bat'), '@echo off\r\necho bat-ran > "%~dp0bat-marker.txt"\r\nexit\r\n');
fs.writeFileSync(path.join(PROBE_DIR, 'probe.sh'), '#!/bin/sh\necho sh-ran > "$(dirname "$0")/sh-marker.txt"\n');
fs.writeFileSync(path.join(PROBE_DIR, 'not-script.txt'), 'plain\n');

let pass = 0;
let fail = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ' | ' + extra : ''}`);
  if (cond) pass++;
  else fail++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFile = async (f, ms = 10000) => {
  for (let i = 0; i < ms / 250 && !fs.existsSync(f); i++) await sleep(250);
  return fs.existsSync(f);
};

// 测试只要"随便一个能用的端口"：别去接管 23456（那会把用户正在用的实例关掉）
process.env.SVNGIT_NO_PORT_TAKEOVER = '1';
const handle = await startServer();
const post = async (p, body) => {
  const r = await fetch(`http://127.0.0.1:${handle.port}` + p, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { code: r.status, body: await r.json().catch(() => ({})) };
};

try {
  console.log('== 「终端运行」端到端（注意：会弹真实终端窗口）==');
  // 1) .bat（路径含中文 + 空格；probe.bat 记 marker 后退出，窗口自关）
  const bat = await post('/api/run-script', { path: rel(path.join(PROBE_DIR, 'probe.bat')) });
  check('POST /api/run-script (.bat) 200 + ok', bat.code === 200 && bat.body.ok === true, JSON.stringify(bat.body));
  check('.bat 实际执行（bat-marker.txt 落盘）', await waitFile(path.join(PROBE_DIR, 'bat-marker.txt')));

  // 2) .sh（Git Bash；跑完 exec bash 留窗——属设计行为，测完手动关）
  const sh = await post('/api/run-script', { path: rel(path.join(PROBE_DIR, 'probe.sh')) });
  check('POST /api/run-script (.sh) 200 + ok', sh.code === 200 && sh.body.ok === true, JSON.stringify(sh.body));
  check('.sh 实际执行（sh-marker.txt 落盘）', await waitFile(path.join(PROBE_DIR, 'sh-marker.txt')));

  // 3) 三类拒绝（与 api-test 同断言，这里是独立复核；文案按平台不同，不比较）
  const bad = await post('/api/run-script', { path: rel(path.join(PROBE_DIR, 'not-script.txt')) });
  check('非脚本类型 500 + ok:false', bad.code === 500 && bad.body.ok === false, JSON.stringify(bad.body));
  const nf = await post('/api/run-script', { path: rel(PROBE_DIR) + '/no-such.bat' });
  check('不存在的文件 404', nf.code === 404, JSON.stringify(nf.body));
  const esc = await post('/api/run-script', { path: '../escape.bat' });
  check('路径越界 400', esc.code === 400, JSON.stringify(esc.body));
} finally {
  await handle.close();
  console.log(`\n结果: ${pass} 通过, ${fail} 失败  |  探针目录: ${rel(PROBE_DIR)}`);
  process.exit(fail ? 1 : 0);
}
