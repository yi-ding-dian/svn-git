/** FsView 的状态码聚合与刷新：从 index.tsx 原样抽出。
 *
 *  - refreshCodes：/api/fs-status → 把状态码写回 nodeData / data；deep 时把子树 M/A 聚合到直接子目录，
 *    并把当前目录自身的角标同步到父目录缓存。
 *  - scanCodes：两阶段加载的第二阶段（目录已显示、异步补状态），维护「正在补充文件状态…（已 N 秒）」。
 *
 *  数据容器（nodeData / data）由调用方持有，本 hook 只接收 setter；依赖数组与清理函数保持原样。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type React from 'react';
import { get, type FsData } from '../shared/api.js';

export function useFsStatus(opts: {
  setNodeData: React.Dispatch<React.SetStateAction<Map<string, FsData>>>;
  setData: React.Dispatch<React.SetStateAction<FsData | null>>;
}) {
  const { setNodeData, setData } = opts;
  /** 两阶段加载的第二阶段：目录已显示，正在异步补充状态标记（大仓库可能较慢）。
   *  sec = 已用秒数，让用户知道在干什么，而不是一直转圈。 */
  const [scanState, setScanState] = useState<{ dir: string; sec: number } | null>(null);
  const scanTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  /** 只让最新一次状态补充收起提示（快速切目录时旧扫描可能晚完成） */
  const scanSeqRef = useRef(0);

  /** 刷新当前目录状态：deep=true 查子树并把深层 M/A 聚合到直接子目录；
   *  false 只查直接子项（30 秒轮询）。只更新已有条目的 code，不清选择/预览。
   *  返回 Promise：两阶段加载要在状态补完后收起「正在补充文件状态」提示。 */
  const refreshCodes = useCallback((cur: string, deep = false) => {
    return get
      .fsStatus(cur, deep)
      .then((r) => {
        const codes = new Map<string, string>();
        /** 树冲突条目：light 数据里没有这个字段，横幅与 ⚠ 角标全靠第二阶段补上 */
        const conflicted = new Set<string>();
        /** 独立工作副本条目：父 WC 看不到它内部，状态用服务端按它自己的 WC 聚合的结果 */
        const nestedItems = new Map<string, { code: string; codes?: string[]; count?: number; nestedWc?: boolean }>();
        for (const it of r.items) {
          codes.set(it.path, it.code);
          if (it.treeConflicted) conflicted.add(it.path);
          if (it.nestedWc || it.codes || it.count !== undefined) nestedItems.set(it.path, it);
        }
        const CODES_ORDER = ['M', 'A', 'D', 'C', 'R', '!', 'U', '~'];
        const rank: Record<string, number> = { C: 10, '!': 9, D: 8, M: 7, A: 6, R: 5, '~': 4, U: 3 };
        /** 目录深聚合：状态码集合 + 变更项数。
         *  口径与 /api/fs 完整数据一致：子项未版本化 '?' 与外部引用 'X' 不计入数量；
         *  目录自身码（?/I/D 等）优先，内部操作码并入集合。 */
        const dirAgg = (rel: string, own?: string) => {
          const prefix = rel + '/';
          const ops = new Set<string>();
          let count = 0;
          for (const [p, c] of codes) {
            if (!p.startsWith(prefix)) continue;
            if (!c || c === ' ' || c === 'none' || c === '?' || c === 'X') continue;
            count++;
            ops.add(c);
          }
          // 目录自身码：? / I / X 是"目录整体"的标记，优先展示且不被子项升级；
          // 其余（M/A/D/C/R…）与子项操作一起参与最高码/集合。口径同 /api/fs 完整数据。
          const self = own && own !== ' ' && own !== 'none' ? own : '';
          const special = self === '?' || self === 'I' || self === 'X' ? self : '';
          if (self && !special) ops.add(self);
          let best = special;
          if (!special) {
            for (const c of ops) if ((rank[c] ?? -1) > (rank[best] ?? -1)) best = c;
          }
          const list = [...ops].sort((a, b) => CODES_ORDER.indexOf(a) - CODES_ORDER.indexOf(b));
          if (special === 'X' && !list.includes('X')) list.push('X');
          if ((special === '?' || special === 'I') && list.length === 0) list.push(special);
          return { code: best || undefined, codes: list.length ? list : undefined, count: count || undefined };
        };
        const sameList = (a?: string[], b?: string[]) =>
          a === b || (!!a && !!b && a.length === b.length && a.every((v, i) => v === b[i]));
        const apply = (d: FsData): FsData => {
          let changed = false;
          /** 当前目录整体未版本化（服务端 wc-root 查不到）：所有条目统一 ?。
           *  被忽略 I / 外部引用 X 保留；这是进入未版本化目录任意深度时唯一可靠的数据源。 */
          const selfMark = r.dirSelf;
          const entries = d.entries.map((e) => {
            if (selfMark) {
              if (e.code === 'I' || e.code === 'X') return e;
              if (e.code === selfMark && sameList(e.codes, [selfMark])) return e;
              changed = true;
              return { ...e, code: selfMark, codes: [selfMark], count: undefined };
            }
            const rel = cur ? `${cur}/${e.name}` : e.name;
            const own = codes.get(rel);
            const tc = conflicted.has(rel);
            if (deep && e.isDir) {
              // 独立工作副本：父 WC 看不到内部，直接用服务端按它自己 WC 聚合的 code/codes/count
              const ownItem = nestedItems.get(rel);
              if (ownItem?.nestedWc) {
                const nextTc = tc || e.treeConflicted || undefined;
                const nextCode = ownItem.code ?? '';
                const nextCodes = ownItem.codes;
                const nextCount = ownItem.count;
                if (
                  nextCode === (e.code ?? '') &&
                  sameList(nextCodes, e.codes) &&
                  nextCount === e.count &&
                  nextTc === e.treeConflicted &&
                  e.nestedWc
                ) {
                  return e;
                }
                changed = true;
                return { ...e, code: nextCode, codes: nextCodes, count: nextCount, treeConflicted: nextTc, nestedWc: true };
              }
              // 目录：整棵子树聚合（code + codes 集合 + 变更项数）
              const agg = dirAgg(rel, own);
              const nextTc = tc || e.treeConflicted || undefined;
              // 没有聚合结果，但完整数据给了"目录整体"的属性码（未版本化 ? / 忽略 I / 外部 X）：
              // 必须保留 —— fs-status 在未版本化目录内部只报目录自身，拿不到子项，
              // 无条件覆盖会把 ? 冲成空（显示成干净的 ✓，用户实报）。
              const keep = !agg.code && !agg.codes && (e.code === '?' || e.code === 'I' || e.code === 'X');
              const nextCode = keep ? e.code : (agg.code ?? '');
              const nextCodes = keep ? e.codes : agg.codes;
              const nextCount = keep ? e.count : agg.count;
              if (
                nextCode === (e.code ?? '') &&
                sameList(nextCodes, e.codes) &&
                nextCount === e.count &&
                nextTc === e.treeConflicted
              ) {
                return e;
              }
              changed = true;
              return { ...e, code: nextCode, codes: nextCodes, count: nextCount, treeConflicted: nextTc };
            }
            const code = own;
            // 独立工作副本：父 WC 的浅扫描永远只给 ?（它不跟踪别人的工作副本），
            // 不能拿这个覆盖"按自身 WC 聚合"得到的 A/M/✓（否则 30 秒轮询后目录又变回 ?）
            if (e.nestedWc && (code === undefined || code === '?')) return e;
            if (code === undefined || code === e.code) {
              // 状态没变：树冲突标记还没打上时补一次（light 条目初始没有）
              if (!tc || e.treeConflicted) return e;
              changed = true;
              return { ...e, treeConflicted: true };
            }
            changed = true;
            return {
              ...e,
              code,
              treeConflicted: tc || e.treeConflicted || undefined,
              // 目录角标用的是 codes（不是 code）：不补这个，悬浮提示显示 M 但图标不显示
              ...(e.isDir
                ? { codes: code && code !== ' ' && code !== 'none' ? [code] : undefined }
                : {}),
            };
          });
          return changed ? { ...d, entries } : d;
        };
        // deep：当前目录内部有修改时，把父目录里这个目录的角标也标出来。
        // 否则用户返回上一级，父目录仍显示旧的 ✓（进入子目录时更新了子目录缓存，但父缓存没动）。
        // 同时把变更项数与操作码集合一并带回：返回上级时目录上的数字/徽标立即是新的。
        let selfCode = '';
        let selfCount = 0;
        const selfOps = new Set<string>();
        if (deep) {
          for (const c of codes.values()) {
            if (!c || c === ' ' || c === 'none' || c === '?' || c === 'X') continue;
            selfCount++;
            selfOps.add(c);
            if ((rank[c] ?? -1) > (rank[selfCode] ?? -1)) selfCode = c;
          }
        }
        const selfCodes = selfOps.size
          ? [...selfOps].sort((a, b) => CODES_ORDER.indexOf(a) - CODES_ORDER.indexOf(b))
          : undefined;
        const idx = cur.lastIndexOf('/');
        // cur 是根目录的直接子目录（如 ConfigureTool）时没有 '/'：父目录是仓库根 ''，
        // name 就是 cur 自己；不能因为 idx<0 把 name 置空，否则父级传播被跳过。
        const parent = deep ? (idx >= 0 ? cur.slice(0, idx) : '') : '';
        const name = deep ? (idx >= 0 ? cur.slice(idx + 1) : cur) : '';
        const patchParent = (d: FsData): FsData => {
          const pe = d.entries.find((e) => e.name === name && e.isDir);
          if (!pe) return d;
          if (pe.code === selfCode && sameList(pe.codes, selfCodes) && pe.count === (selfCount || undefined)) return d;
          // 目录本身未被版本控制（I 被忽略 / ? 未版本化）时，子树聚合永远是空——它里面的
          // 文件 git 根本不跟踪，状态接口查不到。用空结果覆盖会把 I/? 冲成「干净 ✓」
          // （用户实报：进入被忽略目录再返回上级，I 变成 √）。
          if (selfCode === '' && (pe.code === 'I' || pe.code === '?')) return d;
          return {
            ...d,
            entries: d.entries.map((e) =>
              e === pe ? { ...e, code: selfCode, codes: selfCodes, count: selfCount || undefined } : e,
            ),
          };
        };
        setNodeData((m) => {
          const d = m.get(cur);
          let map = m;
          if (d) {
            const next = apply(d);
            // 树冲突条数一并回填：light/浅扫描数据靠第二阶段才能点亮横幅
            const tc = r.treeConflicts ?? d.treeConflicts;
            if (next !== d || tc !== d.treeConflicts) map = new Map(map).set(cur, { ...next, treeConflicts: tc });
          }
          if (deep && name) {
            const pd = map.get(parent);
            if (pd) {
              const nextPd = patchParent(pd);
              if (nextPd !== pd) map = new Map(map).set(parent, nextPd);
            }
          }
          return map;
        });
        setData((d) => {
          if (!d) return d;
          if (d.dir === cur) {
            const next = apply(d);
            const tc = r.treeConflicts ?? d.treeConflicts;
            if (next === d && tc === d.treeConflicts) return d;
            return { ...next, treeConflicts: tc };
          }
          if (deep && name && d.dir === parent) return patchParent(d);
          return d;
        });
      })
      .catch(() => {
        /* 轮询失败不打扰 */
      });
  }, [setData, setNodeData]);

  /** 两阶段加载的第二阶段：补状态并显示「正在补充文件状态…（已 N 秒）」，
   *  补完自动收起（目录已先显示，不阻塞列表）。 */
  const scanCodes = useCallback(
    (cur: string, deep: boolean) => {
      const seq = ++scanSeqRef.current;
      const started = Date.now();
      if (scanTimerRef.current) clearInterval(scanTimerRef.current);
      setScanState({ dir: cur, sec: 0 });
      scanTimerRef.current = setInterval(() => {
        setScanState((s) => (s ? { ...s, sec: Math.floor((Date.now() - started) / 1000) } : s));
      }, 1000);
      void refreshCodes(cur, deep).finally(() => {
        if (seq !== scanSeqRef.current) return; // 已有更新的目录在扫：别把新提示收掉
        if (scanTimerRef.current) {
          clearInterval(scanTimerRef.current);
          scanTimerRef.current = null;
        }
        setScanState(null);
      });
    },
    [refreshCodes],
  );
  // 卸载时清掉计时器
  useEffect(
    () => () => {
      if (scanTimerRef.current) clearInterval(scanTimerRef.current);
    },
    [],
  );

  return { refreshCodes, scanCodes, scanState };
}
