/** 常用目录预加载引擎：BFS + 并发 6 + 代际停止（仓库切换时在飞的 worker 立即作废，不污染新仓库缓存）。
 *  从 FsView 抽出（原 fileSystem/index.tsx:230-288 与切仓库重置 360-363）。
 *  本 hook 只负责调度，拉到的数据通过 onLoaded 交给调用方落地（不持有目录缓存）。
 *
 *  preloadDir：常用文件夹预加载（自身 + 一层子目录），带进度条。
 *  prefetchChildren：进入目录后静默预取它的直接子目录（不查 SVN 状态），
 *  解决「预加载过的目录再往里点仍转圈」——已见集合只包含常用目录那一层，
 *  子目录的下一层要靠这个入口继续铺。
 */
import { useCallback, useRef, useState } from 'react';
import { get, type FsData } from '../shared/api.js';

export interface PreloadState {
  done: number;
  total: number;
  cur: string;
  running: boolean;
}

/** 跳过已知产物/大目录（build/bin/CMakeFiles 等，省时也无"秒开"价值；树模式点击仍懒加载） */
const PRELOAD_SKIP = new Set([
  'build',
  'bin',
  'CMakeFiles',
  'out',
  'dist',
  'node_modules',
  'vendor',
  '.svn',
  '.git',
  'third_party',
  'thirdparty',
]);
/** 队列上限与递归深度：只预拉自身 + 一层子目录（防止大仓库整树递归，如 5639 目录 ×0.65s） */
const PRELOAD_MAX_QUEUE = 500;
const PRELOAD_MAX_DEPTH = 1;
/** 并发度 */
const PRELOAD_CONCURRENCY = 6;
/** 完成后进度条停留时长（ms） */
const PRELOAD_DONE_LINGER = 2500;

export function useDirPreload(onLoaded: (dir: string, data: FsData) => void) {
  const [preload, setPreload] = useState<PreloadState | null>(null);
  const queueRef = useRef<{ rel: string; depth: number }[]>([]);
  const seenRef = useRef<Set<string>>(new Set());
  const genRef = useRef(0);
  const runningRef = useRef(false);
  /** 回调存 ref：调用方不必为它包 useCallback，也不会因它变化重建 preloadDir */
  const onLoadedRef = useRef(onLoaded);
  onLoadedRef.current = onLoaded;

  /** 启动 worker 消费队列；已在运行则直接返回，新目录并入现有队列 */
  const startWorkers = useCallback((silent: boolean) => {
    if (runningRef.current) return;
    runningRef.current = true;
    const gen = genRef.current;
    let done = 0;
    if (!silent) {
      setPreload({
        done: 0,
        total: queueRef.current.length,
        cur: queueRef.current[0]?.rel ?? '',
        running: true,
      });
    }
    const worker = async () => {
      while (queueRef.current.length) {
        if (genRef.current !== gen) return; // 仓库已切换，停止
        const cur = queueRef.current.shift()!;
        const d = cur.rel;
        try {
          // light：只读磁盘目录结构，不查 SVN/Git 状态（状态在真正进入目录时补）
          const r = await get.fs(d, false, true);
          onLoadedRef.current(d, r);
          // 只继续一层：产物目录跳过 + 深度限制 + 队列上限
          if (cur.depth < PRELOAD_MAX_DEPTH) {
            for (const e of r.entries ?? []) {
              if (e.isDir && !PRELOAD_SKIP.has(e.name)) {
                const sub = d ? `${d}/${e.name}` : e.name;
                if (!seenRef.current.has(sub) && queueRef.current.length < PRELOAD_MAX_QUEUE) {
                  seenRef.current.add(sub);
                  queueRef.current.push({ rel: sub, depth: cur.depth + 1 });
                }
              }
            }
          }
        } catch {
          /* 单目录失败不阻断其余 */
        }
        done++;
        if (!silent) {
          setPreload({ done, total: done + queueRef.current.length, cur: d, running: true });
        }
      }
    };
    void Promise.all(Array.from({ length: PRELOAD_CONCURRENCY }, () => worker())).then(() => {
      runningRef.current = false;
      if (!silent) {
        setPreload((p) => (p ? { ...p, running: false } : null));
        setTimeout(() => setPreload(null), PRELOAD_DONE_LINGER);
      }
    });
  }, []);

  /** 常用文件夹预加载（自身 + 一层子目录，带进度条）。
   *  force=true：把该目录及子树从「已见」和待办队列里移除后重新入队（「重新预加载」用）。 */
  const preloadDir = useCallback(
    (rootRel: string, force = false, silent = false) => {
      const queue = queueRef.current;
      if (force) {
        for (const v of [...seenRef.current]) {
          if (v === rootRel || v.startsWith(rootRel + '/')) seenRef.current.delete(v);
        }
        for (let i = queue.length - 1; i >= 0; i--) {
          const q = queue[i].rel;
          if (q === rootRel || q.startsWith(rootRel + '/')) queue.splice(i, 1);
        }
      }
      if (!seenRef.current.has(rootRel)) {
        seenRef.current.add(rootRel);
        queue.push({ rel: rootRel, depth: 0 });
      }
      startWorkers(silent);
    },
    [startWorkers],
  );

  /** 进入目录后静默预取它的直接子目录（不查 SVN 状态）。
   *  和 preloadDir 的区别：不要求父目录未见过——父目录可能已被常用预加载标记，
   *  但它的子目录还没缓存，这里直接从当前 entries 入队下一层。 */
  const prefetchChildren = useCallback(
    (parentRel: string, entries: { name: string; isDir: boolean }[], silent = true) => {
      const queue = queueRef.current;
      for (const e of entries) {
        if (!e.isDir || PRELOAD_SKIP.has(e.name)) continue;
        const sub = parentRel ? `${parentRel}/${e.name}` : e.name;
        if (!seenRef.current.has(sub) && queue.length < PRELOAD_MAX_QUEUE) {
          seenRef.current.add(sub);
          queue.push({ rel: sub, depth: 1 });
        }
      }
      startWorkers(silent);
    },
    [startWorkers],
  );

  /** 仓库切换时调用：让在飞的 worker 立即作废，并清空队列/已见集合（避免污染新仓库缓存） */
  const resetPreload = useCallback(() => {
    genRef.current++;
    queueRef.current = [];
    seenRef.current = new Set();
    runningRef.current = false;
  }, []);

  return { preload, preloadDir, prefetchChildren, resetPreload };
}
