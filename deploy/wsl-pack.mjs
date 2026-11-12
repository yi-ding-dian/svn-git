#!/usr/bin/env node
/** WSL / 纯 Node 浏览器包打包脚本。
 *
 * 产物（deploy/release/）：
 *   - 默认：svn-git-<版本>-wsl.tar.gz        目标机需要 Node 20.11+、git、svn
 *   - --with-node：svn-git-<版本>-wsl-node.tar.gz  附带 Linux x64 Node 二进制，目标机只需 git、svn
 *
 * 包内同时生成两个启动脚本：run-wsl.sh（WSL/Linux）与 run-windows.bat（Windows 原生，
 * 需目标机自装 Windows 版 Node；依赖目前是纯 JS，可跨平台复用）。
 *
 * 两个入口薄壳（deploy/build-wsl.sh / build-wsl-node.sh）只负责转发参数，逻辑集中在这里。
 *
 * 与 Electron 包的区别：不含 Chromium/GTK/NSS，不需要 FUSE/WSLg；只跑 HTTP 服务，
 * 用 Windows 浏览器访问 http://localhost:23456。dist/client 是前端静态文件，服务端直接托管。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'deploy', 'release');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const VERSION = String(pkg.version);
const WITH_NODE = process.argv.includes('--with-node');
/** 内置 Node 版本：与开发机一致（可用 WSL_NODE_VERSION 覆盖） */
const NODE_VERSION = process.env.WSL_NODE_VERSION || '22.23.1';
const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function run(cmd, args, cwd) {
  console.log(`$ ${cmd} ${args.join(' ')}`);
  execFileSync(cmd, args, { cwd, stdio: 'inherit' });
}

/** 下载文件：curl 优先，其次 wget（Ubuntu 最小安装可能只有其中一个） */
function download(url, dest) {
  try {
    run('curl', ['-fL', '--retry', '3', '--connect-timeout', '20', '-o', dest, url], path.dirname(dest));
    return;
  } catch {
    /* 继续试 wget */
  }
  run('wget', ['-q', '-O', dest, url], path.dirname(dest));
}

function writeRunScript(dir, builtinNode) {
  const nodePick = builtinNode
    ? `if [ ! -x ./node/bin/node ]; then
  echo "内置 Node 缺失或不可执行：./node/bin/node（包可能损坏，请重新解压）" >&2
  exit 1
fi
NODE_BIN="./node/bin/node"`
    : `if [ -x ./node/bin/node ]; then
  NODE_BIN="./node/bin/node"
elif command -v node >/dev/null 2>&1; then
  NODE_BIN="node"
else
  echo "未找到 Node.js（需要 20.11+）。" >&2
  echo "  推荐：改用内置 Node 的包 svn-git-${VERSION}-wsl-node.tar.gz（无需安装 Node）" >&2
  echo "  或安装 Node 22：" >&2
  echo "    curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -" >&2
  echo "    sudo apt install -y nodejs" >&2
  exit 1
fi`;
  // import.meta.dirname 从 Node 20.11 才有；只比主版本会漏掉 20.0~20.10
  const versionCheck = `# 代码用了 import.meta.dirname，要求 Node 20.11+
NODE_OK="$("$NODE_BIN" -p "const [a,b]=process.versions.node.split('.').map(Number); (a>20||(a===20&&b>=11))?1:0")"
if [ "$NODE_OK" != "1" ]; then
  echo "Node 版本过低：$("$NODE_BIN" -v)，需要 20.11+。" >&2
  echo "  推荐：改用内置 Node 的包 svn-git-${VERSION}-wsl-node.tar.gz（无需安装 Node）" >&2
  echo "  或升级到 Node 22：" >&2
  echo "    curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -" >&2
  echo "    sudo apt install -y nodejs" >&2
  exit 1
fi`;
  const script = `#!/usr/bin/env bash
# svn-git WSL 启动脚本：启动 HTTP 服务，用 Windows 浏览器访问。
# 用法：
#   ./run-wsl.sh       后台常驻（本终端可关闭）
#   ./run-wsl.sh fg    前台运行（Ctrl+C 停止，日志直接打在终端）
# 停止：页面右上角「退出」，或 curl -X POST http://127.0.0.1:23456/api/shutdown
set -euo pipefail
cd "$(dirname "$0")"

${nodePick}
${versionCheck}

command -v git >/dev/null 2>&1 || { echo "缺少 git：sudo apt install -y git" >&2; exit 1; }
command -v svn >/dev/null 2>&1 || { echo "缺少 subversion：sudo apt install -y subversion" >&2; exit 1; }

URL="http://localhost:23456"
if [ "\${1:-}" = "fg" ]; then
  exec "$NODE_BIN" dist/main/index.js --browser
fi

# 端口被占用时服务会自动换随机端口；后台模式看不到启动日志，先提示用户
if (echo >/dev/tcp/127.0.0.1/23456) 2>/dev/null; then
  echo "提示：23456 已被占用，服务会自动换端口；确认实际地址请用 ./run-wsl.sh fg。" >&2
fi

"$NODE_BIN" dist/main/index.js -d

# WSL 下自动打开 Windows 默认浏览器（非 WSL/没有 cmd.exe 时静默跳过）
if [ -n "\${WSL_DISTRO_NAME:-}" ] && command -v cmd.exe >/dev/null 2>&1; then
  for _ in $(seq 1 20); do
    if command -v curl >/dev/null 2>&1; then
      curl -sf -o /dev/null "$URL" && break
    else
      sleep 0.5
      break
    fi
    sleep 0.25
  done
  cmd.exe /c start "" "$URL" >/dev/null 2>&1 || true
fi

echo
echo "服务地址：$URL（在 Windows 浏览器打开）"
echo "若 23456 被占用，服务会自动换端口，请以启动日志中的地址为准。"
echo "停止：页面右上角「退出」，或 curl -X POST $URL/api/shutdown"
`;
  fs.writeFileSync(path.join(dir, 'run-wsl.sh'), script, { mode: 0o755 });
}

/** Windows 启动脚本（与 run-wsl.sh 同目录）。
 *  目标机需自带 Windows 版 Node 20.11+；包内 node_modules 目前全是纯 JS 依赖，Windows 的
 *  Node 可直接复用（将来若引入原生依赖，需要按平台分别安装，届时必须重新评估这个兼容路径）。
 *  UTF-8 + chcp 65001 写，避免中文提示在 cmd 下乱码；CRLF 换行。 */
function writeWindowsBat(dir) {
  const bat = `@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

rem svn-git Windows 启动脚本（浏览器版）
rem 用法：
rem   run-windows.bat       后台常驻（本窗口可关闭）
rem   run-windows.bat fg    前台运行（Ctrl+C 停止，日志打在窗口里）
rem 依赖：Windows 版 Node.js 20.11+；git / svn 按实际仓库类型安装
rem 停止：页面右上角「退出」，或 curl -X POST http://127.0.0.1:23456/api/shutdown

where node >nul 2>nul
if errorlevel 1 goto :no_node

rem 代码用了 import.meta.dirname，要求 Node 20.11+
node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit((a>20||(a===20&&b>=11))?0:1)"
if errorlevel 1 goto :bad_node

where git >nul 2>nul
if errorlevel 1 echo [提示] 未找到 git：只用 SVN 时可忽略；需要 Git 时请安装 Git for Windows 并加入 PATH
where svn >nul 2>nul
if errorlevel 1 echo [提示] 未找到 svn：只用 Git 时可忽略；需要 SVN 时请安装 TortoiseSVN（勾选命令行工具）或 SlikSVN

if /i "%~1"=="fg" goto :foreground

echo 正在后台启动服务 http://127.0.0.1:23456 ，浏览器将自动打开...
node dist/main/index.js -d
if errorlevel 1 goto :fail
echo 已在后台启动；停止：页面右上角「退出」。
echo 查看实时日志：run-windows.bat fg
echo.
echo 按任意键关闭本窗口（服务继续在后台运行）...
pause >nul
exit /b 0

:foreground
echo 前台启动（Ctrl+C 停止）...
node dist/main/index.js --browser
exit /b %errorlevel%

:no_node
echo 未找到 Node.js（需要 20.11+）。
echo   请到 https://nodejs.org 安装 Node 22 LTS，安装时勾选 "Add to PATH"。
pause
exit /b 1

:bad_node
echo Node 版本过低（需要 20.11+），当前版本：
node -v
echo   请升级 Node 后重试：https://nodejs.org
pause
exit /b 1

:fail
echo 启动失败，请查看上方日志。
pause
exit /b 1
`.replace(/\n/g, '\r\n');
  fs.writeFileSync(path.join(dir, 'run-windows.bat'), bat, { encoding: 'utf8' });
}

function writeReadme(dir, builtinNode) {
  const nodeReq = builtinNode
    ? '本包已内置 Linux x64 Node.js，无需另装 Node。'
    : '需要 Node.js 20.11+（推荐 22 LTS）。';
  fs.writeFileSync(
    path.join(dir, 'README-wsl.txt'),
    `svn-git WSL 浏览器版 v${VERSION}
================================

适用：WSL2（Ubuntu）+ Windows 浏览器。不启动 Electron 窗口，只跑 HTTP 服务。

依赖：
  - ${nodeReq}
  - git、subversion（工具实际调用的是 WSL 里的 Linux 版命令）
    sudo apt install -y git subversion

启动：
  cd svn-git-${VERSION}-wsl${builtinNode ? '-node' : ''}
  ./run-wsl.sh          # 后台常驻
  ./run-wsl.sh fg       # 前台运行，便于看日志

然后在 Windows 浏览器打开：
  http://localhost:23456

Windows 原生（不经 WSL）：
  把包目录复制到 Windows 磁盘，双击 run-windows.bat（或命令行 run-windows.bat fg）。
  需要 Windows 版 Node.js 20.11+${builtinNode ? '（包内内置的 Node 是 Linux 版，Windows 上不可用）' : ''}；
  包内 node_modules 目前是纯 JS 依赖，Windows 的 Node 可直接复用；git / svn 使用 Windows 版
  命令行工具（Git for Windows / TortoiseSVN 命令行工具 / SlikSVN）。
  注意：Windows 原生路径未经完整测试，正式使用建议优先用 Windows 安装包/便携版。

说明：
  - WSL2 默认把 Windows 的 localhost 转发到 WSL；若打不开，用 hostname -I 查看 WSL IP，
    并确认 .wslconfig 没有设置 localhostForwarding=false。
  - 工作副本请放在 WSL 文件系统（如 ~/projects），不要放 /mnt/c：文件权限和性能都更好。
  - 网页里的文件浏览/上传/下载操作的是 WSL 文件系统，不是 Windows 盘。
  - 在线升级：页面「关于」→ 检查更新。要求包目录及其父目录可写（升级靠同盘改名换目录），
    升级完成后会自动重启服务；日志在 ~/.cache/svngit/update.log。
    升级会替换整个包目录，目录名也会变成新版本号（如 svn-git-1.7.2-wsl）：
    如果终端还停在旧目录里，请 cd 到新目录再运行 ./run-wsl.sh（旧路径已不存在）。
  - 停止：页面右上角「退出」，或 curl -X POST http://127.0.0.1:23456/api/shutdown。
  - 端口 23456 被占用时服务会自动换端口，以启动日志为准。
`,
  );
}

async function main() {
  console.log(`== 打包 WSL ${WITH_NODE ? '内置 Node' : '纯 Node'} 包 v${VERSION} ==`);
  console.log('== 1/5 构建前端与服务端 ==');
  run(NPM, ['run', 'build'], ROOT);

  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'svngit-wsl-'));
  const name = `svn-git-${VERSION}-wsl${WITH_NODE ? '-node' : ''}`;
  const dir = path.join(stage, name);
  fs.mkdirSync(dir, { recursive: true });

  try {
    console.log('== 2/5 复制 dist 与 package 清单 ==');
    fs.cpSync(path.join(ROOT, 'dist'), path.join(dir, 'dist'), { recursive: true });
    for (const f of ['package.json', 'package-lock.json']) {
      fs.copyFileSync(path.join(ROOT, f), path.join(dir, f));
    }
    // 发版指南：应用内「复制 AI 提示词」要读取，不带进包会提示指南缺失
    const guide = path.join(ROOT, 'docs', '发版脚本生成指南.md');
    if (fs.existsSync(guide)) {
      fs.mkdirSync(path.join(dir, 'docs'), { recursive: true });
      fs.copyFileSync(guide, path.join(dir, 'docs', '发版脚本生成指南.md'));
    }
    // 在线升级标记：应用只在带这个标记的目录里启用 tar.gz 自更新（源码运行绝不误碰真实目录）。
    // 文件进了 tar.gz，解压后就在包根；升级时据此判断 flavor（决定下载 wsl 还是 wsl-node 包）。
    fs.writeFileSync(
      path.join(dir, '.svngit-package.json'),
      JSON.stringify({ kind: 'svn-git-package', flavor: WITH_NODE ? 'wsl-node' : 'wsl', version: VERSION }, null, 2) + '\n',
    );

    console.log('== 3/5 安装生产依赖（不含 Electron/TypeScript） ==');
    run(NPM, ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], dir);

    if (WITH_NODE) {
      console.log(`== 4/5 下载内置 Node v${NODE_VERSION}（linux-x64） ==`);
      const dl = path.join(stage, 'node-dl');
      fs.mkdirSync(dl, { recursive: true });
      const archive = path.join(dl, `node-v${NODE_VERSION}-linux-x64.tar.gz`);
      const url = `https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.gz`;
      download(url, archive);
      run('tar', ['-xzf', archive, '-C', dl], dl);
      const src = path.join(dl, `node-v${NODE_VERSION}-linux-x64`, 'bin', 'node');
      const dst = path.join(dir, 'node', 'bin', 'node');
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.copyFileSync(src, dst);
      fs.chmodSync(dst, 0o755);
      const license = path.join(dl, `node-v${NODE_VERSION}-linux-x64`, 'LICENSE');
      if (fs.existsSync(license)) fs.copyFileSync(license, path.join(dir, 'node', 'LICENSE'));
      console.log(`   内置 Node 版本: ${execFileSync(dst, ['-v'], { encoding: 'utf8' }).trim()}`);
    } else {
      console.log('== 4/5 跳过内置 Node（目标机需自备 Node 20.11+） ==');
    }

    writeRunScript(dir, WITH_NODE);
    writeWindowsBat(dir);
    writeReadme(dir, WITH_NODE);

    console.log('== 5/5 打包 tar.gz ==');
    fs.mkdirSync(OUT_DIR, { recursive: true });
    const tarPath = path.join(OUT_DIR, `${name}.tar.gz`);
    fs.rmSync(tarPath, { force: true });
    run('tar', ['-czf', tarPath, '-C', stage, name], stage);
    const size = fs.statSync(tarPath).size;
    console.log('');
    console.log(`✅ 完成: ${path.relative(ROOT, tarPath)} (${(size / 1024 / 1024).toFixed(1)} MB)`);
    console.log(`   解压后运行: ./${name}/run-wsl.sh，然后 Windows 浏览器打开 http://localhost:23456`);
    console.log(`   Windows 原生: 复制到 Windows 磁盘后双击 ${name}/run-windows.bat（需自装 Windows 版 Node）`);
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
