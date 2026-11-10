# 架构文档 — svn-git 文件版本管理

> 对应版本 1.7.2 · 更新时间 2026-11-09

## 1. 项目概述

**svn-git 文件版本管理**是一个 SVN / Git 双引擎图形化版本管理工具。自动识别仓库类型（SVN / Git），提供状态检测、历史记录、差异对比、文件夹浏览、分支 / 标签 / 工作树 / Stash、代码统计、局域网共享、发版与在线更新，以及并发修改防护（冲突预警、行级拦截、三方解决）等完整功能。桌面窗口与浏览器两种形态，全部鼠标操作，无需学习命令行。

**定位**：面向同时使用 SVN 和 Git 的团队 / 个人，一套工具统一管理两种版本库。

**规模**：`src/` 约 290 个文件、7.1 万行；前端 13 个业务域；服务端 34 个路由域文件；界面中英双语 2812 条 ×2。

## 2. 技术栈

| 层 | 技术 | 说明 |
|---|---|---|
| 后端 | Node.js（内置 http 模块） | 无第三方框架，零额外依赖 |
| 前端 | React 18 + esbuild | esbuild 打包单文件 bundle，无构建框架链 |
| 桌面外壳 | Electron 33 | AppImage / portable / NSIS；纯 Node 也能跑（浏览器 / WSL） |
| 打包 | electron-builder + 自研 WSL 打包 | AppImage / portable / NSIS / tar.gz |
| 语法高亮 | highlight.js（子集 11 语言） | 按需注册，体积可控 |
| XML 解析 | fast-xml-parser | svn --xml 机器输出解析 |
| 在线更新 | electron-updater + 自研 WSL 更新 | AppImage / Portable / WSL 包 |
| 测试 | 自研断言 + Playwright | 12 个套件约 400 项 + 前端冒烟 |

**依赖设计原则**：外部依赖仅 `svn` / `git` 命令行（工具包装官方命令行，不解析内部格式，保证与官方行为一致）。

## 3. 架构分层

```
┌──────────────────────────────────────────────────────────┐
│  Web 前端（src/client/，13 个业务域）                      │
│  shell 外壳 · filesystem 浏览 · history 历史差异           │
│  ops 操作 · repo 仓库接入 · conflicts 冲突 · stats 统计     │
│  share 共享 · appearance 外观 · animations 动效 · terminal │
├──────────────────────────────────────────────────────────┤
│  HTTP 服务层（src/server/）                               │
│  REST API + SSE + NDJSON 流 · 静态文件 · CSRF/Host 校验    │
│  共享门禁（IP/会话/只读）· 路径安全 · 认证错误透传          │
├──────────────────────────────────────────────────────────┤
│  VCS 抽象层（src/vcs/）                                   │
│  Vcs 接口 + SvnVcs / GitVcs 双实现                        │
│  （status/log/diff/branches/tags/stash/worktree/…）       │
│  exec.ts 子进程封装（stdin 传密码 / 超时 / 取消）          │
├──────────────────────────────────────────────────────────┤
│  平台层（src/platform/）  win32 / linux 双实现             │
│  外部：svn / git 命令行（系统安装）                        │
└──────────────────────────────────────────────────────────┘
```

### 3.1 VCS 抽象层（src/vcs/）

`src/vcs/types.ts` 定义统一 `Vcs` 接口：**22 个公共必选方法 + 22 个可选能力**——平台独有能力用 optional 方法 + `?.` 调用，如 `mergeCheck`（git）、`branchPush`（git）、`update`（svn）。`createVcs(repo, cred)`（`src/vcs/index.ts`）按仓库类型返回 `SvnVcs` 或 `GitVcs`，上层无感知切换；接口缺失在编译期报错（无 `as any` 逃逸）。

| 能力 | SVN 实现 | Git 实现 |
|---|---|---|
| status | `svn status --xml` + item 单词映射 | `git status --porcelain=v1` |
| log | `svn log -r HEAD -v --xml` | `git log --format=%x1f` 分隔 + 按行扫描解析 |
| diff | `svn diff`（中英文输出兼容解析） | `git diff` + `--cached` 合并 |
| move 重命名 | `svn move`（D+A 调度） | `git mv` |
| branches | `svn list/copy/switch/merge`（自动创建 branches/） | `git branch/checkout/merge` + `push -u` + `push --delete` |
| tags | `svn list/copy/delete`（自动创建 tags/） | `git tag -a/-d` |
| stash | — | `git stash push -u/pop/drop` |
| blame | `svn blame` | `git blame --porcelain` |
| 锁定 | `svn lock/unlock` | — |
| 忽略 | `svn propset svn:ignore` | 写 .gitignore |
| 工作树 | — | `git worktree add/list/remove/prune` |
| 合并预检 | 改动统计 + outdated 检测 | `switchCheck` 文件交集 + `merge-tree` 三方试算 |

**关键解析策略**：

- 全部使用**机器格式**（`--xml` / `--porcelain` / 自定义 `--format` 分隔符），不解析人读文本
- **中英文 locale 兼容**：merge 成功文案、commit 版本号、svn update 输出解析均双模式匹配（项目运行在 zh_CN.UTF-8 环境，实测验证）
- **update 输出解析**：状态行 → 文件列表 + 当前版本号；警告行（W205011/W175013…）原样带回展示
- **E205011 容错**：svn:externals 外部定义失败时自动用 `--ignore-externals` 重试一次，两次输出按路径去重
- **子进程隔离**（`src/vcs/exec.ts`）：统一封装 spawn、stdin 数据（SVN 密码走 `--password-from-stdin`）、超时、取消信号（前端请求断开即杀子进程）、输出上限 64MB、进程树清理
- **行级冲突算法**（`src/vcs/diff-lines.ts`）：纯函数解析 unified diff，返回 BASE 侧 `del` / `ins` 行号集合——独立模块，6 项单测覆盖
- **hunk 解析**（`src/vcs/hunks.ts`）：`-U1` 差异解析与 patch 构造，纯函数，配合部分暂存
- **Git 认证重试**（`src/vcs/git.ts`）：推送类操作认证失败时用保存的凭据生成 `GIT_ASKPASS` 脚本（0700 权限、base64 传参）自动重试一次；仍失败返回 `authType`（github / server / ssh）供前端分场景引导
- **SVN 大工作副本**（`src/vcs/svn.ts`）：status 输出 >1MB 判定超大工作副本，进程级降级为 `status -N` 浅扫描；preflight 成功缓存 60s / 失败 10s，用 epoch 防并发旧值回写

### 3.2 HTTP 服务层（src/server/）

- 仅监听 **127.0.0.1 固定端口 23456**（被占用时自动换随机端口）。共享模式（`share.mode !== 'local'`）才监听 `0.0.0.0`，远程访问由 `access-control.ts` 校验 IP / 会话 / 只读
- **端口接管**：23456 被占用时先请求 `/api/info` 自证是否本工具旧实例；是则关闭旧实例并复用 23456，否则退回随机端口。测试脚本置 `SVNGIT_NO_PORT_TAKEOVER=1` 直接随机端口，避免误关用户实例
- **路由按域拆分**（`src/server/routes/`，34 个文件，`handle()` 顺序分发）：
  - `conflicts.ts`：preflight / conflicts / conflict-detail / merge-check / resolve-conflict / blame / text-diff
  - `branch.ts`：branches / branch（create/switch/delete/merge/merge-abort/push/remote-delete）/ tags / stash / git-amend / git-reword / git-reset / unpushed / commit-message
  - `ops/`：add / commit / update / revert / delete（keep 软删）/ push / move / fs-move / fs-delete / locate / ignore / git-clean / svn-lock / cleanup / resolve
  - `browse/`：目录列表 / 过滤树 / 文件内容 / 版本内容 / 文件名与内容搜索 / 行数过滤 / 代码统计 / ZIP 下载
  - `repobrowse.ts`：SVN 远程仓库树 / 文件预览 / 内容搜索 / 体积统计
  - `github.ts`：仓库信息 / 新建 / 删除 / Fork / 身份 / Releases
  - `release.ts` / `packaging.ts`：发版预检执行 / CI 状态 / 本地打包
  - `share.ts` / `access-control.ts` / `share/session.ts`：共享配置 / 门禁 / 会话
  - `app-update.ts`：在线更新状态检查、下载、安装的 HTTP 转发
  - `util.ts`：共享工具（inRepoRoot / realpathSafe / isSafeOrigin / sendJson / readBody / 状态缓存 / authErrorOf）
- **状态缓存 30 秒**（`STATUS_TTL = 30_000`）：`/api/status`、`/api/fs`、`/api/filtered-tree` 共用；**写操作成功后 `invalidateStatusCache(root)` 立即失效**
- **preflight 提交预检**（`conflicts.ts`）：服务器版本对比 + 行级冲突计算（对方改动行 ∩ 我的改动行）+ svn 锁检查；前端据 `updatedFiles ∩ 待提交文件` 决定是否提示
- **合并预检**（`/api/merge-check`）：git = switchCheck 文件级交集 + `merge-tree` 三方试算；svn = 改动统计 + outdated 检测
- **过滤树**（`/api/filtered-tree`）：按状态码构建目录树；`?` 未版本化目录递归展开（跳过 .gitignore 匹配项）
- **角标定位**（`/api/locate`）：目录下指定状态的文件按 mtime 降序返回，点击文件夹角标跳「最近一个」
- **SSE / NDJSON 流**：环境安装日志（SSE）、行数过滤与代码统计（NDJSON 流式进度）
- **网络灯**（`/api/net-check`）：git ls-remote / svn ls 只握手不取数据，8s 超时；区分「断网」与「认证失败」
- **路径安全**：所有带路径参数接口做 `inRepoRoot` 校验——**两侧 realpath 解析**（`realpathSafe` 对不存在路径逐级上溯最长存在前缀），防 `../` 穿越与 symlink 绕过
- **CSRF / Host 校验**：全 API 层 Origin 校验（无 Origin 放行；有 Origin 必须同源且为本机 / 私网），跨站请求一律 403；防 DNS rebinding
- **内容上限**：文本读取 5MB 预检、图片 50MB、请求体超限即 `req.destroy()` 断连
- **认证错误统一处理**：VCS 层识别打标（`VcsResult.code: 'AUTH'`），服务层 `authErrorOf` 透传 → 前端自动弹登录框
- **最近项目历史**（`~/.config/svngit/history.json`，600 权限）：服务端持久化，上限 20 条，支持常用标记、备注、远程状态探测

### 3.3 局域网共享（src/server/access-control.ts + src/server/share/session.ts + src/client/share/）

```
本机（127.0.0.1 / ::1）         → 永远全权限，不占访问名额
远程 + mode=lan                → 私网段放行
远程 + mode=custom             → IP / CIDR 白名单
            ↓
       加入共享会话（按 IP 计人数，上限可配）
            ↓
       只读（默认）：仅 GET / HEAD；可读写需显式开启
```

- 本机专属接口（shutdown / open / env-install / terminal / local-build / app-update / 共享配置）远程一律 403
- 访客页面经 `ShareGate`：未加入时等待、满员每 10 秒重试、拒绝页每 5 秒重试
- 心跳 10 秒；关闭页面用 `sendBeacon` 释放名额，服务端 30 秒超时兜底
- 主机收到加入 / 离开事件，写入铃铛通知

### 3.4 Web 前端（src/client/）

| 模块 | 职责 |
|---|---|
| shell/app.tsx | 主框架：工具栏 / 侧边栏 / 视图调度 / 弹窗管理 / 提交预检 / 2 分钟远程监控 / 操作分派 |
| shell/modal-host.tsx | 33 类弹窗统一出口；`modal-shell.tsx` 提供 8 向调整大小 + 最大化 + Esc 关闭 |
| shell/header/ | 工具栏注册表、拖拽布局、⋯ 菜单、任务 / 通知面板、网络灯、GitHub 身份徽标 |
| shell/sidebar.tsx | 视图导航（历史 / 文件夹）、最近项目（状态 / 常用 / 备注）、主题快捷圆点 |
| filesystem/ | 三视图（列表 / 树 / 网格）+ 多选批量操作 + 拖拽上传 / 删除 + 剪贴板 + 搜索 / 行数过滤 + 预览 + 模块索引 |
| history/ + history/diff/ | 历史记录、提交文件变动详情、并排双栏差异（搜索 / 块导航 / 还原 / 就地编辑） |
| conflicts/ | 三方冲突解决器（Git :1/:2/:3；SVN .mine/.r）+ 远程冲突对比 |
| ops/ | 提交 / 部分提交 / 推送 / 分支 / 标签 / Stash / 清理 / 发布中心 |
| repo/ | 打开 / 新建 / 获取 / 远程浏览 / 检出 / 工作树 / GitHub / 认证 / 环境安装 / 练习仓库 |
| share/ | 共享配置弹窗 + 访客门禁 + 心跳 |
| stats/ | 代码统计：目录勾选、流式进度、结果树、Markdown 导出 |
| appearance/ | 16 套主题 + 自定义 6 色、字号 / 字体 / 缩放 |
| animations/ | 操作动效唯一出口（添加 / 删除 / 还原 / 提交 / 更新 / 抖动 / 任务飞行） |
| terminal/ | 集成终端（非交互 git/svn 命令、历史、ANSI 上色、危险命令确认） |
| ui/ + shared/ | 通用组件（图标 / 菜单 / 徽标 / 命令预览 / 目录勾选树）与前端公共层（API / 任务 / 通知 / 主题） |

**前端关键机制**：

- **视图常驻**（display 切换不卸载）：切换视图保留位置 / 展开状态 / 选中项
- **键盘导航**：↑↓ 选择、→/Enter 进入、← 返回；`Ctrl+\`` 终端、`F5` 刷新、`Ctrl+滚轮` 缩放
- **多选集合操作**：selected 集合贯穿三视图，右键项在集合内时作用于整个集合——按操作能力分组，混选自动拆分
- **提交前预检**：`/api/preflight` 行冲突强制拦截（无「继续提交」按钮）→ 服务器更新交集提示 → 检查失败明示「本次提交不经过拦截」
- **命令预览**：右键菜单 / 行内按钮 / 弹窗按钮统一接入 `cmdOfRepo(repoType, key, vars)`，悬浮即显示真实命令
- **后台任务**：超过 3 秒的操作自动转后台，顶栏沙漏显示进度 / 取消，完成或失败进通知铃铛

## 4. 核心设计决策

### 4.1 为什么包装命令行而非解析内部格式
- SVN 的 `.svn/wc.db`（SQLite）格式复杂、版本间变动大；Git 的 `.git/objects` 内容寻址
- 命令行是官方稳定接口，`--xml` / `--porcelain` 输出契约稳定
- 天然获得官方全部能力（合并算法、认证、网络协议），行为与 CLI 完全一致

### 4.2 开发模式热更新架构（scripts/dev.mjs）
- 后端：`tsc -w` 编译 + `node --watch` 自动重启
- 前端：`tsc -p tsconfig.web.json -w` 仅类型检查（noEmit）+ esbuild `context()` 热构建
- 页面轮询 `Last-Modified` 自动刷新（服务重启也感知）
- 双 tsconfig：后端编译输出 / 前端仅类型检查

### 4.3 凭据安全
- SVN 密码 + Git 推送凭据存 `~/.config/svngit/config.json`（chmod 600；git 凭据 base64 存储）
- 调用 svn 用 `--password-from-stdin` 从管道传密码——**不出现在进程列表（ps）**
- Git 推送用 `GIT_ASKPASS` 脚本重试（0700 权限）
- 支持 HTTPS 自签名证书开关

### 4.4 平台抽象（src/platform/）
- `Platform` 接口（打开方式 / 图标 / 文件管理器定位 / 回收站 / 终端 / 字体 / 环境安装 / 应用菜单 / 端口占用），`index.ts` 按 `process.platform` 组装 win32 或 linux 实现
- Windows 支持系统「打开方式」选择器、从 .exe 提取图标、注册表枚举关联程序、winget 安装；Linux 按 MIME 匹配 .desktop、主题图标、gio / trash-put

### 4.5 环境自检与安装引导
- 启动检测 `svn --version` / `git --version`
- 缺失时横幅提示 → 安装弹窗：免密 sudo 一键 `apt-get install`（SSE 实时日志）或手动命令引导（Windows 为 winget 引导）

### 4.6 发布与在线更新

**发布**（`deploy/release.mjs` + `server/routes/release.ts` + `client/ops/release-*`）：
- 发版脚本是唯一实现，界面只做预检、执行与状态展示
- 发布中心整合：GitHub Releases 历史 / 产物下载、发版表单、本地打包、旧版本清理、Docker 镜像
- CI 状态、失败步骤与日志入口直接显示在发布历史

**在线更新**（`src/main/app-update.ts`）：
- Electron（AppImage / installed）：electron-updater 懒加载，启动 5s 后静默检查；`autoDownload=false`，状态机驱动下载 / 安装；默认 gh-proxy 加速，失败回退 GitHub 直连
- WSL / 纯 Node 包：包根 `.svngit-package.json` 标记启用；拉取 `latest.yml` → 下载 tar.gz → `checksums.txt` 校验 SHA256 → 解压到兄弟目录 → 换版脚本等旧进程退出后改名替换 → `run-wsl.sh` 重启 → `/api/info` 健康检查，失败自动回滚
- 日志：`~/.cache/svngit/update.log`

### 4.7 产物体积控制
- `electron-builder.yml` 的 `electronLanguages` 只保留 zh-CN / en-US（Electron locales 40M → ~2M）
- AppImage 约 97MB（Electron 主二进制为固有成本）

## 5. 并发修改防护体系（特色）

四层防护，覆盖「预防 → 监控 → 解决」：

```
① 行级冲突检测（提交/推送时，/api/preflight）
   对方改动行号 ∩ 我的改动行号（含插入位置）→ 精确到行
   → 有行冲突：强制拦截提交（无"继续提交"按钮），引导 备份→删除→更新→手动合并
② 服务器更新交集提示（提交前）
   服务器有新提交时，取 updatedFiles ∩ 待提交文件
   → 有交集：弹窗列出可能冲突文件（双击查看差异、可"先更新"）
   → 无交集：不打扰，直接进入提交界面
③ 2 分钟主动监控（前端定时 /api/preflight，120s 周期）
   你修改的文件被他人先提交 → 警示条 + [查看对比]（对方改动 diff vs 我的改动 diff）
④ 三方冲突解决器（/api/conflicts + resolve-conflict）
   git: :1/:2/:3 暂存区三方；svn: .mine/.r 文件
   基础/本地/对方 三栏 + 手动编辑 + 采用本地/对方/保存手动
```

**行冲突算法**（`diffChangedLines`，`src/vcs/diff-lines.ts`）：

```ts
解析双方 unified diff：
  del = 被删除/修改的 BASE 行号集合
  ins = 插入位置集合（+ 行对应的 BASE 行号）
行冲突 = (del ∩ del) ∪ (ins ∩ ins)
```

覆盖修改同行、删除同行、同位置追加三类真实冲突。文件头行采用精确匹配，避免 Markdown 分隔行误判导致行号偏移。

**合并预检**（`/api/merge-check`，git）：L1 = switchCheck 工作区文件级交集；L2 = `git merge-base` + `git merge-tree` 三方试算——两边**已提交**改动重叠的文件（`lineConflicts`），合并前提前预告。

## 6. 目录结构

```
src/
├── main/               # Electron 入口 + 在线更新
├── preload/            # Electron preload 桥接
├── config.ts           # 配置读写（~/.config/svngit/config.json，600 权限）
├── git-config.ts / ssh-config.ts / secure-clean.ts
├── inflight.ts / transfer-progress.ts
├── server/
│   ├── index.ts        # HTTP 骨架：安全 / 共享门禁 / 路由分发 / 静态文件
│   ├── access-control.ts + share/session.ts
│   ├── build-script.ts / docker-registry.ts / release-artifacts.ts
│   └── routes/         # 34 个 API 域文件（ops/、browse/ 子模块）
├── vcs/                # VCS 抽象层（types / index / svn / git / exec / …）
├── platform/           # 平台抽象（win32 / linux 双实现）
├── practice/           # 练习仓库生成
├── shared/             # 前后端共享（类型 / 编码 / 冲突 / 主题 / i18n）
└── client/             # React 前端（13 个业务域）
    ├── shell/          # 主框架 + 顶栏 + 侧边栏 + 弹窗宿主
    ├── filesystem/     # 文件浏览
    ├── history/        # 历史与差异
    ├── conflicts/      # 冲突解决
    ├── ops/            # 提交 / 分支 / 标签 / 发布
    ├── repo/           # 仓库接入 / 检出 / GitHub / 练习
    ├── share/          # 局域网共享
    ├── stats/          # 代码统计
    ├── appearance/     # 主题 / 字体
    ├── animations/     # 操作动效
    ├── terminal/       # 集成终端
    └── ui/ + shared/   # 通用组件与公共层
scripts/                # 构建 / 开发 / 检查 / 截图
test/                   # 自动化测试（12 套件 + Playwright 冒烟）
docs/                   # 文档与截图
deploy/                 # 打包与发版
```

## 7. 测试策略

| 层 | 方式 |
|---|---|
| VCS 单元测试 | `vcs-test`（53）+ `vcs-extra-test`（65） |
| 目录 / 分支 / 练习仓库 | `restore-directory-test`（48）+ `branch-track-test`（14）+ `practice-repo-test`（22） |
| 纯函数 | `diff-lines-test`（6）+ `diff-parse-test`（18）+ `conflict-merge-test`（28）+ `git-conflict-status-test`（6） |
| HTTP API 集成 | `api-test`（108，真实服务端端到端） |
| 上传 / 竞态 | `upload-test`（27）+ `preflight-cache-race-test`（13） |
| 部分暂存 | `hunks-test`（18，单独跑，含真实 git apply） |
| 前端冒烟 | `e2e-smoke.mjs`（14，Playwright 驱动真实浏览器） |

`npm test` 串 12 个套件约 400 项断言；CI（`.github/workflows/test.yml`）在 push / PR 时自动跑全量。安全测试覆盖：路径穿越 403、错误参数、中文 / 空格文件名、大文件截断、并发请求、跨站 Origin 403、DNS rebinding。

## 8. 性能

- 子进程异步执行，界面不阻塞
- **状态缓存 30 秒**（/api/status、/api/fs、/api/filtered-tree 共用），写操作后立即失效
- 树模式按需加载（展开时才拉取目录）
- 大文件截断（文本 5MB 预检、对比内容 200KB 截断）
- 行数过滤 / 代码统计走 NDJSON 流式进度，可取消
- SVN 大仓库子项目：`currentScopes` 限定状态扫描范围；超大工作副本自动浅扫描
- 前端 bundle 单文件，语法高亮按需注册；常用目录后台预加载
- 最近项目探测 30 秒缓存，打开侧边栏不阻塞

## 9. 已知限制

- AppImage 不包含 svn / git 二进制（系统级依赖，与认证缓存耦合）
- 依赖系统 locale（zh_CN.UTF-8 为主验证环境，中英文输出均兼容）
- 安装引导需要免密 sudo 或手动命令
- 局域网共享远程默认只读；可读写模式需显式开启并自行评估风险
- WSL / 纯 Node 版在线更新要求应用目录父目录可写；首个带更新代码的版本仍需手动安装
