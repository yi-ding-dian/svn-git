# 变更记录

本文件记录 svn-git 文件版本管理的用户可见变更，按 Keep a Changelog 风格组织。

## [Unreleased]

### 功能增强
- **文件右键「终端运行」（.bat / .cmd / .sh）**：在系统外部终端窗口里跑脚本，跑完窗口保留（输出看得见）——Windows 上 .bat/.cmd 走 `cmd /k`（新控制台窗口；Win11 默认终端设为 Windows Terminal 时自动落在 WT），.sh 走 Git Bash（`where` 探测并过滤掉 WSL 的 System32 占位启动器——它认不了 `D:/...` 路径，未装 Git for Windows 给明确提示）；Linux（待实测）走终端模拟器探测表（x-terminal-emulator / gnome-terminal / konsole / xfce4-terminal / mate-terminal / alacritty / kitty / xterm，`$TERMINAL` 优先）。经 PowerShell `Start-Process` 中转开新窗口，路径含空格/中文全走单引号字面量，不经 cmd 的引号解析；`/api/run-script` 带越界 / 存在性 / 扩展名三重校验，api-test 补三条拒绝侧回归断言，另有手动端到端脚本 `test/run-script-e2e.mjs`（正例真弹终端窗口，故不进 CI）

### 修复
- **进文件夹要等一会儿（git 仓库）**：`/api/fs` 为判断「目录名没被忽略、但里面全是忽略文件」（`.claude` 场景）会对每个无状态条目的子目录**各起一个 `git check-ignore` 进程**，Windows 上每次 spawn ~150ms 还得串行，且缓存 Map 是每请求新建、下次进目录重跑 —— 实测根目录（13 个子目录）2.1~2.6s、`src/client` 2.4~3.0s，耗时基本只跟子目录数走（与文件数无关）。改为把「本目录 + 祖先链 + 全部子目录」的条目名合成**一次** `git check-ignore`（`--stdin` 整批喂入、结果按目录拆回缓存），单次请求的 git 子进程从 ~14 个降到 1 个、根目录 0.19~0.27s；单目录 >5000 条或批内 >20000 条时该目录退回惰性单跑（行为与合批前一致）。改后与旧实例逐目录对拍 15 个目录（含全忽略 `I`、未跟踪 `?`、缺失 `!` 等边界）entries 与元信息完全一致。SVN 侧每次进目录仍有两处**无跨请求缓存**的全量 `svn status`（`--no-ignore` 取忽略集合、取锁列），本轮范围外未动
- **「用默认程序打开」在 Windows 上静默失效**（提示"已打开"，实际什么都没发生）：中转的 `powershell -Command` 在 detached（DETACHED_PROCESS，Node `detached:true` 所置）下连命令都不执行就 exit 0 —— Node 只等到 spawn 事件，于是拿到"假成功"，外部无任何报错可查（实测 Win11 + PS 5.1；同一坑也吃掉了新写的「终端运行」首版）。`launchDetached` 加 `detach` 开关（默认 true，其他调用方不受影响），两处 powershell 中转改传 false 并加 windowsHide（不再闪黑框）。对照实测 cmd.exe 在 detached 下无此问题——纯 PowerShell 怪癖
- **「修改提交注释」报"找不到编辑器"**（Windows）：`GIT_SEQUENCE_EDITOR` / `GIT_EDITOR` 被设成反斜杠路径，而 git 是把编辑器命令交给 **POSIX shell** 执行的 —— shell 把 `\U` `\A` `\1` 当转义吃掉，`C:\Users\...\seq.sh` 变成 `C:Users...seq.sh`，报 `command not found`，reword 直接失败。传给 git 的一律改用正斜杠（MSYS bash 认 `C:/...`；POSIX 上本就是正斜杠，无副作用）
- **「复制完整路径」在 Windows 拼出 `D:\svn-git/run.bat` 这种混用分隔符**：`root` 是平台原生（反斜杠）、`rel` 是版本库风格（正斜杠），直接 `${root}/${rel}` 拼接所致。抽出 `absPath()` 统一处理，4 处调用点收口 —— 其中文件粘贴那处会把路径回传给服务端，不只是一处显示。分隔符只按「确为 Windows 路径」判定（同 `baseName` 的既有规则），Linux 上含 `\` 的文件名不会被改坏

### 测试与工程
- **Linux 源码运行脚本 `run.sh`**：补上一直缺的那半 —— Windows 有双击即跑的启动脚本（现名 `run.bat`，原名 `运行.bat`），Linux 只能手动敲 `npm install` + `npm run dev`。两者做的是同一件事（装依赖 → 构建 → 启动），其余入口路径都只留 package.json 一处
- **一键发版脚本** `deploy/release.mjs`（双击入口 `deploy/release.bat`）：检测工作区/分支/tag 占用 → 问升哪一位与发布说明 → 自动归档 CHANGELOG 的 `[Unreleased]`、`npm version` 提交并打 tag、`git push --follow-tags` 触发 CI、轮询 GitHub API 报出构建结果与产物清单。支持 `--patch|--minor|--major --yes --no-push --no-watch` 供 GUI / CI 非交互调用

## [1.0.0] - 2026-10-11

首个版本：双引擎 SVN/Git 图形化管理、行级冲突防护闭环、AppImage 交付。

### 安全加固
- **修复任意文件读取漏洞**：`/api/cat` git 分支磁盘回退可越界读文件（`../` 穿透，实测可读任意文本），server 层 + VCS 层双保险修复（inRepoRoot + realpath 校验）
- **路径校验升级为 realpath 级**：`inRepoRoot` 两侧 realpath 解析（对不存在路径逐级上溯最长存在前缀），堵住仓库内 symlink 指向仓库外的绕过；`/api/log`、`/api/diff`、`/api/ls` 补校验
- **CSRF 覆盖**：Origin 校验支持 `localhost`/`[::1]`（之前仅 127.0.0.1，手输 localhost 打开时全部 POST 被拒）
- **内容上限**：文本读取 5MB 预检（先 statSync 再读，防止超大文件 OOM）、图片 50MB、请求体超限即断开连接
- readBody 超限后主动 `req.destroy()`，防内存继续累积

### 架构重构
- **VCS 抽象层接口化**：定义 `Vcs` 接口（公共方法必选 + 平台独有能力可选 `?.`），`createVcs` 返回统一接口，全项目 51 处 `as any` 清零；删除恒返回 0 的 `/api/log-count` 死代码端点
- **server.ts 拆分**：1941 → ~1187 行，抽出 `src/routes/`（util 共享工具 + conflicts / branch / ops 三个路由域模块，`handle()` 分发）
- **错误处理结构化**：`VcsResult.code: 'AUTH' | 'ABORTED' | 'NO_CHANGES'`，认证失败由 VCS 层识别一次打标，服务层透传（`authErrorOf` 优先查 code，正则仅兜底）
- **前后端共享常量化**：`src/shared/types.ts`（CODE_DESC / BINARY_EXTS 单一事实源）

### 功能增强
- **命令预览**：悬浮操作项显示将执行的真实命令（右键菜单 / 文件行内按钮 / 全部弹窗按钮，50+ 处接入，git/svn 双引擎模板）
- **远程网络状态灯**：30 秒检测（git ls-remote / svn ls），最近 3 次窗口三态（绿/黄/红），区分"断网"与"认证失败"（认证失败记绿并提示），点击圆点手动检测
- **文件名状态染色**：M 橙黄 / A 绿 / D 红 / C 红 / ? 灰，徽标同步升级实底，目录取操作集合首状态
- **「仅从版本库移除（本地保留）」软删除**：删除确认弹窗新增副选项（`git rm --cached` / `svn delete --keep-local`），解决"想移出版本控制但保留本地"的场景
- **工具栏新增「拉取/更新」按钮**（SVN 每日高频操作，之前入口只在右键空白处）

### 修复
- **行级冲突检测错位**：`diffChangedLines` 将内容行 `---`/`+++` 开头误判为文件头，行号偏移导致冲突漏报/误报——收紧为带空格精确匹配（已抽独立模块 + 6 项回归单测）
- **未推送计数误报**：分支未配置 upstream 时把全部提交当未推送（显示 25 实际 2）——统一 `unpushedRange`（`@{u}` → `origin/<分支>` 缓存 → 无远程返回空）
- **添加后列表不及时刷新**：写操作成功后未失效 30s 状态缓存，且"仅新文件"过滤树不监听刷新——写后失效缓存 + 过滤树依赖 tick
- **SVN 网络灯恒报"未配置仓库 URL"**：`detectRepo` 不含 url，net-check 改用 `vcs.info()` 获取
- **preflight 失败静默放行提交**：冲突检查失败时明示风险弹窗，不再无提示绕过
- 删除确认文案按实际语义重写（提交前可还原、未跟踪文件不可恢复等）；历史视图错误信息红色区分；失败 toast 停留 5 秒不截断
- **启动脚本（`run.bat`，当时叫 `运行.bat`）指向重构前的旧入口**：服务入口早已从 `dist/main.js` 变为 `dist/main/index.js`，脚本仍指向旧文件——不报错，但静默跑起旧版后端（表现为"很多功能都没有"）。改为 `npm start` 跟随 package.json，并清掉 `dist/` 下的旧产物

### 测试与工程
- 新增 `npm test`（build + VCS 层 47 + 扩展 45 + diff 算法 6 + **HTTP API 集成 32** = 130 项断言）
- 新增 `.github/workflows/test.yml`（ubuntu + svn 依赖，push/PR 自动跑全量测试）
- 新增 `test/api-test.mjs`：真实服务端到端测试（越界拦截 6 项、CSRF、缓存失效、软删 keep、重命名 API、SVN net-check 等）
- **Windows 免安装单文件 exe**：新增 electron-builder `portable` 目标（对标 Linux 的 AppImage，目标机无需装 Node）；打包脚本收进 `deploy/`（`build.bat` / `build.sh` / `deploy/README.md`），产物统一落 `deploy/release/`
- **产物文件名改 ASCII**：`svn-git-<版本>-portable.exe`、`svn-git-<版本>-setup.exe`、`svn-git-<版本>.AppImage`（窗口标题 / 开始菜单等界面名称仍为中文）——中文文件名在下载 URL 里会被百分号编码，命令行与传输环节也易乱码
- **版本号与构建标识分离**：「关于」弹窗显示 `v1.0.0（72af3ea）`，构建信息带 commit 短 hash 与 dirty 标记。版本号是发布语义、只在发版时人工变更（`npm version`），日常打包靠 hash 就能对上代码，不再每次打包涨号

### 文档
- **README / docs 全套文档重写**：对齐当前功能现状（重命名、远程分支删除、仅删除过滤、过滤树跳转、命令预览、历史总数、合并预检、Git 认证引导等）；修正过时描述（侧边栏导航、工具栏按钮位置、状态缓存时长、测试断言数、前端体积、高亮语言数等）
- **截图全套重截**：docs/screenshots/ 下 git、svn 各 8 张（1280×820，当前界面布局/图标/右键菜单/分支弹窗/配色主题），文件名与 README/docs 引用一致
