# 架构文档 — svn-git文件版本管理

## 1. 项目概述

**svn-git文件版本管理** 是一个浏览器图形界面的 SVN/Git 双引擎版本管理工具。自动识别仓库类型（SVN / Git），提供状态检测、历史记录、差异对比、文件夹浏览、分支/标签/Stash 管理和并发修改防护（冲突预警、行级拦截、三方解决）等完整功能。全部鼠标操作，无需学习命令行。

**定位**：面向同时使用 SVN 和 Git 的团队/个人，一套工具统一管理两种版本库。

## 2. 技术栈

| 层 | 技术 | 说明 |
|---|---|---|
| 后端 | Node.js（内置 http 模块） | 无第三方框架，零额外依赖 |
| 前端 | React 18 + esbuild | esbuild 打包单文件 bundle（310KB），无构建框架链 |
| 打包 | electron-builder | AppImage 内置 Electron 运行时，免装 Node |
| 语法高亮 | highlight.js（子集 10 语言） | 按需注册，体积可控 |
| XML 解析 | fast-xml-parser | svn --xml 机器输出解析 |

**依赖设计原则**：外部依赖仅 `svn` / `git` 命令行（工具包装官方命令行，不解析内部格式，保证与官方行为一致）。

## 3. 架构分层

```
┌─────────────────────────────────────────────┐
│  Web 前端（src/web/）                        │
│   React 组件：视图/弹窗/图标库/API 封装      │
├─────────────────────────────────────────────┤
│  HTTP 服务层（src/server.ts）                │
│   30+ REST API + SSE 流（安装日志）          │
│   静态文件服务 · 路径安全校验 · 认证错误处理  │
├─────────────────────────────────────────────┤
│  VCS 抽象层（src/vcs/）                      │
│   SvnVcs / GitVcs 统一接口                   │
│   （status/log/diff/branches/tags/stash/…）  │
│   exec.ts 子进程封装（stdin 传密码/超时/缓冲）│
├─────────────────────────────────────────────┤
│  外部：svn / git 命令行（系统安装）           │
└─────────────────────────────────────────────┘
```

### 3.1 VCS 抽象层（src/vcs/）

统一接口设计，`SvnVcs` 与 `GitVcs` 实现相同方法签名，上层无感知切换：

| 能力 | SVN 实现 | Git 实现 |
|---|---|---|
| status | `svn status --xml` + item 单词映射 | `git status --porcelain=v1` |
| log | `svn log -r HEAD -v --xml` | `git log --format=%x1f 分隔` + 按行扫描解析 |
| diff | `svn diff`（中英文输出兼容解析） | `git diff` + `--cached` 合并 |
| branches | `svn list/copy/switch/merge`（自动创建 branches/） | `git branch/checkout/merge` |
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
- **子进程隔离**：`exec.ts` 统一封装 spawn、stdin 数据（SVN 密码走 `--password-from-stdin`，不进命令行参数）、超时、输出上限（64MB）

### 3.2 HTTP 服务层（src/server.ts）

- 仅监听 **127.0.0.1 随机端口**（安全：不对外暴露）
- 30+ REST API：info/status/fs/log/diff/file-versions/blame/branches/tags/stash/search/conflicts/preflight/repo-create/env-check/…
- **preflight 提交预检**：服务器版本对比（`remoteHasUpdate`/`updatedFiles`/`behind`）+ 行级冲突计算 + 锁检查；前端据 `updatedFiles ∩ 待提交文件` 决定是否提示"服务器有新版本"
- **SSE 流**（`/api/env-install/stream`）：sudo apt 安装 svn/git 时实时推送安装日志到前端
- **路径安全**：所有带路径参数接口校验 `abs.startsWith(repo.root)`（防路径穿越）
- **认证错误统一处理**：E170001 等错误码识别 → 前端自动弹登录框
- 静态文件带 `Last-Modified`（开发模式热刷新依赖）

### 3.3 Web 前端（src/web/）

| 模块 | 职责 |
|---|---|
| app.tsx | 主框架：工具栏/侧边栏/视图调度/弹窗管理/定时监控 |
| fs.tsx | 文件夹视图三模式（列表/树/浏览网格）+ **多选**（矩形框选/Ctrl 点选/Shift 范围选，右键批量操作）+ 键盘导航 + 搜索定位 |
| diff.tsx | 并排双栏对比（行映射/修改块导航/滚动条预览标记）+ **分隔栏拖拽调宽 + 左右独立搜索框** |
| diff-render.tsx | diff 行渲染与跳转公共逻辑 |
| log.tsx | 历史记录 + 提交变更文件 + diff 跳转 |
| open.tsx | 启动页/打开项目（最近列表 + 路径输入） |
| vcs-dialogs.tsx | 分支/标签/Stash/创建仓库/清理 对话框 |
| conflicts.tsx | 三方冲突解决器 |
| remote-conflicts.tsx | 远程冲突对比（对方改动 vs 我的改动） |
| modals.tsx | 提交（勾选列表，默认全选）/登录/确认/更新结果/环境安装 弹窗 |
| modal-shell.tsx | 通用弹窗外壳：8 方向边缘拖拽调整大小 + 右上角最大化/关闭（遮罩点击不关闭） |
| icons.tsx | 彩色 SVG 图标库（不依赖系统 emoji 字体） |
| highlight.tsx | 语法高亮公共模块 |

**前端关键机制**：
- **视图常驻**（display 切换不卸载）：切换视图保留位置/展开状态/选中项
- **键盘导航**：↑↓ 选择、→/Enter 进入、← 返回（网格模式按列数跳行）
- **多选集合操作**：selected 集合贯穿三视图，右键项在集合内时菜单作用于整个集合（按状态合并操作）
- **弹窗一致性**：全部弹窗走 `ResizableModal` 外壳（8 方向拖拽 + 最大化 + 遮罩点击不关闭）
- **行级冲突检测**：提交时前后端联动（见 §5）

## 4. 核心设计决策

### 4.1 为什么包装命令行而非解析内部格式
- SVN 的 `.svn/wc.db`（SQLite）格式复杂、版本间变动大；Git 的 `.git/objects` 内容寻址
- 命令行是官方稳定接口，`--xml`/`--porcelain` 输出契约稳定
- 天然获得官方全部能力（合并算法、认证、网络协议），行为与 CLI 完全一致

### 4.2 开发模式热更新架构
- 后端：`tsc -w` 编译 + `node --watch` 自动重启
- 前端：esbuild `context()` API 热构建 + 页面轮询 `Last-Modified` 自动刷新（服务重启也感知）
- 双 tsconfig：后端编译输出 / 前端仅类型检查（noEmit，bundle 归 esbuild）

### 4.3 凭据安全
- SVN 密码存 `~/.config/svnkit/config.json`（chmod 600）
- 调用 svn 用 `--password-from-stdin` 从管道传密码——**不出现在进程列表（ps）**
- 支持 HTTPS 自签名证书开关

### 4.4 环境自检与安装引导
- 启动检测 `svn --version` / `git --version`
- 缺失时横幅提示 → 安装弹窗：免密 sudo 一键 `apt-get install`（SSE 实时日志）或手动命令引导

### 4.5 产物体积控制
- `electron-builder.yml` 的 `electronLanguages` 只保留 zh-CN/en-US（Electron locales 40M → ~2M）
- 产物 AppImage 约 96MB（Electron 主二进制为固有成本，不再裁剪）

## 5. 并发修改防护体系（特色）

三层防护，覆盖"预防 → 监控 → 解决"：

```
① 行级冲突检测（提交/推送时，server.ts preflight）
   对方改动行号 ∩ 我的改动行号（含插入位置）→ 精确到行
   → 有行冲突：强制拦截提交（无"继续提交"按钮），引导 备份→删除→更新→手动合并
② 服务器更新交集提示（提交前）
   服务器有新提交（remoteHasUpdate）时，取 updatedFiles ∩ 待提交文件
   → 有交集：弹窗列出可能冲突文件（双击查看差异、可"先更新"）
   → 无交集：不打扰，直接进入提交界面
③ 2 分钟主动监控（前端定时 preflight）
   你修改的文件被他人先提交 → 警示条 + [查看对比]（对方改动 diff vs 我的改动 diff）
④ 三方冲突解决器（/api/conflicts + resolve-conflict）
   git: :1/:2/:3 暂存区三方；svn: .mine/.r 文件
   基础/本地/对方 三栏 + 手动编辑 + 采用本地/对方/保存手动
```

**行冲突算法**（`diffChangedLines`，server.ts）：
```ts
解析双方 unified diff：
  del = 被删除/修改的 BASE 行号集合
  ins = 插入位置集合（+ 行对应的 BASE 行号）
行冲突 = (del ∩ del) ∪ (ins ∩ ins)
```
覆盖修改同行、删除同行、同位置追加（纯 + 行）三类真实冲突。

## 6. 目录结构

```
src/
├── main.tsx            # 入口：启动服务 + 打开浏览器（Electron 兼容 / --browser 外部浏览器）
├── server.ts           # HTTP 服务：30+ API + SSE + 静态文件 + 行级冲突计算
├── config.ts           # 配置读写（600 权限）
├── preload.cjs         # Electron preload 桥接
├── vcs/                # VCS 抽象层
│   ├── svn.ts          # SVN 实现（668 行）
│   ├── git.ts          # Git 实现（583 行）
│   ├── exec.ts         # 子进程封装
│   ├── detect.ts       # 仓库类型识别
│   └── types.ts        # 统一类型
└── web/                # React 前端（17 文件）
    ├── app.tsx         # 主框架 + 提交预检（冲突拦截/交集提示）
    ├── fs.tsx          # 文件夹三模式视图 + 多选批量操作
    ├── diff.tsx        # 并排对比（分隔栏拖拽/左右独立搜索）
    ├── modal-shell.tsx # 通用弹窗外壳（8 方向调整大小/最大化）
    ├── conflicts.tsx   # 三方冲突解决
    ├── remote-conflicts.tsx # 远程冲突对比
    ├── open.tsx        # 启动页/打开项目
    ├── icons.tsx       # SVG 图标库
    └── …               # 其余组件
scripts/                # 构建/开发/截图脚本
test/                   # 自动化测试（61 项断言）
docs/                   # 文档与截图
```
*（源码合计约 8,900 行 TypeScript/TSX/CSS/HTML）
```

## 7. 测试策略

| 层 | 方式 |
|---|---|
| VCS 单元测试 | `test/vcs-test.mjs`（32 项）+ `test/vcs-extra-test.mjs`（29 项），自动重建测试仓库 |
| 集成测试 | 2 轮 Agent 全功能回归（30+ API × git/svn，含真实冲突场景构造） |
| 边界测试 | 路径穿越 403、错误参数、中文/空格文件名、大文件截断、并发请求 |
| 安全测试 | 密码不出现在 ps、配置 600 权限、仅监听 127.0.0.1 |

## 8. 性能

- 子进程异步执行，界面不阻塞
- 状态缓存 5 秒（/api/fs、status）
- 树模式按需加载（展开时才拉取目录）
- 大文件截断（200KB）
- 前端 bundle 310KB，语法高亮按需注册

## 9. 已知限制

- AppImage 不包含 svn/git 二进制（系统级依赖，与认证缓存耦合）
- 依赖系统 locale（zh_CN.UTF-8 为主验证环境，中英文输出均兼容）
- 安装引导需要免密 sudo 或手动命令
