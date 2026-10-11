#!/bin/bash
# svn-git文件版本管理 打包脚本（electron-builder 方案）
# 产物：deploy/release/svn-git-1.0.0.AppImage
# 说明：内置 Electron 运行时，目标机无需安装 Node；svn/git 命令仍为外部依赖
set -euo pipefail
# 脚本在 deploy/ 下，先回到项目根目录（npm/electron-builder 都要在根目录跑）
cd "$(dirname "$0")/.."

echo "== 1/2 编译 TypeScript + 前端 =="
npm run build

echo "== 2/2 electron-builder 打包 AppImage =="
npx electron-builder --linux AppImage

echo ""
echo "✅ 完成: deploy/release/svn-git-1.0.0.AppImage"
