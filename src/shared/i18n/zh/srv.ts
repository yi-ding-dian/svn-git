/** 中文语言包 · 服务端（HTTP 路由返回给界面的消息）。
 *
 *  这些消息经 `api.ts` 直接透传到界面（`data.error` / `result.message`），
 *  所以**必须跟界面同语言** —— 否则会出现「按钮变英文、一点击弹中文报错」。
 *  语言由主进程的 `setLang` 决定（见 `routes/config.ts` 的 `/api/lang`）。
 *
 *  ⚠️ 源码里以下中文**故意没搬**（是给程序看的，不是文案），已逐行标 `// i18n-ignore`：
 *   - `routes/util.ts` 的 `isAuthError()` 正则（`/认证失败|E170001|Authentication failed/i`）——解析错误文本
 *   - `server/index.ts` 的 `isAuthFail()` 正则 —— 解析 git 输出
 *   - `server/index.ts` 里 `svn mkdir -m '创建标准布局…'` 的提交信息 —— 传给命令、写入版本库的数据
 *   - `routes/util.ts` 的 `TOO_LARGE_PLACEHOLDER` —— 双重身份：既是显示占位符，又是
 *     「写入守卫」的字面量比较标记（翻译会因语言切换产生不一致，破坏守卫）
 */
export const srv = {
  // ---- 语言（原有）----
  'srv.lang.invalid': '语言不受支持',

  // ---- 通用（多路由复用）----
  'srv.unknownAction': '未知操作',
  'srv.unknownRepoType': '未知仓库类型',
  'srv.invalidParams': '参数不合法',
  'srv.incompleteParams': '参数不完整',
  'srv.missingPath': '缺少路径',
  'srv.pathEmpty': '路径为空',
  'srv.samePath': '新旧路径相同',
  'srv.notGitRepo': '非 Git 仓库',
  'srv.gitOnly': '仅 Git 仓库支持',
  'srv.svnOnly': '仅 SVN 仓库支持',
  'srv.fileNotFound': '文件不存在',
  'srv.fileNotFoundAt': '文件不存在: {path}',
  'srv.unsupportedOp': '当前仓库不支持该操作',
  'srv.pathOutOfBounds': '路径越界',
  'srv.outOfScope': '超出工作副本范围',
  'srv.pathOutOfWc': '路径超出工作副本范围: {path}',
  'srv.unknown': '未知',
  'srv.rootDir': '根目录',

  // ---- 仓库创建 / 克隆（server/index.ts）----
  'srv.crossSiteRejected': '拒绝跨站请求',
  'srv.missingDirOrName': '缺少目录或名称',
  'srv.fillDirPath': '请填写目录路径',
  'srv.cloneTimeout': '获取超时（超过 {sec} 秒），已停止',
  'srv.cloneCancelled': '已取消获取',
  'srv.clonedTo': '已克隆到 {path}',
  'srv.cloneFailed': '克隆失败',
  'srv.initedRepo': '已初始化仓库 {path}',
  'srv.gitInitFailed': 'git init 失败',
  'srv.svnCheckedOut': '已检出 SVN 工作副本 {path}',
  'srv.svnCheckoutFailed': 'svn checkout 失败',
  'srv.svnadminFailed': 'svnadmin create 失败',
  'srv.layoutCreateFailed': '标准布局创建失败: {msg}',
  'srv.stdLayoutTrunk': '（标准布局，工作副本检出 trunk）',
  'srv.stdLayout': '（标准布局）',
  'srv.createdSvnRepo': '已创建 SVN 仓库 {path}{layout}（工作副本 {wc}）',
  'srv.createdSvnRepoWcFailed': '已创建 SVN 仓库 {path}{layout}（工作副本检出失败: {msg}）',
  'srv.portInUse': '端口 {port} 被占用，改用随机端口',

  // ---- 配置（config / git-auth / lang / git-config）----
  'srv.saveConfigFailed': '保存配置失败: {msg}',
  'srv.gitAuthEmpty': '用户名和密码不能为空',
  'srv.gitAuthSaved': '推送认证已保存',
  'srv.remoteUrlEmpty': '远程地址不能为空',

  // ---- 分支 / 标签 / Stash（branch.ts）----
  'srv.missingBranch': '缺少分支名',
  'srv.missingRev': '缺少 rev 参数',
  'srv.mergeAbortUnsupported': '当前仓库不支持中止合并',
  'srv.remoteBranchName': '需远程分支名（origin/名字）',
  'srv.trunkNoDelete': '主干分支不能删除（团队稳定版本，防止误删）',
  'srv.branchPushUnsupported': '当前仓库类型不支持分支推送',
  'srv.messageRequired': '注释不能为空',
  'srv.svnNoStash': 'SVN 不支持 Stash 功能',

  // ---- 冲突解决（conflicts.ts）----
  'srv.notInConflict': '{path} 当前不是冲突状态，无法采用本地/对方',
  'srv.takeFailed': '取用失败',
  'srv.resolved': '已解决: {path}（{how}）',
  'srv.takeOurs': '采用本地',
  'srv.takeTheirs': '采用对方',
  'srv.manualEdit': '手动编辑',

  // ---- 操作（ops.ts）----
  'srv.pullUnsupported': '当前仓库不支持拉取',
  'srv.updateUnsupported': '当前仓库不支持更新',
  'srv.restoredMissing': '{msg}；已恢复 {n} 个缺失文件',
  'srv.fsDeleted': '已删除磁盘文件 {n} 项',
  'srv.deleteFailed': '删除失败: {msg}',
  'srv.binaryNoEdit': '二进制文件不支持文本编辑',
  'srv.fileGone': '文件不存在（可能已被删除或移走）',
  'srv.savedFile': '已保存 {path}',
  'srv.folder': '文件夹',
  'srv.file': '文件',
  'srv.nameEmpty': '{what}名为空',
  'srv.nameHasSep': '{what}名不能含路径分隔符',
  'srv.nameExists': '已存在同名文件或文件夹：{name}',
  'srv.created': '已新建{what}: {rel}',
  'srv.targetExists': '目标已存在',
  'srv.fsRenamed': '已重命名 {from} → {to}（磁盘，不影响版本库）',
  'srv.renameFailed': '重命名失败: {msg}',
  'srv.svnIgnorePlanOnly': '仅 SVN 需要忽略预案',

  // ---- 忽略规则（ops.ts）----
  'srv.gitIgnoreWhere.gitignore': '仓库 .gitignore',
  'srv.gitIgnoreWhere.global': '全局忽略（~/.gitignore_global）',
  'srv.removeRuleFailed': '删除失败',
  'srv.ruleRemovedAt': '已删除规则: {pattern}（{where}）',
  'srv.ruleNotFound': '未找到规则: {pattern}',
  'srv.ruleRemoved': '已删除规则: {pattern}',
  'srv.unignoredAppended': '已取消忽略: {path}（追加否定到 {where}）',
  'srv.unignoreRuleNotFound': '未找到忽略 {path} 的规则（该文件当前未被任何档忽略）',
  'srv.unignoreRuleNotFoundGlobal': '未找到忽略 {path} 的规则（可能来自全局 ignore，请手动处理）',
  'srv.unignoreFailed': '取消忽略失败',
  'srv.unignoredSvn': '已取消忽略: 删除 {dir} 的规则「{rule}」，同目录匹配该规则的文件将变为未版本化',
  'srv.ignoreRuleRequired': '请填写忽略规则',
  'srv.unknownIgnoreTarget': '未知忽略去向',
  'srv.globalIgnoreUnconfigured': '全局忽略未配置，请先点击「加入忽略 → 全局」重新尝试（将自动配置 core.excludesFile）',
  'srv.ignoreAdded': '已加入忽略: {pattern}（{where}）',
  'srv.ignoreRestored': '规则已存在,已恢复忽略生效: {pattern}（{where}）',

  // ---- 浏览（browse.ts）----
  'srv.readDirFailed': '无法读取目录: {msg}',
  'srv.binaryNoDiff': '二进制文件（{path}），不支持文本对比',
  'srv.notInWcNoDiff': '该文件不在当前工作副本中，无法查看差异：{path}',
  'srv.diffNotExist': '(不存在的)',
  'srv.diffRevision': '(版本 {rev})',
  'srv.headLabel': 'HEAD（原版）',
  'srv.baseLabel': 'BASE（原版）',
  'srv.worktreeLabel': '工作区（当前）',
  'srv.truncatedLarge': '…（文件过大已截断）',
  'srv.readFailed': '读取失败',
  'srv.imageOnly': '仅支持图片文件',
  'srv.imageTooLarge': '图片过大（超过 50MB），无法预览',

  // ---- 文本写入守卫（util.ts）----
  'srv.refuseReplacementChar': '内容含无法解码的替换字符（�）——写入会把乱码固化进文件，已拒绝保存。请先「还原」该文件再重试',
  'srv.refuseTooLarge': '文件超过 {mb}MB，未读取全文——写入会把占位提示固化进文件，已拒绝保存。请用外部程序打开',
  'srv.refuseUnencodable': '该文件编码为 {enc}，保存内容含其无法表示的字符（{msg}），已拒绝写入',

  // ---- 终端（terminal.ts）----
  'srv.emptyCommand': '命令为空',
  'srv.invalidCwd': '执行目录无效（不存在或超出仓库范围）',

  // ---- 上传 / 复制（upload.ts）----
  'srv.uploadSkipped': '已跳过（同名文件已存在）',
  'srv.copySkipped': '已跳过（同名已存在）',
  'srv.writeFailed': '写入失败: {msg}',
  'srv.uploaded': '已上传',
  'srv.srcInvalid': '源路径无效或不存在',
  'srv.srcDstConflict': '源与目标位置冲突',
  'srv.copyFailed': '复制失败: {msg}',
  'srv.copied': '已复制',

  // ---- 宿主 / 环境（host.ts）----
  'srv.appImageOnly': '仅 AppImage 运行方式支持；源码运行请用 scripts/install-appimage.sh',
  'srv.unknownError': '未知错误',
  'srv.noRemote': '未配置远程',
  'srv.netAuthFailToken': '已连通（认证失败，需检查令牌）',
  'srv.netAuthFailAccount': '已连通（认证失败，请检查账号）',
  'srv.connectFailed': '连接失败',
  'srv.noRepoUrl': '未配置仓库 URL',

  // ---- 模块索引（module-index.ts）----
  'srv.noRepoOpen': '未打开仓库',
  'srv.parseFailedFull': '解析失败：md 文件不存在或不在仓库内，或未找到「路径 ← 描述」条目',
  'srv.parseFailed': '解析失败：md 文件不存在或不在仓库内',
  'srv.scopeDirInvalid': '作用目录非法',
  'srv.scopeDirOutOfBounds': '作用目录越界',

  // ---- 最近项目 / 打开（recent.ts）----
  'srv.notWc': '{dir} 不是 SVN/Git 工作副本',

  // ---- 分块暂存 / 工作副本（stage.ts / wc.ts）----
  'srv.missingPathParam': '缺少 path 参数',
  'srv.repoTypeUnsupported': '当前仓库类型不支持',
} as const;
