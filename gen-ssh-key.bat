@echo off
setlocal
cd /d "%~dp0"

rem ============================================
rem  生成项目内 SSH 私钥（GitHub 推送用）
rem  默认 .git-ssh\id_ed25519，已存在则不覆盖
rem  私钥只留本机：同时写 .gitignore 和 .git\info\exclude
rem  生成后按任意键打开 GitHub 页面并自动检测公钥
rem ============================================

set "KEY_DIR=.git-ssh"
set "KEY=%KEY_DIR%\id_ed25519"

if exist "%KEY%" goto :guide

where ssh-keygen >nul 2>nul
if errorlevel 1 (
  echo [错误] 未找到 ssh-keygen。请安装 OpenSSH 客户端：
  echo        设置 - 应用 - 可选功能 - 添加功能 - OpenSSH 客户端
  pause
  exit /b 1
)

echo [1/3] 生成 ed25519 密钥到 %KEY% ...
if not exist "%KEY_DIR%" mkdir "%KEY_DIR%"
ssh-keygen -t ed25519 -C "svngit" -f "%KEY%" -N "" >nul
if errorlevel 1 goto :fail

rem Windows OpenSSH 会检查私钥 ACL：去掉继承，只给当前用户读权限
icacls "%KEY%" /inheritance:r >nul 2>nul
icacls "%KEY%" /grant:r "%USERNAME%:R" >nul 2>nul

echo [2/3] 写入忽略规则（.gitignore + .git\info\exclude）...
findstr /x /c:".git-ssh/" .gitignore >nul 2>nul
if errorlevel 1 (
  echo.>> .gitignore
  echo # 项目内 SSH 私钥（gen-ssh-key 生成，勿提交）>> .gitignore
  echo .git-ssh/>> .gitignore
)
if exist ".git\info" (
  findstr /x /c:"/.git-ssh/" ".git\info\exclude" >nul 2>nul
  if errorlevel 1 (
    echo.>> ".git\info\exclude"
    echo # 项目内 SSH 私钥（勿提交）>> ".git\info\exclude"
    echo /.git-ssh/>> ".git\info\exclude"
  )
)

echo [3/3] 自检私钥是否会被 git 提交...
if exist ".git" (
  git check-ignore -q "%KEY%" >nul 2>nul
  if errorlevel 1 (
    echo       警告：git 未忽略 %KEY%，请检查 .gitignore！
  ) else (
    echo       OK 已确认私钥被 git 忽略，不会提交到 GitHub
  )
)

:guide
echo.
echo ===== 公钥（添加到 GitHub -^> Settings -^> SSH and GPG keys -^> New SSH key）=====
type "%KEY%.pub"
echo ==========================================================================
echo.
echo 私钥路径：%CD%\%KEY%
echo.
echo 按任意键打开 GitHub 添加页面并开始检测公钥（关窗口可跳过）...
pause >nul
start "" "https://github.com/settings/keys"

set /a tries=0
:check
set /a tries+=1
ssh -T -i "%KEY%" -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10 git@github.com > "%TEMP%\svngit-ssh-check.txt" 2>&1
findstr /c:"successfully authenticated" "%TEMP%\svngit-ssh-check.txt" >nul 2>nul
if not errorlevel 1 (
  echo.
  echo OK 公钥已生效：
  type "%TEMP%\svngit-ssh-check.txt"
  goto :done
)
if %tries% geq 60 goto :timeout
ping -n 6 127.0.0.1 >nul
goto :check

:timeout
echo.
echo 警告：5 分钟内未检测到公钥生效，请确认已添加到 GitHub。
echo 添加后可手动验证：ssh -T -i "%CD%\%KEY%" -o IdentitiesOnly=yes git@github.com

:done
echo.
echo 下一步：
echo   1. 在 GitHub 添加上面的公钥（已打开页面则直接粘贴）
echo   2. 在本应用「Git 信息与配置」的「SSH 私钥」填上面的私钥路径，
echo      并勾选「终端 git 也使用此私钥」——应用会写入 ~/.ssh/config，终端里也能用
echo   3. 勾选「GitHub 地址自动走 SSH」——以后添加的 GitHub 项目不用逐个改 remote
echo   4. 单个项目也可以把远程地址改成 git@github.com:用户名/仓库.git
pause
exit /b 0

:fail
echo [错误] 生成失败，请检查上方输出
pause
exit /b 1
