/** English pack · code stats domain (client/stats): dialog + md export.
 *  key prefix `stats.`; see docs/i18n-搬运规范.md.
 */
export const stats = {
  // ---- entry (⋯ menu) ----
  'stats.title': 'Code statistics',
  'stats.tool.label': 'Code statistics',
  'stats.tool.title': 'Count lines of code by folder and export an md report',

  // ---- dialog: scope ----
  'stats.section.dirs': 'Folders',
  'stats.wholeProject': 'Whole project (incl. root files)',
  'stats.wholeProjectTip': 'Count every file in the repository (including files at the repo root); node_modules and hidden folders are skipped',
  'stats.needDirs': 'Tick folders to count first (or pick “whole project”)',
  'stats.expandDirs': 'Expand folders',
  'stats.collapseDirs': 'Collapse folders',
  'stats.hint': 'Tick the folders to count (all top-level folders are ticked by default); expand to pick subfolders. Text files only — binary, empty and oversized files are skipped.',
  'stats.defaultAll': 'All top-level folders ticked by default; expand to refine',
  'stats.selectAll': 'Select all',
  'stats.unselectAll': 'Select none',
  'stats.selectAllTip': 'Tick all top-level folders (clears deeper unticks)',
  'stats.unselectAllTip': 'Clear selection',
  'stats.scope.label': 'File scope',
  'stats.scope.codeOnly': 'Code files only',
  'stats.scope.allFiles': 'All text files',

  // ---- scan state ----
  'stats.start': 'Count',
  'stats.restart': 'Recount',
  'stats.cancel': 'Cancel',
  'stats.scanning': 'Processed {done} / {total} files…',
  'stats.collecting': 'Collecting files…',
  'stats.cancelled': 'Counting cancelled',

  // ---- result ----
  'stats.result.wait': 'Tick folders, then click “Count”',
  'stats.result.unit': 'lines · {files} files · {sec}s',
  'stats.result.skipped': 'skipped {n}',
  'stats.result.skippedTitle': 'empty {empty} · binary {binary} · oversized {large} · unreadable {error}',
  'stats.result.truncated': 'Timed out — partial result only',
  'stats.result.capped': 'Too many files: only the first {n} were counted',
  'stats.result.empty': 'No countable files',

  // ---- export ----
  'stats.export.label': 'File name',
  'stats.export.defaultName': 'code-statistics.md',
  'stats.export.button': 'Export md',
  'stats.export.saved': 'Exported: {path}',
  'stats.export.failed': 'Export failed: {msg}',
  'stats.export.noResult': 'Count first, then export',

  // ---- md body ----
  'stats.md.heading': '## Directory tree and line counts',
  'stats.md.meta': '(scope: {dirs} · {scope} · {time})',
  'stats.md.allProject': 'whole project',
  'stats.md.listSep': ', ',
  'stats.md.dirNote': '{lines} lines · {files} files',
  'stats.md.fileNote': '{lines} lines',
  'stats.md.total': 'Total: {lines} lines ({files} files)',
  'stats.md.skipped': 'Skipped {n} files (empty / binary / oversized / unreadable)',
  'stats.md.truncated': 'Note: timed out — counts above are partial',
};
