/** 开发模式：后端 tsc 监听编译 + node --watch 热重启 + 前端 esbuild 热构建（浏览器自动刷新） */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// 固定以项目根为工作目录（无论从哪里调用）
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

console.log('🚀 开发模式启动…（Ctrl+C 退出全部）');

const children = [];
function run(name, cmd, args, delay = 0) {
  setTimeout(() => {
    const p = spawn(cmd, args, { stdio: 'inherit', cwd: ROOT, shell: false });
    children.push(p);
    p.on('exit', (code) => {
      if (code !== null && code !== 0 && code !== 130 && code !== 143) {
        console.error(`❌ ${name} 异常退出（${code}）`);
      }
    });
    console.log(`▶ ${name} 已启动`);
  }, delay);
}

// 1. 后端 TypeScript 监听编译（输出 dist，前端已从 tsconfig 排除避免覆盖 esbuild bundle）
run('tsc -w (server)', 'npx', ['tsc', '-w']);
// 1b. 前端 TypeScript 仅类型检查（noEmit，bundle 由 esbuild 负责）
run('tsc -w (web check)', 'npx', ['tsc', '-p', 'tsconfig.web.json', '-w', '--preserveWatchOutput'], 300);
// 2. 前端 esbuild 热构建
run('esbuild --watch', 'node', ['scripts/build-web.mjs', '--watch'], 600);
// 3. 后端服务热重启（等待首次编译完成）
run('node --watch server', 'node', ['--watch', 'dist/main.js'], 4000);

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    children.forEach((p) => p.kill('SIGTERM'));
    process.exit(0);
  });
}
