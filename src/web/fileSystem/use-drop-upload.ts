/** 拖入上传：拖放事件 → 递归收集条目 → 冲突预检 → 逐个上传。
 *
 *  为什么走上传而不是「拿路径让后端自己复制」：浏览器拖入只给 File 对象，拿不到原始绝对路径
 *  （Chrome 早已移除 File.path；Electron 的 webUtils.getPathForFile 只在打包版可用）。
 *  所以读取内容 → POST /api/upload 流式落盘，用户看到的效果一样，大文件走一次本地回环。
 *
 *  目录结构保留在条目相对路径里：拖入 foo/bar/a.txt → <目标目录>/foo/bar/a.txt。
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { post, uploadFile } from '../api.js';

export interface DropItem {
  file: File;
  /** 相对目标目录的路径（含子目录），直接作为 path 传给上传/复制接口 */
  path: string;
  /** 源文件在磁盘上的绝对路径（仅 Electron 打包版有）：有它就走复制快路径，不经 HTTP 传内容 */
  srcPath?: string;
}

export type ConflictMode = 'overwrite' | 'rename' | 'skip';

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
  /** 有冲突时问用户选策略；返回 null = 取消整批 */
  askConflict: (conflicts: string[]) => Promise<ConflictMode | null>;
  /** 一批传完回调：成功数 + 失败清单 + 成功落盘的「相对仓库根路径」（调用方据此刷新列表、选中并定位） */
  onDone: (okCount: number, failed: string[], saved: string[]) => void;
}) {
  const { dir, askConflict, onDone } = opts;
  const [dragging, setDragging] = useState(false);
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
        let mode: ConflictMode = 'overwrite'; // 无冲突时 mode 不生效（目标不存在，走不到冲突分支）
        if (conflicts.length > 0) {
          const chosen = await askConflict(conflicts);
          if (!chosen) return; // 用户取消整批
          mode = chosen;
        }
        const failed: string[] = [];
        const saved: string[] = []; // 成功落盘的相对仓库根路径（savedAs），供调用方选中定位
        let okCount = 0;
        setProgress({ done: 0, total: items.length });
        // 逐个传：单个失败不中断整批，最后汇总（回滚已传文件反而更让人意外）
        for (let i = 0; i < items.length; i++) {
          const it = items[i]!;
          try {
            // 有源路径（打包版）就走复制：不传内容，顺带保留权限位与时间戳
            const r = it.srcPath
              ? await post.copyInto(targetDir, it.srcPath, it.path, mode)
              : await uploadFile(targetDir, it.path, it.file, mode);
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

  /** 文件区容器拖放属性：落在文件夹行/格子上 → 放进该文件夹；否则 → 当前浏览目录 */
  const fileAreaProps = {
    onDragOver: (e: React.DragEvent) => {
      if (!hasFiles(e.dataTransfer)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      const target = dirTargetOf(e);
      setHoverDir(target);
      setDragging(target === null); // 悬在文件夹上时由该行高亮，容器不再描边
    },
    onDragLeave: (e: React.DragEvent) => {
      // 在子元素之间移动也会触发 dragleave：仍停在容器内就不取消高亮
      if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
      setDragging(false);
      setHoverDir(null);
    },
    onDrop: (e: React.DragEvent) => {
      if (!hasFiles(e.dataTransfer)) return;
      e.preventDefault();
      const target = dirTargetOf(e);
      setDragging(false);
      setHoverDir(null);
      void collectItems(e.dataTransfer).then((items) => run(items, target ?? dir));
    },
  };

  return { dragging, hoverDir, progress, fileAreaProps };
}
