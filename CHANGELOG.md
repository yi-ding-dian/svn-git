# 变更记录

本文件记录 svn-git 文件版本管理的用户可见变更，按 Keep a Changelog 风格组织。

## [Unreleased]

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

### 测试与工程
- 新增 `npm test`（build + VCS 层 47 + 扩展 45 + diff 算法 6 + **HTTP API 集成 32** = 130 项断言）
- 新增 `.github/workflows/test.yml`（ubuntu + svn 依赖，push/PR 自动跑全量测试）
- 新增 `test/api-test.mjs`：真实服务端到端测试（越界拦截 6 项、CSRF、缓存失效、软删 keep、重命名 API、SVN net-check 等）

### 文档
- **README / docs 全套文档重写**：对齐当前功能现状（重命名、远程分支删除、仅删除过滤、过滤树跳转、命令预览、历史总数、合并预检、Git 认证引导等）；修正过时描述（侧边栏导航、工具栏按钮位置、状态缓存时长、测试断言数、前端体积、高亮语言数等）
- **截图全套重截**：docs/screenshots/ 下 git、svn 各 8 张（1280×820，当前界面布局/图标/右键菜单/分支弹窗/配色主题），文件名与 README/docs 引用一致

## [1.0.0]

首个版本：双引擎 SVN/Git 图形化管理、行级冲突防护闭环、AppImage 交付。
