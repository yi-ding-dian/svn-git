/** 英文语言包 · 服务端（HTTP 路由返回给界面的消息）。 */
export const srv = {
  // ---- 语言（原有）----
  'srv.lang.invalid': 'Unsupported language',

  // ---- 通用（多路由复用）----
  'srv.unknownAction': 'Unknown action',
  'srv.unknownRepoType': 'Unknown repository type',
  'srv.invalidParams': 'Invalid parameters',
  'srv.incompleteParams': 'Incomplete parameters',
  'srv.missingPath': 'Missing path',
  'srv.pathEmpty': 'Path is empty',
  'srv.samePath': 'Source and destination paths are the same',
  'srv.notGitRepo': 'Not a Git repository',
  'srv.gitOnly': 'Only Git repositories are supported',
  'srv.svnOnly': 'Only SVN repositories are supported',
  'srv.fileNotFound': 'File not found',
  'srv.fileNotFoundAt': 'File not found: {path}',
  'srv.unsupportedOp': 'This operation is not supported for the current repository',
  'srv.pathOutOfBounds': 'Path is out of bounds',
  'srv.outOfScope': 'Outside the working copy',
  'srv.pathOutOfWc': 'Path is outside the working copy: {path}',
  'srv.unknown': 'unknown',
  'srv.rootDir': 'the root directory',

  // ---- 仓库创建 / 克隆（server/index.ts）----
  'srv.crossSiteRejected': 'Cross-site request rejected',
  'srv.missingDirOrName': 'Missing directory or name',
  'srv.fillDirPath': 'Please enter a directory path',
  'srv.cloneTimeout': 'Fetch timed out (over {sec}s), stopped',
  'srv.cloneCancelled': 'Fetch cancelled',
  'srv.clonedTo': 'Cloned to {path}',
  'srv.cloneFailed': 'Clone failed',
  'srv.initedRepo': 'Initialized repository {path}',
  'srv.gitInitFailed': 'git init failed',
  'srv.svnCheckedOut': 'Checked out SVN working copy {path}',
  'srv.svnCheckoutFailed': 'svn checkout failed',
  'srv.svnadminFailed': 'svnadmin create failed',
  'srv.layoutCreateFailed': 'Failed to create the standard layout: {msg}',
  'srv.stdLayoutTrunk': ' (standard layout; working copy checked out from trunk)',
  'srv.stdLayout': ' (standard layout)',
  'srv.createdSvnRepo': 'Created SVN repository {path}{layout} (working copy {wc})',
  'srv.createdSvnRepoWcFailed': 'Created SVN repository {path}{layout} (working copy checkout failed: {msg})',
  'srv.portInUse': 'Port {port} in use, falling back to a random port',

  // ---- 配置（config / git-auth / lang / git-config）----
  'srv.saveConfigFailed': 'Failed to save config: {msg}',
  'srv.gitAuthEmpty': 'Username and password are required',
  'srv.gitAuthSaved': 'Push credentials saved',
  'srv.remoteUrlEmpty': 'Remote URL is required',

  // ---- 分支 / 标签 / Stash（branch.ts）----
  'srv.missingBranch': 'Missing branch name',
  'srv.missingRev': 'Missing rev parameter',
  'srv.mergeAbortUnsupported': 'Aborting a merge is not supported for the current repository',
  'srv.remoteBranchName': 'Remote branch name required (origin/name)',
  'srv.trunkNoDelete': "The main branch cannot be deleted (it is the team's stable branch)",
  'srv.branchPushUnsupported': 'Branch push is not supported for the current repository type',
  'srv.messageRequired': 'Message cannot be empty',
  'srv.svnNoStash': 'SVN does not support Stash',

  // ---- 冲突解决（conflicts.ts）----
  'srv.notInConflict': '{path} is not in a conflicted state; cannot take the local/remote version',
  'srv.takeFailed': 'Failed to take the version',
  'srv.resolved': 'Resolved: {path} ({how})',
  'srv.takeOurs': 'took local version',
  'srv.takeTheirs': 'took remote version',
  'srv.manualEdit': 'edited manually',

  // ---- 操作（ops.ts）----
  'srv.pullUnsupported': 'Pull is not supported for the current repository',
  'srv.updateUnsupported': 'Update is not supported for the current repository',
  'srv.restoredMissing': '{msg}; restored {n} missing file|{msg}; restored {n} missing files',
  'srv.fsDeleted': 'Deleted {n} item from disk|Deleted {n} items from disk',
  'srv.deleteFailed': 'Delete failed: {msg}',
  'srv.binaryNoEdit': 'Binary files cannot be edited as text',
  'srv.fileGone': 'File not found (it may have been deleted or moved)',
  'srv.savedFile': 'Saved {path}',
  'srv.folder': 'folder',
  'srv.file': 'file',
  'srv.nameEmpty': 'The {what} name is empty',
  'srv.nameHasSep': 'The {what} name cannot contain path separators',
  'srv.nameExists': 'A file or folder with the same name already exists: {name}',
  'srv.created': 'Created {what}: {rel}',
  'srv.targetExists': 'Target already exists',
  'srv.fsRenamed': 'Renamed {from} → {to} (on disk; repository unaffected)',
  'srv.renameFailed': 'Rename failed: {msg}',
  'srv.svnIgnorePlanOnly': 'Ignore plans apply only to SVN',

  // ---- 忽略规则（ops.ts）----
  'srv.gitIgnoreWhere.gitignore': 'repo .gitignore',
  'srv.gitIgnoreWhere.global': 'global ignore (~/.gitignore_global)',
  'srv.removeRuleFailed': 'Delete failed',
  'srv.ruleRemovedAt': 'Rule removed: {pattern} ({where})',
  'srv.ruleNotFound': 'Rule not found: {pattern}',
  'srv.ruleRemoved': 'Rule removed: {pattern}',
  'srv.unignoredAppended': 'Unignored: {path} (negation rule appended to {where})',
  'srv.unignoreRuleNotFound': 'No rule ignoring {path} was found (the file is not ignored by any source)',
  'srv.unignoreRuleNotFoundGlobal': 'No rule ignoring {path} was found (it may come from global ignore; please handle it manually)',
  'srv.unignoreFailed': 'Failed to unignore',
  'srv.unignoredSvn': 'Unignored: removed rule "{rule}" from {dir}; files matching it in the same directory become unversioned',
  'srv.ignoreRuleRequired': 'Please enter an ignore rule',
  'srv.unknownIgnoreTarget': 'Unknown ignore destination',
  'srv.globalIgnoreUnconfigured': 'Global ignore is not configured. Click "Add to ignore → Global" to retry (core.excludesFile will be configured automatically)',
  'srv.ignoreAdded': 'Added to ignore: {pattern} ({where})',
  'srv.ignoreRestored': 'Rule already exists; ignoring restored: {pattern} ({where})',

  // ---- 浏览（browse.ts）----
  'srv.readDirFailed': 'Cannot read directory: {msg}',
  'srv.binaryNoDiff': 'Binary file ({path}) cannot be compared as text',
  'srv.notInWcNoDiff': 'This file is not in the current working copy; cannot show the diff: {path}',
  'srv.diffNotExist': '(nonexistent)',
  'srv.diffRevision': '(revision {rev})',
  'srv.headLabel': 'HEAD (original)',
  'srv.baseLabel': 'BASE (original)',
  'srv.worktreeLabel': 'Working copy (current)',
  'srv.truncatedLarge': '… (file too large, truncated)',
  'srv.readFailed': 'Read failed',
  'srv.imageOnly': 'Only image files are supported',
  'srv.imageTooLarge': 'Image too large (over 50MB); cannot preview',

  // ---- 文本写入守卫（util.ts）----
  'srv.refuseReplacementChar': 'Content contains undecodable replacement characters (�) — saving would persist the garbled text. Please revert the file and retry',
  'srv.refuseTooLarge': 'The file exceeds {mb}MB and was not fully read — saving would persist the placeholder text. Please open it with an external program',
  'srv.refuseUnencodable': 'The file is encoded as {enc}, and the content contains characters it cannot represent ({msg}) — write rejected',

  // ---- 终端（terminal.ts）----
  'srv.emptyCommand': 'Command is empty',
  'srv.invalidCwd': 'Invalid working directory (does not exist or is outside the repository)',

  // ---- 上传 / 复制（upload.ts）----
  'srv.uploadSkipped': 'Skipped (a file with the same name already exists)',
  'srv.copySkipped': 'Skipped (same name already exists)',
  'srv.writeFailed': 'Write failed: {msg}',
  'srv.uploaded': 'Uploaded',
  'srv.srcInvalid': 'Source path is invalid or does not exist',
  'srv.srcDstConflict': 'Source and destination locations conflict',
  'srv.copyFailed': 'Copy failed: {msg}',
  'srv.copied': 'Copied',

  // ---- 宿主 / 环境（host.ts）----
  'srv.appImageOnly': 'Only supported when running as AppImage; from source, use scripts/install-appimage.sh',
  'srv.unknownError': 'Unknown error',
  'srv.noRemote': 'No remote configured',
  'srv.netAuthFailToken': 'Reachable (authentication failed; check the token)',
  'srv.netAuthFailAccount': 'Reachable (authentication failed; check your account)',
  'srv.connectFailed': 'Connection failed',
  'srv.noRepoUrl': 'Repository URL not configured',

  // ---- 模块索引（module-index.ts）----
  'srv.noRepoOpen': 'No repository is open',
  'srv.parseFailedFull': 'Parse failed: the md file does not exist or is not in the repository, or no "path ← description" entries were found',
  'srv.parseFailed': 'Parse failed: the md file does not exist or is not in the repository',
  'srv.scopeDirInvalid': 'Invalid scope directory',
  'srv.scopeDirOutOfBounds': 'Scope directory is out of bounds',

  // ---- 最近项目 / 打开（recent.ts）----
  'srv.notWc': '{dir} is not an SVN/Git working copy',

  // ---- 分块暂存 / 工作副本（stage.ts / wc.ts）----
  'srv.missingPathParam': 'Missing path parameter',
  'srv.repoTypeUnsupported': 'Not supported for the current repository type',
};
