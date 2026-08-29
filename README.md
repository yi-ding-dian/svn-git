# svn-git 文件版本管理

> **SVN / Git 双引擎图形化版本管理工具**:浏览器界面、行级冲突防护,一套工具统一管理两种版本库。

![版本](https://img.shields.io/badge/版本-1.0.0-blue)
![语言](https://img.shields.io/badge/语言-TypeScript-blueviolet)
![许可](https://img.shields.io/badge/许可-MIT-green)
![平台](https://img.shields.io/badge/平台-Linux-9cf)
![产物](https://img.shields.io/badge/产物-AppImage_97MB-orange)
![引擎](https://img.shields.io/badge/引擎-Electron-lightgrey)

在 Linux 桌面上同时使用 SVN 和 Git 的项目团队,不用再装两套 GUI 客户端。本工具提供状态检测、历史记录、并排差异对比、分支/标签/Stash、文件夹浏览,以及行业内少见的**行级冲突检测 + 提交拦截 + 三方冲突解决**完整防护闭环。纯本地服务,凭据不落盘明文,操作命令全程透明可预览。

- 详细使用教程: [Git 使用说明](docs/usage-git.md) · [SVN 使用说明](docs/usage-svn.md)
- 架构设计: [docs/architecture.md](docs/architecture.md) · 项目优势: [docs/advantages.md](docs/advantages.md)

---

## ✨ 特色一览

| 特色 | 说明 |
|---|---|
| **双引擎统一** | 自动识别仓库类型,SVN / Git 同一套界面与操作,分支/标签/提交/更新/还原体验一致 |
| **行级冲突防护闭环** | 提交前精确到"哪个文件第几行冲突"强制拦截 → 服务器更新交集提示 → 2 分钟主动监控 → 三方冲突解决器,四层防护一气呵成 |
| **命令预览** | 悬浮任何操作按钮/菜单项,直接显示"将执行的真实命令",教学与透明两不误 |
| **凭据安全** | SVN 密码走 `--password-from-stdin`(ps 不可见)、配置文件 600 权限;Git 推送认证 base64 存储 + `GIT_ASKPASS` 重试 |
| **零部署轻量** | 单个 AppImage(约 97MB)内置 Electron,目标机无需 Node/浏览器;后端零框架,只监听 127.0.0.1 |

---

## 🚀 快速开始

### 方式一:AppImage(推荐,免装 Node、免装浏览器)

下载 `svn-git文件版本管理-1.0.0.AppImage` 后:

```bash
chmod +x ./svn-git文件版本管理-1.0.0.AppImage   # 首次需要执行权限
./svn-git文件版本管理-1.0.0.AppImage            # 直接运行
./svn-git文件版本管理-1.0.0.AppImage /path/to/repo   # 指定仓库目录启动
```

默认启动后弹出**应用窗口**(内置 Electron 渲染引擎,不依赖系统浏览器);关闭窗口即退出。

**使用系统浏览器**:加 `--browser` 参数改用浏览器标签操作:

```bash
./svn-git文件版本管理-1.0.0.AppImage --browser
```

此时服务在后台运行,用页面右上角「退出应用」停止。

> 环境要求:
> - 系统需安装 `svn` 和 `git` 命令(工具启动时自动检测,缺失时引导安装)
> - AppImage 依赖 FUSE;无法挂载时用 `--appimage-extract-and-run` 运行

### 方式二:源码运行

```bash
npm install
npm run dev            # 开发模式(热更新,用浏览器访问 http://127.0.0.1:23456)
npm run dist:linux     # 打包 AppImage
```

### Windows

Windows 安装包(`.exe`)由 GitHub Actions 在 tag 发布时自动构建(见 `.github/workflows/release.yml`),也可在本地 Windows 执行 `npm run dist:win`。Windows 前置:安装 [TortoiseSVN](https://tortoisesvn.net/) 时**必须勾选 `command line client tools`**(默认不勾选,勾选后才有 svn.exe 并加入 PATH)和 [Git for Windows](https://git-scm.com/)。项目根目录的 `运行.bat` 可在 Windows 下以源码方式一键安装依赖并启动。

---

## 📸 功能预览

| 打开项目(目录浏览) | 文件浏览网格(状态徽标) |
|---|---|
| ![打开项目](docs/screenshots/git/01-open.png) | ![文件浏览](docs/screenshots/git/02-browse.png) |

| 树视图 | 历史记录 |
|---|---|
| ![树视图](docs/screenshots/git/03-tree.png) | ![历史](docs/screenshots/git/04-log.png) |

| 分支管理 | 标签管理 |
|---|---|
| ![分支](docs/screenshots/git/05-branch.png) | ![标签](docs/screenshots/git/06-tags.png) |

| 并排差异对比 | 勾选式提交 |
|---|---|
| ![并排差异](docs/screenshots/git/07-diff.png) | ![提交](docs/screenshots/git/08-commit.png) |

> 截图均来自 Git 仓库;SVN 仓库的界面与操作完全一致(工具栏少 Stash/推送,多更新/清理/登录),见 [SVN 使用说明](docs/usage-svn.md)。

---

## 🏗 技术栈与项目结构

### 技术栈

| 层 | 技术 |
|---|---|
| 前端 | React 18 + TypeScript(esbuild 单文件打包,约 500KB) |
| 服务 | Node 内置 http(REST API + SSE),仅监听 127.0.0.1 |
| 桌面外壳 | Electron(可选;纯 node 也能跑,供浏览器访问) |
| VCS | 包装官方 `svn` / `git` 命令行(`--xml` / `--porcelain` 机器格式) |

### 目录结构

```
src/
├── server.ts          # HTTP 服务层(API + 静态文件 + 路由分发)
├── main.tsx           # Electron 入口(打包版窗口 / --browser 外部浏览器)
├── config.ts          # 配置读写(~/.config/svnkit/config.json,600 权限)
├── preload.cjs        # Electron preload
├── routes/            # API 路由域模块
│   ├── ops.ts         #   操作类:add/commit/update/revert/delete/push/重命名/忽略/锁定
│   ├── branch.ts      #   分支/标签/Stash/提交改写/未推送
│   ├── conflicts.ts   #   冲突防护:preflight/conflicts/合并预检/Blame
│   └── util.ts        #   共享工具:路径安全校验/状态缓存/认证判定
├── vcs/               # VCS 抽象层
│   ├── types.ts       #   统一 Vcs 接口(平台独有能力可选)
│   ├── index.ts       #   createVcs 工厂
│   ├── svn.ts         #   SVN 实现(包装 svn 命令行)
│   ├── git.ts         #   Git 实现(包装 git 命令行)
│   ├── diff-lines.ts  #   行级冲突算法(纯函数)
│   ├── exec.ts        #   子进程封装(stdin 传密码/超时/取消/输出上限)
│   └── detect.ts      #   仓库类型识别
├── platform/          # 平台抽象(win32/linux 双实现:打开方式/图标/环境安装)
└── web/               # React 前端
    ├── app.tsx        #   主框架:视图调度/提交预检/冲突拦截/远程监控
    ├── fs.tsx         #   文件夹浏览(列表/树/网格/多选/过滤树/右键菜单/重命名)
    ├── history.tsx    #   历史记录(总数/过滤/未推送标记)
    ├── diff.tsx       #   并排差异对比
    ├── vcs-dialogs.tsx#   分支/标签/Stash/新建仓库弹窗
    ├── conflicts.tsx  #   三方冲突解决器
    ├── cmd-preview.ts #   命令预览模板表
    ├── motion.tsx     #   角标定位/跳转动画
    └── …              #   其余组件(弹窗外壳/图标/主题/侧边栏等)
scripts/               # 构建、开发、截图脚本
test/                  # 自动化测试(npm test,130 项断言)
```

### 架构

```
Web 前端(React + esbuild 单文件)
    ↕ REST API + SSE
HTTP 服务层(Node 内置 http,仅监听 127.0.0.1,固定端口 23456)
    ↕ 统一 Vcs 接口
VCS 抽象层(SvnVcs / GitVcs,包装官方命令行)
    ↕
svn / git 命令行(系统安装)
```

- 只解析官方 `--xml` / `--porcelain` 机器格式,不解析内部格式
- 密码走 `--password-from-stdin`(ps 不可见),配置文件 600 权限

---

## 📦 功能总览

### 状态与浏览

- **三种文件视图**:列表 / 树 / 文件浏览器(图标网格、状态角标、修改数量标识),切换保留位置与选中
- 文件/文件夹状态徽标:M 黄 / A 绿 / D 红 / ? 灰 / ! 紫 / C 红底
- **状态过滤**:工具栏「仅修改 / 仅新文件 / 仅删除」可多选组合,过滤结果以树视图展示,**双击文件直接跳转定位**(带面包屑点亮动画)
- 文件名搜索(自动定位)、键盘导航(↑↓ 选择、→/Enter 进入、← 返回)、右键上下文菜单、面包屑导航
- **多选批量操作**:浏览模式矩形框选 / Ctrl 点选,列表与树 Ctrl+Shift 范围选;右键菜单按选中集合的**操作能力分组**(添加 / 提交 / 还原 / 从版本库移除 / 删除磁盘文件 / 复制路径,各自带计数,混选自动拆分不误伤);还原按状态动态命名(全 A =「取消添加」、全 D =「恢复删除」)
- **文件/文件夹重命名**:右键「重命名」,版本化文件走 `svn move` / `git mv`(提交后生效),未版本化(?/I)文件直接磁盘改名
- 常用文件夹预加载(SVN:右键加入后后台递归缓存,点击秒开)

### 历史与差异

- 提交历史:版本/作者/时间/信息,**顶部显示提交总数**(如「历史: 全部提交(92)」),支持按消息/作者/版本号模糊过滤
- Git 历史中未推送提交带绿点标记;未推送提交可右键**修改注释**(amend/reword)或撤销(reset --soft)
- **并排双栏对比**:左原版右当前,修改行 M 标记,滚动条绿红点全局预览,点击修改处双向跳转;**中间分隔栏可拖动**调整左右宽度(15%–85%)
- 左右栏**独立搜索框**,分别定位各自栏内代码
- 代码语法高亮(C/C++/Python/JS/TS 等 11 种)、文件内代码搜索
- Blame 逐行追溯(版本 + 作者)

### 版本管理操作

- **SVN + Git 统一**:分支(创建/切换/合并/删除)、标签(创建/删除);切换/合并前自动预检工作区改动与冲突文件
- **Git 专属**:Stash(保存/恢复/丢弃)、推送(未推送计数角标 + 确认弹窗 + 进度窗可取消)、清理未跟踪文件、修改提交注释、撤销提交
- **Git 远程分支**:分支弹窗中远程行可直接「删除远程」(git push --delete,进度窗可取消);本地未推送分支可「推送到远程」(首次自动建立上游跟踪)
- **SVN 专属**:锁定/解锁、svn:ignore 忽略、svn cleanup、切回主干、更新结果详情弹窗(终端式状态字母列表 + 按状态统计 + 当前版本号 + 警告完整展示)
- 创建/克隆仓库(git init / git clone / svnadmin create)
- **勾选式提交**:提交弹窗内文件可勾选(默认全选,一键全选/全不选),提交前二次确认;未版本化(?)文件不进入提交列表(需先"添加到版本库")
- **命令预览**:悬浮菜单项/按钮显示将执行的真实命令(git/svn 双引擎模板,50+ 处接入)

### 🛡 并发修改防护(特色)

1. **行级冲突检测**:提交时精确提示"哪个文件第几行冲突",强制拦截 + 处理指引(备份 → 删除 → 更新 → 手动合并)
2. **服务器更新交集提示**:服务器有新提交且**待提交文件与服务器更新文件有交集**时,弹窗列出可能冲突文件(双击查看差异、可先更新);无交集不打扰
3. **2 分钟主动监控**:你修改的文件被他人先提交 → 警示条 + 「查看对比」(对方改动 diff vs 你的改动 diff)
4. **三方冲突解决器**:基础/本地/对方三栏对比,采用本地/对方/手动编辑,一键解决;合并前另有 **merge-tree 三方预检**,提前预告"即使提交后再合并仍会冲突"的文件

### 界面与体验

- 六套浅色主题(侧边栏一键切换)、字号与字体设置(⋯ 菜单)、彩色 SVG 图标(不依赖系统 emoji 字体)
- **弹窗通用可调整大小**:边缘/四角 8 方向拖拽,右上角最大化/还原/关闭
- 中文本地化、中文文件名/提交信息完整支持
- SVN 登录管理(账号切换/退出登录)、Git 认证引导(GitHub token / 服务器密码 / SSH 三种场景分引导)、环境检测与安装引导(SSE 实时日志)
- 远程网络状态灯:30 秒检测,最近 3 次结果三态(绿/黄/红),认证失败单独区分,点击圆点手动检测

---

## 🧪 测试

```bash
npm test   # 一键执行全部 130 项断言
```

| 测试文件 | 覆盖 |
|---|---|
| `test/vcs-test.mjs` | VCS 层 47 项(git/svn 状态、提交、还原、重命名等,自动重建测试仓库) |
| `test/vcs-extra-test.mjs` | 扩展功能 45 项(分支/标签/Stash/忽略/冲突等) |
| `test/diff-lines-test.mjs` | 行级冲突算法 6 项 |
| `test/api-test.mjs` | HTTP API 集成 32 项(真实服务端到端:越界拦截/CSRF/缓存失效/软删 keep/重命名 API 等) |

> 测试仓库在项目根 `svnkit-test/` 下(vcs-test 会自动重建 SVN 仓库并将 Git 仓库重置到固定基准提交,不依赖外部网络);CI(`.github/workflows/test.yml`)在 push/PR 时自动跑全量测试。

---

## 🤝 贡献与许可

欢迎通过以下方式参与:

- **提 issue**:报告 bug、功能建议、使用疑问
- **提 PR**:修复问题、改进界面与交互
- **翻译**:完善界面文案与其他语言的文档

请先阅读 [docs/architecture.md](docs/architecture.md) 了解架构,PR 请附带对应测试。

本项目使用 [MIT License](LICENSE) 开源。

Copyright © 2026
