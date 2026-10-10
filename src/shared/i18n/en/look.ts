/** 英文语言包 · 外观域（client/appearance）：主题气泡 / 字体设置 / 字号 / 我的主题。
 *  key 前缀 `look.`；规范见 docs/i18n-搬运规范.md。
 *
 *  字体名（Microsoft YaHei / SimSun…）用各字体的官方英文名 —— 它们同时是用户在系统里
 *  看到的字体名，写中文反而认不出。纯拉丁字体名两种语言一致。
 */
export const look = {
  // ---- 主题气泡：分组标题 ----
  'look.group.light': 'Light',
  'look.group.dark': 'Dark',
  'look.myThemes': 'My Themes',
  'look.myThemes.deleteHint': '{name} (right-click to delete)',

  // ---- 自定义配色 ----
  'look.custom.toggle': 'Custom Colors',
  'look.custom.namePlaceholder': 'Theme name',
  'look.custom.hint': 'Changes preview live; saved themes appear under "My Themes" and can be deleted with a right-click.',
  'look.color.bg': 'Background',
  'look.color.panel': 'Panel',
  'look.color.border': 'Border',
  'look.color.text': 'Text',
  'look.color.dim': 'Secondary Text',
  'look.color.accent': 'Accent',

  // ---- 字体设置弹窗 ----
  'look.font.title': '🔤 Font Settings',
  'look.font.size': 'Font Size',
  'look.font.ui': 'UI Font',
  'look.font.code': 'Code Font (diffs, code views)',
  'look.font.preview': 'Live Preview',
  'look.font.previewText': 'svn-git Version Control · AaBbCc · Hello World 123',
  'look.font.unavailableTip': 'Font "{name}" is not available on this system',

  // ---- 字体下拉的显示名（只影响显示，改不到 font-family）----
  'look.font.systemDefault': 'System Default',
  'look.font.monoDefault': 'Default Monospace',
  'look.font.yahei': 'Microsoft YaHei',
  'look.font.simsun': 'SimSun',
  'look.font.simhei': 'SimHei',
  'look.font.pingfang': 'PingFang SC',
  'look.font.notoSansCJK': 'Noto Sans CJK SC',
  'look.font.kaiti': 'KaiTi',
  'look.font.notoSerifCJK': 'Noto Serif CJK SC',
  'look.font.fangsong': 'FangSong',
  'look.font.yuanti': 'YouYuan',
  'look.font.jetbrainsMono': 'JetBrains Mono',
  'look.font.consolas': 'Consolas',
  'look.font.courierNew': 'Courier New',
  'look.font.firaCode': 'Fira Code',
};
