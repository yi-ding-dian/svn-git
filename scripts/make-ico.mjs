/** 生成 build/icon.ico（Windows 用）：从 build/icon.png 缩出多档尺寸，打包成 ICO。
 *
 *  用法: node_modules/.bin/electron scripts/make-ico.mjs
 *  （缩图用 Electron 自带的 nativeImage，不引第三方图像库——与项目"打包零额外依赖"一致）
 *
 *  ICO 容器格式：6 字节文件头 + 每档 16 字节目录项 + 各档图像数据。
 *  图像数据这里用 PNG 编码（Vista 起支持），比老式 BMP+掩码简单且体积小，
 *  且能保留圆角图标的透明通道。256 档在目录项里宽高记 0（格式规定）。
 */
import { app, nativeImage } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'build', 'icon.png');
const OUT = path.join(ROOT, 'build', 'icon.ico');
/** 常用档位：16/24/32 任务栏与列表，48/64 资源管理器，128/256 大图标与安装程序 */
const SIZES = [16, 24, 32, 48, 64, 128, 256];

app.whenReady().then(() => {
  const src = nativeImage.createFromPath(SRC);
  if (src.isEmpty()) {
    console.error(`❌ 读不到源图: ${SRC}`);
    app.exit(1);
    return;
  }
  const srcSize = src.getSize();
  if (Math.min(srcSize.width, srcSize.height) < 256) {
    console.error(`❌ 源图至少要有 256×256，当前 ${srcSize.width}×${srcSize.height}`);
    app.exit(1);
    return;
  }

  const pngs = SIZES.map((size) => ({
    size,
    buf: src.resize({ width: size, height: size, quality: 'best' }).toPNG(),
  }));

  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // 保留位
  header.writeUInt16LE(1, 2); // 类型：1 = 图标
  header.writeUInt16LE(pngs.length, 4);
  const dir = Buffer.alloc(16 * pngs.length);
  let offset = 6 + 16 * pngs.length;
  pngs.forEach((p, i) => {
    const o = i * 16;
    dir.writeUInt8(p.size >= 256 ? 0 : p.size, o); // 宽（256 记 0）
    dir.writeUInt8(p.size >= 256 ? 0 : p.size, o + 1); // 高
    dir.writeUInt8(0, o + 2); // 调色板数（PNG 档恒 0）
    dir.writeUInt8(0, o + 3); // 保留位
    dir.writeUInt16LE(1, o + 4); // 色彩平面
    dir.writeUInt16LE(32, o + 6); // 位深
    dir.writeUInt32LE(p.buf.length, o + 8);
    dir.writeUInt32LE(offset, o + 12);
    offset += p.buf.length;
  });

  fs.writeFileSync(OUT, Buffer.concat([header, dir, ...pngs.map((p) => p.buf)]));
  console.log(`✅ 已生成 build/icon.ico：${SIZES.join('/')} 共 ${pngs.length} 档，${fs.statSync(OUT).size} 字节`);
  app.exit(0);
});
