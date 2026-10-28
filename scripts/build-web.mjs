/** 前端构建：esbuild bundle + 复制静态文件到 dist/client；--watch 为热构建模式（开发） */
import { build, context } from 'esbuild';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const WATCH = process.argv.includes('--watch');

fs.mkdirSync('dist/client', { recursive: true });

/** 构建版本戳（YYYYMMDD-HHmm 本地时间）：注入 index.html 静态引用 ?v=，每次构建变化 →
 * 任何浏览器都无法命中旧缓存（配合服务端 Cache-Control: no-store 双保险） */
const BUILD_TAG = (() => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
})();

/** 版本号（package.json）：注入 index.html 的 %VERSION% —— 标签页标题显示 svn-git-V1.1.0 */
const VERSION = JSON.parse(fs.readFileSync('package.json', 'utf8')).version;

/** 复制静态文件 */
function copyStatic() {
  fs.copyFileSync('src/client/index.html', 'dist/client/index.html');
  // 样式 = 主样式 + 动画域（animations/animations.css，源文件域内独立、不堆进 style.css；拼接后仍单文件下发）
  const css = fs.readFileSync('src/client/style.css', 'utf8') + '\n' + fs.readFileSync('src/client/animations/animations.css', 'utf8');
  fs.writeFileSync('dist/client/style.css', css);
  fs.copyFileSync('build/icon.png', 'dist/client/icon.png');
  fs.copyFileSync('src/preload/index.cjs', 'dist/preload.cjs'); // Electron preload
  // index.html 的 %BUILD_TAG% 占位符替换为最新构建戳（每次复制后立即处理）；
  // %VERSION% 换成 package.json 版本（标签页/书签标题）
  const html = fs
    .readFileSync('dist/client/index.html', 'utf8')
    .replaceAll('%BUILD_TAG%', BUILD_TAG)
    .replaceAll('%VERSION%', VERSION);
  fs.writeFileSync('dist/client/index.html', html);
}
copyStatic();

const OPTIONS = {
  entryPoints: ['src/client/main.tsx'],
  bundle: true,
  outfile: 'dist/client/app.js',
  format: 'iife',
  minify: !WATCH,
  target: ['es2020'],
  logLevel: 'warning',
  define: { __DEV__: WATCH ? 'true' : 'false' },
};

if (!WATCH) {
  await build(OPTIONS);
  copyStatic();
  console.log('✅ 前端构建完成: dist/client/');
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
  fs.watch('src/client', (ev, name) => {
    if (name) schedule(name);
  });
  fs.watch('build', (ev, name) => {
    if (name === 'icon.png') schedule('图标更新');
  });
  await ctx.rebuild();
  copyStatic();
  console.log('👀 前端热构建模式运行中（改代码自动重建，浏览器自动刷新）…');
}

/** git 探测：拿不到就返回空串（没装 git / 不在仓库里都不能让构建挂掉） */
function gitOut(args) {
  try {
    return execFileSync('git', args, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return '';
  }
}

/** 构建信息（版本 + 日期 + 提交）：供「关于」弹窗展示（server /api/info 读取 dist/build-info.json）
 *
 *  版本号（package.json）是「发布语义」，构建标识（commit/dirty）是「这个包到底是哪次代码」——
 *  两者分开：版本号只在发版时人工变（npm version），日常打包靠 commit 区分，同名产物永远能对上代码。
 */
function writeBuildInfo() {
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  const info = {
    version: pkg.version,
    buildDate: new Date().toISOString().slice(0, 10),
    commit: gitOut(['rev-parse', '--short', 'HEAD']),
    // 只数已跟踪文件的改动（--untracked-files=no）：与 git describe --dirty 口径一致，
    // 免得好好的发布包被一个临时未跟踪文件标成脏
    dirty: gitOut(['status', '--porcelain', '--untracked-files=no']) !== '',
  };
  fs.writeFileSync('dist/build-info.json', JSON.stringify(info, null, 2) + '\n');
  const stamp = info.commit ? ` · ${info.commit}${info.dirty ? '*' : ''}` : '';
  console.log(`🕒 构建信息: v${info.version} · ${info.buildDate}${stamp}`);
}
writeBuildInfo();
