/** 中文语言包 · 通用 UI 组件域（client/ui）：徽章 / 右键菜单 / 提示框 / 加载态。
 *  key 前缀 `ui.`；规范见 docs/i18n-搬运规范.md。
 */
export const ui = {
  // ---- 状态码徽标（CodeBadge / DirBadge）----
  'ui.badge.clickLocate': '（点击定位到最近的该状态文件）',
  'ui.dirCode.unversioned': '整个目录未版本化（未加入版本库）',
  'ui.dirCode.modified': '有修改的文件',
  'ui.dirCode.added': '有添加的文件',
  'ui.dirCode.deleted': '有删除的文件',
  'ui.dirCode.conflict': '有冲突的文件',
  'ui.dirCode.replaced': '有重命名/替换的文件',
  'ui.dirCode.missing': '有缺失的文件（更新可恢复）',
  'ui.dirCode.updated': '有更新的文件',
  'ui.dirCode.typeChanged': '有类型变更的文件',

  // ---- 树冲突角标（TreeConflictBadge；inner = 目录内部有冲突，不是目录自身）----
  'ui.tc.missing': '树冲突：服务器上该路径已删除，直接提交会被拒绝（右键 → 接受服务器的删除）',
  'ui.tc.present': '树冲突：服务器上该路径仍在，本地与服务器对同一路径各执一词（先 update 或找管理员）',
  'ui.tc.unknown': '树冲突：本地与服务器对同一路径的操作冲突（未查到服务器状态）',
  'ui.tc.innerMissing': '树冲突：目录内部有路径在服务器上已删除，提交会被拒绝 —— 点进去逐条处理',
  'ui.tc.innerPresent': '树冲突：目录内部有路径与服务器各执一词 —— 点进去逐条处理',
  'ui.tc.innerUnknown': '树冲突：目录内部有树冲突（未查到服务器状态）',
  // 插值 {n}（条数）：上面各条主体文案的前缀片段，紧随其后直接拼接
  'ui.tc.innerCount': '内部有 {n} 处。',
  'ui.tc.clickRotate': '（点击定位到该冲突项，连点轮转）',

  // ---- 通用弹窗（InfoModal / ConfirmModal）----
  'ui.modal.gotIt': '知道了',
  'ui.modal.confirm': '确认',
} as const;
