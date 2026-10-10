/** 英文语言包 · 通用。
 *
 *  语言名（`lang.zh` / `lang.en`）**不翻译** —— 语言选择器惯例是显示各语言的自称。
 */
export const common = {
  // ---- 语言切换自身 ----
  'lang.title': 'Language',
  'lang.hint': 'Switch interface language (results and error messages follow)',
  'lang.zh': '简体中文',
  'lang.en': 'English',

  // ---- 通用动作词 ----
  'common.ok': 'OK',
  'common.cancel': 'Cancel',
  'common.close': 'Close',
  'common.save': 'Save',
  'common.delete': 'Delete',
  'common.edit': 'Edit',
  'common.refresh': 'Refresh',
  'common.preview': 'Preview',
  'common.write': 'Write',

  // ---- Network / app-level messages (client/shared/api.ts) ----
  'common.cancelled': 'Canceled',
  'common.serviceDown': 'Cannot reach the service (it may have stopped). Restart the app, or check the terminal window it was launched from.',

  // ---- Common svn/git errors (client/shared/utils.ts translateVcsError) ----
  'common.vcsErr.noCommand': '⚠ svn/git command not found. Install it as described in the banner at the top, then try again',
  'common.vcsErr.outOfDate': '⚠ The server has newer revisions. Run Update to get the latest changes, then commit again',
  'common.vcsErr.locked': '⚠ The working copy is locked. Run Cleanup, then try again',
  'common.vcsErr.conflict': '⚠ The file is in conflict. Resolve the conflict before committing',
  'common.vcsErr.connect': '⚠ Failed to connect to the server. Check your network and credentials, then try again',
  'common.vcsErr.auth': '⚠ Authentication failed. Check your username and password, then try again',
  'common.vcsErr.localChanges': '⚠ You have uncommitted local changes. Commit or revert them first',
  'common.vcsErr.nonFastForward': '⚠ The remote repository has new commits. Pull/Update first, then push again',
  'common.vcsErr.remoteAccess': '⚠ Cannot access the remote repository. Check your network connection and remote URL',

  // ---- Status code descriptions (src/shared/types.ts CODE_DESC) ----
  'common.code.modified': 'Modified',
  'common.code.added': 'Added',
  'common.code.deleted': 'Deleted',
  'common.code.unversioned': 'Unversioned',
  'common.code.missing': 'Missing',
  'common.code.conflict': 'Conflicted',
  'common.code.replaced': 'Replaced/Renamed',
  'common.code.external': 'External',
  'common.code.ignored': 'Ignored',
  'common.code.updated': 'Updated',
  'common.code.typeChanged': 'Type changed',
  'common.code.none': 'No change',

  // ---- Other shared strings ----
  'common.hunkSummary': 'Line {line} · +{add} −{del}',
  'common.gbkUnencodable': 'GBK cannot represent the character "{ch}" (U+{code})',

  // ---- List separators (see zh/common.ts for the rationale) ----
  'common.listSep': ', ',
  'common.listSepSemi': '; ',
};
