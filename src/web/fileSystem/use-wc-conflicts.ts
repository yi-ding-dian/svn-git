/** 树冲突诊断（共享）：把 /api/wc-conflicts 的请求从 WcNotice 里抽出来，
 *  让**横幅与条目角标用同一份结果**——不再各查一遍服务器。
 *
 *  数据分两层，角标先出、颜色后补：
 *    ① 条目级 treeConflicted 来自 /api/fs 的 status —— 本地就知道，打开目录即可标（灰）
 *    ② 服务器上到底还在不在，必须联网问，就是这里的清单 —— 回来后升级成红（已删除）/ 黄（仍在）
 *
 *  范围提醒：诊断只覆盖**当前目录**（大工作副本退化为浅扫描，只列直接子项）。
 *  所以清单里的路径拼上 dir 才能与界面 rel 对齐；没命中的一律按"状态未知"处理，不猜。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { get, type FsData, type WcConflictItem } from '../api.js';

/** /api/fs 里与工作副本异常相关的字段 */
export type WcFlags = Pick<FsData, 'wcLocked' | 'wcIncomplete' | 'wcBroken' | 'treeConflicts'>;

export interface WcDiag {
  /** 冲突清单；null = 没查（无冲突或未触发） */
  list: WcConflictItem[] | null;
  /** 服务器没连上：清单只是本地判断，服务器状态不可信 */
  unchecked: boolean;
}

/** 诊断清单的路径 → 相对**仓库根**的完整路径（清单里的 path 相对被诊断目录）。
 *  点 ⚠ 角标定位时用：筛出目标条目自己 + 它内部的冲突项，逐个跳过去。 */
export function conflictPaths(diag: WcDiag, dir: string): string[] {
  const prefix = dir ? dir + '/' : '';
  return (diag.list ?? []).map((c) => prefix + c.path);
}

/** 条目角标要的冲突信息（三态决定颜色） */
export interface EntryConflict {
  /** 服务器上该路径已不存在（被删或被移）→ 红 */
  serverMissing: boolean;
  /** 服务器状态未知（诊断没跑/没连上）→ 中性灰 */
  unknown: boolean;
  /** 自身冲突时的明细（复制源）；"目录内部有冲突"时取不到（是多条，没有单一明细） */
  item?: WcConflictItem;
  /** 命中的冲突条数：自身冲突为 1，目录内部冲突为目录内的条数 */
  count: number;
}

/** 诊断请求：是否要查 + 清空，逻辑与原 WcNotice 内部一致。
 *
 *  tick 必须进依赖：**只靠 needDiag 判断"要不要查"是不够的**——它是布尔值，
 *  删掉一个冲突项后 count 从 4 变 2，true→true 不变，effect 不重跑，横幅就还列着
 *  已经处理掉的路径（用户实报：VWLog/VWPublic 删完了，横幅里仍在）。
 *  tick 由 refresh() 在写操作后自增，正好是"本地状态可能变了"的信号。 */
export function useWcConflicts(flags: WcFlags | undefined, dir: string, tick: number): WcDiag {
  // treeConflicts 来自 /api/fs 的状态统计，但**工作副本 incomplete/locked 时 SVN 不递归**，
  // 那个计数会是 0（实报的坑）。所以这两种异常状态下也要去问一次，否则冲突提示根本不出现。
  const needDiag = (flags?.treeConflicts ?? 0) > 0 || Boolean(flags?.wcIncomplete) || Boolean(flags?.wcLocked);
  const [list, setList] = useState<WcConflictItem[] | null>(null);
  const [unchecked, setUnchecked] = useState(false);

  useEffect(() => {
    if (!needDiag) {
      setList(null);
      setUnchecked(false);
      return;
    }
    let cancelled = false;
    get
      .wcConflicts(dir)
      .then((r) => {
        if (cancelled) return;
        setList(r.conflicts);
        setUnchecked(Boolean(r.unchecked));
      })
      .catch(() => {
        // 查询失败也要有交代：至少把"这里确实有冲突"告诉用户（清单留空 → 角标退成未知色）
        if (!cancelled) setList([]);
      });
    return () => {
      cancelled = true;
    };
  }, [needDiag, dir, tick]);

  return { list, unchecked };
}

/** 角标查表：条目 rel（相对仓库根）→ 冲突信息。
 *  清单里的 path 是相对**被诊断目录**的（诊断在该目录内跑），要拼上 dir 才是相对根。
 *  引用保持稳定（useCallback）——要进 visibleRows 的 useMemo 依赖，每次都新建会失效。
 *
 *  inner=true 用于"目录内部有冲突"：清单是递归的，前缀扫一遍就能给出**准确颜色**
 *  （有任意一条是"服务器已删除"就整体判红），不必退化成"未知"的灰。
 *  拿不到数据时才灰：大工作副本浅扫描（清单只到直接子项）或服务器没连上。 */
export function useConflictLookup(diag: WcDiag, dir: string): (rel: string, inner?: boolean) => EntryConflict {
  const list = useMemo(() => {
    const prefix = dir ? dir + '/' : '';
    return (diag.list ?? []).map((c) => ({ item: c, full: prefix + c.path }));
  }, [diag.list, dir]);
  const unchecked = diag.unchecked;

  return useCallback(
    (rel: string, inner = false) => {
      if (inner) {
        const pre = rel + '/';
        let count = 0;
        let missing = false;
        for (const e of list) {
          if (!e.full.startsWith(pre)) continue;
          count++;
          if (e.item.serverMissing) missing = true;
        }
        // 一条都没命中：清单没覆盖到这里（浅扫描）或没查成 —— 按未知，不猜
        if (count === 0 || unchecked) return { serverMissing: false, unknown: true, count };
        return { serverMissing: missing, unknown: false, count };
      }
      const hit = list.find((e) => e.full === rel);
      if (hit && !unchecked) return { serverMissing: hit.item.serverMissing, unknown: false, item: hit.item, count: 1 };
      // 没命中：可能是浅扫描只覆盖了直接子项、也可能服务器没查成 —— 一律按未知，不猜
      return { serverMissing: false, unknown: true, count: hit ? 1 : 0 };
    },
    [list, unchecked],
  );
}

/** 条目的角标（undefined = 不是冲突，不显示 ⚠） */
export interface TcBadge {
  state: 'missing' | 'present' | 'unknown';
  /** true = 目录**内部**有冲突（不是它自己），文案要说清"里面" */
  inner?: boolean;
  /** 目录内部冲突的条数——文案里用它说明有几处 */
  innerCount?: number;
}

/** 条目的角标状态：
 *  - 条目自身是树冲突 → 精确匹配，带复制源明细
 *  - 只是"目录内部还有冲突" → 前缀匹配取最严重的一条上色，并给出内部冲突条数 */
export function tcState(
  e: { treeConflicted?: boolean; innerTreeConflict?: boolean },
  rel: string,
  lookup: (rel: string, inner?: boolean) => EntryConflict,
): TcBadge | undefined {
  const pick = (c: EntryConflict): TcBadge['state'] => (c.unknown ? 'unknown' : c.serverMissing ? 'missing' : 'present');
  if (e.treeConflicted) return { state: pick(lookup(rel)) };
  if (e.innerTreeConflict) {
    const c = lookup(rel, true);
    return { state: pick(c), inner: true, innerCount: c.count || undefined };
  }
  return undefined;
}
