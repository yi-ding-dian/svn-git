/** 中文语言包 · 仓库域（client/repo）：打开 / 新建 / 检出 / 登录 / 目录选择 / 最近项目。
 *  key 前缀 `repo.`；规范见 docs/i18n-搬运规范.md。
 *
 *  ⚠️ 含 JSX（<b> / <span className="mono">）的长句按「结构留在 JSX、文本取出来」拆成多段
 *  （见 open.tsx 的 SVN 存储目录提示、git-auth.tsx 的 SSH 提示）：段值首尾的空格是有意的，
 *  与相邻 JSX 元素拼接后还原原文排版，别顺手 trim。
 *  ⚠️ 命令预览（cmdOfRepo 产出）、占位符 `…`、URL 示例不是文案，未入包。
 */
export const repo = {
  // ---- 本域多个弹窗共用 ----
  'repo.up': '← 上级',
  'repo.saving': '保存中…',
  'repo.pickDirTitle': '📂 选择所在目录',
  'repo.parentDir': '所在目录（父目录路径）',
  'repo.browse': '📂 浏览',
  'repo.browseTip': '打开文件夹浏览（可新建/重命名文件夹）',
  'repo.confirm.target': '目标路径：{path}',

  // ---- 启动页（OpenView）----
  'repo.home.title': 'svn-git文件版本管理',
  'repo.home.sub': '浏览并选择 SVN/Git 仓库目录',
  'repo.home.newRepo': '＋ 新建仓库（git init / SVN 建库）…',
  'repo.home.getRepo': '⬇ 获取仓库…',

  // ---- 打开项目（OpenModal / OpenBrowser）----
  'repo.open.title': '📂 打开项目',
  'repo.open.failed': '打开失败',
  'repo.open.failedMsg': '打开失败: {msg}',
  'repo.open.opened': '已打开仓库: {root}',
  'repo.open.notRepo': '当前目录未识别到 SVN/Git 仓库，请重新选择，或从下方文件列表中选择包含仓库的目录',
  'repo.open.switchedDir': '已切换到目录: {path}',
  'repo.open.detectedBare': '检测到 SVN 版本库存储目录: {path}',
  'repo.open.dragUnsupported': '当前浏览器不支持拖拽路径识别，已自动打开系统目录选择，请选择项目目录',
  'repo.open.pickUnsupported': '当前运行环境不支持系统目录选择，请手动输入路径',
  'repo.open.pathPlaceholder': '输入完整项目路径后回车，或将文件夹拖入下方区域识别…',
  'repo.open.pickDirTip': '打开系统目录选择框',
  'repo.open.pickDirBtn': '📁 选择目录…',
  'repo.open.openBtn': '打开',
  'repo.open.dropHint': '📁 或将文件夹直接拖入此窗口，自动识别 SVN/Git 仓库',
  'repo.open.loading': '⏳ 读取目录…',
  'repo.open.emptyDir': '空目录',
  'repo.open.dblClickDir': '双击进入目录 {name}',
  'repo.open.wcLabel': '{root} — SVN/Git 工作副本',
  'repo.open.enterThis': '进入此仓库 →',

  // ---- SVN 版本库存储目录提示（OpenBrowser 识别到 svnadmin 布局时）----
  // 前后两段与 <b>{name}</b> 直接拼接，段首空格是有意的
  'repo.bare.isStore': '是 SVN 版本库存储目录（服务器数据，不能直接编辑）。',
  'repo.bare.openWcHint': '请打开它的工作副本进行日常操作：',
  'repo.bare.enterWc': '进入工作副本 {name} →',

  // ---- 最近项目（OpenBrowser 顶部的列表 + 右键菜单）----
  'repo.recent.title': '最近项目（点击打开）',
  'repo.recent.invalidTip': '{path}（打不开，目录已删除或不是工作副本）',
  'repo.recent.itemTip': '{path}\n点击打开 · 右键删除',
  'repo.recent.removeTip': '从最近项目中移除（不影响仓库本身）',
  'repo.recent.removeAria': '移除 {path}',
  'repo.recent.removeFailed': '移除失败',
  'repo.recent.delFailed': '删除失败',
  'repo.recent.expandTip': '展开其余 {n} 个项目',
  'repo.recent.expandCount': '…（{n} 条）',

  // ---- 新建仓库（CreateRepoDialog）----
  'repo.create.title': '新建仓库',
  'repo.create.needDirName': '请填写目录和名称',
  'repo.create.creating': '创建中…',
  'repo.create.create': '创建',
  'repo.create.help':
    '两种方式：Git 仓库 = 在本地目录初始化新仓库（git init）；SVN 仓库 = 用 svnadmin 创建本地仓库，默认创建标准布局（trunk / branches / tags）并检出 trunk 作为工作副本（目录名 + "-wc"）。',
  'repo.create.typeGit': 'Git 仓库 (init)',
  'repo.create.typeSvn': 'SVN 仓库（svnadmin）',
  'repo.create.name': '仓库名称',
  'repo.create.previewGit': '将创建：Git 仓库 {path}\ngit init 创建，创建后自动打开',
  'repo.create.previewSvn':
    '将创建：SVN 版本库 {path}（服务器存储，不能直接编辑）\n并检出工作副本 {wc}（创建后自动打开；日常编辑、添加、提交都在工作副本进行）',
  'repo.create.standard': '创建标准布局（trunk / branches / tags），工作副本检出 trunk',
  'repo.create.standardWarn': '⚠ 不创建标准布局：分支 / 标签管理将不可用（后续无法自动创建分支和标签）',
  'repo.create.confirmTitle': '确认创建仓库？',
  'repo.create.confirm': '确认创建',
  'repo.create.willRunGit': '将执行：git init 初始化仓库（命令预览见按钮）',
  'repo.create.willRunSvn': '将执行：svnadmin create 创建版本库 + 检出工作副本（命令预览见按钮）',
  'repo.create.inRepoTip':
    '⚠ 目标位于 {type} 仓库内（{root}）——在其内部创建会成为外层仓库的未版本化内容，状态/数据可能错乱',
  'repo.create.existsTip': '⚠ 目标目录已存在且非空（{target}）——可能已有仓库/文件，继续创建可能失败或产生嵌套',

  // ---- 获取仓库（GetRepoDialog）----
  'repo.get.title': '获取仓库',
  'repo.get.needUrl': '请填写地址（URL）',
  'repo.get.needTargetName': '请填写目标和名称',
  'repo.get.getting': '获取中…',
  'repo.get.get': '获取',
  'repo.get.help':
    '两种方式：Git 克隆 = git clone（从地址复制一份到本地）；SVN 检出 = svn checkout（从服务器获取工作副本，目标目录即本地名称）。',
  'repo.get.typeGit': 'Git 克隆',
  'repo.get.typeSvn': 'SVN 检出',
  'repo.get.url': '地址（URL）',
  'repo.get.localName': '本地名称（工作副本名）',
  'repo.get.previewGit': '将克隆：{url} → {path}\ngit clone 后自动打开',
  'repo.get.previewSvn': '将检出：{url} → {path}\nsvn checkout 后自动打开（SVN 建议检出 trunk 或目标分支/标签）',
  'repo.get.elapsed': '⏳ 正在获取…已用 {n} 秒（最多 {max} 秒，超时会自动停止）',
  'repo.get.confirmTitle': '确认获取仓库？',
  'repo.get.confirm': '确认获取',
  'repo.get.willRunGit': '将执行：git clone {url}（命令预览见按钮）',
  'repo.get.willRunSvn': '将执行：svn checkout {url}（命令预览见按钮）',
  'repo.get.inRepoTip':
    '⚠ 目标位于 {type} 仓库内（{root}）——检出的文件会成为外层仓库的未版本化内容，状态/数据可能错乱',
  'repo.get.existsTip': '⚠ 目标目录已存在且非空（{target}）——克隆/检出到非空目录会失败，可能已有仓库/文件',

  // ---- 推送/克隆认证弹窗（GitPushAuthModal；purpose 是语义枚举，取值 push / get）----
  'repo.auth.needUserPass': '请填写用户名和密码',
  'repo.auth.saveFailed': '保存失败: {msg}',
  'repo.auth.failed': '⚠ 认证失败：{msg}',
  'repo.auth.titlePushGithub': '🔑 GitHub 推送认证',
  'repo.auth.titlePushSsh': '🔑 SSH 推送提示',
  'repo.auth.titlePushServer': '🔑 Git 服务器推送认证',
  'repo.auth.titleGetGithub': '🔑 GitHub 获取仓库认证',
  'repo.auth.titleGetSsh': '🔑 SSH 获取仓库提示',
  'repo.auth.titleGetServer': '🔑 Git 服务器获取仓库认证',
  // SSH 提示：围绕三个 <span className="mono"> 命令拆段，段首/段尾空格与原文渲染一致
  'repo.auth.ssh1': '当前远程地址使用',
  'repo.auth.ssh2': '(git@…)。请确认本机已配置 SSH 密钥并已加入 ssh-agent（',
  'repo.auth.ssh3': ' 生成、',
  'repo.auth.ssh4': ' 加入、',
  'repo.auth.ssh5': ' 验证）。',
  'repo.auth.ssh6Push': ' 如需使用用户名密码推送，请改用 ',
  'repo.auth.ssh6Get': ' 如需使用用户名密码获取仓库，请改用 ',
  'repo.auth.ssh7': ' 地址（可在「Git 信息」中修改远程地址）。',
  'repo.auth.githubUser': 'GitHub 用户名',
  'repo.auth.user': '用户名',
  'repo.auth.githubUserPlaceholder': 'your-github-username',
  'repo.auth.serverUserPlaceholder': '服务器用户名',
  'repo.auth.patLabel': 'Personal Access Token',
  'repo.auth.passLabel': '密码 / Token',
  'repo.auth.patPlaceholder': 'ghp_xxx（Settings → Developer settings → Tokens）',
  'repo.auth.passPlaceholder': '密码或访问令牌',
  // GitHub PAT 提示：分段与 <b>repo</b>（权限名，标识符不翻）拼接，首段尾空格是有意的
  'repo.auth.patHint1': '在 GitHub 的 Settings → Developer settings → Personal access tokens 生成，勾选 ',
  'repo.auth.patHint2Push': ' 权限即可推送。',
  'repo.auth.patHint2Get': ' 权限即可获取仓库。',
  'repo.auth.saveAndPush': '保存并推送',
  'repo.auth.saveAndGet': '保存并获取仓库',

  // ---- SVN 账号设置（LoginModal）----
  'repo.login.title': 'SVN 账号设置',
  'repo.login.saved': 'SVN 账号已保存',
  'repo.login.cleared': 'SVN 账号已清除',
  'repo.login.loggedOut': '已退出 SVN 登录（改用官方凭据缓存）',
  'repo.login.currentAccount': '当前已登录账号',
  'repo.login.accountHint': '（SVN 仓库操作使用此账号）',
  'repo.login.switch': '🔄 切换账号',
  'repo.login.logout': '🚪 退出登录',
  'repo.login.usernameLabel': '用户名（留空表示使用 svn 官方凭据缓存）',
  'repo.login.password': '密码',
  'repo.login.trustCert': '信任 HTTPS 自签名证书',

  // ---- 目录选择器（DirPicker）----
  'repo.picker.created': '已创建 {name}',
  'repo.picker.createFailed': '创建失败: {msg}',
  'repo.picker.renamed': '已重命名 {from} → {to}',
  'repo.picker.renameFailed': '重命名失败: {msg}',
  'repo.picker.newPlaceholder': '输入文件夹名称，回车创建',
  'repo.picker.newTip': '在当前位置新建文件夹',
  'repo.picker.newFolder': '📁 新建文件夹',
  'repo.picker.dirTip': '{name}/\n双击进入 · 右键重命名',
  'repo.picker.emptyDir': '空目录（可新建文件夹）',
  'repo.picker.rename': '重命名',
  'repo.picker.current': '当前: {path}',
  'repo.picker.choose': '选择此目录',

  // ---- 环境检测 / 安装（EnvInstallModal）----
  'repo.env.title': '环境检测',
  'repo.env.canceled': '【已取消安装】',
  'repo.env.installed': '已安装',
  'repo.env.notInstalled': '未安装',
  'repo.env.onlyAffects': '仅影响 {tool} 仓库操作',
  'repo.env.installing': '安装中…',
  'repo.env.download': '下载安装',
  'repo.env.help1': '本工具同时支持 ',
  'repo.env.help2': ' 和 ',
  'repo.env.help3':
    ' 两种仓库。使用哪种仓库，系统需已安装对应的命令行工具；只用其中一种时，只需安装对应的一种即可，未安装的引擎仅影响该类仓库的操作。',
  'repo.env.done': '安装完成，点击下方按钮刷新页面后即可使用',
  'repo.env.failed': '安装失败。请在终端手动执行：',
  'repo.env.cancelInstall': '取消安装',
  'repo.env.reload': '🔄 刷新页面',

  // ---- 侧边栏「最近项目 · …」（RecentMorePopover）----
  'repo.recentMore.title': '其余 {n} 个最近项目',
  'repo.recentMore.remarkTip': '{path}\n备注：{remark}',
  'repo.recentMore.fav': '常用项目',

  // ---- 备注弹窗（RemarkModal）----
  'repo.remark.title': '备注',
  'repo.remark.intro': '给「{name}」写一句备注，显示在最近项目的时间前面（侧边栏窄，过长会被截断成「…」，悬浮该项可看全文）',
  'repo.remark.placeholder': '例如：客户演示用 / 主要开发仓库…',
  'repo.remark.clearHint': '清空后保存 = 删除备注',
  'repo.remark.noInput': '还没有输入备注',
  'repo.remark.save': '保存备注',
  'repo.remark.delete': '删除备注',

  // ---- 最近项目的删除 / 常用 / 备注失败消息（useProjectHistory）----
  'repo.fav.setFailed': '设置常用失败',
  'repo.fav.unsetFailed': '取消常用失败',
  'repo.remark.setFailed': '备注失败',
  'repo.remark.clearFailed': '清除备注失败',
} as const;
