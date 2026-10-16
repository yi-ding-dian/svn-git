#!/usr/bin/env bash
# 源码运行（不打包）：装依赖 → 构建 → 启动，并自动打开 http://127.0.0.1:23456
# 对应 Windows 的 run.bat，两边做的是同一件事。
# 默认后台运行：启动完本终端即可关闭（不随终端退出而中断）；停止：页面右上角「退出」。
# ./run.sh fg 走前台模式（服务端日志直接打在终端；Ctrl+C 停止）——排查问题时用。
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
# `--` 之后的参数原样透传给 node：-d = 后台常驻（re-exec 成脱离终端的子进程，
# 实现见 src/main/index.ts 末尾的 -d 分支）。
if [ "${1:-}" = "fg" ]; then
  echo "[3/3] 前台启动服务 http://127.0.0.1:23456（浏览器会自动打开；Ctrl+C 停止）..."
  npm start
else
  echo "[3/3] 后台启动服务 http://127.0.0.1:23456（浏览器会自动打开）..."
  npm start -- -d
  echo
  echo "已在后台运行，本终端可以关闭。停止：页面右上角「退出」。"
  echo "想看日志/调试：./run.sh fg（前台运行，日志直接打在终端）"
fi
