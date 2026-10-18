/** 前端公共工具：纯函数 + 通用 hook */
import { useCallback, useState } from 'react';
import type { Hunk } from '../../shared/types.js';
import { t, type I18nKey } from '../../shared/i18n/index.js';

// 二进制文件扩展名集合：单一事实源在 src/shared/types.ts（server 与前端共用，避免双份维护）
import { BINARY_EXTS, IMAGE_EXTS } from '../../shared/types.js';

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

/** 取路径最后一段当显示名（最近项目、SVN 版本库目录等）。
 *  **两种分隔符都要认**：Windows 的 `D:\x\proj` 里一个 `/` 都没有，只按 `/` 切会把整条路径
 *  当名字显示出来（实报：Windows 侧边栏「最近项目」显示成 `D:\svn-git`，Linux 上正常）。
 *  只在路径确为 Windows 形式（盘符 `C:\`/`C:/` 或 UNC `\\server`）时才把 `\` 当分隔符——
 *  Linux 上 `\` 是合法文件名字符，不能无条件当分隔符（否则会切坏 Linux 的文件名）。 */
export function isWinPath(p: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(p) || p.startsWith('\\\\');
}

export function baseName(p: string): string {
  const segs = p.split(isWinPath(p) ? /[/\\]/ : '/').filter(Boolean);
  return segs.pop() ?? p;
}

/** 输入法组词中的按键：中文输入法里 Enter 是「选候选字」、Esc 是「取消组词」，
 *  不能当成表单提交/取消处理（否则选词就把文件名/分支名提交了）。
 *  `keyCode === 229` 覆盖部分浏览器/输入法在 compositionstart 前只报 229 的情况。 */
export function isImeComposing(e: { nativeEvent?: KeyboardEvent; isComposing?: boolean; keyCode?: number }): boolean {
  const native = e.nativeEvent;
  return Boolean(native?.isComposing ?? e.isComposing) || (native?.keyCode ?? e.keyCode) === 229;
}

/** 拼「仓库根 + 版本库相对路径」，输出平台原生分隔符的绝对路径。
 *
 *  `root` 是**平台原生**的绝对路径（Windows 形如 `D:\svn-git`，来自服务端），
 *  `rel` 是版本库风格的正斜杠相对路径（git/svn 的输出，本项目内部一律用 `/`）。
 *  直接 `${root}/${rel}` 会拼出 `D:\svn-git/run.bat` 这种**混用分隔符**的路径 ——
 *  Windows 认得，但复制出去贴进脚本/配置文件/命令行就是隐患，看着也别扭。
 *
 *  分隔符按 `root` 判定，且只认「确为 Windows 路径」（同 isWinPath）——
 *  不能无条件转成 `\`，否则 Linux 上含反斜杠的文件名会被改坏。
 *
 *  `root` 自身**原样保留**（它来自服务端，本就是平台原生形式），只统一「拼接处」和
 *  `rel` 的分隔符 —— 别顺手把 root 也改了，那个字符串还要拿去和服务端、剪贴板比对。 */
export function absPath(root: string | undefined, rel: string): string {
  if (!root) return rel; // 还没选仓库时（root 为空）退回相对路径，调用方不用自己判空
  const sep = isWinPath(root) ? '\\' : '/';
  const r = root.replace(/[\\/]+$/, ''); // 去掉尾部分隔符（`D:\`、`/` 这类根）
  const p = rel.replace(/^[\\/]+/, '').replace(/[\\/]/g, sep);
  return p ? `${r}${sep}${p}` : r;
}

/** 拼「父目录 + 名字」成**显示/提交用**的绝对路径：分隔符按父目录形态统一。
 *
 *  与 absPath 的区别：那个的 root 来自服务端（本就是平台原生形式，原样保留）；这里的
 *  `dir` 是**用户手填**的（获取仓库弹窗的「所在目录」），`D:\gitProjects` 和 `D:/gitProjects`
 *  两种写法都得规整成同一个形态——否则预览会显示成 `D:\gitProjects/snow-apps` 这种混用
 *  分隔符（用户实报）。Windows 形态（盘符 / UNC）统一用 `\`，其余（Linux / macOS）用 `/`。
 *  名字部分原样保留：Linux 上 `\` 是合法文件名字符，不能碰。
 *  只用于绝对路径（表单/目录选择器），不处理相对路径。 */
export function joinPath(dir: string, name: string): string {
  const d = dir.trim();
  if (!d) return name;
  const win = isWinPath(d);
  const sep = win ? '\\' : '/';
  let base = win ? d.replace(/\//g, '\\') : d;
  // 根（`/`、`D:\`、UNC `\\server\share\`）保留尾分隔符，其余去掉
  const isRoot = win ? /^[A-Za-z]:\\$/.test(base) || /^\\\\[^\\]*\\[^\\]*\\$/.test(base) : base === '/';
  if (!isRoot) base = base.replace(/[\\/]+$/, '');
  return base.endsWith(sep) ? `${base}${name}` : `${base}${sep}${name}`;
}

/** 取父目录（浏览器端没有 node:path 可用，手写；Windows 形态下 `\` 与 `/` 都算分隔符）。
 *  到根返回根自身（`/`、`D:\`）——调用方可用 `parentPath(p) === p` 判断"已在根"。
 *  Linux 上 `\` 是合法文件名字符，只在 Windows 形态（盘符 / UNC）里才当分隔符。 */
export function parentPath(p: string): string {
  const win = isWinPath(p);
  if (win) {
    const t = p.replace(/\//g, '\\').replace(/\\+$/, ''); // 统一后去尾部（根会退化成 `D:`）
    if (/^[A-Za-z]:/.test(t)) {
      if (t.length <= 2) return `${t.slice(0, 2)}\\`; // `D:` → 盘根
      const i = t.lastIndexOf('\\');
      return i <= 2 ? `${t.slice(0, 2)}\\` : t.slice(0, i); // `D:\x` → 盘根
    }
    const i = t.lastIndexOf('\\'); // UNC：`\\server\share\x` → `\\server\share`
    return i <= 1 ? t : t.slice(0, i);
  }
  const t = p.replace(/\/+$/, '') || '/';
  if (t === '/') return '/';
  const i = t.lastIndexOf('/');
  return i <= 0 ? '/' : t.slice(0, i);
}

/** 拖入的 File → 绝对路径（打开项目 / 目录选择器共用；取不到返回 null，由调用方兜底）。
 *  ① Electron 内嵌窗口：webUtils.getPathForFile（preload 注入，替代已移除的 File.path）
 *  ② 浏览器（Chrome/Edge 等）：File.path 属性
 *  ③ 都没有（Firefox 等）：null */
export function pathFromFile(f: File): string | null {
  const el = window as unknown as { svngit?: { getPathForFile: (file: File) => string | null } };
  const p = el.svngit?.getPathForFile(f) ?? (f as File & { path?: string }).path;
  return p || null;
}

/** 是否为二进制文件（不支持文本对比） */
export function isBinaryFile(path: string): boolean {
  const name = path.split('/').pop() ?? '';
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : '';
  return BINARY_EXTS.has(ext);
}

/** 是否为可直接显示的图片（双击进图片预览 / 视图里显示缩略图）。
 *  支持集单一事实源在 src/shared/types.ts 的 IMAGE_EXTS。
 *  注：不能写成 `/.(png|…)$/`——首个点不转义会误判 `apng`、`xsvg` 之类（旧代码的既有小 bug）。 */
export function isImageFile(path: string): boolean {
  const name = path.split('/').pop() ?? '';
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : '';
  return IMAGE_EXTS.has(ext);
}

/** 文件名状态染色：按状态码返回文字色（M 橙黄/A 绿/D 红/C 红/? 灰），无状态返回 undefined（默认色）。
 * 与徽标实底色联动——文件名带色 = 该文件有对应状态,扫视一眼可辨。 */
export function statusColor(code?: string): string | undefined {
  switch (code) {
    case 'M': return 'var(--warn)';
    case 'A': return 'var(--ok)';
    case 'D': return 'var(--err)';
    case 'C': return 'var(--err)';
    case '!': return 'var(--err)'; // 磁盘缺失（svn ! / git " D"）
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

/** 常见 svn/git 错误码 → 界面提示（含下一步动作建议）。映射不到时原样返回原文。
 *  ⚠️ 存的是 i18n key（不是文案本身）：模块顶层若求值 t() 会冻结在首次语言。 */
const VCS_ERR_INFO: { re: RegExp; key: I18nKey }[] = [
  // 环境缺失：svn/git 命令不可用（ENOENT）
  { re: /ENOENT|spawn[^\n]*ENOENT|command not found/i, key: 'common.vcsErr.noCommand' },
  // svn: 服务器有新版本
  { re: OUT_OF_DATE_RE, key: 'common.vcsErr.outOfDate' },
  // svn: 工作副本被锁定
  { re: /E155004|working copy locked/i, key: 'common.vcsErr.locked' },
  // svn: 文件存在冲突
  { re: /E155015|remains in conflict|merge conflict|CONFLICT \(content/i, key: 'common.vcsErr.conflict' },
  // svn: 无法连接服务器
  { re: /E170013|E175002|cannot connect|Could not connect|Unable to connect/i, key: 'common.vcsErr.connect' },
  // svn: 认证失败
  { re: /E170001|Authentication failed|authorization failed/i, key: 'common.vcsErr.auth' },
  // git: 工作区有未提交修改
  { re: /Please commit your changes or stash them|your local changes would be overwritten/i, key: 'common.vcsErr.localChanges' },
  // git: 非快进（需先拉取）
  { re: /Non-fast-forward|rejected.*fetch first/i, key: 'common.vcsErr.nonFastForward' },
  // git: 无法访问远程仓库
  { re: /fatal: unable to access|Could not resolve host|Failed to connect/i, key: 'common.vcsErr.remoteAccess' },
];

/** 展示层统一错误翻译：原始英文/svn 错误码 → 提示 + 下一步动作，未命中原样返回 */
export function translateVcsError(msg: string): string {
  if (!msg) return msg;
  for (const { re, key } of VCS_ERR_INFO) {
    if (re.test(msg)) return t(key);
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

/** 变更块的摘要（hunk 勾选弹窗里每块的标题，如「第 12 行 · +3 −1」） */
export function hunkSummaryLabel(h: Hunk): string {
  const add = h.lines.filter((l) => l.type === 'add').length;
  const del = h.lines.filter((l) => l.type === 'del').length;
  // 第 {line} 行 · +{add} −{del}
  return t('common.hunkSummary', { line: h.oldStart, add, del });
}

/** 按文本内容估算编辑弹窗尺寸：宽按最长行、高度按行数（都钳制在合理范围）。
 *  用于「修改提交注释」这类内容长度不定的弹窗——固定尺寸会让长说明只能滚动看。
 *  maxRows 给得较宽（40）：长行会折行，按逻辑行数算出来的高度往往仍不够，留足余量；
 *  真正超高时由弹窗的 maxHeight 兜底、textarea 内部滚动。 */
export function autoSizeForText(
  text: string,
  opts?: { minW?: number; maxW?: number; minRows?: number; maxRows?: number },
): { width: number; rows: number } {
  const lines = text ? text.split('\n') : [];
  const maxLen = lines.reduce((m, l) => Math.max(m, l.length), 0);
  return {
    width: pathAutoWidth(maxLen, opts?.minW ?? 620, opts?.maxW ?? 1400),
    rows: Math.min(Math.max(lines.length + 1, opts?.minRows ?? 8), opts?.maxRows ?? 40),
  };
}
