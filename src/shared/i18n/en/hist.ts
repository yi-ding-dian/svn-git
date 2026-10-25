/** 英文语言包 · 历史域（client/history）：提交列表 / 变更文件详情 / 差异视图。
 *  key 前缀 `hist.`；规范见 docs/i18n-搬运规范.md。
 *
 *  术语：提交 = Commit · 更新 = Update · 还原 = Restore · 撤销 = Undo · 暂存区 = staging area。
 *  ⚠️ 与 ops 域的 push-confirm 是同一功能的另一处实现，文案保持同译（Edit Message / Undo Commit /
 *  Action Not Available…），便于统一校对。
 *  ⚠️ 拆段的长句（reset/restore 确认弹窗）段值首尾空格与相邻 <b>/<span> 拼接后还原原文排版，别 trim。
 */
export const hist = {
  // ---- 提交列表（左栏标题栏 + 加载/过滤）----
  // 'History: ' 尾空格有意（后接路径或「全部提交」）
  'hist.title': 'History: ',
  'hist.allCommits': 'All Commits',
  'hist.back': '← Back',
  'hist.loadingLogs': '⏳ Reading commit log…',
  'hist.emptyLogs': 'No commits yet',
  'hist.noMatch': 'No matching commits',
  'hist.filterPlaceholder': '🔍 Filter commits (message/author/revision)…',
  'hist.more': 'More',
  'hist.moreTip': 'Append more commits to the bottom of the list (you can keep browsing while loading)',
  'hist.loadingMore': '⏳ Loading…',
  'hist.allLoaded': 'All loaded',
  'hist.appendTo': 'Append up to {n}',
  'hist.loadAll': 'Load All Commits',
  'hist.loadAllCount': 'Load All Commits ({n} total)',
  'hist.unpushedTip': 'Not pushed: {n} commit ahead of the remote|Not pushed: {n} commits ahead of the remote',
  'hist.dragResizer': 'Drag to resize the panes',

  // ---- 提交详情（右栏）----
  'hist.selectHint': 'Select a commit to view details',
  'hist.clickExpand': 'Click to expand',
  'hist.collapse': 'Collapse ▲',
  'hist.expandLines': 'Expand Full Message ({n} lines) ▼',
  'hist.changedFiles': 'Changed files (click to view diff):',
  'hist.mergeStatTip': 'Merge commit: file count vs first parent (what this merge brought in); click for diffs',
  'hist.noChanged': 'No file changes',
  'hist.viewFullDiff': 'View full diff of this commit',
  // ---- Commit changes modal (file list left, diff right) ----
  'hist.changes.open': 'View file changes',
  'hist.changes.title': 'File Changes',
  'hist.changes.commit': 'Commit',
  'hist.changes.files': 'Changed files ({n})',
  'hist.changes.collapseFiles': 'Collapse file list',
  'hist.changes.expandFiles': 'Expand file list',
  'hist.changes.resizeFiles': 'Drag to resize · drag to the far left to collapse · double-click to toggle',
  'hist.changes.before': 'Before (parent of {rev})',
  'hist.changes.beforeRoot': 'Before (empty file)',
  'hist.changes.after': 'After ({rev})',
  'hist.changes.pickFile': 'Select a file on the left to view its diff',

  // ---- 差异查看（详情面板内嵌 / 差异视图共用的标题与提示）----
  'hist.diffOf': 'Diff: {rev}',
  'hist.diffOfPath': 'Diff: {rev} — {path}',
  'hist.workingTreeDiff': 'Working tree diff',
  'hist.loadingDiff': '⏳ Computing diff…',
  'hist.noDiff': '(no differences)',
  'hist.binaryNoDiff': 'This is a binary file (Word document / PDF / image, etc.); text comparison is not supported',
  'hist.readFailed': 'Read failed: {msg}',
  'hist.diffFailed': 'Diff failed',

  // ---- 提交行 / 变更文件右键菜单（仅未推送提交可操作）----
  'hist.restoreThis': 'Restore This Version',
  'hist.restoreItemTip': 'Restore {path} to the version of commit {rev} (overwrites the working copy; the result appears as a local modification)',
  'hist.restoreDirItemTip': 'Restore the whole directory {path} to the version of commit {rev} (all files inside; overwrites the working copy)',
  'hist.amend': 'Edit Message',
  'hist.viewFileDiff': 'View Diff for This File',
  'hist.reset': 'Undo Commit',
  'hist.resetTip': 'Undo this commit and keep the changes in the working copy (you can re-select and commit them); only unpushed commits can be undone',
  'hist.resetBlocked':
    'Only the most recent commit can be undone. There is {n} newer commit ahead of this one — undo it first.|Only the most recent commit can be undone. There are {n} newer commits ahead of this one — undo them first.',
  'hist.resetBlockedHead': 'Only the most recent commit (HEAD) can be undone. There are newer commits after this one; undo them first, one by one.',
  'hist.restoreFailed': 'Restore failed: {msg}',
  'hist.cantOperate': '⚠ Action Not Available',

  // ---- 修改提交注释弹窗 ----
  'hist.amendTitle': '✏️ Edit Commit Message',
  'hist.amendMeta': 'Commit {rev} · {date} · {author}',
  'hist.mdHint': 'Markdown supported: **bold**, - lists, `code`…',
  'hist.mdPreview': 'Rendered (same as shown in History)',
  'hist.amendInputTip': 'Full commit message (first line is the title, body after a blank line); edit it directly',
  'hist.confirmAmend': 'Save',

  // ---- 撤销提交二次确认（含 JSX：分段与 <b>暂存区</b>）----
  'hist.resetTitle': '↩ Undo the Most Recent Commit',
  'hist.resetMsgA': 'You are about to undo the most recent commit ',
  'hist.resetMsgB': '. Its changes return to the ',
  'hist.resetMsgStaging': 'staging area',
  'hist.resetMsgC': ' (content changed after that commit is unaffected); you can re-select files and commit again. Undo it?',
  'hist.resetBtn': 'Undo',

  // ---- 还原到指定版本二次确认（含 JSX：分段与 <b>路径</b>）----
  'hist.restoreTitle': '↩ Restore to Version',
  'hist.restoreMsgA': 'Restore ',
  'hist.restoreMsgB': ' to the version of commit ',
  'hist.restoreMsgC': ': it overwrites the working copy.',
  'hist.restoreOtherFiles': 'The other {n} file(s) in this list are unaffected.',
  'hist.restoreLaterOverwritten':
    'Any later changes to this content are overwritten too; review the working-tree diff before committing.',
  'hist.restoreDirNote': 'This is a directory: everything under it is reverse-merged and may conflict; unversioned files are left alone.',
  'hist.restoreMsgTail': 'The result is a local modification you can commit again.',
  'hist.restoreDeletedTip': 'This commit deletes the file, so that version has no content to restore',
  'hist.restoring': 'Restoring…',
  'hist.previewLoading': '⏳ Checking the difference from the working copy…',
  'hist.previewChecking': 'Checking…',
  'hist.noRestoreNeededTitle': 'Nothing to Restore',
  'hist.noRestoreNeeded': 'The working copy of {path} already matches the version of commit {rev}; there is nothing to restore.',
  'hist.previewDiffLines':
    'Compared with the working copy: {n} line changes (+{added} / −{removed})|Compared with the working copy: {n} lines change (+{added} / −{removed})',
  'hist.previewPropOnly': 'Compared with the working copy: no line differences (properties may differ).',
  'hist.previewBinary': 'Binary files cannot be compared line by line; the target version will overwrite the current file.',
  'hist.previewMissing':
    'The file is currently missing from the working copy; restoring will bring it back (re-adding its parent directories to the repository if needed).',
  'hist.previewDir': '{n} file will change compared with the working copy (modified {m}, restored {r}, deleted {d})|{n} files will change compared with the working copy (modified {m}, restored {r}, deleted {d})',
  'hist.previewFailed': 'Could not check the difference from the working copy ({msg}); you can still restore.',
  'hist.viewRestoreDiff': 'View Full Diff',

  // ---- 差异视图工具栏（差异块导航 / 同步滚动）----
  'hist.blockCounter': 'Change {i}/{n}',
  'hist.prevBlock': 'Previous ↑',
  'hist.nextBlock': 'Next ↓',
  'hist.syncScroll': '↔ Sync Scroll',
  'hist.syncTip': 'When on, scrolling one pane makes the other follow (in preview mode it follows proportionally, without line alignment)',
  // Show all (left pane expands from diff fragments to the full file; Sync Scroll only appears then)
  'hist.showAll': 'Show All',
  'hist.showAllTip': 'Expand the left pane to the full file (unchanged lines shown flat; diff lines still marked)',
  // Large block folding: blocks over the threshold show the first 10 lines plus one summary row in the right pane; click to expand
  'hist.rowsFolded': '+{n} more line(s) (click to expand)',
  'hist.foldTail': '− Collapse',
  'hist.foldExpandTip': 'Expand the full contents of this block',
  'hist.foldCollapseTip': 'Collapse this block',
  // Collapse search (drag the edge narrow past the threshold and release; shown while dragging)
  'hist.releaseToCollapse': 'Release to collapse the search box',
  // Edit in place (edit the working-tree file right in the right pane; jumps to the current change)
  'hist.editInPlaceTip': 'Edit the file in place (jumps to the current change; re-compares automatically after saving)',
  'hist.arrowKeyBack': '← to go back',

  // ---- Per-block restore (arrow next to a diff block: revert this block in the working tree) ----
  'hist.restoreBlockTip': 'Restore this block (revert this part of the working tree to the original)',
  'hist.restoreDisabledDeleted': 'The file has been deleted; use "Restore Missing File" from the file list',
  'hist.restoreDisabledBinary': 'Binary files do not support block restore',
  'hist.restoreDisabledTooLarge': 'File is too large for block restore',
  'hist.restoreBlockTitle': 'Restore Block',
  'hist.restoreBlockMsgAdd': 'The {n} added line(s) in the working tree will be removed. Other changes are unaffected. Restore?',
  'hist.restoreBlockMsgDel': 'The {n} line(s) deleted from the original will be written back to the working tree. Other changes are unaffected. Restore?',
  'hist.restoreBlockMsgMod': 'The {a} line(s) in the working tree will be replaced with the original {d} line(s). Other changes are unaffected. Restore?',
  'hist.restoreBlockConfirm': 'Restore',
  'hist.restoreDone': 'Block restored',
  'hist.restoreStale': 'The file changed externally; reload the comparison before restoring',

  // ---- 文件外部更新提示（stale）----
  'hist.fileChanged': '⚠ The file has changed. Reload it?',
  'hist.reloadFile': 'Reload File',
  'hist.dismiss': 'Dismiss',
  'hist.loadingCompare': '⏳ Loading comparison…',

  // ---- 行右键复制（label 用于菜单项，copied* 用于复制成功 toast）----
  'hist.copySelection': 'Copy Selection',
  'hist.copiedSelection': 'Selection copied',
  'hist.copyRow': 'Copy This Line',
  'hist.copiedRow': 'Line copied',
  'hist.copyAll': 'Copy all {side} text',
  'hist.copiedAll': 'All {side} text copied',
  'hist.sideLeft': 'left pane',
  'hist.sideRight': 'right pane',
  'hist.copyFailed': 'Copy failed',

  // ---- 栏内搜索 ----
  'hist.searchLeftPlaceholder': 'Search in the left pane…',
  'hist.searchRightPlaceholder': 'Search in the right pane…',
  'hist.searchPane': '🔍 Search This Pane',
  'hist.noMatchText': 'No match',

  // ---- Markdown 预览开关（md 文件双栏可各自预览）----
  'hist.backToDiff': 'Back to the diff view',
  'hist.backToCompare': 'Back to Diff',
  'hist.mdPreviewLeft': 'Markdown preview (original)',
  'hist.mdPreviewRight': 'Markdown preview (current)',

  // ---- 并排行标记与占位行 ----
  'hist.leftEmpty': '(original is empty — file added)',
  'hist.rightEmpty': '(current is empty — file deleted)',
  'hist.changeLeft': 'Modified (click to locate on the left)',
  'hist.changeRight': 'Modified (click to locate on the right)',
  'hist.phRight': 'An addition here in the right pane (click to locate on the right)',
  'hist.delPhRightTip':
    '{n} line deleted here in the left pane (click to locate)|{n} lines deleted here in the left pane (click to locate)',
  'hist.delPhRightHint': '← {n} line deleted here in the left pane|← {n} lines deleted here in the left pane',

  // ---- 滚动条预览标记 ----
  'hist.markerTip': 'Change positions (click to jump)',
  'hist.markerAdd': 'Added/Modified',
};
