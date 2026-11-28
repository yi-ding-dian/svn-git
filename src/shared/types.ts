/** 前后端共享常量（单一事实源）：server 与 web feeder 均从此导入,避免双份维护 */
import { t } from './i18n/index.js';

/** 状态码 → 界面说明（文件徽标悬浮 / 网格悬浮卡 / 详情面板共用）。
 *  ⚠️ 值写成函数：模块顶层求值只会算一次，切语言不会跟着变（见 i18n/index.ts 头部说明） */
export const CODE_DESC: Record<string, () => string> = {
  // 已修改
  M: () => t('common.code.modified'),
  // 已添加
  A: () => t('common.code.added'),
  // 已删除
  D: () => t('common.code.deleted'),
  // 未版本化
  '?': () => t('common.code.unversioned'),
  // 缺失
  '!': () => t('common.code.missing'),
  // 冲突
  C: () => t('common.code.conflict'),
  // 已替换/重命名
  R: () => t('common.code.replaced'),
  // 外部引用
  X: () => t('common.code.external'),
  // 已忽略
  I: () => t('common.code.ignored'),
  // 已更新
  U: () => t('common.code.updated'),
  // 类型变更
  '~': () => t('common.code.typeChanged'),
  // 无变化
  ' ': () => t('common.code.none'),
};

/** 二进制文件扩展名（Office/PDF/图片/压缩包/可执行等,不支持文本对比）——server/wc 与前端共用 */
export const BINARY_EXTS = new Set([
  'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'odp', 'pdf',
  'zip', 'rar', '7z', 'jar', 'gz', 'bz2', 'xz',
  'png', 'jpg', 'jpeg', 'gif', 'bmp', 'ico', 'webp', 'psd', 'mp3', 'mp4',
  'exe', 'dll', 'so', 'dylib', 'bin', 'dat', 'db', 'sqlite', 'class', 'o', 'a',
]);

/** 可当图片显示的扩展名（浏览器 <img> 能渲染；与 /api/file 端点支持集一致）——
 *  前端三处共用：双击打开预览 / 列表与网格的缩略图。注意 svg 不在 BINARY_EXTS 里（它是文本） */
export const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'svg']);

/** 常见**文本**扩展名（已知能当文本预览）——判断"未知扩展名"用：
 *  既不在 BINARY_EXTS、也不在这里的（如自定义的 .tgg、无扩展名文件）→ 读文件头探测是否二进制，
 *  避免把自定义二进制格式当文本读成乱码/卡界面。不在表里不影响功能，只是多一次探测请求。 */
export const TEXT_EXTS = new Set([
  'md', 'markdown', 'txt', 'text', 'log', 'rst', 'adoc', 'tex',
  'json', 'jsonc', 'json5', 'yml', 'yaml', 'toml', 'ini', 'cfg', 'conf', 'env', 'properties',
  'xml', 'html', 'htm', 'css', 'scss', 'sass', 'less',
  'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'vue', 'svelte',
  'py', 'rb', 'php', 'java', 'kt', 'kts', 'scala', 'groovy', 'lua', 'r', 'dart',
  'c', 'h', 'cc', 'cpp', 'cxx', 'hpp', 'hh', 'm', 'mm', 'cs', 'go', 'rs', 'swift',
  'sh', 'bash', 'zsh', 'fish', 'bat', 'cmd', 'ps1',
  'sql', 'graphql', 'gql', 'proto', 'cmake', 'mk', 'gradle',
  'csv', 'tsv', 'patch', 'diff', 'lock', 'gitignore', 'gitattributes', 'editorconfig',
  'v', 'vhd', 'vhdl', 'tcl', 'awk', 'asm', 's',
]);

/** 文件/目录名比较（自然排序）：数字段按**数值**比，不是逐字符比。
 *  不写 numeric 时 localeCompare 会把 "v1.10" 排到 "v1.9" 前、"img10.png" 排到 "img2.png" 前（实报）。
 *  中英文的拼音/字母规则不受影响（仍跟随系统语言）。前后端共用：文件列表/树/过滤树/目录浏览都走它 */
export function compareName(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true });
}

/** ---------- 行数过滤（文件浏览搜索框第三模式） ---------- */

/** 比较方式：gte = ≥ value（不输符号的默认值）；gt = > value；lt = < value。
 *  前后端共用：前端解析输入，后端按同一套语义过滤。 */
export type LineOperator = 'gte' | 'gt' | 'lt';

export interface LineCondition {
  operator: LineOperator;
  /** 正整数；0 行没有筛选意义，解析与接口都会拒绝 */
  value: number;
}

/** ---------- diff 分块（hunk）：hunk 级部分提交用，前后端共享 ---------- */

/** hunk 内的一行。meta = diff 的 `\ No newline at end of file` 这类标记行（原样保留，不参与行数计数） */
export interface HunkLine {
  type: 'context' | 'add' | 'del' | 'meta';
  /** 去掉前缀后的原文（meta 行保留整行） */
  text: string;
}

export interface Hunk {
  /** 在所属文件 diff 里的序号（0 起），UI 勾选与回传均用它 */
  index: number;
  /** 原始 hunk 头，如 `@@ -1,3 +1,3 @@` */
  header: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: HunkLine[];
}

/** 单文件 diff 的解析结果 */
export interface ParsedDiff {
  /** 文件头（`diff --git` / `index` / `---` / `+++`，拼 patch 时原样带回） */
  fileHeader: string;
  hunks: Hunk[];
}
