/** 项目代码统计的 md 导出：把统计结果拼成「目录树 + 每目录小计 + 每文件行数 + 总行数」，
 *  再用浏览器原生「另存为」（showSaveFilePicker，Electron/Chrome 支持）落盘；
 *  不支持 picker 的环境（Firefox 等）降级为普通下载（文件名即用户填的那个）。
 *
 *  为什么在客户端拼 md：统计结果已经在弹窗里了，导出只是排版 + 落盘，
 *  不必再为「写文件到任意目录」新增一个能写盘的接口（写盘面越小越安全）。
 */
import { t } from '../../shared/i18n/index.js';
import { post } from '../shared/api.js';
import type { CodeStatsNode } from '../shared/api.js';

/** 文件另存为对话框（File System Access API；TS 标准库里不一定有，这里结构化声明） */
type SaveFileHandle = {
  name: string;
  createWritable: () => Promise<{ write: (data: string) => Promise<void>; close: () => Promise<void> }>;
};

/** 每行「树 + 备注」的排版单元 */
interface Row {
  text: string;
  note: string;
}

/** 显示宽度：CJK 占 2 列（目录名里有中文时备注列才不会歪） */
function displayWidth(s: string): number {
  let n = 0;
  for (const ch of s) n += /[\u2e80-\ua4cf\uf900-\ufaff\uff00-\uff60]/.test(ch) ? 2 : 1;
  return n;
}

/** 当前时间 "2026-10-26 15:52"（本地时区） */
function fmtNow(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 递归拍平成「前缀 + 备注」的行 */
function flatten(nodes: CodeStatsNode[], prefix: string, out: Row[]): void {
  nodes.forEach((n, i) => {
    const last = i === nodes.length - 1;
    const text = `${prefix}${last ? '└── ' : '├── '}${n.isDir ? `${n.name}/` : n.name}`;
    const note = n.isDir
      ? t('stats.md.dirNote', { lines: n.lines, files: n.files })
      : t('stats.md.fileNote', { lines: n.lines });
    out.push({ text, note });
    if (n.isDir) flatten(n.children, `${prefix}${last ? '    ' : '│   '}`, out);
  });
}

/** 把行排成代码块（备注列按最宽行对齐，箭头统一成 ←） */
function renderTree(rootName: string, tree: CodeStatsNode[], lines: number, files: number): string {
  const rows: Row[] = [{ text: `${rootName}/`, note: t('stats.md.dirNote', { lines, files }) }];
  flatten(tree, '', rows);
  const width = rows.reduce((m, r) => Math.max(m, displayWidth(r.text)), 0);
  return rows
    .map((r) => `${r.text}${' '.repeat(Math.max(2, width + 2 - displayWidth(r.text)))}← ${r.note}`)
    .join('\n');
}

export interface MdInput {
  /** 项目根目录名（树的第一行） */
  rootName: string;
  tree: CodeStatsNode[];
  lines: number;
  files: number;
  /** 服务端实际统计的目录（'' = 仓库根 → 显示「整个项目」） */
  dirs: string[];
  codeOnly: boolean;
  skipped: number;
  truncated?: boolean;
}

/** 生成 md 正文 */
export function buildCodeStatsMd(input: MdInput): string {
  const scope = input.dirs.includes('') || input.dirs.length === 0
    ? t('stats.md.allProject')
    : input.dirs.join(t('stats.md.listSep'));
  const meta = t('stats.md.meta', {
    dirs: scope,
    scope: input.codeOnly ? t('stats.scope.codeOnly') : t('stats.scope.allFiles'),
    time: fmtNow(),
  });
  const body = renderTree(input.rootName, input.tree, input.lines, input.files);
  const out = [
    t('stats.md.heading'),
    meta,
    '',
    '```',
    body,
    '```',
    '',
    t('stats.md.total', { lines: input.lines, files: input.files }),
  ];
  if (input.skipped > 0) out.push(t('stats.md.skipped', { n: input.skipped }));
  if (input.truncated) out.push(t('stats.md.truncated'));
  return out.join('\n') + '\n';
}

/** 另存为：优先**系统「另存为」对话框**（Electron 版默认落在项目目录 + 预填文件名），
 *  浏览器模式退到原生保存框（showSaveFilePicker，初始目录由浏览器决定），
 *  再退到普通下载（文件名即用户填的那个）。用户取消保存框一律静默返回 cancelled。 */
export async function saveTextFile(
  suggestedName: string,
  content: string,
  opts?: { startDir?: string }
): Promise<{ ok: boolean; path?: string; cancelled?: boolean; error?: string }> {
  // ① 系统「另存为」（Electron 主进程注入）：startDir 有值就默认打开在那里
  if (opts?.startDir) {
    try {
      const picked = await post.pickSaveFile(opts.startDir, suggestedName);
      if (!picked.unsupported) {
        if (!picked.path) return { ok: false, cancelled: true };
        const w = await post.saveText(picked.path, content);
        if (!w.ok) return { ok: false, error: w.error };
        return { ok: true, path: w.path ?? picked.path };
      }
    } catch {
      /* 接口不可用（纯 node / 浏览器模式）：落到下面的浏览器保存 */
    }
  }

  // ② 浏览器原生保存框
  const picker = (
    window as unknown as {
      showSaveFilePicker?: (o: {
        suggestedName?: string;
        types?: { description: string; accept: Record<string, string[]> }[];
      }) => Promise<SaveFileHandle>;
    }
  ).showSaveFilePicker;
  if (!picker) {
    // ③ 降级：普通下载（落到浏览器/Electron 的下载目录）
    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = suggestedName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // 立刻 revoke 会让部分浏览器取消下载，延后一点
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    return { ok: true, path: suggestedName };
  }
  try {
    const handle = await picker({
      suggestedName,
      types: [{ description: 'Markdown', accept: { 'text/markdown': ['.md'] } }],
    });
    const w = await handle.createWritable();
    await w.write(content);
    await w.close();
    return { ok: true, path: handle.name };
  } catch (e) {
    const err = e as Error & { name?: string };
    if (err.name === 'AbortError') return { ok: false, cancelled: true }; // 用户取消保存框：静默
    return { ok: false, error: err.message };
  }
}
