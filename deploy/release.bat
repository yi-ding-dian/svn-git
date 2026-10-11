@echo off
setlocal
rem ============================================
rem  一键发版(双击运行)
rem  检测 -> 问答 -> 升版本 -> push -> 盯 CI
rem  等价于命令行: node deploy/release.mjs
rem  脚本名是 ASCII 的 release.mjs(不是发布.mjs):下面 chcp 之后
rem  cmd 按 UTF-8 解析后续行,中文文件名在 bat 里没法可靠表达
rem ============================================
rem  chcp 65001: 切 UTF-8 代码页,否则 node 输出的中文在 cmd 里是乱码
rem  故本条之后的行必须全 ASCII,中文注释都放上面
chcp 65001 >nul
node "%~dp0release.mjs" %*
pause
