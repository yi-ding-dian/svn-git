#!/usr/bin/env bash
# 在 Linux 上打 Windows portable 包（build.bat 的 Linux 版；产物同为免安装、双击即运行的 exe）
# 用法：./build-win.sh [压缩级别 1/3/5/9]，不传默认 3
#   1 = 约 91MB（打包耗时约 21 秒）
#   3 = 约 85MB（打包耗时约 26 秒）  [默认]
#   5 = 约 76MB（打包耗时约 1 分钟）
#   9 = 约 67MB（打包耗时约 3 分钟）
# 以上「打包耗时」来自 build.bat 的实测表（压缩花的时间，不是启动时间）。
# 另注意 portable 双击运行时**每次都要自解压**：级别越大 → 体积越小、打包越慢、**打开越慢**；
# 想要打开最快就用级别 1（体积大一点）；级别/体积/打包耗时的对应见 build.bat 实测表。
set -euo pipefail
cd "$(dirname "$0")/.." # 回到项目根（npm/electron-builder 都要在根目录跑）

LEVEL="${1:-3}"
case "$LEVEL" in
  1 | 3 | 5 | 9) ;;
  *)
    echo "压缩级别只支持 1/3/5/9（收到: $LEVEL）"
    exit 1
    ;;
esac

echo "== 1/3 编译 TypeScript + 前端 =="
npm run build

echo "== 2/3 打包 Windows portable（压缩级别 $LEVEL）=="
# 两个 Linux 专属处理（都在命令行完成，不改 electron-builder.yml，Windows 端打包不受影响）：
#  -c.electronDist= ：yml 里 electronDist 指向 Linux 版 Electron（给 Linux 打包提速用）；
#    打 Windows 包时必须清掉，否则会拿 Linux 的二进制当 Windows 包源（找不到 electron.exe，实测踩过）。
#  镜像：工具链默认从 github.com 下载（校验文件等），国内网络会卡死；走 npmmirror（Electron 的
#    win32 zip 本地缓存命中时不重复下载，镜像只是补校验/兜底）。
ELECTRON_BUILDER_COMPRESSION_LEVEL="$LEVEL" \
  ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ \
  ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/ \
  npx electron-builder --win portable --x64 -c.electronDist=

echo ""
echo "== 3/3 完成，产物 =="
ls -lh deploy/release/*portable*.exe
echo ""
echo "提示：拷到 Windows 双击即运行（免安装、无需 Node）；首次运行如被 SmartScreen 拦"
echo "（exe 未签名，Windows 的正常提示），点「更多信息 → 仍要运行」即可。"
