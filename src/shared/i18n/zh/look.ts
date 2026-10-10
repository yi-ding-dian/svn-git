/** 中文语言包 · 外观域（client/appearance）：主题气泡 / 字体设置 / 字号 / 我的主题。
 *  key 前缀 `look.`；规范见 docs/i18n-搬运规范.md。
 *
 *  ⚠️ 字体项（`look.font.yahei` 等）只是**下拉里显示的字体名**；
 *  font-modal.tsx 里 value 字段的 `"楷体"` / `"仿宋"` / `"幼圆"` 是 CSS font-family 名，禁止翻译。
 */
export const look = {
  // ---- 主题气泡：分组标题 ----
  'look.group.light': '浅色',
  'look.group.dark': '深色',
  'look.myThemes': '我的主题',
  'look.myThemes.deleteHint': '{name}（右键删除）',

  // ---- 自定义配色 ----
  'look.custom.toggle': '自定义配色',
  'look.custom.namePlaceholder': '主题名称',
  'look.custom.hint': '改色即时预览；保存后出现在「我的主题」，右键可删。',
  'look.color.bg': '背景',
  'look.color.panel': '面板',
  'look.color.border': '边框',
  'look.color.text': '文字',
  'look.color.dim': '次要文字',
  'look.color.accent': '强调色',

  // ---- 字体设置弹窗 ----
  'look.font.title': '🔤 字体设置',
  'look.font.size': '字号',
  'look.font.ui': '界面字体',
  'look.font.code': '代码字体（差异对比 / 代码查看等区域）',
  'look.font.preview': '实时预览',
  'look.font.previewText': 'svn-git 文件版本管理 · AaBbCc · 你好世界 123',
  'look.font.unavailableTip': '系统没有「{name}」字体样式',

  // ---- 字体下拉的显示名（只影响显示，改不到 font-family）----
  'look.font.systemDefault': '系统默认',
  'look.font.monoDefault': '默认等宽',
  'look.font.yahei': '微软雅黑',
  'look.font.simsun': '宋体',
  'look.font.simhei': '黑体',
  'look.font.pingfang': '苹方',
  'look.font.notoSansCJK': '思源黑体',
  'look.font.kaiti': '楷体',
  'look.font.notoSerifCJK': '思源宋体',
  'look.font.fangsong': '仿宋',
  'look.font.yuanti': '圆体',
  'look.font.jetbrainsMono': 'JetBrains Mono',
  'look.font.consolas': 'Consolas',
  'look.font.courierNew': 'Courier New',
  'look.font.firaCode': 'Fira Code',
} as const;
