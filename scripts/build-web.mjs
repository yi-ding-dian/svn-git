/** 前端构建：esbuild bundle + 复制静态文件到 dist/web；--watch 为热构建模式（开发） */
import { build, context } from 'esbuild';
import fs from 'node:fs';

const WATCH = process.argv.includes('--watch');

fs.mkdirSync('dist/web', { recursive: true });

/** 复制静态文件 */
function copyStatic() {
  fs.copyFileSync('src/web/index.html', 'dist/web/index.html');
  fs.copyFileSync('src/web/style.css', 'dist/web/style.css');
  fs.copyFileSync('build/icon.png', 'dist/web/icon.png');
  fs.copyFileSync('src/preload.cjs', 'dist/preload.cjs'); // Electron preload
}
copyStatic();

const OPTIONS = {
  entryPoints: ['src/web/main.tsx'],
  bundle: true,
  outfile: 'dist/web/app.js',
  format: 'iife',
  minify: !WATCH,
  target: ['es2020'],
  logLevel: 'warning',
  define: { __DEV__: WATCH ? 'true' : 'false' },
};

if (!WATCH) {
  await build(OPTIONS);
  copyStatic();
  console.log('✅ 前端构建完成: dist/web/');
} else {
  // 开发热构建：context API + fs.watch 监听源码/静态文件变化 → 重建 + 复制
  const ctx = await context(OPTIONS);
  let building = false;
  const rebuild = async (reason) => {
    if (building) return;
    building = true;
    try {
      await ctx.rebuild();
      copyStatic();
      console.log(`✅ 前端已重建（${reason}），浏览器将自动刷新`);
    } catch (err) {
      console.error('❌ 构建失败:', err);
    } finally {
      building = false;
    }
  };
  let timer = null;
  const schedule = (reason) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void rebuild(reason), 300);
  };
  fs.watch('src/web', (ev, name) => {
    if (name) schedule(name);
  });
  fs.watch('build', (ev, name) => {
    if (name === 'icon.png') schedule('图标更新');
  });
  await ctx.rebuild();
  copyStatic();
  console.log('👀 前端热构建模式运行中（改代码自动重建，浏览器自动刷新）…');
}
