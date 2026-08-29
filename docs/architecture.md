# 架构文档 — svn-git文件版本管理

## 1. 项目概述

**svn-git文件版本管理** 是一个浏览器图形界面的 SVN/Git 双引擎版本管理工具。自动识别仓库类型（SVN / Git），提供状态检测、历史记录、差异对比、文件夹浏览、分支/标签/Stash 管理和并发修改防护（冲突预警、行级拦截、三方解决）等完整功能。全部鼠标操作，无需学习命令行。

**定位**：面向同时使用 SVN 和 Git 的团队/个人，一套工具统一管理两种版本库。

## 2. 技术栈

| 层 | 技术 | 说明 |
|---|---|---|
| 后端 | Node.js（内置 http 模块） | 无第三方框架，零额外依赖 |
| 前端 | React 18 + esbuild | esbuild 打包单文件 bundle（约 500KB），无构建框架链 |
| 打包 | electron-builder | AppImage 内置 Electron 运行时，免装 Node |
| 语法高亮 | highlight.js（子集 11 语言） | 按需注册，体积可控 |
| XML 解析 | fast-xml-parser | svn --xml 机器输出解析 |

**依赖设计原则**：外部依赖仅 `svn` / `git` 命令行（工具包装官方命令行，不解析内部格式，保证与官方行为一致）。

## 3. 架构分层

```
┌─────────────────────────────────────────────┐
│  Web 前端（src/web/）                        │
│   React 组件：视图/弹窗/图标库/API 封装      │
├─────────────────────────────────────────────┤
│  HTTP 服务层（src/server.ts + src/routes/）  │
│   60+ REST API + SSE 流（安装日志）          │
│   静态文件服务 · 路径安全校验 · 认证错误处理  │
├─────────────────────────────────────────────┤
│  VCS 抽象层（src/vcs/）                      │
│   Vcs 接口 + SvnVcs / GitVcs 双实现          │
│   （status/log/diff/branches/tags/stash/…）  │
│   exec.ts 子进程封装（stdin 传密码/超时/取消）│
├─────────────────────────────────────────────┤
│  外部：svn / git 命令行（系统安装）           │
└─────────────────────────────────────────────┘
```

### 3.1 VCS 抽象层（src/vcs/）

`src/vcs/types.ts` 定义统一 `Vcs` 接口：**公共方法两实现必选，平台独有能力可选（`?.` 调用）**——如 `mergeCheck`（git 才有）、`branchPush`（git 才有）、`update`（svn 才有）。`createVcs(repo, cred)`（`src/vcs/index.ts`）按仓库类型返回 `SvnVcs` 或 `GitVcs`，上层无感知切换；接口方法缺失在编译期报错（无 `as any` 逃逸）。

| 能力 | SVN 实现 | Git 实现 |
|---|---|---|
| status | `svn status --xml` + item 单词映射 | `git status --porcelain=v1` |
| log | `svn log -r HEAD -v --xml` | `git log --format=%x1f 分隔` + 按行扫描解析 |
| diff | `svn diff`（中英文输出兼容解析） | `git diff` + `--cached` 合并 |
| move 重命名 | `svn move`（D+A 调度） | `git mv` |
| branches | `svn list/copy/switch/merge`（自动创建 branches/） | `git branch/checkout/merge` + `push -u` + `push --delete` |
| tags | `svn list/copy/delete`（自动创建 tags/） | `git tag -a/-d` |
| stash | — | `git stash push -u/pop/drop` |
| blame | `svn blame` | `git blame --porcelain` |
| 锁定 | `svn lock/unlock` | — |
| 忽略 | `svn propset svn:ignore` | 写 .gitignore |

**关键解析策略**：
- 全部使用**机器格式**（`--xml` / `--porcelain` / 自定义 `--format` 分隔符），不解析人读文本
- **中英文 locale 兼容**：merge 成功文案、commit 版本号、svn update 输出解析均双模式匹配（项目运行在 zh_CN.UTF-8 环境，实测验证）
- **update 输出解析**：解析状态行 → 文件列表（终端式状态字母）+ 当前版本号（中英文，取不到时补查 `svn info`）；警告行（W205011/W175013…）原样带回展示
- **E205011 容错**：svn:externals 外部定义失败（不可达/无权限）时自动用 `--ignore-externals` 重试一次，跳过外部引用先更新普通文件，两次输出按路径去重，外部定义警告仍完整展示
- **子进程隔离**（`src/vcs/exec.ts`）：统一封装 spawn、stdin 数据（SVN 密码走 `--password-from-stdin`，不进命令行参数）、超时、取消信号（AbortSignal，前端请求断开即杀子进程，更新/推送可取消）、输出上限（64MB）
- **行级冲突算法**（`src/vcs/diff-lines.ts`）：纯函数解析 unified diff，返回 BASE 侧 `del`（删除行）/ `ins`（插入位置）行号集合——独立模块，6 项单测覆盖
- **Git 认证重试**（`src/vcs/git.ts`）：推送类操作认证失败时用保存的凭据生成 `GIT_ASKPASS` 脚本（base64 传参、600 权限）自动重试一次；仍失败返回 `authType`（github / server / ssh）供前端分场景引导

### 3.2 HTTP 服务层（src/server.ts + src/routes/）

- 仅监听 **127.0.0.1 固定端口 23456**（被占用时自动换随机端口；安全：不对外暴露，端口可预期便于收藏）
- **路由按域拆分**（`src/routes/`，`handle()` 顺序分发，server.ts 约 1300 行）：
  - `conflicts.ts`：preflight / conflicts / conflict-detail / merge-check / resolve-conflict / blame / text-diff / reveal
  - `branch.ts`：branches / branch（create/switch/delete/merge/merge-abort/push/remote-delete）/ tags / tag / stash / git-amend / git-reword / git-reset / git-unpushed*
  - `ops.ts`：add / commit / update / revert / delete（keep 软删）/ push / move / fs-move / fs-delete / locate / svn-extra / svn-lock / ignore 系列 / git-clean / unignore
  - `util.ts`：共享工具（inRepoRoot / realpathSafe / isSafeOrigin / sendJson / readBody / 状态缓存 / authErrorOf）
- **状态缓存 30 秒**（`STATUS_TTL = 30_000`）：`/api/status`、`/api/fs`、`/api/filtered-tree` 共用；**写操作成功后 `invalidateStatusCache(root)` 立即失效**（add/commit/update/revert/delete/move/忽略/锁定等全部接入），保证界面不显示旧状态
- **preflight 提交预检**（conflicts.ts）：服务器版本对比（`remoteHasUpdate`/`updatedFiles`/`behind`/`remoteLogs`）+ 行级冲突计算（对方改动行 ∩ 我的改动行）+ svn 锁检查；前端据 `updatedFiles ∩ 待提交文件` 决定是否提示"服务器有新版本"
- **合并预检**（`/api/merge-check`）：git = switchCheck 文件级交集 + `merge-tree` 三方试算的 `lineConflicts`（两边已提交改动重叠 → 提交后再合并仍冲突）；svn = 改动统计 + outdated 检测（WC 落后必须更新才能合并）
- **过滤树**（`/api/filtered-tree`）：按状态码（M/A/D/R/C/!/~/U 或 ? 或 D）构建目录树；'?' 未版本化目录递归展开内部全部文件（跳过 .gitignore 匹配项）
- **角标定位**（`/api/locate`）：目录下指定状态的文件按 mtime 降序返回，点击文件夹角标跳"最近一个"（前端 `flashBreadcrumbs` 动画点亮面包屑）
- **SSE 流**（`/api/env-install/stream`）：安装 svn/git 时实时推送日志（平台差异下沉 `src/platform`：win=winget 引导，linux=免密 sudo 自动装）
- **网络灯**（`/api/net-check`）：git ls-remote / svn ls 只握手不取数据，8s 超时；区分"断网"与"认证失败"（认证失败=网络通）
- **路径安全**：所有带路径参数接口做 `inRepoRoot` 校验——**两侧 realpath 解析**（`realpathSafe` 对不存在路径逐级上溯最长存在前缀），防 `../` 穿越与仓库内 symlink 指向仓库外的绕过；写好端点的校验前置，不受 TOCTOU 影响
- **CSRF**：全 API 层 Origin 校验（127.0.0.1 / localhost / [::1] 视为本机），跨站请求一律 403
- **内容上限**：文本读取 5MB 预检（先 statSync 再读）、图片 50MB、请求体超限即 `req.destroy()` 断连
- **认证错误统一处理**：VCS 层识别打标（`VcsResult.code: 'AUTH'`），服务层 `authErrorOf` 透传 → 前端自动弹登录框
- 静态文件带 `Last-Modified`（开发模式热刷新依赖）
- **最近项目历史**（`~/.config/svnkit/history.json`，600 权限）：服务端持久化（浏览器端口随机，localStorage 不可靠），上限 20 条，支持常用标记（fav，启动时优先打开）

### 3.3 Web 前端（src/web/）

| 模块 | 职责 |
|---|---|
| app.tsx | 主框架：工具栏/侧边栏/视图调度/弹窗管理/提交预检（冲突拦截+交集提示）/2 分钟远程监控/操作分派 |
| fs.tsx | 文件夹视图三模式（列表/树/浏览网格）+ **多选**（矩形框选/Ctrl 点选/Shift 范围选，右键按操作能力分组）+ 键盘导航 + 搜索定位 + 过滤树 + 重命名菜单 + 常用文件夹（svn） |
| header.tsx | 顶部工具栏：传输/分支/清理/刷新/⋯ 更多菜单（打开项目/新建仓库/标签/字体设置/登录）+ 网络状态灯（30s 检测、三态） |
| sidebar.tsx | 侧边栏：视图导航（历史/文件夹）+ 最近项目（右键删除/设常用）+ 主题色块 |
| history.tsx | 历史记录（提交总数/模糊过滤/未推送标记/右键 amend/reword/reset） |
| diff.tsx + diff-render.tsx | 并排双栏对比（行映射/修改块导航/滚动条预览标记）+ 分隔栏拖拽调宽 + 左右独立搜索框 |
| open.tsx | 启动页/打开项目（最近列表 + 路径输入 + 目录浏览 + 拖拽识别） |
| vcs-dialogs.tsx | 分支（含推送到远程/删除远程，进度窗可取消）/标签/Stash/新建仓库/清理/Git 信息与配置/Git 推送认证引导 |
| conflicts.tsx | 三方冲突解决器（git :1/:2/:3 暂存区；svn .mine/.r 文件） |
| remote-conflicts.tsx | 远程冲突对比（对方改动 vs 我的改动） |
| modals.tsx | 提交（勾选列表，默认全选）/登录/确认/更新结果/还原清单/重命名 弹窗 |
| push-confirm.tsx | 推送确认弹窗（未推送提交列表 + 推送条件 + 右键改注释/撤销） |
| cmd-preview.ts | **命令预览模板表**：`CMDS` 键 → 命令模板（git/svn 双引擎，占位符 %key% 替换），悬浮操作项显示将执行的真实命令 |
| motion.tsx | **定位/跳转动画**：面包屑逐级点亮（.crumb-flash）+ 文件卡片脉冲（.file-pulse）；尊重系统"减少动效"偏好 |
| modal-shell.tsx | 通用弹窗外壳：8 方向边缘拖拽调整大小 + 右上角最大化/关闭 + Esc 关闭 + 焦点圈禁（遮罩点击不关闭） |
| badges.tsx / icons.tsx | 状态徽标 / 彩色 SVG 图标库（不依赖系统 emoji 字体） |
| highlight.tsx / markdown.ts | 语法高亮（11 语言）/ Markdown 预览渲染 |
| fav-dirs.tsx | 常用文件夹管理弹窗（svn 预加载缓存） |
| ignore-modal.tsx / font-modal.tsx / dir-picker.tsx | 忽略规则 / 字号与字体设置 / 文件夹选择器 |

**前端关键机制**：
- **视图常驻**（display 切换不卸载）：切换视图保留位置/展开状态/选中项
- **键盘导航**：↑↓ 选择、→/Enter 进入、← 返回（网格模式按列数跳行）
- **多选集合操作**：selected 集合贯穿三视图，右键项在集合内时菜单作用于整个集合——按操作能力分组（tNew 添加 / tMod 提交·还原 / tVer 从版本库移除 / tFsDel 删除磁盘文件，各自计数），混选自动拆分；还原按状态动态命名（全 A=取消添加、全 D=恢复删除）
- **提交前预检**：`/api/preflight` 行冲突强制拦截（无"继续提交"按钮）→ 服务器更新交集提示（双击看差异）→ 检查失败明示"本次提交不经过拦截"，知情决策
- **弹窗一致性**：全部弹窗走 `ResizableModal` 外壳（8 方向拖拽 + 最大化 + Esc 关闭）
- **命令预览**：右键菜单/文件行内按钮/弹窗按钮统一接入 `cmdOfRepo(repoType, key, vars)`，悬浮即显示真实命令

## 4. 核心设计决策

### 4.1 为什么包装命令行而非解析内部格式
- SVN 的 `.svn/wc.db`（SQLite）格式复杂、版本间变动大；Git 的 `.git/objects` 内容寻址
- 命令行是官方稳定接口，`--xml`/`--porcelain` 输出契约稳定
- 天然获得官方全部能力（合并算法、认证、网络协议），行为与 CLI 完全一致

### 4.2 开发模式热更新架构（scripts/dev.mjs）
- 后端：`tsc -w` 编译 + `node --watch` 自动重启
- 前端：`tsc -p tsconfig.web.json -w` 仅类型检查（noEmit）+ esbuild `context()` 热构建（bundle 归 esbuild）
- 页面轮询 `Last-Modified` 自动刷新（服务重启也感知）
- 双 tsconfig：后端编译输出 / 前端仅类型检查

### 4.3 凭据安全
- SVN 密码 + Git 推送凭据存 `~/.config/svnkit/config.json`（chmod 600；git 凭据 base64 存储）
- 调用 svn 用 `--password-from-stdin` 从管道传密码——**不出现在进程列表（ps）**
- Git 推送用 `GIT_ASKPASS` 脚本重试（脚本 600 权限）
- 支持 HTTPS 自签名证书开关

### 4.4 平台抽象（src/platform/）
- `Platform` 接口（打开方式 / 图标 / 文件管理器定位 / 浏览器 / 环境安装），`index.ts` 按 `process.platform` 组装 win32 或 linux 实现，调用方不接触平台分支
- Windows 支持系统「打开方式」选择器、从 .exe 提取图标、注册表枚举关联程序；Linux 按 MIME 匹配 .desktop 程序、主题图标

### 4.5 环境自检与安装引导
- 启动检测 `svn --version` / `git --version`
- 缺失时横幅提示 → 安装弹窗：免密 sudo 一键 `apt-get install`（SSE 实时日志）或手动命令引导（Windows 为 winget 引导）

### 4.6 产物体积控制
- `electron-builder.yml` 的 `electronLanguages` 只保留 zh-CN/en-US（Electron locales 40M → ~2M）
- 产物 AppImage 约 97MB（Electron 主二进制为固有成本，不再裁剪）

## 5. 并发修改防护体系（特色）

四层防护，覆盖"预防 → 监控 → 解决"：

```
① 行级冲突检测（提交/推送时，/api/preflight）
   对方改动行号 ∩ 我的改动行号（含插入位置）→ 精确到行
   → 有行冲突：强制拦截提交（无"继续提交"按钮），引导 备份→删除→更新→手动合并
② 服务器更新交集提示（提交前）
   服务器有新提交（remoteHasUpdate）时，取 updatedFiles ∩ 待提交文件
   → 有交集：弹窗列出可能冲突文件（双击查看差异、可"先更新"）
   → 无交集：不打扰，直接进入提交界面
③ 2 分钟主动监控（前端定时 /api/preflight，120s 周期）
   你修改的文件被他人先提交 → 警示条 + [查看对比]（对方改动 diff vs 我的改动 diff）
④ 三方冲突解决器（/api/conflicts + resolve-conflict）
   git: :1/:2/:3 暂存区三方；svn: .mine/.r 文件
   基础/本地/对方 三栏 + 手动编辑 + 采用本地/对方/保存手动
```

**行冲突算法**（`diffChangedLines`，src/vcs/diff-lines.ts）：
```ts
解析双方 unified diff：
  del = 被删除/修改的 BASE 行号集合
  ins = 插入位置集合（+ 行对应的 BASE 行号）
行冲突 = (del ∩ del) ∪ (ins ∩ ins)
```
覆盖修改同行、删除同行、同位置追加（纯 + 行）三类真实冲突。文件头行采用"三横线/三加号+空格"精确匹配，避免 markdown 分隔行（`----`/`++++`）误判导致行号偏移。

**合并预检**（`/api/merge-check`，git）：L1 = switchCheck 工作区文件级交集（未提交改动与分支改动重叠必拒）；L2 = `git merge-base` + `git merge-tree` 三方试算——两边**已提交**的改动重叠的文件（`lineConflicts`），即使提交后再合并仍冲突，合并前提前预告（工作区未提交部分已由 L1 拦截）。

## 6. 目录结构

```
src/
├── main.tsx            # 入口：启动服务 + Electron 窗口 / --browser 外部浏览器
├── server.ts           # HTTP 服务：API 分发 + 静态文件 + 固定端口 23456（约 1300 行）
├── config.ts           # 配置读写（~/.config/svnkit/config.json，600 权限）
├── preload.cjs         # Electron preload 桥接（目录选择/文件路径）
├── routes/             # API 路由域模块
│   ├── conflicts.ts    #   冲突防护：preflight/conflicts/merge-check/blame
│   ├── branch.ts       #   分支/标签/Stash/提交改写/未推送
│   ├── ops.ts          #   操作类：add/commit/update/revert/delete/move/忽略/锁定
│   └── util.ts         #   共享工具：路径校验/状态缓存/认证判定/CSRF
├── vcs/                # VCS 抽象层
│   ├── types.ts        #   统一 Vcs 接口（必选 + 平台可选 ?.）
│   ├── index.ts        #   createVcs 工厂
│   ├── svn.ts          #   SVN 实现（792 行）
│   ├── git.ts          #   Git 实现（1071 行）
│   ├── diff-lines.ts   #   行级冲突算法（纯函数）
│   ├── exec.ts         #   子进程封装（stdin/超时/取消/输出上限 64MB）
│   ├── ignore.ts       #   忽略规则匹配（.gitignore / svn:ignore）
│   └── detect.ts       #   仓库类型识别（向上查找 .svn/.git）
├── platform/           # 平台抽象（win32/linux 双实现）
└── web/                # React 前端（31 个文件）
    ├── app.tsx         # 主框架 + 提交预检（冲突拦截/交集提示）
    ├── fs.tsx          # 文件夹三模式视图 + 多选批量操作 + 过滤树
    ├── history.tsx     # 历史记录（总数/过滤/未推送）
    ├── diff.tsx        # 并排对比（分隔栏拖拽/左右独立搜索）
    ├── vcs-dialogs.tsx # 分支/标签/Stash/新建仓库/Git 认证引导
    ├── conflicts.tsx   # 三方冲突解决
    ├── cmd-preview.ts  # 命令预览模板表
    ├── motion.tsx      # 定位/跳转动画
    ├── modal-shell.tsx # 通用弹窗外壳（8 方向调整大小/最大化）
    └── …               # 其余组件（header/sidebar/badges/icons/open/modals 等）
scripts/                # 构建/开发/截图脚本
test/                   # 自动化测试（npm test，130 项断言）
docs/                   # 文档与截图
```
*（src 下纯 TS/TSX 约 15,600 行）*

## 7. 测试策略

| 层 | 方式 |
|---|---|
| VCS 单元测试 | `test/vcs-test.mjs`（47 项）+ `test/vcs-extra-test.mjs`（45 项），自动重建测试仓库 |
| 行级冲突算法 | `test/diff-lines-test.mjs`（6 项纯函数测试） |
| HTTP API 集成 | `test/api-test.mjs`（32 项，真实服务端到端：越界拦截/CSRF/缓存失效/软删 keep/重命名 API/net-check 等） |
| Windows 回归 | `test/windows-api-test.mjs`（自建独立仓库打全部 REST 接口，中文不乱码 + 无 500） |
| 安全测试 | 路径穿越 403、错误参数、中文/空格文件名、大文件截断、并发请求、跨站 Origin 403 |
| 凭据安全 | 密码不出现在 ps、配置 600 权限、仅监听 127.0.0.1 |

`npm test` 一键执行全部 130 项断言；CI（`.github/workflows/test.yml`）在 push/PR 时自动跑全量。

## 8. 性能

- 子进程异步执行，界面不阻塞
- **状态缓存 30 秒**（/api/status、/api/fs、/api/filtered-tree 共用），写操作后 `invalidateStatusCache` 立即失效
- 树模式按需加载（展开时才拉取目录）
- 大文件截断（文本 5MB 预检、对比内容 200KB 截断）
- 前端 bundle 约 500KB（esbuild 单文件），语法高亮按需注册
- SVN 大仓库子项目：`currentScopes` 限定状态扫描范围，避免全仓库扫描卡顿

## 9. 已知限制

- AppImage 不包含 svn/git 二进制（系统级依赖，与认证缓存耦合）
- 依赖系统 locale（zh_CN.UTF-8 为主验证环境，中英文输出均兼容）
- 安装引导需要免密 sudo 或手动命令
