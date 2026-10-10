/** English language pack · Conflict domain (client/conflicts): three-way conflict resolver / remote conflict comparison.
 *  Key prefix `conflict.`; see docs/i18n-搬运规范.md.
 *
 *  ⚠️ Leading/trailing spaces in split segments (titleA/titleB, bin.lead/types, …) are intentional:
 *  they line up with the adjacent <b>/<span> JSX elements — do not trim.
 */
export const conflict = {
  // ---- Resolver modal skeleton (title / loading / empty) ----
  'conflict.title': '⚠ Resolve Conflicts ({n})',
  'conflict.loading': 'Loading…',
  'conflict.none': 'No conflicts',

  // ---- Three-pane tabs (base / local / theirs) ----
  'conflict.tab.base': 'Base',
  'conflict.tab.ours': 'Local',
  'conflict.tab.theirs': 'Theirs',

  // ---- Content area (fallbacks for the read-only preview) ----
  'conflict.identical': '(local and theirs are identical)',
  'conflict.noContent': '(no content)',

  // ---- Binary file (no content, no diff — only take one whole side) ----
  'conflict.bin.lead': 'This file is ',
  'conflict.bin.kind': 'a binary file',
  'conflict.bin.types': ' (Word document / PDF / image, etc.), ',
  'conflict.bin.noTextDiff': 'text diff is not supported',
  'conflict.bin.hint': 'Click "Use Local" / "Use Theirs" to keep one version, or open the file in an external program to handle it manually',

  // ---- Side-by-side toolbar / scrollbar conflict markers ----
  'conflict.vs.lead': '🔀 Side-by-side: ',
  'conflict.vs.left': 'left = theirs',
  'conflict.vs.right': 'right = local',
  'conflict.vs.mod': 'M = modified',
  'conflict.vs.expand': '⛶ Expand',
  // "Restore" here means restoring the pane size, not reverting changes
  'conflict.vs.restore': '⛶ Restore',
  'conflict.vs.scrollTip': 'Conflict positions (click to scroll both panes in sync)',
  'conflict.vs.markAdd': 'Their change',
  'conflict.vs.markDel': 'Local deletion',

  // ---- Manual edit + non-UTF-8 encoding warning (warnA has an {enc} placeholder) ----
  'conflict.manual.label': 'Manually edit the merge result (starts as the current merged content):',
  'conflict.enc.warnA': '⚠ This file is not UTF-8 (the tool guessed {enc} for decoding):',
  'conflict.enc.warnB': 'If it is actually in another encoding such as Japanese or Traditional Chinese, saving will corrupt the original encoding.',
  'conflict.enc.warnC': 'If unsure, use "Use Local" / "Use Theirs", or fix the file in an external program first.',

  // ---- Action buttons (titles also show cmdOfRepo command previews — real commands, not in the pack) ----
  'conflict.takeOurs': 'Use Local',
  'conflict.takeTheirs': 'Use Theirs',
  'conflict.saveManual': '💾 Save Edits',
  'conflict.abort': '↩ Abort Merge',
  'conflict.abortTip': 'Discard this merge (git merge --abort): drops all changes since the merge began, returning the working copy to its pre-merge state. Branches themselves are unaffected and can be merged again later.',
  'conflict.reveal': 'Open Folder',
  'conflict.revealTip': 'Open the folder containing the conflicted file',

  // ---- Result messages (msg area) ----
  'conflict.allResolved': '🎉 All conflicts resolved',
  'conflict.abortFailed': 'Failed to abort merge',

  // ---- Confirm resolution (three branches: local / theirs / manual) ----
  'conflict.confirm.title': '⚠ Confirm Resolution',
  'conflict.confirm.ours': 'This will overwrite the conflicted file with your version, losing the other side\'s changes. Use Local?',
  'conflict.confirm.theirs': 'This will overwrite the conflicted file with the other side\'s version, losing your changes. Use Theirs?',
  'conflict.confirm.manual': 'This will overwrite the conflicted file with your edited content. Save?',

  // ---- Confirm abort merge (git only) ----
  'conflict.abortConfirm.title': '⚠ Confirm Abort Merge',
  'conflict.abortConfirm.msg': 'All changes since this merge began (including auto-merged files) will be discarded, and the working copy returns to its pre-merge state. Branches themselves are unaffected and can be merged again later. Abort?',
  'conflict.abortConfirm.btn': 'Abort Merge',

  // ---- Remote conflict comparison (remote-conflicts) ----
  // Title split in two: the file count (a <span> highlight) sits in between; titleB is pluralised by n
  'conflict.remote.titleA': '⚠ You and the other side changed the same spot in ',
  'conflict.remote.titleB': ' file; updating will conflict| files; updating will conflict',
  'conflict.remote.linesTip': 'Lines changed by both sides: {lines}',
  'conflict.remote.count': '{n} place|{n} places',
  'conflict.remote.loading': 'Loading comparison…',
  // Two-diff headings split in two: the path (<b> highlight) sits in between
  'conflict.remote.theirsLead': '🔴 ',
  'conflict.remote.theirsNote': ' — changes from the other side (new remote version vs your base; they will come in after updating):',
  'conflict.remote.theirsEmpty': '(the other side did not change this file)',
  'conflict.remote.oursLead': '🟢 ',
  'conflict.remote.oursNote': ' — your changes (working copy vs your base):',
  'conflict.remote.oursEmpty': '(you did not change this file)',
  // Hint line split in three: <b>in conflict</b> sits in between; tipA has the {n} count
  'conflict.remote.tipA': '💡 Highlighted in yellow are the lines both you and the other side changed ({n} in total). Click "Update" first to pull in their changes — these files will become ',
  'conflict.remote.tipBold': 'conflicted',
  'conflict.remote.tipB': ', then resolve each spot in "Resolve Conflicts".',
};
