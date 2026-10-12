#!/usr/bin/env bash
# 发版（升版本号 + 打 tag + 推 + 盯 CI）：与 Windows 的 release.bat 等价
# 流程逻辑全在 release.mjs（交互问答 + 非交互形态 --patch --yes 等），这里只是个「好敲」的入口
set -euo pipefail
# 脚本在 deploy/ 下，cd 到脚本目录后转发（release.mjs 自己会回到项目根）
cd "$(dirname "$0")"
exec node release.mjs "$@"
