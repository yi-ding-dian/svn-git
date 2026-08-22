/** 前后端共享常量（单一事实源）：server 与 web feeder 均从此导入,避免双份维护 */
/** 状态码 -> 中文说明 */
export const CODE_DESC: Record<string, string> = {
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
