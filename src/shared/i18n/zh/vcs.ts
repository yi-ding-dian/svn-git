/** 中文语言包 · VCS 层（src/vcs）：svn / git 操作的**结果消息**（⚠️ 解析命令行输出的中文不属此列）。
 *  key 前缀 `vcs.`；规范见 docs/i18n-搬运规范.md。
 *
 *  ⚠️ 本域最容易改坏，两点务必守住：
 *  1. `svn.ts` 的 `CN_MAP` / `parseUpdateFiles` / `revOf` 的正则、`git.ts` 的
 *     `没有跟踪信息|no tracking information` 这类是**解析 svn/git 命令行输出**的匹配表，
 *     源码里已逐行标 `// i18n-ignore`，禁止搬进来（翻了状态/冲突识别会静默失效）。
 *  2. 认证失败文案（`vcs.authFailed` 等）在英文侧**必须**含 "authentication failed" 字样：
 *     `server/routes/util.ts` 的 `isAuthError()` 用 `/认证失败|E170001|Authentication failed/i`
 *     兜底识别 throw 型异常（结构化 `code: 'AUTH'` 之外的路径），换了措辞会丢认证引导。
 */
export const vcs = {
  // ---- 认证 ----
  'vcs.authFailed': 'SVN 认证失败，请检查账号密码（按 o 设置）',
  'vcs.authFailedCode': 'SVN 认证失败（{code}），请检查账号密码（按 o 设置）',

  // ---- svn：查询类命令失败 / 提交 ----
  'vcs.svnStatusFailed': 'svn status 失败: {err}',
  'vcs.svnLogFailed': 'svn log 失败: {err}',
  'vcs.addedSkipped': '添加完成（已版本化的文件已自动跳过）',
  'vcs.svnAddFailed': 'svn add 失败',
  'vcs.addedCount': '已添加 {n} 项',
  'vcs.svnCommitFailed': 'svn commit 失败',
  'vcs.commitOkRev': '提交成功，版本 r{rev}',
  'vcs.commitOk': '提交成功',

  // ---- svn：更新 ----
  'vcs.updateCancelled': '更新已取消',
  'vcs.updateExternalsSkippedRev': '更新了 {n} 个文件（外部引用同步失败已跳过），当前版本 r{rev}',
  'vcs.updateExternalsSkipped': '更新了 {n} 个文件（外部引用同步失败已跳过）',
  'vcs.externalsSkippedLatestRev': '外部引用同步失败已跳过，其余已是最新（当前 r{rev}）',
  'vcs.externalsSkippedLatest': '外部引用同步失败已跳过，其余已是最新',
  'vcs.updateFailedExternalsRetried': '{err}（已尝试跳过外部引用仍失败）',
  'vcs.svnUpdateFailed': 'svn update 失败',
  'vcs.updatedFilesRev': '更新了 {n} 个文件，当前版本 r{rev}',
  'vcs.updatedFiles': '更新了 {n} 个文件',
  'vcs.updateLatestRev': '已是最新版本（当前 r{rev}）',
  'vcs.updateLatest': '已是最新版本',

  // ---- svn：还原 / 删除 / 移动 / 取历史版本 ----
  'vcs.svnRevertFailed': 'svn revert 失败',
  'vcs.revertedCount': '已还原 {n} 项',
  'vcs.removeKeepFailed': '从版本库移除失败',
  'vcs.removeKeepMarked': '已标记从版本库删除 {n} 项（本地文件保留）',
  'vcs.svnMoveFailed': 'svn move 失败',
  'vcs.moved': '已重命名 {from} → {to}（提交后生效）',
  'vcs.svnDeleteFailed': 'svn delete 失败',
  'vcs.removeMarked': '已标记删除 {n} 项',
  'vcs.svnCatRevFailed': 'svn cat -r {rev} 失败',
  'vcs.restoredToRev': '已将 {path} 还原到 {rev} 版本（工作区修改，可提交）',

  // ---- svn：分支 / 标签 / 合并 ----
  'vcs.mkdirFailed': '创建目录失败',
  'vcs.branchExists': '分支 {name} 已存在',
  'vcs.noTrunkForBranch': '仓库没有 trunk（非标准布局），无法创建分支。请先补建 trunk 目录（svn mkdir）',
  'vcs.createBranchesDirFailed': '创建 branches 目录失败: {err}',
  'vcs.createBranchFailed': '创建分支失败',
  'vcs.branchCreated': '已创建分支 {name}',
  'vcs.deleteBranchFailed': '删除分支失败',
  'vcs.branchDeleted': '已删除分支 {name}',
  'vcs.noTrunkSwitchBack': '仓库没有 trunk 目录，无法切回主干（请确认仓库布局或直接切换到其他分支）',
  'vcs.switchBranchFailed': '切换分支失败',
  'vcs.switchedToTrunk': '已切换到主干',
  'vcs.switchedToBranch': '已切换到分支 {name}',
  'vcs.switchConflict': '{msg}；⚠ 切换时产生冲突，请打开冲突视图处理冲突文件',
  'vcs.mergeFailedMaybeConflict': '合并失败（可能有冲突）',
  'vcs.mergedBranch': '已合并分支 {name} 的改动',
  'vcs.mergeConflict': '{msg}；⚠ 合并产生冲突，请打开冲突视图处理冲突文件',
  'vcs.tagExists': '标签 {name} 已存在',
  'vcs.createTagsDirFailed': '创建 tags 目录失败: {err}',
  'vcs.createTagFailed': '创建标签失败',
  'vcs.tagCreated': '已创建标签 {name}',
  'vcs.deleteTagFailed': '删除标签失败',
  'vcs.tagDeleted': '已删除标签 {name}',

  // ---- svn：清理 / 冲突解决 / 忽略 / 锁定 / blame / list ----
  'vcs.cleanupFailed': '清理失败',
  'vcs.cleanupDone': '清理完成',
  'vcs.resolveFailed': '解决冲突失败',
  'vcs.resolved': '已解决: {path}（{accept}）',
  'vcs.ignoreSetExists': '已设置忽略: {at} → {pattern}（规则已存在）',
  'vcs.ignoreSet': '已设置忽略: {at} → {pattern}',
  'vcs.ignoreFailed': '设置忽略失败',
  'vcs.ignoreNoVersionedDir': '仓库中没有已纳入版本控制的目录可承载 svn:ignore 属性',
  'vcs.ignoreCannotNoVersionedDir': '无法设置忽略：仓库中没有已纳入版本控制的目录可承载 svn:ignore 属性',
  'vcs.ignoreSetDegraded': '已设置忽略: {at} → {rule}（svn 的忽略规则不能带路径，已忽略整个 {rule} 目录）',
  'vcs.lockFailed': '锁定失败',
  'vcs.locked': '已锁定: {path}',
  'vcs.unlockFailed': '解锁失败',
  'vcs.unlocked': '已解锁: {path}',
  'vcs.svnBlameFailed': 'svn blame 失败: {err}',
  'vcs.svnListFailed': 'svn list 失败: {err}',

  // ---- git：远程 / 状态 / 提交说明 ----
  'vcs.setRemoteFailed': '设置远程地址失败',
  'vcs.remoteUpdated': '远程地址已更新',
  'vcs.remoteAdded': '远程地址已添加',
  'vcs.gitStatusFailed': 'git status 失败: {err}',
  'vcs.gitLogFailed': 'git log 失败: {err}',
  'vcs.readCommitMsgFailed': '读取提交说明失败: {err}',
  'vcs.commitNotFound': '提交不存在',
  'vcs.amendFailed': '修改注释失败',
  'vcs.amendedHash': '已修改注释 {hash}',
  'vcs.amended': '已修改注释',
  'vcs.commitAlreadyPushed': '该提交已推送，修改注释需重写远程历史（force push），已禁止',
  'vcs.rewordNeedsCleanWc': '修改较早提交的注释需要工作区干净：请先提交或贮藏当前改动（新增的未跟踪文件不影响）',
  'vcs.noParentCommit': '无法确定该提交的父提交',
  'vcs.rewordFailedDirty': '修改注释失败（工作区有未提交修改时需先提交或还原）',

  // ---- git：hunk 级部分暂存 ----
  'vcs.readDiffFailed': '读取差异失败: {err}',
  'vcs.stageNotUtf8': '该文件不是 UTF-8 编码（如 GBK），行级暂存暂不支持——请整文件暂存，或用其它工具处理',
  'vcs.noStagedChanges': '该文件没有可暂存的改动',
  'vcs.fileChangedAfterOpen': '文件在弹窗打开后已被改动，请关闭后重新打开再选',
  'vcs.noHunksSelected': '未选择任何改动',
  'vcs.stageFailed': '暂存失败',
  'vcs.stageFailedErr': '暂存失败: {err}',
  'vcs.stagedHunks': '已暂存 {n} 处改动',
  'vcs.resetSoftFailed': '撤销提交失败',
  'vcs.resetSoftDone': '已撤销最近一次提交（改动回到暂存区，可重新提交）',
  'vcs.gitAddFailed': 'git add 失败',
  'vcs.stagedCount': '已暂存 {n} 项',
  'vcs.gitCommitFailed': 'git commit 失败',
  'vcs.commitOkRef': '提交成功 {ref} {hash}',
  'vcs.stagedCleanupFailed': '暂存区清理失败: {err}',

  // ---- git：拉取 / 还原 / 删除 / 移动 / 推送 ----
  'vcs.noRemotePull': '此仓库未配置远程（origin），无法拉取更新。',
  'vcs.gitPullFailed': 'git pull 失败',
  'vcs.pullLatestBranch': '已是最新（分支 {branch} @ {hash}）',
  'vcs.updateDone': '更新完成',
  'vcs.gitRevertFailed': 'git 还原失败',
  'vcs.deletedCount': '已删除 {n} 项',
  'vcs.gitRmFailed': 'git rm 失败',
  'vcs.removeKeepRemoved': '已从版本库移除 {n} 项（本地文件保留，状态变为 ? 未版本化）',
  'vcs.restoreRevFailed': '还原到指定版本失败',
  'vcs.gitMvFailed': 'git mv 失败',
  'vcs.noRemotePush': '此仓库未配置远程（origin），无法推送。',
  'vcs.pushCancelled': '推送已取消',
  'vcs.pushOk': '推送成功',
  'vcs.gitPushFailed': 'git push 失败',
  'vcs.gitLsTreeFailed': 'git ls-tree 失败: {err}',

  // ---- git：分支 / 合并 ----
  'vcs.gitBranchFailed': 'git branch 失败: {err}',
  'vcs.createBranchWithBase': '已创建分支 {name}（基于 {base}）',
  'vcs.branchPushed': '已推送分支 {name} 到远程',
  'vcs.needRemoteBranchName': '需远程分支名（origin/名字）',
  'vcs.remoteBranchDeleted': '已删除远程分支 {name}',
  'vcs.switchedWithTracking': '已切换到 {name}（自动创建本地跟踪分支 {local}）',
  'vcs.switchedTo': '已切换到 {name}',
  'vcs.currentBranch': '当前分支',
  'vcs.mergeConflicts': '合并 {name} 时这些文件冲突了，需要手动解决（{n} 个）：{list}\n解决完提交，合并就完成了',
  'vcs.moreCount': '等 {n} 个',
  'vcs.pathListSep': '、',
  'vcs.branchNotFound': '找不到分支 {name}',
  'vcs.unresolvedMergeFirst': '上次合并的冲突还没处理完，先去「解决冲突」里解决掉',
  'vcs.mergeLocalChangesBlocked': '这些文件你有未提交的改动，合并会覆盖它们，请先提交或贮藏：{list}',
  'vcs.mergeLocalChangesBlockedNoList': '这些文件你有未提交的改动，合并会覆盖它们，请先提交或贮藏',
  'vcs.mergeUpToDate': '不用合并：{name} 的改动 {cur} 里已经有了',
  'vcs.mergeFastForward': '{name} 上的改动已经进 {cur} 了（现在两边内容一样）',
  'vcs.mergedWithCommit': '已把 {name} 合并进 {cur}，生成了一条合并记录',
  'vcs.mergedInto': '已把 {name} 合并进 {cur}',
  'vcs.mergeFailed': '合并失败',
  'vcs.noMergeInProgress': '当前没有进行中的合并',
  'vcs.mergeAbortFailed': '中止合并失败',
  'vcs.mergeAbortDone': '已中止合并，工作区已还原到合并前状态',

  // ---- git：标签 / Stash ----
  'vcs.gitTagFailed': 'git tag 失败: {err}',
  'vcs.stashNoChanges': '没有可保存的改动',
  'vcs.stashFailed': 'stash 失败',
  'vcs.stashSaved': '改动已保存到 Stash',
  'vcs.stashPopFailed': '恢复失败（可能有冲突）',
  'vcs.stashPopped': '已恢复 stash@{index}',
  'vcs.stashDropFailed': '丢弃失败',
  'vcs.stashDropped': '已丢弃 stash@{index}',

  // ---- git：仓库 / 远程 / 清理 / 忽略 ----
  'vcs.gitInitFailed': 'git init 失败',
  'vcs.repoInitialized': '仓库已初始化: {dir}',
  'vcs.cloneFailed': '克隆失败',
  'vcs.clonedTo': '已克隆到 {dir}',
  'vcs.remoteAddFailed': '添加远程失败',
  'vcs.remoteAddedName': '已添加远程 {name}',
  'vcs.remoteRemoveFailed': '移除远程失败',
  'vcs.remoteRemoved': '已移除远程 {name}',
  'vcs.gitBlameFailed': 'git blame 失败: {err}',
  'vcs.gitCleanPreviewFailed': 'git clean 预览失败: {err}',
  'vcs.cleanedCount': '已清理 {n} 项未跟踪文件',
  'vcs.cleanedAll': '已清理全部未跟踪文件',
  'vcs.ignoreAddedPattern': '已加入忽略: {pattern}',
  'vcs.writeGitignoreFailed': '写入 .gitignore 失败: {err}',

  // ---- diff 块摘要（hunk 勾选弹窗里每块的标题）----
  'vcs.hunkSummary': '第 {line} 行 · +{add} −{del}',

  // ---- 写入版本库历史的消息（工具自动生成的 svn/git 提交信息）----
  // ⚠️ 这些**会永久写进仓库历史**，协作者在历史视图都能看到。经用户拍板：**跟随界面语言**
  //    （切到英文界面创建的分支/tag，消息就是英文）。改这些文案等于改写入仓库的数据，谨慎。
  'vcs.commitMsg.mkdir': '创建目录',
  'vcs.commitMsg.branchCreate': '创建分支 {name}',
  'vcs.commitMsg.branchDelete': '删除分支 {name}',
  'vcs.commitMsg.tagCreate': '创建标签 {name}',
  'vcs.commitMsg.tagDelete': '删除标签 {name}',
  /** 创建标准布局（trunk/branches/tags）时的提交信息。key 在 vcs 域，但用在 server/index.ts —— 同性质的消息放一起 */
  'vcs.commitMsg.stdLayout': '创建标准布局 trunk/branches/tags',
} as const;
