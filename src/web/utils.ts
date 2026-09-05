/** 前端公共工具：纯函数 + 通用 hook */
import { useCallback, useState } from 'react';

/** 弹窗宽度自适应最长文件名（mono 13px 约 7.6px/字符 + 勾选框/徽标/间距余量），钳制在 [minW, maxW] 防过窄/超宽 */
export function pathAutoWidth(maxPathLen: number, minW = 620, maxW = 1400): number {
  return Math.min(maxW, Math.max(minW, 140 + maxPathLen * 7.6));
}

/** 文件大小格式化（B / KB / MB） */
export function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** 二进制文件扩展名（Office/PDF/图片/压缩包/可执行等，不支持文本对比） */
const BINARY_EXTS = new Set([
  // Office / PDF
  'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'odp', 'pdf',
  // 压缩包
  'zip', 'rar', '7z', 'jar', 'gz', 'bz2', 'xz',
  // 图片 / 音视频
  'png', 'jpg', 'jpeg', 'gif', 'bmp', 'ico', 'webp', 'psd', 'mp3', 'mp4',
  // 可执行 / 二进制数据
  'exe', 'dll', 'so', 'dylib', 'bin', 'dat', 'db', 'sqlite', 'class', 'o', 'a',
]);

/** 是否为二进制文件（不支持文本对比） */
export function isBinaryFile(path: string): boolean {
  const name = path.split('/').pop() ?? '';
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : '';
  return BINARY_EXTS.has(ext);
}

/** 文件名状态染色：按状态码返回文字色（M 橙黄/A 绿/D 红/C 红/? 灰），无状态返回 undefined（默认色）。
 * 与徽标实底色联动——文件名带色 = 该文件有对应状态,扫视一眼可辨。 */
export function statusColor(code?: string): string | undefined {
  switch (code) {
    case 'M': return 'var(--warn)';
    case 'A': return 'var(--ok)';
    case 'D': return 'var(--err)';
    case 'C': return 'var(--err)';
    case '?': return 'var(--dim)';
    default: return undefined;
  }
}

/** svn out-of-date 类错误（服务器有新版本，提交前需先更新）：判断与翻译共用同一正则 */
const OUT_OF_DATE_RE = /E155011|E160028|E160029|File or directory is out of date/i;

/** 是否为 svn out-of-date 类错误（服务器已有新版本，需先「更新」再提交） */
export function isOutOfDateError(msg: string): boolean {
  return OUT_OF_DATE_RE.test(msg);
}

/** 常见 svn/git 错误码 → 中文提示（含下一步动作建议）。映射不到时原样返回原文。 */
const VCS_ERR_INFO: { re: RegExp; cn: string }[] = [
  // 环境缺失：svn/git 命令不可用（ENOENT）
  { re: /ENOENT|spawn[^\n]*ENOENT|command not found/i, cn: '⚠ 未检测到 svn/git 命令，请按顶部横幅指引安装后重试' },
  // svn: 服务器有新版本
  { re: OUT_OF_DATE_RE, cn: '⚠ 服务器已有新版本，请先「更新」获取最新内容后再提交' },
  // svn: 工作副本被锁定
  { re: /E155004|working copy locked/i, cn: '⚠ 工作副本被锁定，请执行「清理」后再操作' },
  // svn: 文件存在冲突
  { re: /E155015|remains in conflict|merge conflict|CONFLICT \(content/i, cn: '⚠ 文件存在冲突，请先解决冲突再提交' },
  // svn: 无法连接服务器
  { re: /E170013|E175002|cannot connect|Could not connect|Unable to connect/i, cn: '⚠ 连接服务器失败，请检查网络/账号密码后重试' },
  // svn: 认证失败
  { re: /E170001|Authentication failed|authorization failed/i, cn: '⚠ 认证失败，请检查账号密码（设置后重新操作）' },
  // git: 工作区有未提交修改
  { re: /Please commit your changes or stash them|your local changes would be overwritten/i, cn: '⚠ 本地有未提交的修改，请先提交或撤销后重试' },
  // git: 非快进（需先拉取）
  { re: /Non-fast-forward|rejected.*fetch first/i, cn: '⚠ 远程仓库有新提交，请先「拉取/更新」后再推送' },
  // git: 无法访问远程仓库
  { re: /fatal: unable to access|Could not resolve host|Failed to connect/i, cn: '⚠ 无法访问远程仓库，请检查网络连接与远程地址' },
];

/** 展示层统一错误翻译：原始英文/svn 错误码 → 中文解释 + 下一步动作，未命中原样返回 */
export function translateVcsError(msg: string): string {
  if (!msg) return msg;
  for (const { re, cn } of VCS_ERR_INFO) {
    if (re.test(msg)) return cn;
  }
  return msg;
}

/** 勾选集合（checkbox 列表）：初始集合 + 单项切换 */
export function useCheckedSet(initial: string[]) {
  const [checked, setChecked] = useState<Set<string>>(() => new Set(initial));
  const toggle = useCallback((p: string) => {
    setChecked((s) => {
      const n = new Set(s);
      if (n.has(p)) n.delete(p);
      else n.add(p);
      return n;
    });
  }, []);
  return { checked, setChecked, toggle };
}
