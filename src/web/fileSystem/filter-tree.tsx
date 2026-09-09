/** 过滤树（fs 拆分批次 1-4）：仅修改/仅新文件/仅删除视图的树数据拉取 + 折叠 + 扁平化 hook
 * 树行渲染（renderTreeRow）留在 index.tsx（列表/树/过滤树三处共用一行渲染器）。 */
import { useEffect, useMemo, useState } from 'react';
import { get, type FilterTreeNode } from '../api.js';
import type { Filter, VisibleRow } from './utils.js';

/** 过滤树状态：filters 激活时拉取 /api/filtered-tree（当前目录+状态码集），
 * 折叠集合（目录 path）与扁平行（默认全展开；与树视图一致：不带隐藏文件）
 * tick 强制重拉信号：内部操作（加入/取消忽略、忽略规则增删）成功后自增。 */
export function useFilterTree(dir: string, filters: Set<Filter>, tick: number, showHidden: boolean) {
  const [filterTree, setFilterTree] = useState<FilterTreeNode[] | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [filterTreeTick, setFilterTreeTick] = useState(0);

  useEffect(() => {
    if (filters.size === 0) {
      setFilterTree(null);
      return;
    }
    let cancelled = false;
    const codes: string[] = [];
    if (filters.has('changed')) codes.push('M', 'A', 'D', 'R', 'C', '!', '~', 'U');
    if (filters.has('new')) codes.push('?');
    if (filters.has('deleted')) codes.push('D');
    get
      .filteredTree(dir, codes)
      .then((r) => {
        if (!cancelled) setFilterTree(r.tree);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [filters, dir, tick, filterTreeTick]); // tick: 操作(添加/还原等)成功后 refresh() 会重置过滤树；filterTreeTick: 忽略相关内部操作

  // 过滤树：转成扁平行（复用树列表行渲染），默认全展开，目录可点击收起
  const filterRows = useMemo<VisibleRow[]>(() => {
    const rows: VisibleRow[] = [];
    const countFiles = (n: FilterTreeNode): number => {
      let c = 0;
      const w = (x: FilterTreeNode) => {
        if (!x.isDir) c++;
        else x.children.forEach(w);
      };
      w(n);
      return c;
    };
    const walk = (nodes: FilterTreeNode[], depth: number) => {
      for (const n of nodes) {
        // 与列表/树模式一致的隐藏文件开关：未勾选时不显示 . 开头的隐藏文件/目录（如 .playwright-mcp）
        if (!showHidden && n.name.startsWith('.')) continue;
        const open = n.isDir && !collapsed.has(n.path);
        rows.push({
          rel: n.path,
          name: n.name,
          code: n.code, // 目录也带自身状态码（未版本化目录 '?'；无状态目录为空 → 显示 √）
          isDir: n.isDir,
          size: n.size ?? 0,
          mtime: n.mtime ?? '',
          count: n.isDir ? countFiles(n) : undefined,
          depth,
          open,
          locked: false,
          // 磁盘上已缺失（svn '!' / git " D"）：行虚化处理，与列表/树视图一致
          miss: n.code === '!',
          // 目录徽标用自身状态码（未版本化目录 '?'）；无自身码的容器（命中文件所在目录）保持 √
          codes: n.isDir && n.code ? [n.code] : undefined,
        });
        if (n.isDir && open) walk(n.children, depth + 1);
      }
    };
    walk(filterTree ?? [], 0);
    return rows;
  }, [filterTree, collapsed, showHidden]);

  return { filterTree, filterRows, collapsed, setCollapsed, filterTreeTick, setFilterTreeTick };
}
