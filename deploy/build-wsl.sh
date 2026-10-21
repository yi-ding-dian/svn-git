#!/usr/bin/env bash
# 打包纯 Node WSL 包（目标机需自备 Node 20.11+、git、svn）
# 产物：deploy/release/svn-git-<版本>-wsl.tar.gz
set -euo pipefail
cd "$(dirname "$0")/.."
exec node deploy/wsl-pack.mjs
