@echo off
setlocal
rem 脚本在 deploy/ 下,先回到项目根目录(所有命令都要在根目录跑)
cd /d "%~dp0.."

rem ============================================
rem  Windows 一键打包:免安装单文件 exe(portable)  [deploy 目录]
rem  产物:deploy\release\svn-git文件版本管理-1.0.0-portable.exe
rem  目标机无需装 Node;svn/git 命令仍是外部依赖
rem  注:AppImage 是 Linux 专有格式只能在 Linux 上打,
rem     Windows 侧的对应产物就是这个 portable 单文件 exe
rem ============================================

if not exist "node_modules" (
  echo [1/2] 首次打包,先安装依赖 npm install ...
  call npm install
  if errorlevel 1 goto :err_install
) else (
  echo [1/2] 依赖已存在,跳过安装
)

echo [2/2] 构建 + 打包 portable exe ...
call npm run dist:win-portable
if errorlevel 1 goto :err_build

echo.
echo 打包完成,产物:
dir /b "deploy\release\*portable*.exe"
echo 所在目录:%CD%\deploy\release
pause
exit /b 0

:err_install
echo [错误] 依赖安装失败,请检查网络后重试
goto :fail
:err_build
echo [错误] 打包失败,请查看上方日志
echo       若是下载 nsis/winCodeSign 报错,属于网络问题,可改用 GitHub Actions 的产物
:fail
pause
exit /b 1
