/** 中文语言包 · 通用：语言切换自身 + 跨域复用的动作词。
 *
 *  key 命名规范：域前缀 + 点分（`common.` / `shell.` / `fs.` / `ops.` / `repo.` / `srv.` / `vcs.` …）。
 *  值里 `{name}` 是插值占位；`a|b` 是**单复数分隔**（按 `params.n` 选，中文不用，英文用）。
 *
 *  ⚠️ 只放「界面文案」。`vcs/svn.ts` 的 `CN_MAP`（已更新/已添加…）与 `parseUpdateFiles` 里的正则是
 *  **解析 svn 命令行输出**的逻辑，不是文案，禁止搬进来 —— 翻了会直接坏功能。
 */
export const common = {
  // ---- 语言切换自身 ----
  'lang.title': '语言',
  'lang.hint': '切换界面语言（操作结果与报错消息一并切换）',
  'lang.zh': '简体中文',
  'lang.en': 'English',

  // ---- 通用动作词（跨域复用）----
  'common.ok': '确定',
  'common.cancel': '取消',
  'common.close': '关闭',
  'common.save': '保存',
  'common.delete': '删除',
  'common.edit': '编辑',
  'common.refresh': '刷新',
  'common.preview': '预览',
  'common.write': '编写',

  // ---- 网络层 / 应用级消息（client/shared/api.ts）----
  // ⚠️ common.cancelled 是「用户主动中止」的消息文本；调用方判断取消**不要比较这段文本**
  // （随语言变），要用 ApiError.cancelled 标志（见 api.ts）。
  'common.cancelled': '已取消',
  'common.serviceDown': '无法连接服务（服务可能已停止）。请重新启动应用，或检查启动它的终端窗口',

  // ---- 常见 svn/git 错误 → 提示（client/shared/utils.ts translateVcsError）----
  // ⚠️ 左侧正则匹配的是**命令输出的英文错误码/原文**，不是文案；这里只搬右侧提示。
  'common.vcsErr.noCommand': '⚠ 未检测到 svn/git 命令，请按顶部横幅指引安装后重试',
  'common.vcsErr.outOfDate': '⚠ 服务器已有新版本，请先「更新」获取最新内容后再提交',
  'common.vcsErr.locked': '⚠ 工作副本被锁定，请执行「清理」后再操作',
  'common.vcsErr.conflict': '⚠ 文件存在冲突，请先解决冲突再提交',
  'common.vcsErr.connect': '⚠ 连接服务器失败，请检查网络/账号密码后重试',
  'common.vcsErr.auth': '⚠ 认证失败，请检查账号密码（设置后重新操作）',
  'common.vcsErr.localChanges': '⚠ 本地有未提交的修改，请先提交或撤销后重试',
  'common.vcsErr.nonFastForward': '⚠ 远程仓库有新提交，请先「拉取/更新」后再推送',
  'common.vcsErr.remoteAccess': '⚠ 无法访问远程仓库，请检查网络连接与远程地址',

  // ---- 状态码说明（src/shared/types.ts CODE_DESC：文件徽标悬浮 / 网格悬浮卡 / 详情面板共用）----
  'common.code.modified': '已修改',
  'common.code.added': '已添加',
  'common.code.deleted': '已删除',
  'common.code.unversioned': '未版本化',
  'common.code.missing': '缺失',
  'common.code.conflict': '冲突',
  'common.code.replaced': '已替换/重命名',
  'common.code.external': '外部引用',
  'common.code.ignored': '已忽略',
  'common.code.updated': '已更新',
  'common.code.typeChanged': '类型变更',
  'common.code.none': '无变化',

  // ---- 其它共用文案 ----
  'common.hunkSummary': '第 {line} 行 · +{add} −{del}',
  'common.gbkUnencodable': 'GBK 无法表示字符「{ch}」(U+{code})',

  // ---- 列表连接符：并列项之间的分隔（中文顿号 / 英文逗号+空格）----
  // 用法：`names.join(t('common.listSep'))`。**别在代码里直接写 `join('、')`** ——
  // 中文标点不是"文案"、检查脚本扫不到，但英文界面下会露出顿号（实为漏网的 i18n 点）。
  'common.listSep': '、',
  'common.listSepSemi': '；',
} as const;
