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

rem --------------------------------------------
rem  压缩级别:数字越小越快, 产物越大(portable 实测: 1=21 秒/91MB, 3=26 秒/85MB,
rem  5=1 分半/76MB, 9=3 分半/67MB)。也可直接指定跳过询问: build.bat 5, 或先 set
rem  ELECTRON_BUILDER_COMPRESSION_LEVEL=5
rem --------------------------------------------
if not "%~1"=="" set ELECTRON_BUILDER_COMPRESSION_LEVEL=%~1
if defined ELECTRON_BUILDER_COMPRESSION_LEVEL goto :level_ready

echo 选择打包压缩级别(数字越小越快, 产物越大):
echo     1 = 约 21 秒, 91MB
echo     3 = 约 26 秒, 85MB   [默认]
echo     5 = 约 1 分半, 76MB
echo     9 = 约 3 分半, 67MB
set "LEVEL=3"
choice /C 1359 /T 20 /D 3 /N /M "请选择 [1/3/5/9] (20 秒不选自动用 3): "
if errorlevel 5 goto :level_done
if errorlevel 4 set "LEVEL=9" & goto :level_done
if errorlevel 3 set "LEVEL=5" & goto :level_done
if errorlevel 2 set "LEVEL=3" & goto :level_done
if errorlevel 1 set "LEVEL=1"
:level_done
set ELECTRON_BUILDER_COMPRESSION_LEVEL=%LEVEL%

:level_ready

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
