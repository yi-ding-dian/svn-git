/** 文件搬运：把文件/目录弄进当前仓库（拖入上传 + 剪贴板复制剪切粘贴）。
 *
 *  两件事共用同一套「冲突预检 → 问策略 → 逐个执行」流程（覆盖 / 改名 / 跳过），
 *  所以放在一个模块里：策略语义天然一致，弹窗也只有一个（UploadConflictModal）。
 *  拆成两个文件会让「冲突怎么处理」有两份实现，早晚走样。
 *
 *  - 拖入上传：浏览器拖入只给 File 对象，拿不到原始绝对路径（Chrome 早已移除 File.path；
 *    Electron 的 webUtils.getPathForFile 只在打包版可用）→ 读取内容走 /api/upload 流式落盘。
 *    打包版能拿到路径时走 /api/copy-into 快路径（零拷贝、整树、保留权限位）。
 *  - 剪贴板：仓库内搬运。**移动一律走 svn move / git mv** —— 让用户去系统文件管理器拖，
 *    工作副本会变成「原路径 missing + 新路径 unversioned」的脏状态，还得手动收拾，重命名历史也断了。
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { post, uploadFile } from '../shared/api.js';

// ============================ 拖入上传 ============================

export interface DropItem {
  file: File;
  /** 相对目标目录的路径（含子目录），直接作为 path 传给上传/复制接口 */
  path: string;
  /** 源文件在磁盘上的绝对路径（仅 Electron 打包版有）：有它就走复制快路径，不经 HTTP 传内容 */
  srcPath?: string;
}

export type ConflictMode = 'overwrite' | 'rename' | 'skip';

/** 冲突弹窗的选择：整批策略 + **逐个指定的新名字**（用户在弹窗里直接改的那种）。
 *  改名不用后端支持——上传/复制的目标名字本来就是请求参数里的相对路径。 */
export interface ConflictChoice {
  mode: ConflictMode;
  /** 原名 → 用户改后的新名（只含被改过的项）；mode='rename' 时生效 */
  renames?: Record<string, string>;
}

/** readEntries 一次最多返回 100 条：必须循环读到空，否则大目录会漏文件 */
function readAllEntries(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  return new Promise((resolve, reject) => {
    const acc: FileSystemEntry[] = [];
    const step = () =>
      reader.readEntries((batch) => {
        if (batch.length === 0) resolve(acc);
        else {
          acc.push(...batch);
          step();
        }
      }, reject);
    step();
  });
}

async function walk(entry: FileSystemEntry, prefix: string, out: DropItem[]): Promise<void> {
  if (entry.isFile) {
    const file = await new Promise<File>((res, rej) => (entry as FileSystemFileEntry).file(res, rej));
    out.push({ file, path: prefix + entry.name });
    return;
  }
  if (entry.isDirectory) {
    const entries = await readAllEntries((entry as FileSystemDirectoryEntry).createReader());
    for (const e of entries) await walk(e, `${prefix}${entry.name}/`, out);
  }
}

/** 收集拖入的条目。
 *  打包版：顶层条目都能拿到绝对路径 → 只收顶层、目录不展开，交给后端整树复制
 *  （几百个文件也只有一个请求）；浏览器版拿不到路径，必须递归读出每个文件内容走上传。 */
async function collectItems(dt: DataTransfer): Promise<DropItem[]> {
  const getPath = pathGetter();
  if (getPath) {
    const tops: DropItem[] = [];
    for (const f of Array.from(dt.files)) {
      const p = getPath(f);
      if (p) tops.push({ file: f, path: f.name, srcPath: p });
    }
    if (tops.length > 0 && tops.length === dt.files.length) return tops; // 全都拿到路径才走快路径
  }
  const entries: FileSystemEntry[] = [];
  for (const it of dt.items ? Array.from(dt.items) : []) {
    if (it.kind !== 'file') continue;
    const e = it.webkitGetAsEntry?.();
    if (e) entries.push(e);
  }
  const out: DropItem[] = [];
  if (entries.length > 0) {
    for (const e of entries) await walk(e, '', out);
    return out;
  }
  for (const f of Array.from(dt.files)) out.push({ file: f, path: f.name }); // Firefox 等：拿不到目录，只能传扁平文件
  return out;
}

const hasFiles = (dt: DataTransfer | null): boolean => !!dt && Array.from(dt.types).includes('Files');

/** Electron 打包版的「按 File 取绝对路径」能力（preload 注入）；浏览器版没有 → undefined */
function pathGetter(): ((f: File) => string | null) | undefined {
  const el = window as unknown as { svngit?: { getPathForFile: (f: File) => string | null } };
  return el.svngit?.getPathForFile;
}

export function useDropUpload(opts: {
  /** 当前浏览的相对目录（'' = 仓库根）：拖到文件区的落点 */
  dir: string;
  /** 有冲突时问用户选策略（可顺带逐个改名）；返回 null = 取消整批 */
  askConflict: (conflicts: string[]) => Promise<ConflictChoice | null>;
  /** 一批传完回调：成功数 + 失败清单 + 成功落盘的「相对仓库根路径」（调用方据此刷新列表、选中并定位） */
  onDone: (okCount: number, failed: string[], saved: string[]) => void;
  /** 项目内拖拽落到目录上时调用（`null` = 没落在任何目录上，松开等于取消）。
   *  拖的是哪些条目由调用方自己记着——拖拽期间浏览器的安全限制读不到 dataTransfer 的内容。 */
  onMoveDrop?: (destDir: string | null) => void;
}) {
  const { dir, askConflict, onDone, onMoveDrop } = opts;
  const [dragging, setDragging] = useState(false); // 外部文件悬停中（显示"松开即复制到…"横幅）
  const [hoverDir, setHoverDir] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const busy = useRef(false);

  // 拦住浏览器默认的「拖入即用文件替换当前页面」——拖到文件区以外也不该把界面冲掉。
  // 这里只阻止默认行为、不接管投放，真正接受文件的仍只有文件区。
  useEffect(() => {
    const stop = (e: DragEvent) => e.preventDefault();
    window.addEventListener('dragover', stop);
    window.addEventListener('drop', stop);
    return () => {
      window.removeEventListener('dragover', stop);
      window.removeEventListener('drop', stop);
    };
  }, []);

  const run = useCallback(
    async (items: DropItem[], targetDir: string) => {
      if (items.length === 0) return;
      if (busy.current) return; // 上一批还在传：忽略重复拖放
      busy.current = true;
      try {
        // 先探路：把冲突挑出来问用户，避免内容白传一遍
        const { conflicts } = await post.uploadCheck(targetDir, items.map((i) => i.path));
        let choice: ConflictChoice = { mode: 'overwrite' }; // 无冲突时 mode 不生效（目标不存在，走不到冲突分支）
        if (conflicts.length > 0) {
          const chosen = await askConflict(conflicts);
          if (!chosen) return; // 用户取消整批
          choice = chosen;
        }
        const failed: string[] = [];
        const saved: string[] = []; // 成功落盘的相对仓库根路径（savedAs），供调用方选中定位
        let okCount = 0;
        setProgress({ done: 0, total: items.length });
        // 逐个传：单个失败不中断整批，最后汇总（回滚已传文件反而更让人意外）
        for (let i = 0; i < items.length; i++) {
          const it = items[i]!;
          try {
            // 用户在弹窗里给这一项改了名字 → 按新名字落盘（改名即改请求里的相对路径）
            const rel = choice.renames?.[it.path] ?? it.path;
            // 有源路径（打包版）就走复制：不传内容，顺带保留权限位与时间戳
            const r = it.srcPath
              ? await post.copyInto(targetDir, it.srcPath, rel, choice.mode)
              : await uploadFile(targetDir, rel, it.file, choice.mode);
            if (r.ok) {
              okCount++;
              if (r.savedAs) saved.push(r.savedAs); // rename/skip 模式下是最终落点，不是拖入时的名字
            } else failed.push(`${it.path}${r.error ? `：${r.error}` : ''}`);
          } catch (e) {
            failed.push(`${it.path}：${(e as Error).message}`);
          }
          setProgress({ done: i + 1, total: items.length });
        }
        onDone(okCount, failed, saved);
      } catch (e) {
        onDone(0, [`预检失败：${(e as Error).message}`], []);
      } finally {
        setProgress(null);
        busy.current = false;
      }
    },
    [askConflict, onDone],
  );

  /** 从事件目标向上找最近的文件夹投放点：行/格子带 data-dir-rel。
   *  走事件委托而不是给每个行挂 handler——三种视图（网格/列表/树）共用一份拖放逻辑。 */
  const dirTargetOf = (e: React.DragEvent): string | null => {
    const el = (e.target as HTMLElement | null)?.closest?.('[data-dir-rel]') as HTMLElement | null;
    return el?.dataset.dirRel ?? null;
  };

  /** 文件区容器拖放属性：落在文件夹行/格子上 → 放进该文件夹；否则 → 当前浏览目录。
   *  同一套落点判定同时服务两种拖放：**外部文件拖入**（复制进来）与**项目内拖拽**（移动过去），
   *  用 MIME 标记区分——外部拖的是 'Files'，内部拖的是 MOVE_MIME。 */
  const fileAreaProps = {
    onDragOver: (e: React.DragEvent) => {
      const internal = isInternalDrag(e.dataTransfer);
      if (!internal && !hasFiles(e.dataTransfer)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = internal ? 'move' : 'copy';
      const target = dirTargetOf(e);
      setHoverDir(target);
      // 内部拖拽不弹"松开即复制到…"横幅：落点已由目标行高亮表达，再说一句反而吵
      if (!internal) setDragging(target === null); // 悬在文件夹上时由该行高亮，容器不再描边
    },
    onDragLeave: (e: React.DragEvent) => {
      // 在子元素之间移动也会触发 dragleave：仍停在容器内就不取消高亮
      if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
      setDragging(false);
      setHoverDir(null);
    },
    onDrop: (e: React.DragEvent) => {
      const internal = isInternalDrag(e.dataTransfer);
      if (!internal && !hasFiles(e.dataTransfer)) return;
      e.preventDefault();
      const target = dirTargetOf(e);
      setDragging(false);
      setHoverDir(null);
      if (internal) {
        // 内部拖拽**只有落在目录上才生效**：落空白处/文件行上不猜意图，交给调用方给个说法
        onMoveDrop?.(target);
        return;
      }
      void collectItems(e.dataTransfer).then((items) => run(items, target ?? dir));
    },
  };

  return { dragging, hoverDir, progress, fileAreaProps };
}

// ======================= 剪贴板（复制 / 剪切 / 粘贴） =======================

export interface ClipItem {
  /** 相对仓库根 */
  rel: string;
  name: string;
  isDir: boolean;
  /** 状态码：? / I 是未版本化（移动走 fs-move），其余已纳入版本控制（走 move） */
  code: string;
}

export interface Clip {
  mode: 'copy' | 'cut';
  items: ClipItem[];
  /** 入剪贴板时的仓库根：粘到别的项目时 rel 不再有意义，直接作废 */
  repoRoot: string;
}

/** 未版本化条目（版本库不认识它，只能纯文件系统搬） */
const isUnversioned = (code: string): boolean => code === '?' || code === 'I';

/** 应用内拖拽移动的 MIME 标记：用来和「外部文件拖入」（types 里是 'Files'）区分开。
 *  值本身在 dragover 阶段读不到（浏览器安全限制），只用它的**存在**做类型判断。 */
export const MOVE_MIME = 'application/x-svngit-move';

/** 这次拖放是「项目内的条目移动」吗（与外部文件拖入二选一） */
export const isInternalDrag = (dt: DataTransfer | null): boolean => !!dt && Array.from(dt.types).includes(MOVE_MIME);

/** moveItemsTo 的结果：ok=搬完了；noop=条目本来就在目标目录；blocked=有冲突/失败，什么都没动 */
export type MoveOutcome = 'ok' | 'noop' | 'blocked';

/**
 * 把条目移动到目标目录 —— **剪贴板剪切粘贴与应用内拖拽共用这一套规则**：
 *  - 版本化条目走 svn move / git mv（**保留文件历史**，不是"删了再添"）
 *  - 未版本化（? / I）版本库本来就不认识它，只能纯磁盘移动
 *  - 目标已存在同名 → 一律拒绝并说明：svn move 到已存在的路径本就失败，也不该替用户覆盖
 */
export async function moveItemsTo(
  items: ClipItem[],
  dest: string,
  onToast: (m: string, err?: boolean) => void,
): Promise<MoveOutcome> {
  const toRel = (name: string): string => (dest ? `${dest}/${name}` : name);
  // 已经在目标目录里的（如全选后原地粘贴/拖回原处）：不算失败，但也无事可做
  const moving = items.filter((i) => toRel(i.name) !== i.rel);
  if (moving.length === 0) {
    onToast('这些条目已经在目标目录里了');
    return 'noop';
  }
  const { conflicts } = await post.uploadCheck(dest, moving.map((i) => i.name));
  if (conflicts.length > 0) {
    onToast(
      `目标已存在同名：${conflicts.slice(0, 3).join('、')}${conflicts.length > 3 ? ' 等' : ''}，请先改名或删除后再移动`,
      true,
    );
    return 'blocked';
  }
  const failed: string[] = [];
  let ok = 0;
  for (const it of moving) {
    try {
      // 未版本化条目版本库不认识，只能纯文件系统搬（与「重命名」的分流规则一致）
      const r = isUnversioned(it.code)
        ? await post.fsMove(it.rel, toRel(it.name))
        : await post.move(it.rel, toRel(it.name));
      if (r.ok) ok++;
      else failed.push(`${it.name}${r.message ? `：${r.message}` : ''}`);
    } catch (e) {
      failed.push(`${it.name}：${(e as Error).message}`);
    }
  }
  onToast(
    failed.length === 0
      ? `已移动 ${ok} 项到 ${dest || '仓库根目录'}`
      : `移动完成 ${ok} 项，失败 ${failed.length} 项：${failed.slice(0, 2).join('；')}`,
    failed.length > 0,
  );
  return failed.length > 0 ? 'blocked' : 'ok';
}

export function useCopyPaste(opts: {
  /** 当前浏览的相对目录（'' = 仓库根）：Ctrl+V / 空白处「粘贴」的落点 */
  dir: string;
  /** 仓库根绝对路径（/api/copy-into 要源文件的绝对路径） */
  repoRoot: string;
  /** 有同名冲突时问用户选策略（可顺带逐个改名，与拖入上传共用同一个弹窗）；返回 null = 取消 */
  askConflict: (conflicts: string[]) => Promise<ConflictChoice | null>;
  onToast: (m: string, err?: boolean) => void;
  /** 搬运完成后刷新当前目录 */
  onDone: () => void;
}) {
  const [clip, setClip] = useState<Clip | null>(null);
  const busy = useRef(false); // 粘贴进行中：忽略重复触发（连按 Ctrl+V）
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const clipRef = useRef(clip);
  clipRef.current = clip;

  /** 入剪贴板（复制 / 剪切）。只收条目，不做任何磁盘操作 —— 真正的动作在粘贴时发生。 */
  const take = (mode: 'copy' | 'cut', items: ClipItem[]) => {
    if (items.length === 0) {
      optsRef.current.onToast('没有可搬运的条目：先在文件/目录上单击选中（Ctrl 可多选），再复制或剪切', true);
      return;
    }
    setClip({ mode, items, repoRoot: optsRef.current.repoRoot });
    const n = items.length;
    optsRef.current.onToast(
      mode === 'copy' ? `已复制 ${n} 项，到目标目录按 Ctrl+V 粘贴` : `已剪切 ${n} 项，到目标目录按 Ctrl+V 粘贴`,
    );
  };

  /** 粘贴到 destDir（缺省 = 当前浏览目录） */
  const paste = useCallback(async (destDirArg?: string) => {
    const c = clipRef.current;
    if (!c || busy.current) return;
    const { dir, repoRoot, onToast, onDone, askConflict } = optsRef.current;
    if (c.repoRoot !== repoRoot) {
      setClip(null);
      onToast('剪贴板来自另一个项目，已清空（路径对不上）', true);
      return;
    }
    const dest = destDirArg ?? dir;
    const absOf = (rel: string): string => (repoRoot ? `${repoRoot}/${rel}` : rel);

    busy.current = true;
    try {
      if (c.mode === 'cut') {
        // 移动规则见 moveItemsTo（与应用内拖拽共用同一套）
        const outcome = await moveItemsTo(c.items, dest, onToast);
        // 搬完/本就在原位都算这一轮结束；被冲突挡下则保留剪贴板，用户改完能直接再粘
        if (outcome !== 'blocked') setClip(null);
        if (outcome === 'ok') onDone();
        return;
      }

      // ---------- 复制 ----------
      const { conflicts } = await post.uploadCheck(dest, c.items.map((i) => i.name));
      let choice: ConflictChoice = { mode: 'rename' };
      if (conflicts.length > 0) {
        const chosen = await askConflict(conflicts);
        if (!chosen) return; // 用户取消整批（保留剪贴板）
        choice = chosen;
      }
      const isConflict = (name: string): boolean => conflicts.includes(name);
      const failed: string[] = [];
      /** 复制出来的**新**路径（供自动加入版本库） */
      const fresh: string[] = [];
      for (const it of c.items) {
        try {
          // 用户在弹窗里给这一项改了名字 → 按新名字放入
          const rel = choice.renames?.[it.name] ?? it.name;
          const r = await post.copyInto(dest, absOf(it.rel), rel, choice.mode);
          if (!r.ok) {
            failed.push(`${it.name}${r.error ? `：${r.error}` : ''}`);
            continue;
          }
          // 覆盖模式下覆盖的是已存在的文件，不算新条目；改名/无冲突产生的才是新的
          const isFresh = !isConflict(it.name) || choice.mode === 'rename';
          // 源本来就在版本库里 → 副本也该进版本库（源是 ? / I 的说明用户还没打算管它）
          if (isFresh && r.savedAs && !isUnversioned(it.code)) fresh.push(r.savedAs);
        } catch (e) {
          failed.push(`${it.name}：${(e as Error).message}`);
        }
      }
      // 自动 add：不然复制进来的只是一堆 ?，用户还得再点一次「添加到版本库」
      let addedCount = 0;
      if (fresh.length > 0) {
        try {
          const r = await post.add(fresh);
          if (r.ok) addedCount = fresh.length;
        } catch {
          /* 添加失败不阻断：文件已复制成功，用户可以手动加 */
        }
      }
      const okCount = c.items.length - failed.length;
      let msg = `已复制 ${okCount} 项到 ${dest || '仓库根目录'}`;
      if (failed.length > 0) msg += `，失败 ${failed.length} 项：${failed.slice(0, 2).join('；')}`;
      else if (addedCount > 0) msg += '，已加入版本库';
      else if (fresh.length === 0) msg += '（源未纳入版本控制，副本保持未版本化）';
      onToast(msg, failed.length > 0);
      onDone();
    } catch (e) {
      onToast(`粘贴失败：${(e as Error).message}`, true);
    } finally {
      busy.current = false;
    }
  }, []);

  return { clip, take, paste };
}
