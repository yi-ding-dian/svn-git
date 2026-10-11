# deploy — 打包与发版

把项目打成「目标机免装 Node」的分发产物，以及把产物正式发布出去。
两个打包脚本都会先回到项目根目录（脚本自己 `cd ..`，不用手动切目录），再执行 `npm run build` + `electron-builder`。

| 脚本 | 平台 | 产物（落在 `deploy/release/`） |
|---|---|---|
| `打包.bat` | Windows | `svn-git-<版本>-portable.exe` — 免安装单文件 exe，约 70MB |
| `build.sh` | Linux | `svn-git-<版本>.AppImage` — 免安装单文件，约 97MB |
| （安装包） | Windows | `svn-git-<版本>-setup.exe` — NSIS 安装包，约 70MB |

> **文件名一律 ASCII，界面名称保持中文**：`productName`（窗口标题、开始菜单、安装目录）是 `svn-git文件版本管理`，而产物文件名写死前缀 `svn-git-`（在 `electron-builder.yml` 的各 `artifactName` 里）。原因：中文文件名在下载 URL 里会被百分号编码、命令行和传输环节容易乱码。

> 产物目录由 `electron-builder.yml` 的 `directories.output` 统一指定（Windows 和 Linux 都落这里，已加进 `.gitignore`）。目录里除最终产物外还有 `win-unpacked/` 等中间文件和 `latest.yml`（自动更新用），可以无视。

## Windows：双击 `打包.bat`

首次运行会自动 `npm install`，然后构建 + 打包，结束时打印产物名和所在目录。

命令行等价：

```bash
npm run dist:win-portable   # 免安装单文件 exe（portable）
npm run dist:win            # NSIS 安装包（装到 Program Files + 开始菜单快捷方式）
```

## Linux：`./build.sh`

```bash
./build.sh                  # 等价于 npm run dist:linux
```

打好后可用 `../scripts/install-appimage.sh <AppImage 路径>` 把它装进系统应用菜单。

**AppImage 只能在 Linux 上打**，Windows 打不出来；Windows 侧对应的免安装形态就是上面的 portable exe（首启会解压到临时目录，比 AppImage 挂载慢一两秒）。

## 发版（升版本号 + 打 tag + 触发 CI）

双击 `发布.bat`，或命令行 `node deploy/release.mjs`。交互式走完整个流程：

```
检测  工作区干净 / 当前在 main / 新版本的 tag 没被本地或远端占用
问    升哪一位（patch / minor / major，显示 1.0.0 → 1.0.1）
问    发布说明（默认取 CHANGELOG 里第一条变更，进 commit 与 tag 信息）
自动  归档 CHANGELOG：[Unreleased] → [x.y.z] - 日期，顶部留出新的空段
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
- **但仍需要 `svn.exe` / `git.exe`** —— 工具本身只做图形界面，实际版本控制操作调的是系统命令行。装 [TortoiseSVN](https://tortoisesvn.net/) 时**必须勾选 `command line client tools`**（默认不勾选），另装 [Git for Windows](https://git-scm.com/)

**发版机**（跑 `发布.bat` 那台）额外需要：能 push 到 `origin`（Git 凭据已配好）。CI 是 tag 触发的，构建与上传都在 GitHub 侧完成，见 `../.github/workflows/release.yml`。
