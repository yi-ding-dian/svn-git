@echo off
setlocal
cd /d "%~dp0"

rem ============================================
rem  双击运行:构建 + 启动 SVN/Git 工具(自动打开浏览器)
rem  停止:浏览器页面右上角「退出」,或关闭本窗口
rem ============================================

if not exist "node_modules" (
  echo [1/3] 首次运行,安装依赖 npm install ...
  call npm install
  if errorlevel 1 goto :err_install
) else (
  echo [1/3] 依赖就绪
)

echo [2/3] 编译构建 tsc + esbuild ...
call npm run build
if errorlevel 1 goto :err_build

echo [3/3] 启动服务 http://127.0.0.1:23456 ,浏览器即将自动打开...
node dist/main.js
if errorlevel 1 goto :err_run

echo 服务已退出。
exit /b 0

:err_install
echo [错误] 依赖安装失败,请检查网络后重试
goto :fail
:err_build
echo [错误] 构建失败,请检查上方日志
echo       若提示 npm 不是内部或外部命令,说明 Node 未加入 PATH,
echo       请到 https://nodejs.org 安装 Node,安装完重新双击
goto :fail
:err_run
echo [错误] 服务异常退出,请检查上方日志
:fail
pause
exit /b 1
