/** 前后端共享常量（单一事实源）：server 与 web feeder 均从此导入,避免双份维护 */
/** 状态码 -> 中文说明 */export const CODE_DESC: Record<string, string> = {
  M: '已修改',
  A: '已添加',
  D: '已删除',
  '?': '未版本化',
  '!': '缺失',
  C: '冲突',
  R: '已替换/重命名',
  X: '外部引用',
  I: '已忽略',
  U: '已更新',
  '~': '类型变更',
  ' ': '无变化',
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
