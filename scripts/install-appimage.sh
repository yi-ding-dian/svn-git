#!/usr/bin/env bash
# AppImage 安装到系统应用菜单（与工具内「⋯ → 安装到系统应用菜单」等价，供手动/非 AppImage 运行使用）
# 用法: ./scripts/install-appimage.sh /path/to/svn-git文件版本管理-1.0.0.AppImage
set -euo pipefail

IMAGE="${1:-${APPIMAGE:-}}"
if [ -z "$IMAGE" ] || [ ! -f "$IMAGE" ]; then
  echo "用法: $0 <AppImage 路径>"
  echo "  或先 export APPIMAGE=/path/to/xxx.AppImage 后不带参数运行"
  exit 1
fi
IMAGE="$(readlink -f "$IMAGE")"

APPS="$HOME/.local/share/applications"
ICON="$HOME/.local/share/icons/hicolor/512x512/apps"
mkdir -p "$APPS" "$ICON"

cat > "$APPS/svngit.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=svn-git文件版本管理
Comment=SVN/Git 状态检测与操作工具
Exec="$IMAGE" %U
Icon=svngit
Terminal=false
Categories=Development;
StartupWMClass=svngit
EOF

# 图标：优先仓库内 dist/web/icon.png（构建产物），否则 build/icon.png
ROOT="$(dirname "$(dirname "$(readlink -f "$0")")")"
for c in "$ROOT/dist/web/icon.png" "$ROOT/build/icon.png"; do
  if [ -f "$c" ]; then
    cp "$c" "$ICON/svngit.png"
    break
  fi
done

command -v update-desktop-database >/dev/null && update-desktop-database "$APPS" || true
command -v gtk-update-icon-cache >/dev/null && gtk-update-icon-cache -f "$HOME/.local/share/icons/hicolor" || true

echo "✅ 已安装: $APPS/svngit.desktop（Exec=$IMAGE）"
echo "   卸载: 删除该文件与 $ICON/svngit.png，或在工具内「⋯ → 卸载系统应用菜单」"
