/** 英文语言包 · 通用 UI 组件域（client/ui）：徽章 / 右键菜单 / 提示框 / 加载态。
 *  key 前缀 `ui.`；规范见 docs/i18n-搬运规范.md。
 */
export const ui = {
  // ---- 状态码徽标（CodeBadge / DirBadge）----
  'ui.badge.clickLocate': '(Click to jump to the nearest file with this status)',
  'ui.dirCode.unversioned': 'Entire directory is unversioned (not added to the repository)',
  'ui.dirCode.modified': 'Contains modified files',
  'ui.dirCode.added': 'Contains added files',
  'ui.dirCode.deleted': 'Contains deleted files',
  'ui.dirCode.conflict': 'Contains files in conflict',
  'ui.dirCode.replaced': 'Contains renamed/replaced files',
  'ui.dirCode.missing': 'Contains missing files (recoverable with Update)',
  'ui.dirCode.updated': 'Contains updated files',
  'ui.dirCode.typeChanged': 'Contains files with changed type',

  // ---- 树冲突角标（inner = 目录内部有冲突）----
  'ui.tc.missing': 'Tree conflict: this path was deleted on the server; committing will be rejected (right-click → accept the server deletion)',
  'ui.tc.present': 'Tree conflict: this path still exists on the server; local and server disagree over it (run Update first, or ask an admin)',
  'ui.tc.unknown': 'Tree conflict: local and server operations conflict on the same path (server status unavailable)',
  'ui.tc.innerMissing': 'Tree conflict: a path inside this directory was deleted on the server; committing will be rejected — open it and resolve each one',
  'ui.tc.innerPresent': 'Tree conflict: paths inside this directory disagree with the server — open it and resolve each one',
  'ui.tc.innerUnknown': 'Tree conflict: paths inside this directory have tree conflicts (server status unavailable)',
  // 尾随空格是有意的：这段与紧随其后的主体文案直接拼接（`a|b` 为单复数分隔）
  'ui.tc.innerCount': '{n} tree conflict inside. |{n} tree conflicts inside. ',
  'ui.tc.clickRotate': '(Click to jump to this conflict; click again to cycle)',

  // ---- 通用弹窗（InfoModal / ConfirmModal）----
  'ui.modal.gotIt': 'Got it',
  'ui.modal.confirm': 'Confirm',
};
