/** 常用目录预加载引擎：BFS + 并发 6 + 代际停止（仓库切换时在飞的 worker 立即作废，不污染新仓库缓存）。
 *  从 FsView 抽出（原 fileSystem/index.tsx:230-288 与切仓库重置 360-363）。
 *  本 hook 只负责调度，拉到的数据通过 onLoaded 交给调用方落地（不持有目录缓存）。
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
const PRELOAD_MAX_QUEUE = 300;
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

  /** 预加载目录（BFS + 并发 6，结果写入调用方缓存，之后进入秒开） */
  const preloadDir = useCallback((rootRel: string) => {
    const queue = queueRef.current;
    if (!seenRef.current.has(rootRel)) {
      seenRef.current.add(rootRel);
      queue.push({ rel: rootRel, depth: 0 });
    }
    if (runningRef.current) return; // 已在预加载中，新目录并入队列
    runningRef.current = true;
    const gen = genRef.current;
    let done = 0;
    setPreload({ done: 0, total: 1, cur: rootRel, running: true });
    const worker = async () => {
      while (queue.length) {
        if (genRef.current !== gen) return; // 仓库已切换，停止
        const cur = queue.shift()!;
        const d = cur.rel;
        try {
          const r = await get.fs(d, false);
          onLoadedRef.current(d, r);
          // 只继续一层：产物目录跳过 + 深度限制 + 队列上限
          if (cur.depth < PRELOAD_MAX_DEPTH) {
            for (const e of r.entries ?? []) {
              if (e.isDir && !PRELOAD_SKIP.has(e.name)) {
                const sub = d ? `${d}/${e.name}` : e.name;
                if (!seenRef.current.has(sub) && queue.length < PRELOAD_MAX_QUEUE) {
                  seenRef.current.add(sub);
                  queue.push({ rel: sub, depth: cur.depth + 1 });
                }
              }
            }
          }
        } catch {
          /* 单目录失败不阻断其余 */
        }
        done++;
        setPreload({ done, total: done + queue.length, cur: d, running: true });
      }
    };
    void Promise.all(Array.from({ length: PRELOAD_CONCURRENCY }, () => worker())).then(() => {
      runningRef.current = false;
      setPreload((p) => (p ? { ...p, running: false } : null));
      setTimeout(() => setPreload(null), PRELOAD_DONE_LINGER);
    });
  }, []);

  /** 仓库切换时调用：让在飞的 worker 立即作废，并清空队列/已见集合（避免污染新仓库缓存） */
  const resetPreload = useCallback(() => {
    genRef.current++;
    queueRef.current = [];
    seenRef.current = new Set();
    runningRef.current = false;
  }, []);

  return { preload, preloadDir, resetPreload };
}
