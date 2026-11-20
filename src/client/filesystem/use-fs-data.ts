/** FsView 的目录数据层：从 index.tsx 原样抽出。
 *
 *  - 列表/浏览模式的两阶段加载（light 目录结构先出，状态后台补）与节点缓存
 *  - 树模式节点加载（loadNode）与展开节点重载
 *  - 跨项目目录缓存 LRU（切走收起、切回秒开）与切项目后的缓存恢复/静默强刷
 *  - tick（全局刷新）失效缓存与静默强刷、30 秒浅状态轮询
 *
 *  ⚠ 几个竞态防护必须保留：
 *    - loadSeqRef：旧加载晚回来不许覆盖新目录
 *    - loadingCountRef：被取代的旧请求也要关掉自己开的加载条
 *    - restoredAtSwitchRef / tickAtSwitchRef：切项目带来的 tick 不当成用户刷新
 *    - nodeDataRef：load 保持稳定引用，避免 setNodeData → load 重建 → effect 循环
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type React from 'react';
import { get, type FsData, type FsEntry } from '../shared/api.js';
import { t } from '../../shared/i18n/index.js';

/** 跨项目目录缓存保留的项目数：切走的项目缓存留在内存里，切回直接秒开（LRU 淘汰最久未用的） */
const CROSS_PROJECT_CACHE_KEEP = 5;

export function useFsData(opts: {
  active: boolean;
  /** 全局刷新信号（App 的 tick） */
  tick: number;
  mode: 'list' | 'tree' | 'browse';
  repoType: 'svn' | 'git';
  repoRoot?: string | null;
  startRel?: string | null;
  /** 挂载时恢复的初始目录（项目上次浏览位置）；缺省 = startRel */
  initialDir?: string;
  dir: string;
  setDir: React.Dispatch<React.SetStateAction<string>>;
  expanded: Set<string>;
  /** load 只会清空选择/预览，因此只要求能接收 null */
  setSel: (v: null) => void;
  setPreview: (v: null) => void;
  /** 是否暂时保留已打开的预览（从悬浮胶囊恢复文件时，数据层加载/切项目会清预览，
   *  恢复的预览不能被这一步关掉；用户主动关闭/打开别的文件后由调用方置回 false） */
  keepPreview?: () => boolean;
  /** 清掉残留定位（原 setPendingLocate(null)） */
  clearPendingLocate: () => void;
  refreshCodes: (cur: string, deep?: boolean) => Promise<void> | void;
  scanCodes: (cur: string, deep: boolean) => void;
  prefetchChildren: (dir: string, entries: FsEntry[], force?: boolean) => void;
  /** useDirPreload 的进度快照（切换项目时判断旧预加载是否还没跑完） */
  preload: { running: boolean } | null;
  /** 仓库切换后的常用目录/预加载处理（由 useFsFavorites 提供） */
  onRepoSwitch: (args: { repoRoot: string | null; repoType: 'svn' | 'git'; restoredDirs: { has(key: string): boolean } | null; complete: boolean }) => void;
}) {
  const {
    active,
    tick,
    mode,
    repoType,
    repoRoot,
    startRel,
    initialDir,
    dir,
    setDir,
    expanded,
    setSel,
    setPreview,
    keepPreview,
    clearPendingLocate,
    refreshCodes,
    scanCodes,
    prefetchChildren,
    preload,
    onRepoSwitch,
  } = opts;

  const [data, setData] = useState<FsData | null>(null); // 列表模式数据
  const [error, setError] = useState('');
  // 树模式状态：各目录数据
  const [nodeData, setNodeData] = useState<Map<string, FsData>>(new Map());
  const [fsLoading, setFsLoading] = useState(false);
  // 大目录提示（条目多时提示原因，避免误以为卡死；5 秒后自动消失）
  const [bigTip, setBigTip] = useState('');

  const loadNode = useCallback((d: string, force = false) => {
    return get.fs(d, force).then((r: FsData) => {
      setNodeData((m) => new Map(m).set(d, r));
    });
  }, []);

  // 列表/浏览模式加载（进入过的目录走 nodeData 缓存，秒开不重复请求）
  // 注意：load 必须是稳定引用（用 nodeDataRef 读写缓存），否则 setNodeData → load 重建 → effect 循环 → 抖动
  const nodeDataRef = useRef(nodeData);
  nodeDataRef.current = nodeData;
  /** 当前目录镜像（切项目时判断 dir 是否会变化：相同则 dir effect 不触发，要显式加载） */
  const dirRef = useRef(dir);
  dirRef.current = dir;
  /** 目录加载请求序号：切项目后 dir effect 的普通加载与后台强刷可能并发，
   *  旧请求晚回来会把新数据覆盖回去——只让最新一次请求的结果落地。 */
  const loadSeqRef = useRef(0);
  /** 非静默加载的并发计数：被取代的旧请求也要关掉自己开的那份加载条，任一未完成就继续显示 */
  const loadingCountRef = useRef(0);
  const bigTipTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** 加载目录（列表/浏览模式）。quiet=true 为静默强刷（操作后 / tick 刷新）：不出顶部加载条、
   *  不弹大目录提示——列表原地换数据，界面不闪；切目录、首次进入照常给加载反馈。
   *  **两阶段**：先 light 读目录结构立即显示文件，再异步补状态（大工作副本不阻塞列表）。 */
  const load = useCallback(async (targetDir: string, force: boolean, quiet = false) => {
    const seq = ++loadSeqRef.current;
    const cache = nodeDataRef.current.get(targetDir);
    if (!force && cache) {
      setData(cache);
      setSel(null);
      // 恢复预览（悬浮胶囊）期间不能被数据加载关掉
      if (!keepPreview?.()) setPreview(null);
      setError('');
      // 预加载缓存只有目录结构（light），进入时立即查子树并聚合深层 M/A。
      // **根目录也查子树**：否则根下目录拿不到"内部有修改"（用户实报：浏览视图全是 ✓，
      // 「仅修改」却能看到深层 M）。大工作副本由服务端降级浅扫描，不会真的全量。
      refreshCodes(targetDir, true);
      // 静默预取下一层：直接拿当前目录的 entries 入队，不要求父目录未见过
      prefetchChildren(targetDir, cache.entries, true);
      // light 数据（预加载）的 code 全空，而 refreshCodes 只能补"有状态"的条目——
      // 被忽略的条目（.gitignore / svn:ignore，如 svngit-test/ 整片测试仓库）在
      // /api/fs-status 里根本不存在，补不回来，于是整排未版本化的项都显示成干净 ✓（用户实报）。
      // 目录已秒开，这里再要一份完整数据、到了原地替换；失败就保持现状（不清空列表）。
      // **根目录跳过**：整仓 status 正是打开大工作副本根时长时间卡顿的来源。
      if (cache.light && targetDir !== '') {
        void get
          .fs(targetDir)
          .then((r) => {
            // 期间已有更新的加载（切目录 / 切项目强刷）：这份补数据可能携带旧状态，丢弃
            if (seq !== loadSeqRef.current) return;
            setNodeData((m) => new Map(m).set(targetDir, r));
            // 请求期间用户可能已翻到别的目录：只更新内容，不把列表拽回来
            if (dirRef.current === targetDir) setData(r);
          })
          .catch(() => {});
      }
      return;
    }
    if (!quiet) {
      loadingCountRef.current += 1;
      setFsLoading(true);
    }
    setError('');
    // 两阶段①：只读目录结构（light，毫秒级），文件先出来；状态（M/A/?）由第二阶段异步补
    let light: Awaited<ReturnType<typeof get.fs>> | null = null;
    try {
      light = await get.fs(targetDir, force, true);
    } catch (e) {
      // 已被更新的加载取代：旧请求的错误（比如旧项目目录已不存在）不作数
      if (seq === loadSeqRef.current) {
        // 目录不存在（ENOENT：上次浏览位置被删除/仓库已切换）→ 自动回到仓库根，避免卡死在错误页
        if (targetDir && (e as Error).message.includes('ENOENT')) {
          setDir('');
          clearPendingLocate();
          setError('');
        } else {
          setError((e as Error).message);
        }
      }
      return;
    } finally {
      if (!quiet) {
        loadingCountRef.current = Math.max(0, loadingCountRef.current - 1);
        if (loadingCountRef.current === 0) setFsLoading(false);
      }
    }
    if (!light || seq !== loadSeqRef.current) return;
    setNodeData((m) => new Map(m).set(targetDir, light));
    setData(light);
    setSel(null);
    // 恢复预览（悬浮胶囊）期间不能被数据加载关掉
    if (!keepPreview?.()) setPreview(null);
    // 两阶段②：补状态（查子树，把深层 M/A 聚合到直接子目录；根目录也查，
    // 否则根下目录看不到"内部有修改"）。
    // 顶层显示「正在补充文件状态…（已 N 秒）」，大仓库也看得见在做什么；静默刷新不显示。
    if (quiet) refreshCodes(targetDir, true);
    else scanCodes(targetDir, true);
    // 静默预取下一层：进入目录后立刻在后台拉它的直接子目录（light，不查 SVN 状态）
    prefetchChildren(targetDir, light.entries ?? [], true);
    // 子目录且条目不多：后台再要一份完整数据（补忽略项 I/未跟踪 ? 的精确状态）；
    // 根目录与超大目录跳过全量 status（这正是方案的性能取舍）
    if (targetDir !== '' && (light.entries?.length ?? 0) <= 200) {
      void get
        .fs(targetDir)
        .then((r) => {
          if (seq !== loadSeqRef.current) return;
          setNodeData((m) => new Map(m).set(targetDir, r));
          if (dirRef.current === targetDir) setData(r);
        })
        .catch(() => {});
    }
    if (!quiet) {
      // 大目录提示：条目多时告知原因（加载完成后展示 5 秒）——静默刷新不重复提示
      const n = light.entries?.length ?? 0;
      if (n > 200) {
        // 该目录文件较多（共 {n} 项），首次加载可能需要一点时间
        setBigTip(t('fs.tip.bigDir', { n }));
        if (bigTipTimer.current) clearTimeout(bigTipTimer.current);
        bigTipTimer.current = setTimeout(() => setBigTip(''), 5000);
      } else {
        setBigTip('');
      }
    }
    // setPendingLocate 的 useState 在下方才声明，放进依赖数组会 TDZ（Block-scoped variable used before its declaration）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefetchChildren, refreshCodes, scanCodes]);

  // 当前目录浅状态轮询：外部编辑器改了文件，30 秒内刷新 M/A；不重拉目录、不清选择/预览
  useEffect(() => {
    if (!active || !repoRoot) return;
    const timer = window.setInterval(() => refreshCodes(dirRef.current, false), 30_000);
    return () => window.clearInterval(timer);
  }, [active, repoRoot, refreshCodes]);

  // 目录切换：优先缓存
  useEffect(() => {
    void load(dir, false);
  }, [dir, load]);

  // 仓库切换（repoRoot 变化）→ 浏览位置回到操作范围(子项目/根)
  // 目录缓存按项目分桶：切走收起、切回恢复（秒开，不重新预加载）；只留最近 5 个项目
  /** 上一个渲染的项目根（切走时把它的缓存收进桶里） */
  const prevRootRef = useRef<string | null>(null);
  /** 仓库根 → 目录缓存；只留最近切换过的 CROSS_PROJECT_CACHE_KEEP 个项目（仅内存，重启清空） */
  const cacheByRootRef = useRef(new Map<string, Map<string, FsData>>());
  /** 缓存不完整的项目（切走时预加载还没跑完 / 本项目内刷新清过缓存）：切回时重新预加载 */
  const incompleteRootsRef = useRef(new Set<string>());
  /** preload 状态镜像（切换 effect 里读，避免把它加进依赖导致重复执行） */
  const preloadRef = useRef(preload);
  preloadRef.current = preload;
  /** 当前项目根镜像（invalidateCache 是稳定回调，不能把 repoRoot 加进依赖） */
  const repoRootRef = useRef<string>(repoRoot ?? '');
  repoRootRef.current = repoRoot ?? '';
  /** 切项目时的 tick：App 打开项目后会 refresh()，这次 tick 不能当成「用户刷新」去清刚恢复的缓存 */
  const tickAtSwitchRef = useRef(tick);
  /** 本次切换是否恢复了该项目的缓存（树/浏览模式据此跳过重载） */
  const restoredAtSwitchRef = useRef(false);
  /** 树/浏览模式 effect 上次处理的 tick（区分「切项目」与「用户刷新」） */
  const lastTreeTickRef = useRef(tick);
  /** 模式镜像：切换项目的 effect 只依赖 repoRoot，延迟回调里要读到最新模式 */
  const modeRef = useRef(mode);
  modeRef.current = mode;

  useEffect(() => {
    const prev = prevRootRef.current;
    tickAtSwitchRef.current = tick;
    if (prev && prev !== repoRoot) {
      // 切走：收起上一个项目的缓存（最近使用排最后，超过上限淘汰最久未用的）
      const buckets = cacheByRootRef.current;
      buckets.delete(prev);
      buckets.set(prev, nodeDataRef.current);
      while (buckets.size > CROSS_PROJECT_CACHE_KEEP) {
        const oldest = buckets.keys().next().value;
        if (oldest === undefined) break;
        buckets.delete(oldest);
      }
      // 预加载没跑完就切走 → 缓存不完整，切回时要补拉
      if (preloadRef.current?.running) incompleteRootsRef.current.add(prev);
    }
    prevRootRef.current = repoRoot ?? null;
    // 切回：恢复该项目上次的缓存（存在则进入目录命中缓存，秒开）
    const restored = repoRoot ? cacheByRootRef.current.get(repoRoot) : undefined;
    restoredAtSwitchRef.current = Boolean(restored);
    const targetDir = initialDir ?? startRel ?? '';
    const restoredMap = restored ? new Map(restored) : new Map();
    setDir(targetDir);
    setSel(null);
    // 恢复预览（悬浮胶囊）期间不能被数据加载关掉
    if (!keepPreview?.()) setPreview(null);
    setNodeData(restoredMap);
    // nodeDataRef 下一渲染才更新；这里先写，供下面的 load 读（否则读到上一个项目的缓存）
    nodeDataRef.current = restoredMap;
    // 两个项目的起始目录相同时 dir 不变、dir effect 不会触发 → 列表会残留上一个项目的内容，
    // 必须显式加载一次（命中恢复的缓存则秒开；首次挂载交给 dir effect，避免重复请求）
    if (prev && dirRef.current === targetDir) void load(targetDir, false);
    // 常用目录 / 预加载：切回已缓存项目保留，否则补拉；git 清空
    const complete = Boolean(restored) && !incompleteRootsRef.current.has(repoRoot ?? '');
    if (repoRoot && repoType === 'svn') incompleteRootsRef.current.delete(repoRoot);
    onRepoSwitch({ repoRoot: repoRoot ?? null, repoType, restoredDirs: restored ?? null, complete });
  }, [repoRoot]); // eslint-disable-line react-hooks/exhaustive-deps

  // 树/浏览模式的重载要按"已展开集合"刷新，下面的工具用 ref 镜像（避免闭包捕获旧集合）
  const expandedRef = useRef(expanded);
  expandedRef.current = expanded;

  /** 操作后 / tick 刷新的缓存失效：**保留渲染中的目录**（''、当前目录、已展开）——
   *  整体清空会让树闪成整页加载态、列表闪空白再重建（「操作后界面刷新抖动」的根源）；
   *  其余目录缓存照旧清掉（操作可能改动任意目录，陈旧缓存下次进入会显示旧状态）。 */
  const invalidateCache = useCallback(() => {
    // 刷新 / 操作清过缓存 → 该项目缓存不完整；切走再切回时重新补预加载
    if (repoRootRef.current) incompleteRootsRef.current.add(repoRootRef.current);
    const keep = new Set<string>(['', dir, ...expandedRef.current]);
    setNodeData((m) => {
      let changed = false;
      const n = new Map(m);
      for (const k of n.keys()) {
        if (!keep.has(k)) {
          n.delete(k);
          changed = true;
        }
      }
      return changed ? n : m;
    });
  }, [dir]);

  /** 树/浏览模式重载：''+已展开节点全刷（保留缓存后必须重载它们，否则展开子树显示旧数据）。
   *  loadNode 无加载态、数据到达原地替换——界面不闪。 */
  const reloadOpenNodes = useCallback(() => {
    ['', ...expandedRef.current].forEach((d) => void loadNode(d, true));
  }, [loadNode]);

  // 切回有缓存的项目：缓存只负责秒开，切走期间外部可能改了文件、新增/删除——
  // 首屏渲染出来后静默强刷一次，数据到达原地替换；失败保留缓存，不弹错误。
  // 切到无缓存的新项目不用补刷（dir effect / 树重载本来就会加载最新数据）；
  // 首次挂载走正常加载，也不在这里重复请求。
  useEffect(() => {
    if (!repoRoot || !restoredAtSwitchRef.current) return;
    const root = repoRoot;
    const targetDir = initialDir ?? startRel ?? '';
    // 让恢复的缓存先完成首帧渲染，再在后台请求（不闪加载条、不打断界面）
    const timer = window.setTimeout(() => {
      if (repoRootRef.current !== root) return; // 等待期间又切走了：这次强刷作废
      if (modeRef.current === 'tree') reloadOpenNodes();
      else void load(targetDir, true, true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [repoRoot]); // eslint-disable-line react-hooks/exhaustive-deps

  // 刷新（tick 变化）：静默强刷——保留渲染中的缓存、数据原地替换（不闪加载条/不闪整页转圈）。
  // 视图隐藏时只失效缓存不请求：切回来（active 变化）会补拉，否则后台每个视图都在跟着 tick 跑。
  useEffect(() => {
    if (tick === 0) return;
    // 切项目带来的 tick（App 打开项目后会 refresh）：刚恢复的缓存就是切换时刻的数据，
    // 不能再整体失效/强刷——否则"切回秒开"变成"重新请求根目录、常用目录缓存被清空"
    if (tick === tickAtSwitchRef.current) return;
    invalidateCache();
    if (!active) return;
    void load(dir, true, true);
  }, [tick, active, load]); // eslint-disable-line react-hooks/exhaustive-deps

  // 树/浏览模式：初始化 + 刷新时重载根和已展开节点（同样只在视图可见时做）
  // 切回已缓存的项目时跳过重载（缓存直接可用）；切到新项目 / 用户刷新照常重载
  useEffect(() => {
    if (mode !== 'tree' && mode !== 'browse') return;
    if (!active) return;
    const tickChanged = tick !== lastTreeTickRef.current;
    lastTreeTickRef.current = tick;
    if (tickChanged && tick === tickAtSwitchRef.current && restoredAtSwitchRef.current) return;
    reloadOpenNodes();
  }, [mode, tick, active, loadNode]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    data,
    setData,
    nodeData,
    setNodeData,
    error,
    setError,
    fsLoading,
    bigTip,
    setBigTip,
    load,
    loadNode,
    invalidateCache,
    reloadOpenNodes,
  };
}
