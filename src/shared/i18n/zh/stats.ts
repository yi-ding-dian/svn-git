/** 中文语言包 · 项目代码统计域（client/stats）：统计弹窗 + md 导出。
 *  key 前缀 `stats.`；规范见 docs/i18n-搬运规范.md。
 */
export const stats = {
  // ---- 入口（⋯ 菜单）----
  'stats.title': '项目代码统计',
  'stats.tool.label': '项目代码统计',
  'stats.tool.title': '按目录统计代码行数，可导出 md 报告',

  // ---- 弹窗：选择范围 ----
  'stats.section.dirs': '统计目录',
  'stats.wholeProject': '整个项目（含根目录文件）',
  'stats.wholeProjectTip': '统计仓库里全部文件（含仓库根目录下的文件）；跳过 node_modules 与隐藏目录',
  'stats.needDirs': '请先勾选要统计的目录（或选「整个项目」）',
  'stats.expandDirs': '展开目录',
  'stats.collapseDirs': '收起目录',
  'stats.hint': '勾选要统计的目录（默认全选一级目录），展开可细选子目录；只统计文本文件，二进制、空文件与超大文件自动跳过。',
  'stats.defaultAll': '默认全选一级目录；展开可细选子目录',
  'stats.selectAll': '全选',
  'stats.unselectAll': '全不选',
  'stats.selectAllTip': '全选一级目录（并清掉深层取消）',
  'stats.unselectAllTip': '清空勾选',
  'stats.scope.label': '文件范围',
  'stats.scope.codeOnly': '仅代码文件',
  'stats.scope.allFiles': '全部文本文件',

  // ---- 扫描状态 ----
  'stats.start': '开始统计',
  'stats.restart': '重新统计',
  'stats.cancel': '取消',
  'stats.scanning': '已处理 {done} / {total} 个文件…',
  'stats.collecting': '正在收集文件…',
  'stats.cancelled': '统计已取消',

  // ---- 结果 ----
  'stats.result.wait': '勾选目录后点「开始统计」',
  'stats.result.unit': '行 · {files} 个文件 · 耗时 {sec}s',
  'stats.result.skipped': '跳过 {n} 个',
  'stats.result.skippedTitle': '空文件 {empty} 个 · 二进制 {binary} 个 · 超大 {large} 个 · 读取失败 {error} 个',
  'stats.result.truncated': '统计超时，以上为已统计部分',
  'stats.result.capped': '文件过多，仅统计了前 {n} 个',
  'stats.result.empty': '没有可统计的文件',

  // ---- 导出 ----
  'stats.export.label': '导出文件名',
  'stats.export.defaultName': '导出项目代码统计.md',
  'stats.export.button': '导出 md',
  'stats.export.saved': '已导出：{path}',
  'stats.export.failed': '导出失败：{msg}',
  'stats.export.noResult': '先统计出结果才能导出',

  // ---- md 正文 ----
  'stats.md.heading': '## 目录树与行数统计',
  'stats.md.meta': '（统计范围：{dirs} · {scope} · {time}）',
  'stats.md.allProject': '整个项目',
  'stats.md.listSep': '、',
  'stats.md.dirNote': '{lines} 行 · {files} 个文件',
  'stats.md.fileNote': '{lines} 行',
  'stats.md.total': '总行数：{lines} 行（{files} 个文件）',
  'stats.md.skipped': '已跳过 {n} 个文件（空文件 / 二进制 / 超大 / 读取失败）',
  'stats.md.truncated': '注意：统计超时，以上为已统计部分',
} as const;
