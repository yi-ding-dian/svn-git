/** 中文语言包 · 终端域（client/terminal）。
 *  key 前缀 `term.`；规范见 docs/i18n-搬运规范.md。
 *
 *  ⚠️ **真实执行的命令与命令输出不翻** —— 命令本身、`git --no-pager` / `svn --non-interactive`
 *  前缀、`svn info` 这类示例命令都是给程序跑的，不是界面文案。这里只收标题、提示、空态说明。
 */
export const term = {
  // ---- 标题 / 底部工具栏 ----
  'term.title': '终端',
  'term.backToRoot': '回根目录',
  'term.backToRootTitle': '把执行目录切回仓库根（已经跑过的记录保留，只影响后面的命令）',
  'term.footHint': '只支持 git / svn · Enter 执行 · ↑↓ 历史 · Ctrl+C 中断',
  'term.clear': '清空记录',
  'term.clearTitle': '清掉上面这些执行记录（本次会话内的）',
  // 输入行的「执行」按钮；「关闭」按钮复用 common.close
  'term.run': '执行',
  // 命令预览条前缀，后面直接拼真实命令（`将执行：git --no-pager status`）
  'term.preview': '将执行：',
  // 目录显示：拿不到仓库顶级路径时标题旁显示的兜底（term.repoFallback 同理，是记录前缀的兜底）
  'term.repoRoot': '仓库根',
  'term.repoFallback': '仓库',

  // ---- 空态说明（本次会话还没跑过命令时）----
  'term.emptyIntro': '输入要执行的 {bin} 命令，例如：',
  'term.emptyGuard': '不支持管道 / 重定向 / 串联；需要交互的命令（如 git rebase -i）请用系统终端。',
  // 空态示例列表：左列命令（原样显示，不翻）、右列说明。「git 重命名分支」那条的命令含中文占位
  // 「旧名 新名」（用户要照着换成自己的分支名），整条按文案处理，故单独成 key
  'term.ex.svnInfo': '看工作副本信息',
  'term.ex.svnLog': '看最近 10 条提交',
  // svn status 与 git status 两行的说明相同，共用一个 key
  'term.ex.status': '看工作区状态',
  'term.ex.gitLog': '看最近提交',
  'term.ex.gitRenameCmd': 'git branch -m 旧名 新名',
  'term.ex.gitRename': '重命名分支',

  // ---- 执行状态 / 回执 ----
  'term.running': '…执行中（Ctrl+C 可中断）',
  'term.doneNoOutput': '✓ 完成（无输出）',
  'term.noOutput': '■ 命令没有输出',
  // 被护栏拒绝（已中断 / 超时）时记在命令下方的补充说明
  'term.noteAborted': '已中断',
  'term.noteTimeout': '超过 30 秒，已终止',
  // 单条输出过长被截断时的收尾提示（{n} = 保留的字符数）
  'term.outputTruncated': '…（输出过长，仅保留前 {n} 字符）',

  // ---- 危险命令确认框 ----
  'term.danger.reason': '这是危险操作',
  'term.danger.title': '⚠ 危险命令',
  'term.danger.confirm': '仍要执行',
  'term.danger.changed': '当前有 {n} 个文件未提交。',
  'term.danger.clean': '当前工作区没有未提交的改动。',
} as const;
