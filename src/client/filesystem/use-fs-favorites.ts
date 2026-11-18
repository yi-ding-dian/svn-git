/** FsView 的常用文件夹 + 模块索引：从 index.tsx 原样抽出。
 *
 *  - 常用文件夹：localStorage 读写、勾选树弹窗开关、保存后强制预加载
 *  - 仓库切换时：停止旧仓库预加载；svn 恢复该仓库的常用目录并补拉缺失缓存，git 清空
 *  - 模块索引（md 文件说明注入）：仓库打开时加载一次，descOf 供行内描述/悬浮提示使用
 */
import { useCallback, useEffect, useState } from 'react';
import { get } from '../shared/api.js';
import { t } from '../../shared/i18n/index.js';
import type { FavDir } from './fav-dirs.js';

export function useFsFavorites(opts: {
  repoRoot?: string | null;
  repoType: 'svn' | 'git';
  onToast: (m: string, err?: boolean) => void;
  preloadDir: (d: string, force?: boolean) => void;
  resetPreload: () => void;
}) {
  const { repoRoot, repoType, onToast, preloadDir, resetPreload } = opts;

  // ---------- 常用文件夹：指定 + 后台递归预加载缓存（大仓库秒开） ----------
  const favKey = (root: string) => `svngit:fav-dirs:${root}`;
  const loadFavs = useCallback((root: string): FavDir[] => {
    try {
      return JSON.parse(localStorage.getItem(favKey(root)) ?? '[]') as FavDir[];
    } catch {
      return [];
    }
  }, []);
  const [favs, setFavs] = useState<FavDir[]>(() => (repoRoot ? loadFavs(repoRoot) : []));
  const [favModal, setFavModal] = useState(false);

  /** 保存勾选树的结果（弹窗「确定并预加载」）：勾选集合 = 新的常用列表，写本机 + 立即预加载 */
  const saveFavs = (paths: string[]) => {
    if (!repoRoot) return;
    const old = new Map(loadFavs(repoRoot).map((f) => [f.path, f]));
    const next: FavDir[] = paths.map(
      (p) => old.get(p) ?? { path: p, name: p.split('/').pop() || p, addedAt: Date.now() },
    );
    localStorage.setItem(favKey(repoRoot), JSON.stringify(next));
    setFavs(next);
    // force：刚改选过的目录要重拉（已缓存的子目录仍命中，不会整棵重来）
    for (const p of paths) preloadDir(p, true);
    setFavModal(false);
    // 已保存 {n} 个常用文件夹，正在后台预加载 / 已移除全部常用文件夹
    onToast(next.length > 0 ? t('fs.fav.saved', { n: next.length }) : t('fs.fav.cleared'));
  };

  /** 仓库切换：关闭指向旧仓库的勾选树；svn 恢复常用目录并按缓存完整性补拉，git 清空 */
  const onRepoSwitch = useCallback(
    (args: { repoRoot: string | null; repoType: 'svn' | 'git'; restoredDirs: { has(key: string): boolean } | null; complete: boolean }) => {
      setFavModal(false); // 仓库切换：勾选树指向旧仓库，直接关掉
      // 自动预加载该仓库保存的常用文件夹（仅 svn，git 无需预加载；后台，不阻塞界面）
      if (!args.repoRoot) return;
      resetPreload(); // 停掉旧仓库的预加载 worker，清空队列与已见集合，避免污染新仓库缓存
      if (args.repoType === 'svn') {
        const saved = loadFavs(args.repoRoot);
        setFavs(saved);
        // 缓存完整且该常用目录已在缓存里 → 保留（切回秒开）；否则补拉
        for (const f of saved) {
          if (!args.complete || !args.restoredDirs?.has(f.path)) preloadDir(f.path);
        }
      } else {
        setFavs([]);
      }
    },
    [loadFavs, preloadDir, resetPreload],
  );

  // 模块索引（md 文件说明注入）：仓库相对路径 → 描述；null=未加载/无索引。加载时机：仓库打开时一次性
  const [moduleIndex, setModuleIndex] = useState<Map<string, string> | null>(null);
  const [moduleIndexModal, setModuleIndexModal] = useState<{ md: string } | null>(null);
  const loadModuleIndex = useCallback(() => {
    get
      .moduleIndex()
      .then((r) => {
        const m = new Map<string, string>();
        // 父目录先（短路径优先），子目录索引后写入覆盖 → 命中"向上就近/子覆盖父"
        const dirs = Object.keys(r.indexes).sort((a, b) => a.split('/').length - b.split('/').length);
        for (const dir of dirs) {
          for (const e of r.indexes[dir]?.entries ?? []) {
            m.set(dir ? `${dir}/${e.path}` : e.path, e.desc);
          }
        }
        setModuleIndex(m);
      })
      .catch(() => setModuleIndex(null));
  }, []);
  useEffect(() => {
    loadModuleIndex();
  }, [repoRoot, loadModuleIndex]);
  /** 行 rel → 描述（无索引/无命中返回空串） */
  const descOf = useCallback((rel: string) => moduleIndex?.get(rel) ?? '', [moduleIndex]);

  // moduleIndex 相关文案沿用调用方 t()；导出供 JSX 使用
  return {
    favs,
    setFavs,
    favModal,
    setFavModal,
    loadFavs,
    saveFavs,
    onRepoSwitch,
    moduleIndex,
    moduleIndexModal,
    setModuleIndexModal,
    loadModuleIndex,
    descOf,
    /** 供调用方判断仓库类型（原组件多处直接读 props.repoType，这里仅做兜底导出） */
    repoType,
  };
}
