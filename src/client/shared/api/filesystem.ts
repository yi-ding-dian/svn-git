/** 文件系统浏览 / 状态 / 搜索 / 文件变更相关的 API。 */
import { api, json, type FileStatus, type RepoInfo, type VcsResult } from './core.js';
import type { LineCondition } from '../../../shared/types.js';

/** 还原前预检（只读）：目标版本 vs 当前工作区。与 src/vcs/types.ts 的 RestorePreview 同构 */
export interface RestorePreview {
  kind: 'file' | 'dir';
  /** 完全一致：界面直接拦下，不再进入还原确认 */
  same: boolean;
  /** 文件当前在工作区里缺失（磁盘上没有）：还原会把它找回 */
  missing?: boolean;
  /** 二进制文件：无法逐行统计 */
  binary?: boolean;
  /** 文件：还原后会新增/删除的行数 */
  added?: number;
  removed?: number;
  /** 目录：还原后会修改/找回/删除的文件数 */
  files?: { modify: number; restore: number; remove: number };
}

export interface BrowseResult {
  entries: { name: string; isDir: boolean }[];
  repo: RepoInfo | null;
  dir: string;
}

export interface LsResult {
  items: { name: string; isDir: boolean }[];
  repoType: 'svn' | 'git';
}

export interface FsEntry {
  name: string;
  isDir: boolean;
  size: number;
  mtime: string;
  code: string;
  /** 仅重命名（code='R'）有值：从哪个路径移过来的（后端 /api/fs 透传，列表用 tooltip 提示来源） */
  origPath?: string;
  count?: number;
  /** 目录同时发生的操作集合（M/A/D…），无操作或未版本化时为 undefined */
  codes?: string[];
  /** 目录内部未版本化文件数量（'?' 不显示徽标，筛选"仅新文件"时用于提示新文件位置） */
  unversionedCount?: number;
  /** 磁盘上已缺失（svn '!' / git " D"）：磁盘无文件、版本库仍在 → 虚化渲染，右键可还原 */
  miss?: boolean;
  /** 树冲突：本地已添加/修改，服务器同路径已删除或移动。本地 status 就带，无需联网 */
  treeConflicted?: boolean;
  /** 该目录**内部深层**还有树冲突（仅小仓库全量扫描时可能为真；超大工作副本浅扫描拿不到） */
  innerTreeConflict?: boolean;
  /** 独立检出的工作副本（有自己的 .svn）：父工作副本未跟踪它，但内部按它自己的状态显示 */
  nestedWc?: boolean;
}

export interface FsData {
  dir: string;
  abs: string;
  root: string;
  entries: FsEntry[];
  selfLocked?: string[];
  /** 当前目录被 SVN 标成「缺失」（磁盘上确实没有） */
  wcBroken?: boolean;
  /** 当前目录被锁定：上次 SVN 操作未正常结束，需先停其他 SVN 程序再 cleanup */
  wcLocked?: boolean;
  /** 工作副本不完整：上次操作中途失败，cleanup 即可修复 */
  wcIncomplete?: boolean;
  /** 树冲突条目数（>0 时前端再去 /api/wc-conflicts 问服务器，确认这些路径还在不在） */
  treeConflicts?: number;
  /** 预加载（light=1）拿到的数据：只有磁盘目录结构，**entries 的 code 全是空串**。
   *  进入该目录时要用整份数据静默补一次——被忽略的条目（.gitignore / svn:ignore）
   *  在 /api/fs-status 里根本不存在，靠状态接口补不回来，会一直显示成干净 ✓（用户实报）。 */
  light?: boolean;
}

/** 树冲突诊断结果（/api/wc-conflicts） */
export interface WcConflictItem {
  path: string;
  /** 服务器上该路径已不存在（被删或被移）——树冲突的根源 */
  serverMissing: boolean;
  /** 复制源（该目录从哪个版本复制来的） */
  fromRev?: string;
  fromAuthor?: string;
  fromDate?: string;
}

export interface FilterTreeNode {
  name: string;
  path: string;
  isDir: boolean;
  code: string;
  /** 文件大小（字节,目录为 0）——过滤树悬浮卡片与列表一致性 */
  size?: number;
  /** 文件修改时间（目录为空） */
  mtime?: string;
  /** 行数（仅行数过滤树的文件节点有；目录为空） */
  lines?: number;
  children: FilterTreeNode[];
}

/** 行数过滤的流式进度（/api/line-scan，NDJSON 每行一个） */
export interface LineScanTick {
  total?: number;
  scanned?: number;
  done?: boolean;
  tree?: FilterTreeNode[];
  /** 匹配总数（截断前）与本次实际返回的节点数 */
  matched?: number;
  shown?: number;
  skippedEmpty?: number;
  skippedBinary?: number;
  skippedLarge?: number;
  skippedError?: number;
  /** 候选文件超过上限（只扫描了前 N 个） */
  capped?: boolean;
  /** time=扫描超时；limit=匹配过多只返回前 N 个 */
  truncated?: 'time' | 'limit';
  elapsedMs?: number;
  error?: string;
}

/** 项目代码统计（/api/code-stats）的树节点：目录的 lines/files 是**子树合计**，文件是自身值 */
export interface CodeStatsNode {
  name: string;
  path: string;
  isDir: boolean;
  lines: number;
  files: number;
  children: CodeStatsNode[];
}

/** 项目代码统计的流式进度（NDJSON 每行一个） */
export interface CodeStatsTick {
  /** 候选文件总数 / 已处理数（进度） */
  total?: number;
  scanned?: number;
  done?: boolean;
  tree?: CodeStatsNode[];
  /** 总行数 / 命中文件数（done 时） */
  lines?: number;
  files?: number;
  /** 本次实际统计的目录（祖先已选时子目录已收敛；'' = 仓库根） */
  dirs?: string[];
  skippedEmpty?: number;
  skippedBinary?: number;
  skippedLarge?: number;
  skippedError?: number;
  /** 候选文件超过上限（只统计了前 N 个） */
  capped?: boolean;
  /** time = 统计超时（返回已统计部分） */
  truncated?: 'time';
  elapsedMs?: number;
  error?: string;
}

export const getFilesystem = {
  status: () => api<{ items: FileStatus[] }>('/api/status'),
  filteredTree: (dir?: string, codes: string[] = []) =>
    api<{ tree: FilterTreeNode[] }>(`/api/filtered-tree?dir=${encodeURIComponent(dir ?? '')}&codes=${encodeURIComponent(codes.join(','))}`),
  /** 目录下（含子目录）该状态文件，按 mtime 降序（角标跳转定位） */
  locate: (dir: string, code: string) =>
    api<{ files: { path: string; mtime: number }[] }>(`/api/locate?dir=${encodeURIComponent(dir)}&code=${encodeURIComponent(code)}`),
  ls: (dir?: string) => api<LsResult>(`/api/ls?dir=${encodeURIComponent(dir ?? '')}`),
  browse: (dir?: string) => api<BrowseResult>(`/api/browse?path=${encodeURIComponent(dir ?? '')}`),
  pickDir: () => api<{ path: string | null; unsupported: boolean }>('/api/pick-dir'),
  fs: (dir?: string, force?: boolean, light?: boolean) =>
    api<FsData>(`/api/fs?dir=${encodeURIComponent(dir ?? '')}${force ? '&force=1' : ''}${light ? '&light=1' : ''}`),
  /** 当前目录状态：deep=true 查子树（进入目录时用），否则只查直接子项（轮询用） */
  fsStatus: (dir?: string, deep = false) =>
    api<{
      items: {
        path: string;
        code: string;
        /** 独立工作副本的聚合结果（父工作副本看不到它内部） */
        codes?: string[];
        count?: number;
        nestedWc?: boolean;
        treeConflicted?: boolean;
      }[];
      treeConflicts?: number;
      /** 当前目录自身未版本化（父工作副本没跟踪它）：所有条目统一标 ? */
      dirSelf?: '?';
    }>(`/api/fs-status?dir=${encodeURIComponent(dir ?? '')}${deep ? '&deep=1' : ''}`),
  /** 工作副本树冲突诊断：去服务器核对冲突路径是否还在（只在 /api/fs 报了 treeConflicts 时调用） */
  wcConflicts: (dir: string) =>
    api<{ conflicts: WcConflictItem[]; unchecked?: boolean }>(`/api/wc-conflicts?dir=${encodeURIComponent(dir)}`),
  search: (query: string, dir = '') =>
    api<{ paths: string[] }>(`/api/search?query=${encodeURIComponent(query)}&dir=${encodeURIComponent(dir)}`),
  /** 文件内容搜索：hits 按发现顺序；truncated='limit'|'time' = 结果/超时被截断（内容模式专用） */
  searchContent: (query: string, dir: string, signal?: AbortSignal) =>
    api<{ hits: { path: string; line: number; text: string }[]; truncated?: 'limit' | 'time' }>(
      `/api/search-content?query=${encodeURIComponent(query)}&dir=${encodeURIComponent(dir)}`,
      { signal }
    ),
  /** 行数过滤：流式 NDJSON（进度 → done 结果）。请求断开时后端销毁在途读取。 */
  lineScan: async (
    dir: string,
    condition: LineCondition,
    onTick: (tick: LineScanTick) => void,
    signal?: AbortSignal
  ): Promise<void> => {
    const q = new URLSearchParams({
      dir,
      op: condition.operator,
      value: String(condition.value),
    });
    const res = await fetch(`/api/line-scan?${q.toString()}`, { signal });
    if (!res.ok || !res.body) {
      let msg = `HTTP ${res.status}`;
      try {
        const j = (await res.json()) as { error?: string };
        if (j.error) msg = j.error;
      } catch {
        /* 非 JSON 响应：保留状态码文案 */
      }
      onTick({ error: msg });
      return;
    }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          onTick(JSON.parse(line) as LineScanTick);
        } catch {
          /* 半行/坏行：忽略 */
        }
      }
    }
    if (buf.trim()) {
      try {
        onTick(JSON.parse(buf) as LineScanTick);
      } catch {
        /* 尾部残行：忽略 */
      }
    }
  },
  /** 项目代码统计：流式 NDJSON（进度 → done 结果树 + 总行数）。
   *  whole=true 统计整个项目（含仓库根目录下的文件）；否则按 dirs 里的仓库相对路径统计。 */
  codeStats: async (
    dirs: string[],
    whole: boolean,
    codeOnly: boolean,
    onTick: (tick: CodeStatsTick) => void,
    signal?: AbortSignal
  ): Promise<void> => {
    const q = new URLSearchParams();
    for (const d of dirs) q.append('dirs', d);
    if (whole) q.set('whole', '1');
    if (codeOnly) q.set('codeOnly', '1');
    const res = await fetch(`/api/code-stats?${q.toString()}`, { signal });
    if (!res.ok || !res.body) {
      let msg = `HTTP ${res.status}`;
      try {
        const j = (await res.json()) as { error?: string };
        if (j.error) msg = j.error;
      } catch {
        /* 非 JSON 响应：保留状态码文案 */
      }
      onTick({ error: msg });
      return;
    }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          onTick(JSON.parse(line) as CodeStatsTick);
        } catch {
          /* 半行/坏行：忽略 */
        }
      }
    }
    if (buf.trim()) {
      try {
        onTick(JSON.parse(buf) as CodeStatsTick);
      } catch {
        /* 尾部残行：忽略 */
      }
    }
  },
  ignoreRules: (path: string) =>
    api<{ rules: string[]; sources?: { pattern: string; where: string }[] }>(`/api/ignore?path=${encodeURIComponent(path)}`),
  /** 忽略预案（仅 svn）：规则最终写到哪个目录、内容是什么 —— 弹窗确认前如实展示 */
  ignorePlan: (path: string) =>
    api<{ target: string; rule: string; degraded: boolean }>(`/api/ignore-plan?path=${encodeURIComponent(path)}`),
  /** 「谁忽略了我」（仅 svn）：本目录无规则却被上层规则忽略时，指出规则在哪一层 */
  ignoreSource: (path: string) =>
    api<{ source: { dir: string; rule: string } | null }>(`/api/ignore-source?path=${encodeURIComponent(path)}`),
  /** 模块索引（md 文件说明注入）：全仓库作用目录→条目；preview=注入前解析预览 */
  moduleIndex: () =>
    api<{ indexes: Record<string, { md: string; entries: { path: string; desc: string }[] }> }>('/api/module-index'),
  moduleIndexPreview: (dir: string, md: string) =>
    api<{ entries: { path: string; desc: string }[] }>(
      `/api/module-index/preview?dir=${encodeURIComponent(dir)}&md=${encodeURIComponent(md)}`,
    ),
};

export const postFilesystem = {
  /** 模块索引注入/更新（included：勾选保留的 path 清单，null/缺省=全保留）；clear=清除作用目录注入 */
  moduleIndexSet: (dir: string, md: string, included: string[] | null) =>
    api<{ ok: boolean; count: number }>('/api/module-index', json({ dir, md, included })),
  moduleIndexClear: (dir: string) => api<{ ok: boolean }>('/api/module-index/clear', json({ dir })),
  add: (paths: string[]) => api<VcsResult>('/api/add', json({ paths })),
  revert: (paths: string[]) => api<VcsResult>('/api/revert', json({ paths })),
  /** 还原到指定历史版本（git checkout REV -- path / svn cat -r REV 写回工作区） */
  restoreVersion: (path: string, rev: string) => api<VcsResult>('/api/restore-version', json({ path, rev })),
  /** 还原前预检：目标版本与当前工作区是否一致、差多少（只读） */
  restorePreview: (path: string, rev: string) =>
    api<VcsResult & { preview?: RestorePreview }>('/api/restore-preview', json({ path, rev })),
  delete: (paths: string[], keep = false) => api<VcsResult>('/api/delete', json({ paths, keep })),
  /** 移到回收站；force=true 跳过回收站直接删（仅用于「回收站不可用」弹窗里用户确认后的重发） */
  fsDelete: (paths: string[], force = false) => api<VcsResult>('/api/fs-delete', json({ paths, force })),
  /** 版本化文件/目录重命名/移动（svn move / git mv，提交后生效） */
  move: (from: string, to: string) => api<VcsResult>('/api/move', json({ from, to })),
  /** 未版本化 ? / 忽略 I 文件/目录磁盘改名（不影响版本库） */
  fsMove: (from: string, to: string) => api<VcsResult>('/api/fs-move', json({ from, to })),
  resolveConflict: (path: string, mode: 'ours' | 'theirs' | 'manual', content = '') =>
    api<VcsResult>('/api/resolve-conflict', json({ path, mode, content })),
  textDiff: (left: string, right: string) => api<{ diff: string }>('/api/text-diff', json({ left, right })),
  reveal: (path: string) => api<{ ok: boolean }>('/api/reveal', json({ path })),
  /** 在当前目录打开系统终端（Windows: Windows Terminal / cmd；Linux: 终端模拟器） */
  openTerminal: (path: string) => api<{ ok: boolean; message: string }>('/api/open-terminal', json({ path })),
  svnLock: (action: 'lock' | 'unlock', path: string, force = false) => api<VcsResult>('/api/svn-lock', json({ action, path, force })),
  /** 内联编辑保存：按目标文件原编码写回（后端两道守卫，详见 writeTextKeepEncoding） */
  writeFile: (path: string, content: string) => api<VcsResult>('/api/write-file', json({ path, content })),
  ignoreRemove: (path: string, pattern: string) => api<VcsResult>('/api/ignore-remove', json({ path, pattern })),
  /** 加入忽略：target=gitignore(默认，随仓库分发)/global(仅本机全部仓库)/exclude(仅本机本仓库) */
  ignore: (path: string, pattern: string, target: 'gitignore' | 'global' | 'exclude' = 'gitignore') =>
    api<VcsResult>('/api/ignore', json({ path, pattern, target })),
  unignore: (path: string) => api<VcsResult>('/api/unignore', json({ path })),
  mkdir: (path: string) => api<{ ok: boolean }>('/api/mkdir', json({ path })),
  /** 仓库内新建文件夹（path 相对仓库根，单级）——与上面那个系统级的 mkdir 是两回事 */
  newDir: (path: string) => api<{ ok: boolean; message?: string }>('/api/new-dir', json({ path })),
  /** 仓库内新建空文件（同 newDir，单级；已存在即失败，不覆盖） */
  newFile: (path: string) => api<{ ok: boolean; message?: string }>('/api/new-file', json({ path })),
  rename: (from: string, to: string) => api<{ ok: boolean }>('/api/rename', json({ from, to })),
  /** 用指定系统程序打开仓库内文件 */
  openWith: (path: string, exec: string) => api<{ ok: boolean; message: string }>('/api/open-with', json({ path, exec })),
  /** 用系统默认浏览器打开本地文件（html/svg/txt 等） */
  openInBrowser: (path: string) =>
    api<{ ok: boolean; message?: string; error?: string }>('/api/open-in-browser', json({ path })),
  /** 在系统外部终端窗口里运行脚本（.bat/.cmd/.sh，右键「终端运行」） */
  runScript: (path: string) => api<{ ok: boolean; message: string }>('/api/run-script', json({ path })),
  /** 拖入上传：冲突预检（只传相对路径列表，不传文件内容；先探路再决定怎么传） */
  uploadCheck: (dir: string, paths: string[]) => api<{ conflicts: string[] }>('/api/upload-check', json({ dir, paths })),
  /** 打包版拖入快路径：源已在磁盘上（Electron 拿到绝对路径），让后端 fs.cp 直接复制。
   *  不走 HTTP 传内容：大文件零拷贝、目录整树复制，且保留权限位（可执行位）与时间戳 */
  copyInto: (dir: string, src: string, rel: string, mode: 'overwrite' | 'rename' | 'skip') =>
    api<{ ok?: boolean; savedAs?: string; skipped?: boolean; message?: string; error?: string }>(
      '/api/copy-into',
      json({ dir, src, path: rel, mode }),
    ),
  /** 系统「另存为」对话框（Electron）：默认落在 startDir 并预填 name；纯 node/浏览器返回 unsupported */
  pickSaveFile: (startDir: string, name: string) =>
    api<{ path: string | null; unsupported: boolean }>('/api/pick-save-file', json({ startDir, name })),
  /** 把文本写到用户刚选的路径（宿主级写入：父目录必须已存在，目标不能是目录） */
  saveText: (path: string, content: string) =>
    api<{ ok: boolean; path?: string; error?: string }>('/api/save-text', json({ path, content })),
};

/** 上传单个文件（拖入用）：body 是原始字节，不能走 json() 封装，故单独一个函数。
 *  mode：overwrite 覆盖 / rename 自动改名（a.txt → a (1).txt）/ skip 跳过同名 */
export async function uploadFile(
  dir: string,
  rel: string,
  blob: Blob,
  mode: 'overwrite' | 'rename' | 'skip',
): Promise<{ ok?: boolean; savedAs?: string; skipped?: boolean; message?: string; error?: string }> {
  const qs = `dir=${encodeURIComponent(dir)}&path=${encodeURIComponent(rel)}&mode=${mode}`;
  const r = await fetch(`/api/upload?${qs}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: blob,
  });
  return (await r.json().catch(() => ({}))) as {
    ok?: boolean;
    savedAs?: string;
    skipped?: boolean;
    message?: string;
    error?: string;
  };
}
