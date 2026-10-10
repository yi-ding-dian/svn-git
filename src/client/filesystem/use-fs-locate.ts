/** FsView 的定位与脉冲：角标点击 → 跳到该状态的条目、滚动高亮、卡片脉冲闪烁。
 *
 *  从 index.tsx 抽出（`locateBadge` + 展开父链 / 滚动高亮两个 effect + 四个状态）。
 *  这些 effect 只做"找到一个条目并把它亮出来"，与视图渲染解耦；行数据、DOM 引用等由调用方持有、
 *  按引用传入（别处也在用），所以这里只接依赖、不接管数据。
 *
 *  ⚠ 这里有两处**竞态防护**，搬动时别丢：
 *    - `locateTokenRef`：连点角标时只认最后一次（前面的异步结果作废）
 *    - `locateMissTimerRef`：目标行迟迟不出现（父链还在加载/已被删）时 3s 兜底静默结束，
 *      否则悬着的定位会在后续任何数据变化时反复把用户拽回去（"点哪都被拉回"的根因）
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { get, type FsData, type FsEntry } from '../shared/api.js';
import { flashBreadcrumbs } from '../ui/motion.js';
import { conflictPaths } from './use-wc-conflicts.js';
import type { Mode, VisibleRow } from './utils.js';

/** 定位目标：rel = 目标相对仓库根/当前目录的路径（与所在模式的基准一致） */
export interface LocateTarget {
  rel: string;
  at: number;
  /** 同层的同状态条目一起选中+脉冲；tc（树冲突）时按"是否是冲突项"选，不能按状态码（冲突项 code 是 A/M，按码选会误伤） */
  code?: string;
  /** 只选中显式指定的这几个（拖入上传后用：只选真正落盘的那几个） */
  only?: string[];
  tc?: boolean;
}

export function useFsLocate(opts: {
  mode: Mode;
  dir: string;
  /** 树模式的行（自带 rel，相对仓库根） */
  visibleRows: VisibleRow[];
  /** 列表/网格的条目（相对 dir） */
  listEntries: FsEntry[];
  data: FsData | null;
  /** 行 DOM 引用（滚动到目标用） */
  rowRefs: React.MutableRefObject<Map<string, HTMLDivElement>>;
  /** 树模式：展开父链要逐级加载 */
  loadNode: (d: string, force?: boolean) => unknown;
  setExpanded: React.Dispatch<React.SetStateAction<Set<string>>>;
  /** 树冲突诊断结果（code='TC' 的角标定位用内存清单，不联网） */
  diag: Parameters<typeof conflictPaths>[0];
  /** 诊断/冲突清单的基准目录：树模式行 rel 相对仓库根，列表/网格相对 dir */
  viewDir: string;
  breadcrumbRef: React.RefObject<HTMLDivElement | null>;
  setFocusIndex: (i: number) => void;
  setSelected: React.Dispatch<React.SetStateAction<Set<string>>>;
  setDir: React.Dispatch<React.SetStateAction<string>>;
  relOf: (e: FsEntry) => string;
}) {
  const { mode, dir, visibleRows, listEntries, data, rowRefs, loadNode, setExpanded, diag, viewDir, breadcrumbRef, setFocusIndex, setSelected, setDir, relOf } = opts;

  const [pendingLocate, setPendingLocate] = useState<LocateTarget | null>(null);
  /** 正在脉冲闪烁的条目（渲染时挂 .file-pulse） */
  const [pulseRels, setPulseRels] = useState<string[]>([]);
  /** 角标定位轮转索引（同一角标连点依次跳下一个）+ 竞态令牌（连点时作废前一次） */
  const locateIdxRef = useRef<Map<string, number>>(new Map());
  const locateTokenRef = useRef(0);
  /** 「目标行迟迟不出现」的兜底计时器 */
  const locateMissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** 角标定位：点击文件夹状态徽标 → 跳转到其中"最近修改"的该状态文件（连续点击轮转；面包屑点亮 + 卡片脉冲）。
   *  code='TC' 是树冲突角标：目标不是"某状态的文件"，而是这批冲突项本身（含条目自身与它内部的），
   *  数据来自内存里的诊断清单，不必问服务器。 */
  const locateBadge = useCallback(
    async (dirRel: string, code: string) => {
      const token = ++locateTokenRef.current;
      let files: { path: string; mtime: number }[];
      if (code === 'TC') {
        // 基准同诊断（viewDir）：树模式的行 rel 相对仓库根，列表/网格相对 dir
        files = conflictPaths(diag, viewDir)
          .filter((p) => p === dirRel || p.startsWith(dirRel + '/'))
          .map((path) => ({ path, mtime: 0 }));
      } else {
        try {
          const r = await get.locate(dirRel, code);
          files = r.files;
        } catch {
          // 定位失败即忽略（接口异常/目录不存在时不打扰用户，角标下次点击可重试）
          return;
        }
      }
      if (token !== locateTokenRef.current || files.length === 0) return;
      const key = `${dirRel}::${code}`;
      const idx = (locateIdxRef.current.get(key) ?? 0) % files.length;
      locateIdxRef.current.set(key, idx + 1);
      const target = files[idx]!.path;
      const parent = target.includes('/') ? target.slice(0, target.lastIndexOf('/')) : '';
      // 面包屑逐级点亮：目标链路（根→目标目录）
      const chain: string[] = [];
      {
        let acc = '';
        for (const part of parent.split('/').filter(Boolean)) {
          acc = acc ? `${acc}/${part}` : part;
          chain.push(acc);
        }
      }
      void flashBreadcrumbs(breadcrumbRef.current, chain);
      // 统一走 pendingLocate：树=展开父链+高亮；列表/网格=进目录+选中（数据就绪后的滚动/脉冲在下面的 effect 里）
      setPendingLocate({ rel: target, at: Date.now(), code: code === 'TC' ? undefined : code, tc: code === 'TC' });
    },
    [diag, viewDir, breadcrumbRef], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // 定位第一步（树）：展开目标的父链并逐级加载
  useEffect(() => {
    if (!pendingLocate || mode !== 'tree') return;
    const parts = pendingLocate.rel.split('/');
    // ⚠ 先把祖先链收进数组再展开：setState 的 updater 是**延迟执行**的，
    // 若在循环里直接引用 `acc`，等 React 真正调用它时循环早已结束、acc 已是最终值，
    // 于是每一级都写成同一个路径、只展开了最末一级（深层目录定位失效的根因）。
    const ancestors: string[] = [];
    let acc = '';
    for (let i = 0; i < parts.length - 1; i++) {
      acc = acc ? `${acc}/${parts[i]}` : parts[i]!;
      ancestors.push(acc);
    }
    ancestors.forEach((a) => {
      setExpanded((s) => new Set(s).add(a));
      void loadNode(a);
    });
  }, [pendingLocate, mode, loadNode, setExpanded]);

  // 定位第二步：数据就绪后高亮 + 滚动 + 脉冲
  useEffect(() => {
    if (!pendingLocate) return;
    if (mode === 'tree') {
      const idx = visibleRows.findIndex((r) => r.rel === pendingLocate.rel);
      if (idx >= 0) {
        if (locateMissTimerRef.current) {
          clearTimeout(locateMissTimerRef.current);
          locateMissTimerRef.current = null;
        }
        setFocusIndex(idx);
        // 同父目录下的同类项一并选中+脉冲（角标定位"找的不止一个"）：
        //   状态字母（M/A…）→ 同状态码；树冲突（tc）→ 同目录下**其他冲突项**
        const tParent = pendingLocate.rel.includes('/') ? pendingLocate.rel.slice(0, pendingLocate.rel.lastIndexOf('/')) : '';
        const pfx = tParent ? `${tParent}/` : '';
        // 同层 = 目标所在目录的直接子项；根目录时 pfx 为空，此时不含 '/' 的都算同层
        // （原先 pfx 为空直接判 false，导致根目录下"同状态全选"静默失效）
        const sameLayer = (rel: string) => (pfx ? rel.startsWith(pfx) && !rel.slice(pfx.length).includes('/') : !rel.includes('/'));
        const same = visibleRows
          .filter((r) => r.rel !== pendingLocate.rel && sameLayer(r.rel) && (pendingLocate.tc ? r.treeConflicted : Boolean(r.code) && r.code === pendingLocate.code))
          .map((r) => r.rel);
        const sel = pendingLocate.only ? new Set(pendingLocate.only) : new Set([pendingLocate.rel, ...same]);
        setSelected(sel);
        const el = rowRefs.current.get(pendingLocate.rel) ?? null;
        el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
        setPulseRels([...sel]);
        setTimeout(() => setPulseRels([]), 1600);
        setPendingLocate(null);
      } else if (!locateMissTimerRef.current) {
        // 目标行暂不可见（父链还在加载/数据还没刷新到/已被隐藏或删除）：兜底 3s 后仍无 → 静默结束，
        // 否则悬着的定位会在后续导航的数据变化时反复拽回（用户点哪都被拉回——"一直刷新"现象根因）。
        // 3s 而非更短：拖入上传后要等目录刷新回来（多文件时可能过秒），太快会白白放弃定位
        locateMissTimerRef.current = setTimeout(() => {
          locateMissTimerRef.current = null;
          setPendingLocate(null);
        }, 3000);
      }
    } else {
      const parent = pendingLocate.rel.includes('/') ? pendingLocate.rel.slice(0, pendingLocate.rel.lastIndexOf('/')) : '';
      if (data?.dir === parent) {
        const idx = listEntries.findIndex((e) => (parent ? `${parent}/${e.name}` : e.name) === pendingLocate.rel);
        if (idx >= 0) {
          // 同状态文件全选（同目录层）+ 全部脉冲；树冲突定位则选同目录下的其他冲突项
          const same = listEntries
            .filter((e) => (pendingLocate.tc ? e.treeConflicted : Boolean(pendingLocate.code) && e.code === pendingLocate.code))
            .map((e) => relOf(e));
          const sel = pendingLocate.only ? new Set(pendingLocate.only) : same.length ? new Set(same) : new Set([pendingLocate.rel]);
          setSelected(sel);
          setFocusIndex(idx);
          const el = rowRefs.current.get(pendingLocate.rel) ?? null;
          el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
          setPulseRels([...sel]);
          setTimeout(() => setPulseRels([]), 1600);
          setPendingLocate(null);
        } else {
          // 目标行不存在（已删除/被隐藏/被过滤筛选掉）：静默结束定位，避免悬死劫持导航
          setPendingLocate(null);
        }
      } else if (data?.dir !== parent) {
        setDir(parent);
      }
    }
  }, [pendingLocate, mode, visibleRows, data, listEntries]); // eslint-disable-line react-hooks/exhaustive-deps

  return { pendingLocate, setPendingLocate, pulseRels, locateBadge };
}
