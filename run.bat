@echo off
setlocal
cd /d "%~dp0"

rem ============================================
rem  双击运行:构建 + 启动 SVN/Git 工具(自动打开浏览器)
rem  默认后台运行(服务脱离本窗口);窗口留在原地等你按任意键,关掉不影响运行;
rem  停止:浏览器页面右上角「退出」。
rem  命令行运行 run.bat fg 走前台模式(日志打在窗口里,Ctrl+C 或关窗口停止)
rem ============================================

rem  依赖判断不能只看 node_modules 目录:package.json 后来加新依赖时目录仍在,
rem  旧写法会跳过安装,构建直接报 Cannot find module(electron-updater 就这么漏过一次)。
rem  改看 package-lock.json 是否比 node_modules\.package-lock.json 新:前者较新说明依赖清单变了。
set "NEED_INSTALL="
if not exist "node_modules" set "NEED_INSTALL=1"
if not exist "node_modules\.package-lock.json" set "NEED_INSTALL=1"
if not defined NEED_INSTALL for /f "usebackq delims=" %%i in (`powershell -NoProfile -Command "if ((Get-Item -LiteralPath 'package-lock.json').LastWriteTime -gt (Get-Item -LiteralPath 'node_modules\.package-lock.json').LastWriteTime) { '1' }"`) do set "NEED_INSTALL=%%i"
if defined NEED_INSTALL (
  echo [1/3] 依赖缺失或已过期(package-lock.json 有更新),安装依赖 npm install ...
  call npm install
  if errorlevel 1 goto :err_install
) else (
  echo [1/3] 依赖已是最新,跳过安装
)

echo [2/3] 编译构建 tsc + esbuild ...
call npm run build
if errorlevel 1 goto :err_build

rem  入口取自 package.json 的 start 脚本,不在此写死 dist 路径
rem  (重构后入口从 dist/main.js 变成了 dist/main/index.js,写死会跑到旧版本)
rem  -- 之后的参数原样透传给 node:-d = 后台常驻(脱离终端,实现见 src/main/index.ts)
if /i "%~1"=="fg" goto :fg

echo [3/3] 后台启动服务 http://127.0.0.1:23456 ,浏览器即将自动打开...
call npm start -- -d
if errorlevel 1 goto :err_run
echo 服务已在后台运行(脱离本窗口)。停止:浏览器页面右上角「退出」。
echo 想看实时日志/调试:run.bat fg(前台模式,日志直接打在窗口里)
echo.
echo 按任意键关闭本窗口(关掉不影响服务)...
pause >nul
exit /b 0

:fg
echo [3/3] 前台启动服务 http://127.0.0.1:23456 ,浏览器即将自动打开;Ctrl+C 停止...
call npm start
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
