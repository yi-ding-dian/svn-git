#!/usr/bin/env bash
# 生成 SSH 私钥（GitHub 推送用），对应 Windows 的 gen-ssh-key.bat。
# 默认生成到 ~/.ssh/id_ed25519（用户级：应用和终端 git 都直接能用），已存在则不覆盖。
# 用法：./gen-ssh-key.sh [密钥目录]     例：./gen-ssh-key.sh .git-ssh（项目内私钥，老方案）
#
# 私钥只留在本机。项目内私钥模式会同时写 .gitignore 和 .git/info/exclude 双保险，防止误提交。
# 生成后按回车会自动打开 GitHub 的 SSH keys 页面，并轮询检测公钥是否已生效。
set -euo pipefail
cd "$(dirname "$0")"

KEY_DIR="${1:-$HOME/.ssh}"
KEY="$KEY_DIR/id_ed25519"
SSH_KEYS_URL="https://github.com/settings/keys"

# 实际文件与"应用里该填的写法"分开：
#  - 家目录下 → ~/...（应用会展开 ~，也是应用留空时的系统默认）
#  - 项目内   → 相对仓库根（仓库搬家/别人 clone 都不用改配置）
#  - 其它     → 绝对路径
# 不能直接印脚本里的路径：Git-Bash 的 /d/xxx 形式，Windows 上的应用解析不了
# （会被当成当前盘根下的 d\xxx），照抄进「SSH 私钥」就是错的。
KEY_ABS="$KEY"
case "$KEY_ABS" in
  /*) ;;
  *) KEY_ABS="$PWD/$KEY" ;;
esac
IN_REPO=0
case "$KEY_ABS" in "$PWD"/*) IN_REPO=1 ;; esac
DISPLAY_KEY="$KEY_ABS"
case "$KEY_ABS" in
  "$PWD"/*) DISPLAY_KEY="${KEY_ABS#"$PWD"/}" ;;
  "$HOME"/*) DISPLAY_KEY="~/${KEY_ABS#"$HOME"/}" ;;
esac

open_ssh_page() {
  if command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$SSH_KEYS_URL" >/dev/null 2>&1 &
  elif command -v open >/dev/null 2>&1; then
    open "$SSH_KEYS_URL" >/dev/null 2>&1 &
  else
    echo "请手动打开：$SSH_KEYS_URL"
  fi
}

# 用这把私钥连 GitHub：GitHub 对成功认证返回 "Hi <用户名>! You've successfully authenticated..."，
# 失败则是 "Permission denied (publickey)"。只看输出，不看退出码（GitHub 不给 shell，退出码恒为 1）。
wait_for_key() {
  local i out
  echo
  echo "等待 GitHub 收到公钥（最多 5 分钟，Ctrl+C 可跳过）..."
  for ((i = 1; i <= 60; i++)); do
    out=$(ssh -T -i "$KEY_ABS" -o IdentitiesOnly=yes -o BatchMode=yes \
      -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10 git@github.com 2>&1 || true)
    if printf '%s' "$out" | grep -q "successfully authenticated"; then
      echo "✓ 公钥已生效：$(printf '%s' "$out" | head -1)"
      return 0
    fi
    printf '.'
    sleep 5
  done
  echo
  echo "⚠ 5 分钟内未检测到公钥生效。添加后请手动验证："
  echo "  ssh -T -i \"$KEY_ABS\" -o IdentitiesOnly=yes git@github.com"
  return 1
}

show_guide() {
  echo
  echo "===== 公钥（添加到 GitHub → Settings → SSH and GPG keys → New SSH key）====="
  cat "$KEY.pub"
  echo "=========================================================================="
  echo
  echo "私钥路径：$DISPLAY_KEY"
  echo
  if [ -t 0 ] && [ -t 1 ]; then
    # 交互终端：打开页面并自动检测；非交互（CI/管道）只打印说明，避免卡住
    read -r -p "按回车打开 GitHub 添加页面并开始检测公钥（Ctrl+C 跳过）..." _ || true
    open_ssh_page
    wait_for_key || true
  else
    echo "（非交互运行，跳过自动检测）打开 $SSH_KEYS_URL 添加公钥"
  fi
  echo
  echo "下一步："
  echo "  1. 在 GitHub 添加上面的公钥（已打开页面则直接粘贴）"
  echo "  2. 在本应用「Git 信息与配置」的「SSH 私钥」填：$DISPLAY_KEY"
  echo "     （留空则用系统默认 ~/.ssh；填了就要和这里完全一致）"
  echo "  3. 勾选「终端 git 也使用此私钥」——应用会写入 ~/.ssh/config，终端里也能用"
  echo "  4. 勾选「GitHub 地址自动走 SSH」——以后添加的 GitHub 项目不用逐个改 remote"
  echo "  5. 单个项目也可以把远程地址改成 git@github.com:用户名/仓库.git"
}

if [ -f "$KEY" ]; then
  echo "私钥已存在：$DISPLAY_KEY（不覆盖，避免破坏正在使用的密钥）"
  show_guide
  exit 0
fi

if ! command -v ssh-keygen >/dev/null 2>&1; then
  echo "[错误] 未找到 ssh-keygen，请先安装 OpenSSH 客户端" >&2
  echo "       Debian/Ubuntu: sudo apt install openssh-client" >&2
  exit 1
fi

if [ "$IN_REPO" -eq 1 ]; then
  echo "[1/3] 生成 ed25519 密钥到 $DISPLAY_KEY ..."
else
  echo "[1/1] 生成 ed25519 密钥到 $DISPLAY_KEY ..."
fi
mkdir -p "$KEY_DIR"
chmod 700 "$KEY_DIR"
# -N ""：不设密码短语——应用推送是非交互的，设了密码每次都要手动输入
ssh-keygen -t ed25519 -C "svngit@$(hostname)" -f "$KEY" -N "" >/dev/null
chmod 600 "$KEY"

if [ "$IN_REPO" -eq 1 ]; then
  # 忽略规则里的目录：项目内相对路径、统一正斜杠（.gitignore 不认反斜杠）
  IGNORE_DIR="${KEY_DIR#./}"
  IGNORE_DIR="${IGNORE_DIR//\\//}"
  echo "[2/3] 写入忽略规则（.gitignore + .git/info/exclude）..."
  if ! grep -qxF "$IGNORE_DIR/" .gitignore 2>/dev/null; then
    printf '\n# 项目内 SSH 私钥（gen-ssh-key 生成，勿提交）\n%s/\n' "$IGNORE_DIR" >> .gitignore
  fi
  if [ -d .git/info ]; then
    if ! grep -qxF "/$IGNORE_DIR/" .git/info/exclude 2>/dev/null; then
      printf '\n# 项目内 SSH 私钥（勿提交）\n/%s/\n' "$IGNORE_DIR" >> .git/info/exclude
    fi
  fi

  echo "[3/3] 自检私钥是否会被 git 提交..."
  if command -v git >/dev/null 2>&1 && [ -d .git ]; then
    if git check-ignore -q "$KEY"; then
      echo "      ✓ 已确认私钥被 git 忽略，不会提交到 GitHub"
    else
      echo "      ⚠ 警告：git 未忽略 $KEY，请检查 .gitignore！" >&2
    fi
  fi
else
  echo "[2/2] 私钥在用户目录（不在仓库里），无需忽略规则"
fi

show_guide
