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
  'hist.noChanged': 'No file changes',
  'hist.viewFullDiff': 'View full diff of this commit',

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
  'hist.restoreMsgC': ': it overwrites the working copy (the result is a local modification you can commit again). Continue?',

  // ---- 差异视图工具栏（差异块导航 / 同步滚动）----
  'hist.blockCounter': 'Change {i}/{n}',
  'hist.prevBlock': 'Previous ↑',
  'hist.nextBlock': 'Next ↓',
  'hist.syncScroll': '↔ Sync Scroll',
  'hist.syncTip': 'When on, scrolling one pane makes the other follow (in preview mode it follows proportionally, without line alignment)',
  'hist.arrowKeyBack': '← to go back',

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
