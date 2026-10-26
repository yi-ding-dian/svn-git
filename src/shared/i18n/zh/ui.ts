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

  // ---- 命令预览（CommandPreview）----
  'ui.cmdPreview.title': '将执行以下命令',
  'ui.cmdPreview.toggle': '展开/收起命令预览',
  'ui.cmdPreview.expanded': '点击收起',
  'ui.cmdPreview.collapsed': '{n} 条，点击展开',
  'ui.cmdPreview.copy': '复制',
  'ui.cmdPreview.copyTip': '复制全部命令',
  'ui.cmdPreview.copyLineTip': '复制这一行命令',
  'ui.cmdPreview.copied': '已复制',
  // ---- 差异文件头（DiffRender）----
  'ui.diffFileHead.add': '新增',
  'ui.diffFileHead.del': '删除',
  'ui.diffFileHead.mod': '修改',
  'ui.diffFileHead.rename': '重命名',
  'ui.diffFileHead.binary': '二进制',
  // ---- 通用目录勾选树（DirCheckTree）----
  'ui.dirTree.loading': '正在获取目录列表…',
  'ui.dirTree.loadFail': '目录列表获取失败，请稍后重试',
  'ui.dirTree.empty': '（该目录下没有子目录）',
  'ui.dirTree.emptyChild': '（空目录）',
  'ui.dirTree.expand': '展开',
  'ui.dirTree.collapse': '收起',
} as const;
