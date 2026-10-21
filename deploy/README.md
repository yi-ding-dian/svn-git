# deploy — 打包与发版

把项目打成「目标机免装 Node」的分发产物，以及把产物正式发布出去。
两个打包脚本都会先回到项目根目录（脚本自己 `cd ..`，不用手动切目录），再执行 `npm run build` + `electron-builder`。

> **只想把应用跑起来看看**（不产出分发包）：用项目根的 `run.sh`（Windows 是 `run.bat`）—— 那是源码运行，属于另一件事，所以不在这个目录里。

| 脚本 | 平台 | 产物（落在 `deploy/release/`） |
|---|---|---|
| `build.bat` | Windows | `svn-git-<版本>-portable.exe` — 免安装单文件 exe，默认档约 85MB（压缩级别可选，见下文） |
| `build.sh` | Linux | `svn-git-<版本>.AppImage` — 免安装单文件，约 97MB（gzip；**勿换 xz**——冷启动会慢 20 倍，原因见 `electron-builder.yml` 注释） |
| `build-wsl.sh` | WSL / 纯 Node | `svn-git-<版本>-wsl.tar.gz` — 浏览器模式，目标机需 Node 20.11+、git、svn；约 4MB |
| `build-wsl-node.sh` | WSL / 内置 Node | `svn-git-<版本>-wsl-node.tar.gz` — 浏览器模式，目标机只需 git、svn；约 46MB |
| （安装包） | Windows | `svn-git-<版本>-setup.exe` — NSIS 安装包，约 70MB |

脚本名一律 ASCII 且两两成对：打包 `build.bat`（Windows 双击）/ `build.sh`（Linux），发版 `release.bat`（Windows 双击）/ `release.sh`（Linux）；流程逻辑统一在 `release.mjs`——两个入口都只是薄壳（cd 后转发给它）。

> **文件名一律 ASCII，界面名称保持中文**：`productName`（窗口标题、开始菜单、安装目录）是 `svn-git文件版本管理`，而产物文件名写死前缀 `svn-git-`（在 `electron-builder.yml` 的各 `artifactName` 里）。原因：中文文件名在下载 URL 里会被百分号编码、命令行和传输环节容易乱码。

> 产物目录由 `electron-builder.yml` 的 `directories.output` 统一指定（Windows 和 Linux 都落这里，已加进 `.gitignore`）。目录里除最终产物外还有 `win-unpacked/` 等中间文件和 `latest.yml`（自动更新用），可以无视。

## Windows：双击 `build.bat`

首次运行会自动 `npm install`，然后构建 + 打包，结束时打印产物名和所在目录。

命令行等价：

```bash
npm run dist:win-portable   # 免安装单文件 exe（portable）
npm run dist:win            # NSIS 安装包（装到 Program Files + 开始菜单快捷方式）
```

> **Windows 打包为什么比 Linux 慢**：electron-builder 给 Windows 的 7z 载荷默认用最慢档
> （`-mx=9`，单线程），243MB 的 Electron 运行时要压 3~4 分钟；Linux 的 AppImage 走
> mksquashfs 多线程 gzip，所以只要 ~20 秒。
> `build.bat` 启动时会列出压缩级别让你选（打包阶段实测：`1`≈21 秒/91MB、`3`≈26 秒/85MB、
> `5`≈1 分半/76MB、`9`≈3 分半/67MB），默认 `3`、20 秒不选自动继续。不想交互就
> `build.bat 5`，或先 `set ELECTRON_BUILDER_COMPRESSION_LEVEL=5` 再跑。手动执行上面的
> `npm run dist:win*` 不会带上这些默认值，同样先 `set` 再打包才走得快。

## Linux：`./build.sh`

```bash
./build.sh                  # 等价于 npm run dist:linux
```

打好后可用 `../scripts/install-appimage.sh <AppImage 路径>` 把它装进系统应用菜单。

**AppImage 只能在 Linux 上打**，Windows 打不出来；Windows 侧对应的免安装形态就是上面的 portable exe（首启会解压到临时目录，比 AppImage 挂载慢一两秒）。

## WSL / 纯浏览器模式：`build-wsl.sh` / `build-wsl-node.sh`

不需要 Electron / WSLg / FUSE，产物是纯 Node HTTP 服务，用 Windows 浏览器访问。

```bash
./deploy/build-wsl.sh        # 目标机需 Node 20.11+、git、svn；约 4MB
./deploy/build-wsl-node.sh   # 内置 Linux x64 Node v22.23.1，目标机只需 git、svn；约 46MB
```

解压后：

```bash
tar -xzf svn-git-<版本>-wsl.tar.gz
cd svn-git-<版本>-wsl
./run-wsl.sh          # 后台常驻（本终端可关闭）
./run-wsl.sh fg       # 前台运行，日志直接打在终端
```

Windows 浏览器打开 `http://localhost:23456`。WSL2 默认把 Windows 的 localhost 转发到 WSL；
工作副本放 WSL 文件系统（如 `~/projects`），不要放 `/mnt/c`。页面里的文件浏览/上传操作的是
WSL 文件系统，不是 Windows 盘。内置 Node 的版本可用 `WSL_NODE_VERSION=<版本>` 覆盖打包时下载的版本。

## 产物怎么用（自己拿到产物、或发给别人时看这节）

产物都是**免安装单文件**，双击即开应用窗口；在终端里运行则按下面三条规则走：

- **不带参数**（终端里）：先弹运行方式菜单 —— `1` 应用窗口 / `2` 浏览器 · 前台 / `3` 浏览器 · 后台（回车默认 `1`）
- **带 `--browser`**：跳过菜单，启动服务并打开系统浏览器（前台运行，终端被占用）
- **带 `-d`**（自动含 `--browser`）：**后台常驻** —— 命令立即返回，服务在后台运行、浏览器照常自动打开

```bash
./svn-git-1.0.0.AppImage --browser -d      # Linux：后台常驻
svn-git-1.0.0-portable.exe --browser -d    # Windows：同上（portable 包装器会原样转发参数）
```

> 双击图标没有终端，不弹菜单、直接开窗口。
> 停止方式：窗口模式关窗即退；浏览器 / 后台模式用页面右上角「退出应用」；前台浏览器模式 Ctrl+C 也行。
> 服务只监听 `127.0.0.1:23456`（被占用时自动换随机端口，以浏览器标签地址栏为准）；指定启动目录用环境变量 `SVNGIT_DIR`（Linux 直接前置，Windows CMD 里先 `set`）。

## 发版（升版本号 + 打 tag + 触发 CI）

双击 `release.bat`（Windows）/ `./deploy/release.sh`（Linux），或命令行 `node deploy/release.mjs`。交互式走完整个流程：

```
检测  工作区干净 / 当前在 main / 新版本的 tag 没被本地或远端占用
问    升哪一位（patch / minor / major，显示 1.0.0 → 1.0.1）
问    发布说明（默认取自上个 tag 以来最新一条提交的主题，进 commit 与 tag 信息）
自动  npm version → 提交 package.json / package-lock.json 并打 tag
自动  git push --follow-tags → 触发 CI
自动  轮询 GitHub API 报 CI 结果与产物清单（Ctrl+C 可退出，不影响构建）
```

非交互形态（给 GUI / CI 调用）：`node deploy/release.mjs --patch --yes`。
另有 `--minor` / `--major`、`--no-push`（只提交打 tag 不推）、`--no-watch`（不盯 CI）、`--branch <名>`（允许在非 main 分支发版）。

> 脚本名是 ASCII 的 `release.mjs` 而不是 `发布.mjs`：双击入口里 `chcp 65001` 之后 cmd 按 UTF-8 解析后续行，中文文件名在 bat 里没法可靠表达。

## 前置条件

**打包机**（跑脚本这台）：

- 装了 Node（`npm` 在 PATH 里）
- 首次打包需联网装依赖；electron-builder 还会下载 nsis 等打包工具，之后走本地缓存

**目标机**（跑产物的那台）：

- **不需要装 Node / 浏览器** —— Electron 运行时已内置
- **但仍需要 `svn.exe` / `git.exe`** —— 工具本身只做图形界面，实际版本控制操作调的是系统命令行。SVN 命令行两条路：装纯命令行的 [SlikSVN](https://sliksvn.com/)（推荐，`winget install --id=Slik.Subversion -e`——工具本身就是图形界面，不需要再来个 GUI），或装 [TortoiseSVN](https://tortoisesvn.net/) 时**必须勾选 `command line client tools`**（默认不勾选）；Git 装 [Git for Windows](https://git-scm.com/)。工具内「环境检测 → 下载安装」可一键装上 SlikSVN。

**发版机**（跑 `release.bat` / `release.sh` 那台）额外需要：能 push 到 `origin`（Git 凭据已配好）。CI 是 tag 触发的，构建与上传都在 GitHub 侧完成，见 `../.github/workflows/release.yml`。
