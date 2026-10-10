/** 英文语言包 · 终端域（client/terminal）。
 *  key 前缀 `term.`；规范见 docs/i18n-搬运规范.md。
 *
 *  ⚠️ Real commands and command output are **not** translated — the commands themselves,
 *  the `git --no-pager` / `svn --non-interactive` prefixes and example commands like `svn info`.
 */
export const term = {
  // ---- Title / footer toolbar ----
  'term.title': 'Terminal',
  'term.backToRoot': 'Back to root',
  'term.backToRootTitle': 'Switch the working directory back to the repository root (existing records are kept; only later commands are affected)',
  'term.footHint': 'git / svn only · Enter to run · ↑↓ history · Ctrl+C to interrupt',
  'term.clear': 'Clear',
  'term.clearTitle': 'Clear the execution records above (this session only)',
  'term.run': 'Run',
  'term.preview': 'Will run: ',
  'term.repoRoot': 'repo root',
  'term.repoFallback': 'repo',

  // ---- Empty state ----
  'term.emptyIntro': 'Type a {bin} command to run, for example:',
  'term.emptyGuard': 'Pipes / redirection / chaining are not supported; use a system terminal for interactive commands (e.g. git rebase -i).',
  'term.ex.svnInfo': 'Show working copy info',
  'term.ex.svnLog': 'Show the last 10 commits',
  'term.ex.status': 'Show working copy status',
  'term.ex.gitLog': 'Show recent commits',
  'term.ex.gitRenameCmd': 'git branch -m old-name new-name',
  'term.ex.gitRename': 'Rename a branch',

  // ---- Run status / receipt ----
  'term.running': '…running (Ctrl+C to interrupt)',
  'term.doneNoOutput': '✓ Done (no output)',
  'term.noOutput': '■ Command produced no output',
  'term.noteAborted': 'Interrupted',
  'term.noteTimeout': 'Exceeded 30 seconds; terminated',
  'term.outputTruncated': '… (output too long; only the first {n} characters kept)',

  // ---- Dangerous command confirm ----
  'term.danger.reason': 'This is a dangerous operation',
  'term.danger.title': '⚠ Dangerous command',
  'term.danger.confirm': 'Run anyway',
  'term.danger.changed': 'You have {n} uncommitted file.|You have {n} uncommitted files.',
  'term.danger.clean': 'The working copy has no uncommitted changes.',
};
