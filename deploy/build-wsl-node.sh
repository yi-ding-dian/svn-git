#!/usr/bin/env bash
# 打包纯 Node + 内置 Node 二进制的 WSL 包（目标机只需 git、svn）
# 产物：deploy/release/svn-git-<版本>-wsl-node.tar.gz
set -euo pipefail
cd "$(dirname "$0")/.."
exec node deploy/wsl-pack.mjs --with-node
