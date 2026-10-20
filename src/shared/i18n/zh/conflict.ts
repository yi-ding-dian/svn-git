/** 中文语言包 · 冲突域（client/conflicts）：三方冲突解决器 / 远程冲突对比。
 *  key 前缀 `conflict.`；规范见 docs/i18n-搬运规范.md。
 *
 *  ⚠️ 拆段长句的段值**首尾空格是有意的**（如 titleA/titleB、bin.lead/types）：
 *  与 <b>/<span> 相邻 JSX 元素拼接后还原原文排版，别顺手 trim。
 */
export const conflict = {
  // ---- 解决器弹窗骨架（标题 / 加载 / 空态）----
  'conflict.title': '⚠ 解决冲突（{n}）',
  'conflict.loading': '加载中…',
  'conflict.none': '暂无冲突',

  // ---- 基础版本折叠（三栏之外的历史版本查看）----
  'conflict.tab.base': '基础版本',

  // ---- 二进制文件（不读内容不对比，只能整份采用一侧；两句含 <b> 拆段）----
  'conflict.bin.lead': '该文件为 ',
  'conflict.bin.kind': '二进制文件',
  'conflict.bin.types': '（Word 文档 / PDF / 图片等），',
  'conflict.bin.noTextDiff': '不支持文本对比',
  'conflict.bin.hint': '请用「采用本地 / 采用对方」直接选择一个版本保留，或在外部程序中打开文件手动处理',

  // ---- 三栏合并编辑器：工具条 / 块级选择 / 行内编辑 ----
  'conflict.merge.tagTheirs': '对方',
  'conflict.merge.tagResult': '结果（可编辑）',
  'conflict.merge.tagOurs': '本地',
  'conflict.merge.progress': '已选 {done}/{total} 处',
  'conflict.merge.noMarkers': '文件里没有冲突标记，可直接编辑结果',
  'conflict.merge.allTheirs': '全部采用对方',
  'conflict.merge.allOurs': '全部采用本地',
  'conflict.merge.prevTip': '上一处冲突',
  'conflict.merge.nextTip': '下一处冲突',
  'conflict.merge.takeTheirs': '采用对方',
  'conflict.merge.takeOurs': '采用本地',
  'conflict.merge.both': '两边都要',
  'conflict.merge.blockN': '第 {n} 处',
  'conflict.merge.editHint': '双击结果栏的行可编辑',
  'conflict.merge.edit': '✎ 编辑',
  'conflict.merge.editTip': '手动编辑合并结果（整段文本）',
  'conflict.merge.editDone': '✓ 完成',
  'conflict.merge.editCancel': '✕ 取消',
  'conflict.merge.editing': '手动编辑中：改完点「完成」；文本里还有冲突标记时不能保存',
  'conflict.merge.resizeTip': '拖动调整栏宽（双击恢复均分）',
  'conflict.merge.unresolved': '还有 {n} 处冲突未选择，先选完再保存',
  // 一侧/两侧没有该文件（删除/新增冲突）
  'conflict.merge.oursMissing': '本地没有这个文件（一侧删除/未添加的冲突）：选「采用本地」就是删除它',
  'conflict.merge.theirsMissing': '对方没有这个文件（一侧删除/未添加的冲突）：选「采用对方」就是删除它',
  'conflict.merge.bothMissing': '双方都没有这个文件：采用任一边都会删除它',
  'conflict.merge.sideEmpty': '（这一侧没有此文件）',

  // ---- 放大 / 还原尺寸（不是撤回改动的「还原」）----
  'conflict.vs.expand': '⛶ 放大',
  'conflict.vs.restore': '⛶ 还原',
  'conflict.enc.warnA': '⚠ 该文件不是 UTF-8（工具按 {enc} 猜测解码）：',
  'conflict.enc.warnB': '若它其实是日文/繁体等其他编码，保存会把原编码改坏。',
  'conflict.enc.warnC': '拿不准就用「采用本地 / 采用对方」，或先用外部程序改好再回来。',

  // ---- 操作按钮（title 里另有 cmdOfRepo 的命令预览，是真实命令不入包）----
  'conflict.takeOurs': '采用本地',
  'conflict.takeTheirs': '采用对方',
  'conflict.saveManual': '💾 保存并标记已解决',
  'conflict.abort': '↩ 中止合并',
  'conflict.abortTip': '放弃本次合并（git merge --abort）：丢弃合并以来所有改动，工作区回到合并前。分支本身不受影响，可稍后再合并。',
  'conflict.reveal': '打开文件夹',
  'conflict.revealTip': '打开冲突文件所在文件夹',

  // ---- 操作结果（msg 区）----
  'conflict.allResolved': '🎉 所有冲突已解决',
  'conflict.abortFailed': '中止合并失败',

  // ---- 解决方式二次确认（三分支：本地 / 对方 / 手动编辑）----
  'conflict.confirm.title': '⚠ 确认解决冲突',
  'conflict.confirm.ours': '将用【你的版本】覆盖冲突文件，对方的修改会丢失。确认采用本地？',
  'conflict.confirm.theirs': '将用【对方的版本】覆盖冲突文件，你的修改会丢失。确认采用对方？',
  'conflict.confirm.manual': '将用你编辑的内容覆盖冲突文件。确认保存？',
  'conflict.confirm.oursDelete': '本地没有这个文件（删除/新增冲突）。采用本地将从工作区删除该文件并标记为已解决，确认？',
  'conflict.confirm.theirsDelete': '对方没有这个文件（删除/新增冲突）。采用对方将从工作区删除该文件并标记为已解决，确认？',

  // ---- 中止合并二次确认（仅 git）----
  'conflict.abortConfirm.title': '⚠ 确认中止合并',
  'conflict.abortConfirm.msg': '将丢弃本次合并以来的所有改动（含已自动合并的文件），工作区回到合并前状态；分支本身不受影响，可稍后再合并。确认中止？',
  'conflict.abortConfirm.btn': '中止合并',

  // ---- 远程冲突对比（remote-conflicts）----
  // 标题拆两段：中间夹 <span> 高亮的文件数；titleB 按 n 选单复数，段值首尾空格有意
  'conflict.remote.titleA': '⚠ 这 ',
  'conflict.remote.titleB': ' 个文件你和对方改了同一处，更新时会冲突',
  'conflict.remote.linesTip': '双方都改到的行：{lines}',
  'conflict.remote.count': '{n} 处',
  'conflict.remote.loading': '加载对比…',
  // 双 diff 标题拆两段：中间夹 <b> 高亮的路径，段值尾/首空格有意
  'conflict.remote.theirsLead': '🔴 ',
  'conflict.remote.theirsNote': ' — 对方的改动（远程新版本 vs 你的基准，更新后这些会进来）：',
  'conflict.remote.theirsEmpty': '（对方未改动此文件）',
  'conflict.remote.oursLead': '🟢 ',
  'conflict.remote.oursNote': ' — 你的改动（工作区 vs 你的基准）：',
  'conflict.remote.oursEmpty': '（你未改动此文件）',
  // 提示行拆三段：中间夹 <b>冲突状态</b>；tipA 含 {n}（处数），句号后空格有意
  'conflict.remote.tipA': '💡 标黄的就是你和对方都改到的行（共 {n} 处）。 先点「去更新」拉取对方改动 —— 这几个文件会变成',
  'conflict.remote.tipBold': '冲突状态',
  'conflict.remote.tipB': '，再到「解决冲突」里逐处处理。',
} as const;
