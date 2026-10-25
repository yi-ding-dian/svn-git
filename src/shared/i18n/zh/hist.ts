/** 中文语言包 · 历史域（client/history）：提交列表 / 变更文件详情 / 差异视图。
 *  key 前缀 `hist.`；规范见 docs/i18n-搬运规范.md。
 *
 *  ⚠️ 拆段的长句（reset/restore 的确认弹窗）段值首尾的空格与空串是有意的：
 *  与 <b>/<span> 相邻 JSX 元素拼接后还原原文排版，别顺手 trim。
 *  ⚠️ 命令预览（`cmdOfRepo` 产出，如 `git commit --amend`）是真实命令，未入包。
 */
export const hist = {
  // ---- 提交列表（左栏标题栏 + 加载/过滤）----
  // '历史: ' 尾空格有意（后接路径或「全部提交」）
  'hist.title': '历史: ',
  'hist.allCommits': '全部提交',
  'hist.back': '← 返回',
  'hist.loadingLogs': '⏳ 读取提交记录…',
  'hist.emptyLogs': '暂无提交记录',
  'hist.noMatch': '没有匹配的提交',
  'hist.filterPlaceholder': '🔍 过滤提交（消息/作者/版本号）…',
  'hist.more': '更多',
  'hist.moreTip': '追加更多提交到列表底部（加载期间可继续浏览）',
  'hist.loadingMore': '⏳ 加载中…',
  'hist.allLoaded': '已全部加载',
  'hist.appendTo': '追加到 {n} 条',
  'hist.loadAll': '加载全部提交',
  'hist.loadAllCount': '加载全部提交（共 {n} 条）',
  'hist.unpushedTip': '未推送：本地领先远程 {n} 个提交',
  'hist.dragResizer': '拖动调整左右栏宽度',

  // ---- 提交详情（右栏）----
  'hist.selectHint': '选择提交查看详情',
  'hist.clickExpand': '点击展开全文',
  'hist.collapse': '收起 ▲',
  'hist.expandLines': '展开全文（共 {n} 行）▼',
  'hist.changedFiles': '变更文件（点击查看 diff）：',
  'hist.mergeStatTip': '合并提交：显示相对第一父（本次合入当前分支）的文件数，点开可看差异',
  'hist.noChanged': '无文件变更',
  'hist.viewFullDiff': '查看本次提交完整 diff',
  // ---- 文件变动详情弹窗（左侧文件列表 + 右侧差异）----
  'hist.changes.open': '查看文件变动详情',
  'hist.changes.title': '文件变动详情',
  'hist.changes.commit': '提交',
  'hist.changes.files': '变更文件（{n}）',
  'hist.changes.collapseFiles': '收起文件列表',
  'hist.changes.expandFiles': '展开文件列表',
  'hist.changes.resizeFiles': '拖动调整宽度 · 拖到最左侧自动收起 · 双击收起/展开',
  'hist.changes.before': '修改前（{rev} 的上一提交）',
  'hist.changes.beforeRoot': '修改前（空文件）',
  'hist.changes.after': '修改后（{rev}）',
  'hist.changes.pickFile': '点击左侧文件查看差异',

  // ---- 差异查看（详情面板内嵌 / 差异视图共用的标题与提示）----
  'hist.diffOf': '差异: {rev}',
  'hist.diffOfPath': '差异: {rev} — {path}',
  'hist.workingTreeDiff': '工作区差异',
  'hist.loadingDiff': '⏳ 计算差异…',
  'hist.noDiff': '(无差异)',
  'hist.binaryNoDiff': '该文件为二进制文件（Word 文档 / PDF / 图片等），不支持文本对比',
  'hist.readFailed': '读取失败: {msg}',
  'hist.diffFailed': 'diff 失败',

  // ---- 提交行 / 变更文件右键菜单（仅未推送提交可操作）----
  'hist.restoreThis': '还原此版本',
  'hist.restoreItemTip': '还原 {path} 到提交 {rev} 的版本内容（覆盖当前工作区，还原后为一次本地修改）',
  'hist.restoreDirItemTip': '还原 {path} 整个目录到提交 {rev} 的版本内容（含其中所有文件，覆盖当前工作区）',
  'hist.amend': '修改注释',
  'hist.viewFileDiff': '查看此文件差异',
  'hist.reset': '撤销提交',
  'hist.resetTip': '撤销这次提交，改动保留在工作区（可重新勾选提交）；仅未推送的提交可撤销',
  'hist.resetBlocked': '仅支持撤销最近一次提交。此项之前还有 {n} 个更新提交，需先逐一撤销前面的提交后，此项才可操作',
  'hist.resetBlockedHead': '仅支持撤销最近一次提交（HEAD）。这次提交之前还有更新的提交，需先逐一撤销它们。',
  'hist.restoreFailed': '还原失败: {msg}',
  'hist.cantOperate': '⚠ 无法操作此项',

  // ---- 修改提交注释弹窗 ----
  'hist.amendTitle': '✏️ 修改提交注释',
  'hist.amendMeta': '提交 {rev} · {date} · {author}',
  'hist.mdHint': '支持 Markdown：**加粗**、- 列表、`代码`…',
  'hist.mdPreview': '渲染效果（与历史里显示的一致）',
  'hist.amendInputTip': '完整提交说明（第一行为标题，空行后为正文），可直接编辑',
  'hist.confirmAmend': '确认修改',

  // ---- 撤销提交二次确认（含 JSX：分段与 <b>暂存区</b>）----
  'hist.resetTitle': '↩ 撤销最近一次提交',
  'hist.resetMsgA': '将撤销最近一次提交 ',
  'hist.resetMsgB': '。这次提交的改动会回到',
  'hist.resetMsgStaging': '暂存区',
  'hist.resetMsgC': '（提交之后新改的内容不受影响），可以重新勾选文件再次提交。确认撤销?',
  'hist.resetBtn': '撤销',

  // ---- 还原到指定版本二次确认（含 JSX：分段与 <b>路径</b>）----
  'hist.restoreTitle': '↩ 还原到指定版本',
  'hist.restoreMsgA': '将把 ',
  'hist.restoreMsgB': ' 还原到提交 ',
  'hist.restoreMsgC': ' 的版本内容：覆盖当前工作区。',
  // 多文件提交里只还原其中一个文件时，说明列表里其余文件不受影响（历史可能按目录过滤，不说"整个提交"）
  'hist.restoreOtherFiles': '列表里的另外 {n} 个文件不受影响。',
  // 之后的提交若也改过这些内容，会在工作区里被一并覆盖（只是本地修改，提交前能核对）
  'hist.restoreLaterOverwritten': '之后对这些内容的改动也会被覆盖；提交前可在工作区差异里核对。',
  // 目录还原：反向合并会带上删除/新增，可能冲突；未跟踪文件不受影响
  'hist.restoreDirNote': '这是一个目录：会反向合并它下面的所有内容，可能产生冲突；未跟踪文件不动。',
  'hist.restoreMsgTail': '还原后为一次本地修改，可再次提交。',
  // 该提交里此文件是删除操作 → 那个版本里没有内容可还原
  'hist.restoreDeletedTip': '这次提交里该文件是删除操作，那个版本没有内容可以还原',
  'hist.restoring': '还原中…',
  // ---- 还原前预检（目标版本 vs 当前工作区，只读）----
  'hist.previewLoading': '⏳ 正在检查与当前工作区的差异…',
  'hist.previewChecking': '检查中…',
  'hist.noRestoreNeededTitle': '无需还原',
  'hist.noRestoreNeeded': '当前工作区的 {path} 已经与提交 {rev} 的版本完全一致，没有需要还原的改动。',
  'hist.previewDiffLines': '与当前工作区相比：改动 {n} 行（+{added} / −{removed}）',
  'hist.previewPropOnly': '与当前工作区相比：内容没有行差异（可能有属性变化）。',
  'hist.previewBinary': '二进制文件无法逐行比较，将直接用该版本内容覆盖。',
  'hist.previewMissing': '文件当前在工作区里缺失，还原会把它找回来（必要时连同所在目录一起重新纳入版本库）。',
  'hist.previewDir': '与当前工作区相比：将改动 {n} 个文件（修改 {m}、恢复 {r}、删除 {d}）',
  'hist.previewFailed': '无法检测与当前工作区的差异（{msg}），仍可继续还原。',
  'hist.viewRestoreDiff': '查看完整差异',

  // ---- 差异视图工具栏（差异块导航 / 同步滚动）----
  'hist.blockCounter': '差异点 {i}/{n}',
  'hist.prevBlock': '上一个 ↑',
  'hist.nextBlock': '下一个 ↓',
  'hist.syncScroll': '↔ 同步滚动',
  'hist.syncTip': '开启后滚动任一栏，另一栏自动跟随（预览模式下为按比例跟随，无行对齐）',
  // 显示全部（左栏从"仅差异片段"展开为完整文件；同步滚动按钮只在展开后出现）
  'hist.showAll': '显示全部',
  'hist.showAllTip': '左栏展开为完整文件内容（未改动行平铺显示，差异行照旧标记）',
  // 大块折叠：超过阈值的差异块只显示前 10 行 + 右栏一行汇总，点击展开（左栏只留对齐占位）
  'hist.rowsFolded': '+{n} 行（点击展开）',
  'hist.foldTail': '− 收起',
  'hist.foldExpandTip': '展开这个差异块的全部内容',
  'hist.foldCollapseTip': '收起这个差异块',
  // 收起搜索（往左拖窄过阈值松手即收起；拖动中显示此提示）
  'hist.releaseToCollapse': '松开鼠标将收起搜索框',
  // 就地编辑（右栏直接改工作区文件；定位到当前差异处、保存后重新对比）
  'hist.editInPlaceTip': '就地编辑当前文件（定位到当前差异处；保存后自动重新对比）',
  'hist.arrowKeyBack': '← 键返回',

  // ---- 块级还原（左栏差异块旁的箭头：把工作区这一块改回原版）----
  'hist.restoreBlockTip': '还原此块（工作区这部分改回原版）',
  'hist.restoreDisabledDeleted': '文件已被删除，请在文件列表右键「还原缺失文件」',
  'hist.restoreDisabledBinary': '二进制文件不支持块级还原',
  'hist.restoreDisabledTooLarge': '文件过大，不支持块级还原',
  'hist.restoreBlockTitle': '还原差异块',
  'hist.restoreBlockMsgAdd': '工作区这 {n} 行新增将被删除，其他修改不受影响。确定还原吗？',
  'hist.restoreBlockMsgDel': '原版删除的 {n} 行将写回工作区，其他修改不受影响。确定还原吗？',
  'hist.restoreBlockMsgMod': '工作区这 {a} 行将替换为原版的 {d} 行，其他修改不受影响。确定还原吗？',
  'hist.restoreBlockConfirm': '还原',
  'hist.restoreDone': '已还原此块',
  'hist.restoreStale': '文件已被外部修改，请先更新对比再还原',

  // ---- 文件外部更新提示（stale）----
  'hist.fileChanged': '⚠ 文件已更新，是否更新文件？',
  'hist.reloadFile': '更新文件',
  'hist.dismiss': '忽略',
  'hist.loadingCompare': '⏳ 加载对比…',

  // ---- 行右键复制（label 用于菜单项，copied* 用于复制成功 toast）----
  'hist.copySelection': '复制选中文本',
  'hist.copiedSelection': '选中文本已复制',
  'hist.copyRow': '复制此行',
  'hist.copiedRow': '本行已复制',
  'hist.copyAll': '复制{side}全部文本',
  'hist.copiedAll': '{side}全部文本已复制',
  'hist.sideLeft': '左栏',
  'hist.sideRight': '右栏',
  'hist.copyFailed': '复制失败',

  // ---- 栏内搜索 ----
  'hist.searchLeftPlaceholder': '搜索左栏代码…',
  'hist.searchRightPlaceholder': '搜索右栏代码…',
  'hist.searchPane': '🔍 搜索此栏',
  'hist.noMatchText': '无匹配',

  // ---- Markdown 预览开关（md 文件双栏可各自预览）----
  'hist.backToDiff': '返回差异行视图',
  'hist.backToCompare': '返回对比',
  'hist.mdPreviewLeft': 'Markdown 渲染预览（原版）',
  'hist.mdPreviewRight': 'Markdown 渲染预览（当前）',

  // ---- 并排行标记与占位行 ----
  'hist.leftEmpty': '（原版为空 — 新增文件）',
  'hist.rightEmpty': '（当前为空 — 文件已删除）',
  'hist.changeLeft': '修改处（点击左侧定位）',
  'hist.changeRight': '修改处（点击右侧定位）',
  'hist.phRight': '右栏此处有新增（点击右侧定位）',
  'hist.delPhRightTip': '左栏此处删除了 {n} 行（点击定位）',
  'hist.delPhRightHint': '← 左栏此处删除了 {n} 行',

  // ---- 滚动条预览标记 ----
  'hist.markerTip': '修改位置（点击跳转）',
  'hist.markerAdd': '新增/修改',
} as const;
