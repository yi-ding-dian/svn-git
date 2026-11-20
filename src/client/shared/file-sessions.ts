/** 文件浏览会话与编辑草稿（localStorage）：
 *
 *  - sessions：切换项目时挂起的「刚才在看/编辑什么」（右侧悬浮胶囊），最多 10 个；
 *  - drafts：每个文件的未保存编辑内容，按「项目 + 文件」隔离，所有编辑自动保存；
 *  - active：当前预览的快照（切换项目前 capture，写入 sessions）；
 *  - pending：点胶囊后等待文件视图打开的目标（切项目重挂载时消费）。
 *
 *  只覆盖文件浏览预览（原文 / md 预览 / 编辑态）；diff、历史等视图不参与。
 */
export interface FileSession {
  /** 文件现场（默认）还是目录书签：目录点胶囊直接进入该目录，不打开文件 */
  kind?: 'file' | 'dir';
  /** 项目根（工作副本路径） */
  root: string;
  type: 'svn' | 'git';
  /** 文件相对路径 */
  rel: string;
  /** 文件名（胶囊显示用） */
  name: string;
  mode: 'raw' | 'md' | 'editing';
  /** 编辑/预览是否有未保存的草稿 */
  dirty?: boolean;
  /** 编辑光标所在行（1-based）；预览态用作跳转行 */
  line?: number;
  /** 预览容器的滚动位置 */
  scrollTop?: number;
  /** 挂起时文件列表所在的目录（相对仓库根）与列表滚动位置：恢复时一起还原 */
  listDir?: string;
  listScroll?: number;
  /** 挂起时间（排序/淘汰最旧用） */
  ts: number;
}

const SESS_KEY = 'svngit-file-sessions';
const DRAFT_PREFIX = 'svngit-file-draft:';
const MAX_SESSIONS = 10;
/** 草稿上限：localStorage 只有几 MB，超大文件（接近 InlineEditor 的编辑上限）不存 */
const MAX_DRAFT_CHARS = 1_000_000;

let sessions: FileSession[] | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const fn of listeners) fn();
}

function isSession(v: unknown): v is FileSession {
  const s = v as Partial<FileSession> | null;
  return (
    !!s &&
    typeof s.root === 'string' &&
    typeof s.rel === 'string' &&
    typeof s.name === 'string' &&
    (s.mode === 'raw' || s.mode === 'md' || s.mode === 'editing') &&
    typeof s.ts === 'number'
  );
}

/** 订阅会话列表（悬浮胶囊用）：add/remove 后触发重渲染 */
export function subscribeSessions(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function getSessions(): FileSession[] {
  if (sessions) return sessions;
  try {
    const raw = JSON.parse(localStorage.getItem(SESS_KEY) ?? '[]') as unknown;
    sessions = Array.isArray(raw) ? raw.filter(isSession) : [];
  } catch {
    sessions = [];
  }
  return sessions;
}

/** 挂起一个会话：同项目同文件只保留最新，最多 10 个（超出淘汰最旧） */
export function addSession(s: FileSession): void {
  const rest = getSessions().filter((x) => !(x.root === s.root && x.rel === s.rel));
  sessions = [s, ...rest].slice(0, MAX_SESSIONS);
  try {
    localStorage.setItem(SESS_KEY, JSON.stringify(sessions));
  } catch {
    /* 存储满/隐私模式：本次会话内仍生效 */
  }
  emit();
}

/** 删除会话（草稿按产品约定保留，下次打开文件仍可恢复） */
export function removeSession(root: string, rel: string): void {
  const next = getSessions().filter((x) => !(x.root === root && x.rel === rel));
  if (next.length === getSessions().length) return;
  sessions = next;
  try {
    localStorage.setItem(SESS_KEY, JSON.stringify(sessions));
  } catch {
    /* 同上 */
  }
  emit();
}

/** 草稿 key：JSON 编码避免 root/rel 里的分隔符撞车 */
const draftKey = (root: string, rel: string) => `${DRAFT_PREFIX}${JSON.stringify([root, rel])}`;

export function loadFileDraft(root: string, rel: string): string | null {
  try {
    return localStorage.getItem(draftKey(root, rel));
  } catch {
    return null;
  }
}

export function saveFileDraft(root: string, rel: string, text: string): void {
  if (text.length > MAX_DRAFT_CHARS) return; // 超大文件不占本地存储（编辑本身也有限制）
  try {
    localStorage.setItem(draftKey(root, rel), text);
  } catch {
    /* 存储满/隐私模式：草稿静默失效 */
  }
}

export function clearFileDraft(root: string, rel: string): void {
  try {
    localStorage.removeItem(draftKey(root, rel));
  } catch {
    /* 同上 */
  }
}

/** 当前预览快照（PreviewPane 随状态更新；切换项目前由 capture 取走） */
let active: FileSession | null = null;
export function setActiveSession(s: FileSession | null): void {
  active = s;
}
/** 局部更新活动快照（滚动位置等高频变化用，不触发渲染） */
export function patchActiveSession(patch: Partial<FileSession>): void {
  if (active) active = { ...active, ...patch };
}
export function captureActiveSession(): FileSession | null {
  if (!active) return null;
  // 带出该项目文件列表的浏览位置（目录 + 滚动），恢复时一起还原
  const pos = loadListPos(active.root);
  return { ...active, listDir: pos?.dir, listScroll: pos?.scrollTop };
}

/** 文件列表的浏览位置（按项目根）：切换项目/胶囊恢复时回到上次的目录与滚动 */
export interface ListPos {
  dir: string;
  scrollTop: number;
}

const listPosKey = (root: string) => `svngit-fs-pos:${root}`;

export function loadListPos(root: string): ListPos | null {
  try {
    const v = JSON.parse(localStorage.getItem(listPosKey(root)) ?? 'null') as Partial<ListPos> | null;
    return v && typeof v.dir === 'string' && typeof v.scrollTop === 'number'
      ? { dir: v.dir, scrollTop: v.scrollTop }
      : null;
  } catch {
    return null;
  }
}

export function saveListPos(root: string, pos: ListPos): void {
  try {
    localStorage.setItem(listPosKey(root), JSON.stringify(pos));
  } catch {
    /* 隐私模式等：本次会话内仍生效 */
  }
}

/** 点胶囊后待打开的文件：FsView 重挂载时消费（只消费一次） */
let pending: FileSession | null = null;
export function setPendingSession(s: FileSession | null): void {
  pending = s;
}
export function takePendingSession(): FileSession | null {
  const p = pending;
  pending = null;
  return p;
}

/** 同项目内恢复：不切项目、不重挂载 FsView，直接由文件视图监听事件打开 */
export const OPEN_SESSION_EVENT = 'svngit-open-session';
export function openSessionInPlace(s: FileSession): void {
  window.dispatchEvent(new CustomEvent<FileSession>(OPEN_SESSION_EVENT, { detail: s }));
}

/** 「打开所在目录」：切到该项目并进入文件所在目录、选中文件（不打开预览） */
export interface PendingDir {
  root: string;
  /** 文件所在目录（相对仓库根；根目录为空串） */
  dir: string;
  /** 要选中的文件（相对仓库根） */
  selectRel?: string;
}

let pendingDir: PendingDir | null = null;
export function setPendingDir(d: PendingDir | null): void {
  pendingDir = d;
}
export function takePendingDir(): PendingDir | null {
  const d = pendingDir;
  pendingDir = null;
  return d;
}

/** 同项目内直接打开目录（不切项目、不重挂载） */
export const OPEN_DIR_EVENT = 'svngit-open-dir';
export function openDirInPlace(d: PendingDir): void {
  window.dispatchEvent(new CustomEvent<PendingDir>(OPEN_DIR_EVENT, { detail: d }));
}
