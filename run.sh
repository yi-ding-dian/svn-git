#!/usr/bin/env bash
# 源码运行（不打包）：装依赖 → 构建 → 启动，并自动打开 http://127.0.0.1:23456
# 对应 Windows 的 run.bat，两边做的是同一件事。停止：页面右上角「退出」，或终端 Ctrl+C
#
# 脚本名用 ASCII 而不是「运行.sh」：Linux 上这个脚本主要是**敲**的（./run.sh），
# 中文名每次都得切输入法；而 .bat 是双击的，名字永远不用敲 —— 见 deploy/README.md 的同类说明。
set -euo pipefail
cd "$(dirname "$0")"

if [ ! -d node_modules ]; then
  echo "[1/3] 首次运行，安装依赖 npm install ..."
  npm install
else
  echo "[1/3] 依赖已存在，跳过安装"
fi

echo "[2/3] 编译构建 tsc + esbuild ..."
npm run build

# 用 npm start 而不是写死 node dist/main/index.js：入口路径只留 package.json 一处
# （run.bat 当初就是写死了 dist 路径，重构后静默跑了半个月旧版本 —— 别再挖同一个坑）
echo "[3/3] 启动服务 http://127.0.0.1:23456（浏览器会自动打开）..."
npm start
