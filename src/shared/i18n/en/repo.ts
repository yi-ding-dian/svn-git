/** 英文语言包 · 仓库域（client/repo）：打开 / 新建 / 检出 / 登录 / 目录选择 / 最近项目。
 *  key 前缀 `repo.`；规范见 docs/i18n-搬运规范.md。
 *
 *  术语：检出 = Checkout、版本库 = Repository、工作副本 = Working Copy、克隆 = Clone、获取 = Fetch、备注 = Note。
 *  ⚠️ 含 JSX 的长句对应 zh 侧的拆段（段值首尾空格与相邻元素拼接），别顺手 trim。
 */
export const repo = {
  // ---- 本域多个弹窗共用 ----
  'repo.up': '← Up',
  'repo.saving': 'Saving…',
  'repo.pickDirTitle': '📂 Choose Parent Directory',
  'repo.parentDir': 'Parent Directory',
  'repo.browse': '📂 Browse',
  'repo.browseTip': 'Open the folder browser (create/rename folders)',
  'repo.confirm.target': 'Target path: {path}',

  // ---- 启动页 ----
  'repo.home.title': 'svn-git Version Control',
  'repo.home.sub': 'Browse and select an SVN/Git repository directory',
  'repo.home.newRepo': '+ New Repository (git init / SVN create)…',
  'repo.home.getRepo': '⬇ Get Repository…',

  // ---- 打开项目 ----
  'repo.open.title': '📂 Open Project',
  'repo.open.failed': 'Failed to open',
  'repo.open.failedMsg': 'Failed to open: {msg}',
  'repo.open.opened': 'Opened repository: {root}',
  'repo.open.notRepo':
    'No SVN/Git repository detected in this directory. Pick another one, or open a directory that contains a repository from the list below',
  'repo.open.switchedDir': 'Switched to directory: {path}',
  'repo.open.detectedBare': 'SVN repository storage directory detected: {path}',
  'repo.open.dragUnsupported':
    'This browser cannot resolve dropped paths; the system directory picker was opened instead — please choose your project directory',
  'repo.open.pickUnsupported': 'The system directory picker is not available here; please type the path manually',
  'repo.open.pathPlaceholder': 'Type a full project path and press Enter, or drop a folder below to detect it…',
  'repo.open.pickDirTip': 'Open the system directory picker',
  'repo.open.pickDirBtn': '📁 Choose Directory…',
  'repo.open.openBtn': 'Open',
  'repo.open.dropHint': '📁 Or drop a folder into this window — SVN/Git repositories are detected automatically',
  'repo.open.loading': '⏳ Reading directory…',
  'repo.open.emptyDir': 'Empty directory',
  'repo.open.dblClickDir': 'Double-click to enter {name}',
  'repo.open.wcLabel': '{root} — SVN/Git working copy',
  'repo.open.enterThis': 'Open this repository →',

  // ---- SVN 版本库存储目录提示 ----
  'repo.bare.isStore': 'is an SVN repository storage directory (server-side data, not editable directly).',
  'repo.bare.openWcHint': 'Open its working copy for daily work:',
  'repo.bare.enterWc': 'Open working copy {name} →',

  // ---- 最近项目 ----
  'repo.recent.title': 'Recent Projects (click to open)',
  'repo.recent.invalidTip': '{path} (cannot open: directory deleted or not a working copy)',
  'repo.recent.itemTip': '{path}\nClick to open · right-click to remove',
  'repo.recent.removeTip': 'Remove from recent projects (does not affect the repository itself)',
  'repo.recent.removeAria': 'Remove {path}',
  'repo.recent.removeFailed': 'Failed to remove',
  'repo.recent.delFailed': 'Failed to delete',
  'repo.recent.expandTip': 'Show the other {n} project|Show the other {n} projects',
  'repo.recent.expandCount': '… ({n} more)',

  // ---- 新建仓库 ----
  'repo.create.title': 'New Repository',
  'repo.create.needDirName': 'Please fill in the directory and name',
  'repo.create.creating': 'Creating…',
  'repo.create.create': 'Create',
  'repo.create.help':
    'Two options: Git repository = initialize a new repository in a local directory (git init); SVN repository = create a local repository with svnadmin, with the standard layout (trunk / branches / tags) by default and trunk checked out as the working copy (directory name + "-wc").',
  'repo.create.typeGit': 'Git Repository (init)',
  'repo.create.typeSvn': 'SVN Repository (svnadmin)',
  'repo.create.name': 'Repository Name',
  'repo.create.previewGit': 'Will create: Git repository {path}\nCreated with git init; opens automatically afterwards',
  'repo.create.previewSvn':
    'Will create: SVN repository {path} (server-side storage, not editable directly)\nand check out the working copy {wc} (opens automatically afterwards; daily edits, adds and commits happen in the working copy)',
  'repo.create.standard': 'Create the standard layout (trunk / branches / tags), checking out trunk',
  'repo.create.standardWarn':
    '⚠ Without the standard layout, branch/tag management will be unavailable (branches and tags can no longer be created automatically)',
  'repo.create.confirmTitle': 'Create this repository?',
  'repo.create.confirm': 'Create',
  'repo.create.willRunGit': 'Will run: git init (hover the button for the command preview)',
  'repo.create.willRunSvn':
    'Will run: svnadmin create to make the repository + check out the working copy (hover the button for the command preview)',
  'repo.create.inRepoTip':
    '⚠ The target is inside the {type} repository ({root}) — creating there makes it unversioned content of the outer repository; status/data may get mixed up',
  'repo.create.existsTip':
    '⚠ The target directory already exists and is not empty ({target}) — it may already contain a repository/files; continuing may fail or nest',

  // ---- 获取仓库 ----
  'repo.get.title': 'Get Repository',
  'repo.get.needUrl': 'Please fill in the URL',
  'repo.get.needTargetName': 'Please fill in the target and name',
  'repo.get.getting': 'Fetching…',
  'repo.get.get': 'Get',
  'repo.get.help':
    'Two options: Git clone = git clone (copy from a URL to your machine); SVN checkout = svn checkout (fetch a working copy from the server; the target directory is the local name).',
  'repo.get.typeGit': 'Git Clone',
  'repo.get.typeSvn': 'SVN Checkout',
  'repo.get.url': 'URL',
  'repo.get.localName': 'Local Name (working copy name)',
  'repo.get.previewGit': 'Will clone: {url} → {path}\nOpens automatically after git clone',
  'repo.get.previewSvn':
    'Will check out: {url} → {path}\nOpens automatically after svn checkout (prefer checking out trunk or the target branch/tag)',
  'repo.get.elapsed': '⏳ Fetching… {n}s elapsed (limit {max}s; stops automatically on timeout)',
  'repo.get.confirmTitle': 'Fetch this repository?',
  'repo.get.confirm': 'Get',
  'repo.get.willRunGit': 'Will run: git clone {url} (hover the button for the command preview)',
  'repo.get.willRunSvn': 'Will run: svn checkout {url} (hover the button for the command preview)',
  'repo.get.inRepoTip':
    '⚠ The target is inside the {type} repository ({root}) — the checked-out files become unversioned content of the outer repository; status/data may get mixed up',
  'repo.get.existsTip':
    '⚠ The target directory already exists and is not empty ({target}) — cloning/checking out into a non-empty directory fails; it may already contain a repository/files',

  // ---- 推送/克隆认证弹窗 ----
  'repo.auth.needUserPass': 'Please enter the username and password',
  'repo.auth.saveFailed': 'Failed to save: {msg}',
  'repo.auth.failed': '⚠ Authentication failed: {msg}',
  'repo.auth.titlePushGithub': '🔑 GitHub Push Authentication',
  'repo.auth.titlePushSsh': '🔑 SSH Push Tips',
  'repo.auth.titlePushServer': '🔑 Git Server Push Authentication',
  'repo.auth.titleGetGithub': '🔑 GitHub Fetch Authentication',
  'repo.auth.titleGetSsh': '🔑 SSH Fetch Tips',
  'repo.auth.titleGetServer': '🔑 Git Server Fetch Authentication',
  'repo.auth.ssh1': 'The current remote URL uses',
  'repo.auth.ssh2': ' (git@…). Make sure an SSH key exists on this machine and is added to ssh-agent (',
  'repo.auth.ssh3': ' to generate it, ',
  'repo.auth.ssh4': ' to add it, ',
  'repo.auth.ssh5': ' to verify).',
  'repo.auth.ssh6Push': ' To push with a username and password instead, switch to an ',
  'repo.auth.ssh6Get': ' To fetch the repository with a username and password instead, switch to an ',
  'repo.auth.ssh7': ' URL (the remote URL can be changed under "Git Info").',
  'repo.auth.githubUser': 'GitHub Username',
  'repo.auth.user': 'Username',
  'repo.auth.githubUserPlaceholder': 'your-github-username',
  'repo.auth.serverUserPlaceholder': 'server username',
  'repo.auth.patLabel': 'Personal Access Token',
  'repo.auth.passLabel': 'Password / Token',
  'repo.auth.patPlaceholder': 'ghp_xxx (Settings → Developer settings → Tokens)',
  'repo.auth.passPlaceholder': 'Password or access token',
  'repo.auth.patHint1': 'Generate one at GitHub → Settings → Developer settings → Personal access tokens and check the ',
  'repo.auth.patHint2Push': ' scope to push.',
  'repo.auth.patHint2Get': ' scope to fetch the repository.',
  'repo.auth.saveAndPush': 'Save & Push',
  'repo.auth.saveAndGet': 'Save & Fetch',

  // ---- SVN 账号设置 ----
  'repo.login.title': 'SVN Account Settings',
  'repo.login.saved': 'SVN account saved',
  'repo.login.cleared': 'SVN account cleared',
  'repo.login.loggedOut': 'Signed out of SVN (using the official credential cache instead)',
  'repo.login.currentAccount': 'Signed-in Account',
  'repo.login.accountHint': '(used for operations on SVN repositories)',
  'repo.login.switch': '🔄 Switch Account',
  'repo.login.logout': '🚪 Sign Out',
  'repo.login.usernameLabel': 'Username (leave empty to use the svn credential cache)',
  'repo.login.password': 'Password',
  'repo.login.trustCert': 'Trust self-signed HTTPS certificates',

  // ---- 目录选择器 ----
  'repo.picker.created': 'Created {name}',
  'repo.picker.createFailed': 'Failed to create: {msg}',
  'repo.picker.renamed': 'Renamed {from} → {to}',
  'repo.picker.renameFailed': 'Failed to rename: {msg}',
  'repo.picker.newPlaceholder': 'Type a folder name and press Enter to create',
  'repo.picker.newTip': 'Create a folder in the current location',
  'repo.picker.newFolder': '📁 New Folder',
  'repo.picker.dirTip': '{name}/\nDouble-click to enter · right-click to rename',
  'repo.picker.emptyDir': 'Empty directory (you can create a folder)',
  'repo.picker.rename': 'Rename',
  'repo.picker.current': 'Current: {path}',
  'repo.picker.choose': 'Choose This Directory',

  // ---- 环境检测 / 安装 ----
  'repo.env.title': 'Environment Check',
  'repo.env.canceled': '[Installation cancelled]',
  'repo.env.installed': 'Installed',
  'repo.env.notInstalled': 'Not installed',
  'repo.env.onlyAffects': 'Only affects {tool} repository operations',
  'repo.env.installing': 'Installing…',
  'repo.env.download': 'Install',
  'repo.env.help1': 'This tool supports both ',
  'repo.env.help2': ' and ',
  'repo.env.help3':
    ' repositories. Whichever you use, the matching command-line tool must be installed; if you only use one, install just that one — a missing engine only affects operations on that kind of repository.',
  'repo.env.done': 'Installation complete — click the button below to reload the page, then you can use it',
  'repo.env.failed': 'Installation failed. Run it manually in a terminal:',
  'repo.env.cancelInstall': 'Cancel Install',
  'repo.env.reload': '🔄 Reload Page',

  // ---- 侧边栏「最近项目 · …」 ----
  'repo.recentMore.title': 'Other {n} recent project|Other {n} recent projects',
  'repo.recentMore.remarkTip': '{path}\nNote: {remark}',
  'repo.recentMore.fav': 'Favorite project',

  // ---- 备注弹窗 ----
  'repo.remark.title': 'Note',
  'repo.remark.intro': 'Write a note for "{name}"; it shows before the time in recent projects (the sidebar is narrow, so long notes are truncated to "…" — hover the entry to read the full text)',
  'repo.remark.placeholder': 'e.g. client demo / main dev repository…',
  'repo.remark.clearHint': 'Save with empty text = delete the note',
  'repo.remark.noInput': 'No note entered yet',
  'repo.remark.save': 'Save Note',
  'repo.remark.delete': 'Delete Note',

  // ---- 最近项目的删除 / 常用 / 备注失败消息 ----
  'repo.fav.setFailed': 'Failed to mark as favorite',
  'repo.fav.unsetFailed': 'Failed to unmark favorite',
  'repo.remark.setFailed': 'Failed to save note',
  'repo.remark.clearFailed': 'Failed to clear note',
};
