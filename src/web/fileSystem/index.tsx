/** 文件夹浏览视图：列表/树/浏览(网格)三模式，支持键盘导航（↑↓ 选择、→/Enter 进入、← 返回） */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { get, post, CODE_DESC, codeRank, type FsData, type FsEntry, type FilterTreeNode } from '../api.js';
import { IconDiff, IconRevert, IconClock, IconEyeOff, IconEye, IconLock, IconUnlock, IconCommit, IconPlus, IconClean, IconRefresh, IconDownload, IconFolder, IconList, IconTree, IconGrid, IconHome, IconUp, IconUpload, IconHistory, IconIgnore, IconStar, IconCopy, IconFile, IconExternal, IconRename, GridIcon } from '../icons.js';
import { CodeBadge, DirBadge } from '../badges.js';
import { ContextMenu, type CtxMenuItem } from '../context-menu.js';
import { multiRevertName, renameableCode, removableFromRepo, renameItem, joinPaths, fsSortRank, filterEntries, revertName, type Filter, type Mode, type VisibleRow } from './utils.js';
import { buildBlankItems, buildMultiItems, buildRowItems, type MenuServices } from './menus.js';
import { useFileSearch, FsSearchBox } from './search.js';
import { useFilterTree } from './filter-tree.js';
import { TreeRow } from './views/rows.js';
import { GridItem, FileTipCard } from './views/grid.js';
import { flashBreadcrumbs } from '../motion.js';
import { ModuleIndexDialog } from '../dialogs/module-index.js';

/** 磁盘存在且可改名（renameItem 内部按状态分流：?/I 走磁盘改名，其余走 svn/git move）：
 *  干净 / M / A / C / ? / I（D 已删调度、R/~/U 调度中或磁盘不在 → 均不可改名） */
/** 有版本库内容（可从版本库移除，非添加/删除调度中）：干净 / M / C（A 添加调度用"还原=取消添加"，D 删除调度不再移除） */
/** 重命名菜单项：不在版本库（?/I）→ 磁盘改名（无命令预览）；版本化 → svn/git move（占位预览，新名弹窗输入） */
import { IgnoreModal } from '../ignore-modal.js';
import { FavDirsModal } from '../fav-dirs.js';
import { fmtSize, statusColor, translateVcsError, isBinaryFile } from '../utils.js';
import { cmdOfRepo } from '../cmd-preview.js';
/** 命令预览: 多路径缩写（前 3 个 + …） */
import { ModalShell } from '../modal-shell.js';
import { FormRow } from '../ui.js';
import { ConfirmModal } from '../modals.js';
import { PreviewPane } from '../preview-pane.js';

interface Props {
  tick: number;
  /** 当前视图是否激活（视图常驻挂载、display 切换；键盘监听只在激活时生效，防止隐藏时按键穿透误改状态） */
  active: boolean;
  repoType: 'svn' | 'git';
  /** 仓库根（切换仓库时重置浏览位置，避免残留上次目录） */
  repoRoot?: string | null;
  /** 操作范围(相对仓库根):大仓库打开的子项目,浏览从这里开始 */
  startRel?: string | null;
  onAction: (op: 'add' | 'revert' | 'delete' | 'commit' | 'fs-delete' | 'move' | 'fs-move', paths: string[], keep?: boolean) => void;
  onDiff: (path: string) => void;
  onLog: (path: string) => void;
  onCommitSelect: (dir: string, dirLabel: string) => void;
  onUpdateDir: (dir: string) => void;
  onToast: (msg: string) => void;
}



/** 行操作按钮（带彩色图标，统一尺寸） */
function ActionBtn(props: {
  icon: React.ReactNode;
  label: string;
  title?: string;
  danger?: boolean;
  primary?: boolean;
  cmd?: string;
  onClick: () => void;
}) {
  return (
    <button
      className={`act-btn ${props.danger ? 'danger' : ''} ${props.primary ? 'primary' : ''}`}
      title={props.cmd ? `${props.title ?? props.label}\n${props.cmd}` : props.title ?? props.label}
      onClick={props.onClick}
    >
      {props.icon}
      <span>{props.label}</span>
    </button>
  );
}

export function FsView(props: Props) {
  const [dir, setDir] = useState(props.startRel ?? ''); // 列表模式当前目录(初始 = 操作范围,大仓库子项目)
  const [data, setData] = useState<FsData | null>(null); // 列表模式数据
  const [error, setError] = useState('');
  const [sel, setSel] = useState<FsEntry | null>(null);
  // 预览目标（文本/图片等实际内容与 md/blame/搜索状态都在 PreviewPane 内；此处只做开关与目标，供目录切换/刷新时关闭）
  const [preview, setPreview] = useState<{ name: string; rel: string; img?: boolean; code?: string } | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const [filters, setFilters] = useState<Set<Filter>>(new Set());
  const [mode, setMode] = useState<Mode>('browse');
  // 过滤激活时记住原视图（取消过滤恢复）
  const prevModeRef = useRef<Mode>(mode);
  type CtxItem = CtxMenuItem; // 右键菜单项（公共类型见 context-menu.tsx）
  const [ctx, setCtx] = useState<{ x: number; y: number; items: CtxItem[] } | null>(null);
  // 右键选中锁定：右键后条目保持选中（hover 不清），点击其他地方/菜单关闭才取消
  const [ctxLocked, setCtxLocked] = useState(false);
  // 菜单随悬停消失：延迟关闭计时器 + 右键的条目 rel（空白右键为 null，用于判断鼠标是否回到原条目）
  const ctxHideTimer = useRef<ReturnType<typeof setTimeout>>();
  const ctxRelRef = useRef<string | null>(null);
  // 多选：rel 集合（Ctrl 点选 / Shift 范围选 / 浏览模式拖拽框选）；右键项在集合内时菜单作用于整个集合
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const shiftAnchorRef = useRef<string | null>(null); // Shift 范围选择锚点（上次单击项）
  // 浏览模式拖拽框选：拖拽起点 / 框选矩形（ref 直接操作 DOM，避免 mousemove 高频 re-render 卡顿） / 本次是否发生过拖动（供 click 判断，避免空白点击清空误伤框选结果）
  const selBoxRef = useRef<HTMLDivElement | null>(null);
  const selDragRef = useRef<{ startX: number; startY: number } | null>(null);
  // 框选 mouseup 丢失兜底（松手移出窗口/松开在菜单遮罩上等）：任何 position 清除拖拽状态并隐藏矩形，
  // 避免"没按左键移动鼠标也画出框选"；grid 内正常松开由 grid 的 onMouseUp 先行处理，此兜底无副作用
  useEffect(() => {
    const onWinUp = () => {
      if (selDragRef.current) {
        selDragRef.current = null;
        if (selBoxRef.current) selBoxRef.current.style.display = 'none';
      }
    };
    window.addEventListener('mouseup', onWinUp);
    return () => window.removeEventListener('mouseup', onWinUp);
  }, []);
  const lastWasDragRef = useRef(false);
  const [ignoreModal, setIgnoreModal] = useState<{ dir: string } | null>(null);
  /** 加入忽略输入弹窗（替代 window.prompt：目标文件 + 规则输入） */
  const [ignoreAsk, setIgnoreAsk] = useState<{ rel: string; name: string } | null>(null);
  const [ignorePattern, setIgnorePattern] = useState('');
  // 忽略写入去向（.gitignore 随仓库分发 / global 仅本机全部仓库 / exclude 仅本机本仓库）
  const [ignoreTarget, setIgnoreTarget] = useState<'gitignore' | 'global' | 'exclude'>('gitignore');
  const IGNORE_WHERE_LABEL: Record<'gitignore' | 'global' | 'exclude', string> = {
    gitignore: '仓库 .gitignore（随仓库分发）',
    global: '全局忽略（仅本机，所有仓库生效）',
    exclude: '.git/info/exclude（仅本机本仓库）',
  };
  /** 取消忽略确认弹窗（忽略项右键：git 追加 !规则 / svn 删规则 → 变回未版本化 ?） */
  const [unignoreAsk, setUnignoreAsk] = useState<{ rel: string; name: string; isDir: boolean } | null>(null);
  const [focusIndex, setFocusIndex] = useState(0);
  // 网格目录悬浮提示（替代原生 title：状态字母带颜色、紧凑排列）
  const [tip, setTip] = useState<{ x: number; y: number; name: string; isDir?: boolean; count?: number; size?: number; mtime?: string; code?: string; codes?: string[]; miss?: boolean } | null>(null);
  // 文件搜索（工具栏）：防抖查询 + 结果下拉状态收于 useFileSearch
  const search = useFileSearch(data?.dir ?? '');
  const [pendingLocate, setPendingLocate] = useState<{ rel: string; at: number; code?: string } | null>(null);
  // 定位目标行/卡片脉冲："就是它"提示（渲染期挂 .file-pulse class，1500ms 后清除；同状态文件全选后全闪）
  const [pulseRels, setPulseRels] = useState<string[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const rowRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const gridRef = useRef<HTMLDivElement | null>(null);
  // 角标定位：轮转索引（dir::code → 下一次取第几个）+ 竞态令牌（连点/换目录时中断旧动画）
  const locateIdxRef = useRef<Map<string, number>>(new Map());
  const locateTokenRef = useRef(0);
  // 树模式定位兜底：目标行暂不可见（父链加载中/被隐藏）→ 800ms 后仍未出现则静默结束（防悬死劫持后续导航）
  const locateMissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const breadcrumbRef = useRef<HTMLDivElement | null>(null);

  /** 角标定位：点击文件夹状态徽标 → 跳转到其中"最近修改"的该状态文件（连续点击轮转；面包屑点亮 + 卡片脉冲动画） */
  const locateBadge = async (dirRel: string, code: string) => {
    const token = ++locateTokenRef.current;
    let files: { path: string; mtime: number }[];
    try {
      const r = await get.locate(dirRel, code);
      files = r.files;
    } catch {
      // 定位失败即忽略（接口异常/目录不存在时不打扰用户，角标下次点击可重试）
      return;
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
    // 统一走 pendingLocate：树=展开父链+高亮；列表/网格=进目录+选中（数据就绪后的滚动/脉冲在 pendingLocate effect 内）
    setPendingLocate({ rel: target, at: 0, code });
  };

  // 树模式状态：展开集合 + 各目录数据
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [nodeData, setNodeData] = useState<Map<string, FsData>>(new Map());

  const loadNode = useCallback((d: string, force = false) => {
    return get.fs(d, force).then((r: FsData) => {
      setNodeData((m) => new Map(m).set(d, r));
    });
  }, []);

  // 列表/浏览模式加载（进入过的目录走 nodeData 缓存，秒开不重复请求）
  // 注意：load 必须是稳定引用（用 nodeDataRef 读写缓存），否则 setNodeData → load 重建 → effect 循环 → 抖动
  const nodeDataRef = useRef(nodeData);
  nodeDataRef.current = nodeData;
  const [fsLoading, setFsLoading] = useState(false);
  // 大目录提示（条目多时提示原因，避免误以为卡死；5 秒后自动消失）
  const [bigTip, setBigTip] = useState('');
  const bigTipTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ---------- 常用文件夹：指定 + 后台递归预加载缓存（大仓库秒开） ----------
  interface FavDir {
    path: string;
    name: string;
    addedAt: number;
  }
  const favKey = (root: string) => `svngit:fav-dirs:${root}`;
  const loadFavs = (root: string): FavDir[] => {
    try {
      return JSON.parse(localStorage.getItem(favKey(root)) ?? '[]') as FavDir[];
    } catch {
      return [];
    }
  };
  const [favs, setFavs] = useState<FavDir[]>(() => (props.repoRoot ? loadFavs(props.repoRoot) : []));
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
  }, [props.repoRoot, loadModuleIndex]);
  /** 行 rel → 描述（无索引/无命中返回空串） */
  const descOf = useCallback((rel: string) => moduleIndex?.get(rel) ?? '', [moduleIndex]);
  const [favModal, setFavModal] = useState(false);
  // 预加载进度（done/total 渐进；running=false 表示已完成）
  const [preload, setPreload] = useState<{ done: number; total: number; cur: string; running: boolean } | null>(null);
  // 预加载引擎：全局队列 + 并发 6 + 代际停止（仓库切换时旧 worker 立即停，不污染新仓库缓存）
  const preloadQueueRef = useRef<{ rel: string; depth: number }[]>([]);
  const preloadSeenRef = useRef<Set<string>>(new Set());
  const preloadGenRef = useRef(0);
  const preloadRunningRef = useRef(false);
  // 预加载跳过已知产物/大目录（build/bin/CMakeFiles 等,省时也无"秒开"价值;树模式点击仍懒加载）
  const PRELOAD_SKIP = new Set(['build', 'bin', 'CMakeFiles', 'out', 'dist', 'node_modules', 'vendor', '.svn', '.git', 'third_party', 'thirdparty']);
  /** 预加载上限与深度：fav 目录只预拉自身 + 一层子目录（防止大仓库整树递归拉取,如 SCA_HB 5639 目录×0.65s） */
  const PRELOAD_MAX_QUEUE = 300;
  const PRELOAD_MAX_DEPTH = 1;
  /** 预加载目录（BFS + 并发 6,结果写入 nodeData 缓存,之后进入秒开）
   * 深度 ≤ PRELOAD_MAX_DEPTH（fav 目录=0,只递归一层）;深层由树模式展开时懒加载 */
  const preloadDir = useCallback((rootRel: string) => {
    const queue = preloadQueueRef.current;
    const rootDepth = 0;
    if (!preloadSeenRef.current.has(rootRel)) {
      preloadSeenRef.current.add(rootRel);
      queue.push({ rel: rootRel, depth: rootDepth });
    }
    if (preloadRunningRef.current) return; // 已在预加载中，新目录并入队列
    preloadRunningRef.current = true;
    const gen = preloadGenRef.current;
    let done = 0;
    setPreload({ done: 0, total: 1, cur: rootRel, running: true });
    const worker = async () => {
      while (queue.length) {
        if (preloadGenRef.current !== gen) return; // 仓库已切换，停止
        const cur = queue.shift()!;
        const d = cur.rel;
        try {
          const r = await get.fs(d, false);
          setNodeData((m) => new Map(m).set(d, r));
          // 只继续一层：产物目录跳过 + 深度限制 + 队列上限
          if (cur.depth < PRELOAD_MAX_DEPTH) {
            for (const e of r.entries ?? []) {
              if (e.isDir && !PRELOAD_SKIP.has(e.name)) {
                const sub = d ? `${d}/${e.name}` : e.name;
                if (!preloadSeenRef.current.has(sub) && queue.length < PRELOAD_MAX_QUEUE) {
                  preloadSeenRef.current.add(sub);
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
    void Promise.all(Array.from({ length: 6 }, () => worker())).then(() => {
      preloadRunningRef.current = false;
      setPreload((p) => (p ? { ...p, running: false } : null));
      setTimeout(() => setPreload(null), 2500);
    });
  }, []);
  /** 加入常用文件夹（去重后保存 + 立即预加载） */
  const addFavDir = (rel: string) => {
    if (!props.repoRoot) return;
    const list = loadFavs(props.repoRoot);
    if (list.some((f) => f.path === rel)) return;
    const next = [...list, { path: rel, name: rel.split('/').pop() || rel, addedAt: Date.now() }];
    localStorage.setItem(favKey(props.repoRoot), JSON.stringify(next));
    setFavs(next);
    preloadDir(rel);
    props.onToast(`已加入常用文件夹，正在后台预加载：${rel}`);
  };
  /** 移除常用文件夹 */
  const removeFav = (rel: string) => {
    if (!props.repoRoot) return;
    const next = loadFavs(props.repoRoot).filter((f) => f.path !== rel);
    localStorage.setItem(favKey(props.repoRoot), JSON.stringify(next));
    setFavs(next);
  };
  const load = useCallback(async (targetDir: string, force: boolean) => {
    const cache = nodeDataRef.current.get(targetDir);
    if (!force && cache) {
      setData(cache);
      setSel(null);
      setPreview(null);
      setError('');
      return;
    }
    setFsLoading(true);
    setError('');
    try {
      const r = await get.fs(targetDir, force);
      setNodeData((m) => new Map(m).set(targetDir, r));
      setData(r);
      setSel(null);
      setPreview(null);
      // 大目录提示：条目多时告知原因（加载完成后展示 5 秒）
      const n = r.entries?.length ?? 0;
      if (n > 200) {
        setBigTip(`该目录文件较多（共 ${n} 项），首次加载可能需要一点时间`);
        if (bigTipTimer.current) clearTimeout(bigTipTimer.current);
        bigTipTimer.current = setTimeout(() => setBigTip(''), 5000);
      } else {
        setBigTip('');
      }
    } catch (e) {
      // 目录不存在（ENOENT：上次浏览位置被删除/仓库已切换）→ 自动回到仓库根，避免卡死在错误页
      if (targetDir && (e as Error).message.includes('ENOENT')) {
        setDir('');
        setPendingLocate(null);
        setError('');
        return;
      }
      setError((e as Error).message);
    } finally {
      setFsLoading(false);
    }
  }, []);

  // 目录切换：优先缓存
  useEffect(() => {
    void load(dir, false);
  }, [dir, load]); // eslint-disable-line react-hooks/exhaustive-deps
  // 仓库切换（repoRoot 变化）→ 浏览位置回到操作范围(子项目/根)，清空旧目录缓存
  useEffect(() => {
    setDir(props.startRel ?? '');
    setSel(null);
    setPreview(null);
    setNodeData(new Map());
    // 自动预加载该仓库保存的常用文件夹（仅 svn，git 无需预加载；后台，不阻塞界面）
    if (props.repoRoot) {
      // 停掉旧仓库的预加载 worker，清空队列与已见集合，避免污染新仓库缓存
      preloadGenRef.current++;
      preloadQueueRef.current = [];
      preloadSeenRef.current = new Set();
      preloadRunningRef.current = false;
      if (props.repoType === 'svn') {
        const saved = loadFavs(props.repoRoot);
        setFavs(saved);
        for (const f of saved) preloadDir(f.path);
      } else {
        setFavs([]);
      }
    }
  }, [props.repoRoot]); // eslint-disable-line react-hooks/exhaustive-deps
  // 刷新（tick 变化）：强制重新拉取
  useEffect(() => {
    if (props.tick === 0) return;
    // 清空全部目录缓存再强刷当前目录：操作可能改动任意目录（如添加 A 目录），
    // 仅强刷当前目录时其他目录缓存残留旧 ? 状态，再次进入会缓存命中显示旧数据
    setNodeData(new Map());
    void load(dir, true);
  }, [props.tick, load]); // eslint-disable-line react-hooks/exhaustive-deps

  // 树/浏览模式：初始化 + 刷新时重载根和已展开节点
  const expandedRef = useRef(expanded);
  expandedRef.current = expanded;
  useEffect(() => {
    if (mode !== 'tree' && mode !== 'browse') return;
    const dirs = ['', ...expandedRef.current];
    dirs.forEach((d) => void loadNode(d, true));
  }, [mode, props.tick, loadNode]);

  // 树模式：扁平化可见行
  const visibleRows = useMemo<VisibleRow[]>(() => {
    if (mode !== 'tree') return [];
    const rows: VisibleRow[] = [];
    const walk = (d: string, depth: number) => {
      const nd = nodeData.get(d);
      if (!nd) return;
      let list = filterEntries(nd.entries.filter((e) => showHidden || !e.name.startsWith('.')), filters);
      list = list
        .slice()
        .sort((a, b) => Number(b.isDir) - Number(a.isDir) || fsSortRank(b.code) - fsSortRank(a.code) || a.name.localeCompare(b.name));
      for (const e of list) {
        const rel = d ? `${d}/${e.name}` : e.name;
        const open = e.isDir && expanded.has(rel);
        rows.push({
          rel,
          name: e.name,
          code: e.code,
          isDir: e.isDir,
          size: e.size,
          mtime: e.mtime,
          count: e.count,
          codes: e.codes,
          depth,
          open,
          locked: nd.selfLocked?.includes(rel),
          miss: e.miss,
        });
        if (e.isDir && open) walk(rel, depth + 1);
      }
    };
    walk('', 0);
    return rows;
  }, [nodeData, expanded, showHidden, filters, mode]);

  // 树模式：展开/收起目录
  const toggleExpand = useCallback(
    (rel: string) => {
      if (!expanded.has(rel)) {
        setExpanded((s) => new Set(s).add(rel));
        void loadNode(rel);
      } else {
        setExpanded((s) => {
          const n = new Set(s);
          n.delete(rel);
          return n;
        });
      }
    },
    [expanded, loadNode]
  );

  // 列表模式条目
  const listEntries = useMemo(() => {
    if (!data) return [];
    let list = filterEntries(data.entries.filter((e) => showHidden || !e.name.startsWith('.')), filters);
    return list
      .slice()
      .sort((a, b) => Number(b.isDir) - Number(a.isDir) || fsSortRank(b.code) - fsSortRank(a.code) || a.name.localeCompare(b.name));
  }, [data, showHidden, filters]);

  // 过滤树（仅修改/仅新文件/仅删除）：拉取+折叠+扁平行由 useFilterTree 管理
  const ft = useFilterTree(data?.dir ?? '', filters, props.tick, showHidden);
  /** 过滤树双击文件 → 跳转到所在文件夹并选中（清除过滤恢复原视图） */
  const jumpToFile = (rel: string) => {
    const idx = rel.lastIndexOf('/');
    const parent = idx >= 0 ? rel.slice(0, idx) : '';
    setDir(parent);
    setPendingLocate(null); // 用户主动跳转：取消残留的定位（否则数据变化会被旧定位拽回）
    setSelected(new Set([rel]));
    setFocusIndex(0);
    setFilters(new Set());
    setMode(prevModeRef.current);
  };

  /** 树行渲染（树列表与过滤树共用；filtered=true 时目录点击折叠、双击文件跳转） */
  const renderTreeRow = (row: VisibleRow, i: number, filtered: boolean) => (
    <TreeRow
      row={row}
      i={i}
      filtered={filtered}
      focused={i === focusIndex}
      multi={selected.has(row.rel)}
      searchHit={search.searchResults.includes(row.rel)}
      pulse={pulseRels.includes(row.rel)}
      desc={descOf(row.rel)}
      buttons={rowButtons(row)}
      rowRef={(el) => {
        if (el) rowRefs.current.set(row.rel, el);
        else rowRefs.current.delete(row.rel); // 行卸载（收起/切换模式）时移除，避免残留导致泄漏
      }}
      onMouseEnterRow={(ev, r) => {
        if (!ctxLocked) setFocusIndex(-1);
        else if (ctxRelRef.current === r.rel) cancelCtxClose(); // 鼠标回到右键的条目，保持菜单
        // 树行信息已行内展示（名称/描述/大小/时间），不再弹悬浮卡（网格仍保留）
      }}
      onMouseLeaveRow={() => {
        closeCtxSoon();
        setTip(null);
      }}
      onRowClick={(ev, r, idx) => {
        onRowClick(r.rel, idx, ev, { name: r.name, isDir: r.isDir, code: r.code, size: r.size, mtime: r.mtime, relPath: r.rel } as FsEntry);
        if (r.isDir && r.miss) {
          // 缺失目录（树/过滤树共用）：磁盘已不存在，展开/折叠会加载空数据——拦截并提示还原
          props.onToast('目录已在磁盘上缺失，请右键「还原」恢复');
          return;
        }
        if (r.isDir && !ev.ctrlKey && !ev.shiftKey) {
          if (filtered) {
            // 过滤树：本地折叠（数据已全量，无需再加载）
            ft.setCollapsed((s) => {
              const n = new Set(s);
              if (n.has(r.rel)) n.delete(r.rel);
              else n.add(r.rel);
              return n;
            });
          } else {
            toggleExpand(r.rel); // Ctrl/Shift 时仅选择不展开
          }
        }
      }}
      onDoubleClick={(r) => {
        setTip(null); // 双击即关闭悬浮卡片
        if (r.miss) {
          props.onToast('文件已在磁盘上缺失，请右键「还原」恢复');
          return;
        }
        if (filtered) {
          if (!r.isDir) jumpToFile(r.rel);
        } else if (!r.isDir) void openFile(r.name, r.code, r.rel);
      }}
      onContextMenu={(ev, r, idx) => onRowContext(ev, { isDir: r.isDir, code: r.code, rel: r.rel, name: r.name }, idx)}
    />
  );

  const breadcrumbs = useMemo(() => {
    if (!data) return [] as { label: string; rel: string }[];
    const parts = data.dir ? data.dir.split('/') : [];
    const out = [{ label: data.root.split('/').pop() || '/', rel: '' }];
    let acc = '';
    for (const p of parts) {
      acc = acc ? `${acc}/${p}` : p;
      out.push({ label: p, rel: acc });
    }
    return out;
  }, [data]);

  const relOf = (e: FsEntry) => (data?.dir ? `${data.dir}/${e.name}` : e.name);
  const relOfName = (d: string, name: string) => (d ? `${d}/${name}` : name);

  /** 打开文件：有变更 → diff；无变更/未版本化 → 原文预览（内容由 PreviewPane 自行读取渲染） */
  const openFile = useCallback(
    (name: string, code: string, rel: string) => {
      setTip(null); // 双击打开时关闭悬浮卡片（视图切换后不会再触发 mouseleave,需主动清）
      // 图片文件：双击直接看图（不读文本/diff,避免二进制乱码与"不支持文本对比"提示）
      if (/.(png|jpe?g|gif|svg|webp|bmp|ico)$/i.test(rel)) {
        setPreview({ name, rel, img: true });
        return;
      }
      // 办公文档/压缩包等二进制：双击不打开（diff 无意义、原文会乱码、大文件拖死界面），提示走「打开方式…」
      if (isBinaryFile(rel)) {
        props.onToast('二进制文档：右键「打开方式…」用系统程序打开');
        return;
      }
      if (code && code !== '?' && code !== 'I') {
        props.onDiff(rel);
        return;
      }
      // 干净/未版本化/忽略文件：打开原文预览（原 get.cat 读取移到 PreviewPane；读取失败面板回调退回列表）
      setPreview({ name, rel, code });
    },
    [props]
  );

  type FsOp = 'add' | 'commit' | 'revert' | 'delete';
  const onAction = (op: FsOp, rel: string, keep?: boolean) => props.onAction(op, [rel], keep);

  // 关闭右键菜单（同时解锁右键选中锁定，并清空"原右键条目"记录，避免残留误判）
  const closeCtx = () => {
    if (ctxHideTimer.current) {
      clearTimeout(ctxHideTimer.current);
      ctxHideTimer.current = undefined;
    }
    ctxRelRef.current = null;
    setCtx(null);
    setCtxLocked(false);
  };
  // 延迟关闭：鼠标离开条目/菜单后短暂等待（给鼠标移入菜单留时间），移入菜单或回到原条目则取消
  const closeCtxSoon = () => {
    if (!ctx) return; // 菜单已关（渲染时闭包），无需再启动计时
    if (ctxHideTimer.current) return; // 已有计时，不重置（避免条目间快速移动反复刷新）
    ctxHideTimer.current = setTimeout(closeCtx, 250);
  };
  const cancelCtxClose = () => {
    if (ctxHideTimer.current) {
      clearTimeout(ctxHideTimer.current);
      ctxHideTimer.current = undefined;
    }
  };
  // 点击其他地方 / 滚动 → 立即关闭（同时解锁）
  useEffect(() => {
    if (!ctx) return;
    window.addEventListener('click', closeCtx);
    window.addEventListener('scroll', closeCtx, true);
    return () => {
      window.removeEventListener('click', closeCtx);
      window.removeEventListener('scroll', closeCtx, true);
      cancelCtxClose();
    };
  }, [ctx]);

  // 当前目录下的匹配文件名（网格/列表框选高亮；匹配集来自 useFileSearch）
  const currentMatchNames = useMemo(() => {
    if (!data) return new Set<string>();
    const prefix = data.dir ? data.dir + '/' : '';
    const set = new Set<string>();
    for (const p of search.searchResults) {
      if (p.startsWith(prefix)) {
        const rest = p.slice(prefix.length);
        if (rest && !rest.includes('/')) set.add(rest);
      }
    }
    return set;
  }, [search.searchResults, data]);

  // 定位：树模式展开父链并加载数据
  useEffect(() => {
    if (!pendingLocate || mode !== 'tree') return;
    const parts = pendingLocate.rel.split('/');
    let acc = '';
    for (let i = 0; i < parts.length - 1; i++) {
      acc = acc ? `${acc}/${parts[i]}` : parts[i]!;
      setExpanded((s) => new Set(s).add(acc));
      void loadNode(acc);
    }
  }, [pendingLocate, mode, loadNode]);

  // 定位：visibleRows / 列表数据就绪后高亮并滚动
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
        // 同父目录下相同状态的行一并选中+脉冲（角标定位"找的不止一个"）
        const tParent = pendingLocate.rel.includes('/') ? pendingLocate.rel.slice(0, pendingLocate.rel.lastIndexOf('/')) : '';
        const pfx = tParent ? `${tParent}/` : '';
        const same = visibleRows
          .filter((r) => r.code && r.code === pendingLocate.code && r.rel !== pendingLocate.rel && (pfx ? r.rel.startsWith(pfx) && !r.rel.slice(pfx.length).includes('/') : false))
          .map((r) => r.rel);
        const sel = new Set([pendingLocate.rel, ...same]);
        setSelected(sel);
        const el = rowRefs.current.get(pendingLocate.rel) ?? null;
        el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
        setPulseRels([...sel]);
        setTimeout(() => setPulseRels([]), 1600);
        setPendingLocate(null);
      } else if (!locateMissTimerRef.current) {
        // 目标行暂不可见（父链还在加载/已被隐藏/已被删除）：兜底 800ms 后仍无 → 静默结束，
        // 否则悬着的定位会在后续导航的数据变化时反复拽回（用户点哪都被拉回——"一直刷新"现象根因）
        locateMissTimerRef.current = setTimeout(() => {
          locateMissTimerRef.current = null;
          setPendingLocate(null);
        }, 800);
      }
    } else {
      const parent = pendingLocate.rel.includes('/') ? pendingLocate.rel.slice(0, pendingLocate.rel.lastIndexOf('/')) : '';
      if (data?.dir === parent) {
        const idx = listEntries.findIndex((e) => (parent ? `${parent}/${e.name}` : e.name) === pendingLocate.rel);
        if (idx >= 0) {
          // 同状态文件全选（同目录层）+ 全部脉冲
          const same = listEntries.filter((e) => pendingLocate.code && e.code === pendingLocate.code).map((e) => relOf(e));
          const sel = same.length ? new Set(same) : new Set([pendingLocate.rel]);
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
  }, [pendingLocate, mode, visibleRows, data, listEntries]);

  // ---------- 键盘导航 ----------
  const rows = mode === 'tree' ? visibleRows : listEntries;
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const focusRef = useRef(focusIndex);
  focusRef.current = focusIndex;
  const dirRef = useRef(dir);
  dirRef.current = dir;

  useEffect(() => {
    if (!props.active) return; // 视图隐藏时键盘不响应（防止穿透到其他视图）
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return; // 输入框内不拦截
      if (ctx) {
        if (e.key === 'Escape') {
          closeCtx(); // 统一关闭路径：清计时器 + 解锁 + 清原条目记录
        }
        return;
      }
      if (preview) return; // 预览打开：按键由 PreviewPane 自己的监听处理（/ 搜索 · Esc/←/Backspace 返回），这里只吃键防止列表响应
      const list = rowsRef.current;
      if (list.length === 0) return;
      const k = e.key;
      let fi = focusRef.current;
      const cur = list[fi] ?? list[0]!;

      if (k === 'ArrowDown' || k === 'j') {
        e.preventDefault();
        // 网格模式按列数跳行，其余单行移动
        if (modeRef.current === 'browse') {
          const w = gridRef.current?.clientWidth ?? 600;
          const cols = Math.max(1, Math.floor(w / 120));
          setFocusIndex(Math.min(list.length - 1, fi + cols));
        } else {
          setFocusIndex(Math.min(list.length - 1, fi + 1));
        }
        return;
      }
      if (k === 'ArrowUp' || k === 'k') {
        e.preventDefault();
        if (modeRef.current === 'browse') {
          const w = gridRef.current?.clientWidth ?? 600;
          const cols = Math.max(1, Math.floor(w / 120));
          setFocusIndex(Math.max(0, fi - cols));
        } else {
          setFocusIndex(Math.max(0, fi - 1));
        }
        return;
      }
      if (k === 'Enter' || k === 'ArrowRight') {
        e.preventDefault();
        if (mode === 'tree') {
          const row = cur as VisibleRow;
          if (row.isDir) {
            if (!row.open) {
              toggleExpand(row.rel);
              // 展开后焦点移到第一个子行
              setFocusIndex(Math.min(list.length, fi + 1));
            }
          } else {
            void openFile(row.name, row.code, row.rel);
          }
        } else {
          const row = cur as FsEntry;
          if (row.isDir) {
            setDir(relOfName(dirRef.current, row.name));
            setPendingLocate(null); // 键盘进入目录：取消残留定位
          } else {
            void openFile(row.name, row.code, relOfName(dirRef.current, row.name));
          }
        }
        return;
      }
      if (k === 'ArrowLeft' || k === 'Backspace') {
        e.preventDefault();
        if (mode === 'tree') {
          const row = cur as VisibleRow;
          if (row.isDir && row.open) {
            toggleExpand(row.rel); // 收起
            return;
          }
          // 焦点上移到最近父级行
          for (let i = fi - 1; i >= 0; i--) {
            if ((list[i] as VisibleRow).depth < row.depth) {
              setFocusIndex(i);
              return;
            }
          }
        } else if (dirRef.current) {
          setDir((d) => (d.includes('/') ? d.slice(0, d.lastIndexOf('/')) : ''));
          setPendingLocate(null); // 键盘返回上级：取消残留定位
          setFocusIndex(0);
        }
        return;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ctx, preview, mode, toggleExpand, openFile, props.active]);

  // 焦点越界修正
  useEffect(() => {
    if (focusIndex >= rows.length) setFocusIndex(Math.max(0, rows.length - 1));
  }, [rows.length, focusIndex]);

  // 网格模式：焦点变化时滚动到选中项
  useEffect(() => {
    if (mode !== 'browse' || !rows.length) return;
    const el = gridRef.current?.children[focusIndex] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }, [focusIndex, mode, rows.length]);

  /** 菜单定位：动态估算菜单尺寸，超出屏幕右/下边界时上移/左移，保证完整显示 */
  const ctxPos = (e: React.MouseEvent, itemCount: number) => {
    const itemH = 36; // 每项高度（含分隔线/间距）估算
    const h = itemCount * itemH + 12;
    const w = 220;
    const x = Math.max(4, Math.min(e.clientX, window.innerWidth - w - 8));
    const y = Math.max(4, Math.min(e.clientY, window.innerHeight - h - 8));
    return { x, y };
  };

  /** 条目点击（三视图通用）：无修饰=单选，Ctrl=切换选中，Shift(列表/树)=锚点范围选择 */
  const onRowClick = (rel: string, i: number, ev: React.MouseEvent, e: FsEntry) => {
    setFocusIndex(i);
    if (ev.ctrlKey || ev.metaKey) {
      // Ctrl：切换该项选中
      setSelected((prev) => {
        const s = new Set(prev);
        if (s.has(rel)) s.delete(rel);
        else s.add(rel);
        return s;
      });
      shiftAnchorRef.current = rel;
    } else if (ev.shiftKey && shiftAnchorRef.current) {
      // Shift：锚点 → 当前 范围选择（列表/树）
      const rels =
        mode === 'tree'
          ? (visibleRows as unknown as { rel: string }[]).map((r) => r.rel)
          : listEntries.map((e) => relOf(e));
      const a = rels.indexOf(shiftAnchorRef.current);
      const b = rels.indexOf(rel);
      if (a >= 0 && b >= 0) {
        const s = new Set<string>();
        for (let k = Math.min(a, b); k <= Math.max(a, b); k++) s.add(rels[k]!);
        setSelected(s);
      } else {
        setSelected(new Set([rel]));
        shiftAnchorRef.current = rel;
      }
    } else {
      // 单击：单选（替换）
      setSelected(new Set([rel]));
      shiftAnchorRef.current = rel;
    }
    setSel(e);
  };

  // 切换目录后清空多选（rel 相对新目录已失效）；树模式 dir 不变，不受影响
  useEffect(() => {
    setSelected(new Set());
    shiftAnchorRef.current = null;
  }, [dir]);

  /** 打开系统文件管理器（复用 /api/reveal：Linux xdg-open 打开目录） */
  const openInFm = (rel: string) => {
    void post
      .reveal(rel)
      .then(() => props.onToast('已打开文件管理器'))
      .catch((err: Error) => props.onToast(`打开失败: ${err.message}`));
  };

  // 右键菜单服务：菜单项动作所需数据/回调（menus.tsx 纯构建 items,不直接碰组件状态）
  const menuSvc = (): MenuServices => ({
    repoType: props.repoType,
    dir: data?.dir ?? '',
    root: data?.root,
    favs,
    setIgnoreTarget,
    ignoreFile,
    setIgnoreModal,
    setUnignoreAsk,
    setModuleIndexModal,
    viewHistory,
    openFile,
    svnLock,
    onAction: props.onAction,
    onDiff: props.onDiff,
    onLog: props.onLog,
    onUpdateDir: props.onUpdateDir,
    onCommitSelect: props.onCommitSelect,
    onToast: props.onToast,
    openInFm,
    removeFav,
    addFavDir,
    menuPatchItems,
  });
  /** 「打开方式」异步取到程序列表后替换菜单第 owIdx 项的子菜单（菜单已关闭则安全跳过） */
  const menuPatchItems = (owIdx: number, subs: CtxMenuItem[]) => {
    setCtx((cur) =>
      cur && cur.items[owIdx]?.label === '打开方式…'
        ? { ...cur, items: cur.items.map((it, i) => (i === owIdx ? { ...it, submenu: subs } : it)) }
        : cur
    );
  };

  const onBlankContext = (e: React.MouseEvent) => {
    e.preventDefault();
    setTip(null); // 空白右键同样关闭悬浮卡片
    cancelCtxClose();
    ctxRelRef.current = null; // 空白右键：任何条目都不算"原条目"，鼠标离开即关
    setCtxLocked(false); // 空白右键不锁定任何条目（防止前一次右键的锁定残留）
    const items = buildBlankItems(menuSvc());
    setCtx({ ...ctxPos(e, items.length), items });
  };

  // 无历史记录提示：点击位置显示，1 秒后淡出
  const [noHist, setNoHist] = useState<{ x: number; y: number } | null>(null);
  const noHistTimer = useRef<ReturnType<typeof setTimeout>>();
  const showNoHistory = (x: number, y: number) => {
    setNoHist({ x, y });
    if (noHistTimer.current) clearTimeout(noHistTimer.current);
    noHistTimer.current = setTimeout(() => setNoHist(null), 1200);
  };

  /** 查看历史：有记录 → 打开历史视图；无记录 → 点击位置提示 */
  const viewHistory = (rel: string, ev: React.MouseEvent) => {
    void (async () => {
      try {
        const r = await get.log(rel);
        if (r.logs.length > 0) props.onLog(rel);
        else showNoHistory(ev.clientX, ev.clientY);
      } catch {
        props.onLog(rel);
      }
    })();
  };

  /** 条目右键菜单：按 文件/目录 + 状态 + 仓库类型 动态生成可用操作；右键同时选中该条目并锁定 */
  const onRowContext = (e: React.MouseEvent, t: { isDir: boolean; code: string; rel: string; name: string }, index: number) => {
    e.preventDefault();
    e.stopPropagation();
    setTip(null); // 右键即关闭悬浮卡片,避免与右键菜单重叠
    cancelCtxClose(); // 清掉上次的延迟关闭计时
    ctxRelRef.current = t.rel; // 记录右键条目：鼠标回到它（或移入菜单）时菜单保持
    setFocusIndex(index);
    setSel({ name: t.name, isDir: t.isDir, code: t.code, size: 0, mtime: '', relPath: t.rel } as FsEntry);
    setCtxLocked(true);
    const svc = menuSvc();
    // 多选：右键项已在选中集合内 → 菜单作用于整个集合（按状态合并操作，不误伤）
    if (selected.has(t.rel) && selected.size > 1) {
      const rows =
        mode === 'tree'
          ? (visibleRows as unknown as { rel: string; name: string; isDir: boolean; code: string }[]).map((r) => ({
              rel: r.rel,
              isDir: r.isDir,
              code: r.code,
              name: r.name,
            }))
          : listEntries.map((e) => ({ rel: relOf(e), isDir: e.isDir, code: e.code, name: e.name }));
      const byRel = new Map(rows.map((r) => [r.rel, r]));
      const tArr = [...selected].map((rel) => byRel.get(rel)).filter((x): x is { rel: string; isDir: boolean; code: string; name: string } => !!x);
      const items = buildMultiItems(tArr, svc);
      setCtx({ ...ctxPos(e, items.length), items });
      return;
    }
    // 单选（原有逻辑）：右键不在选中集合时，清空多选只留右键项
    setSelected(new Set([t.rel]));
    const items = buildRowItems(t, e, svc);
    setCtx({ ...ctxPos(e, items.length), items });
  };

  /** 加入忽略：git 写 .gitignore / svn 设置 svn:ignore（弹自定义输入框替代 window.prompt） */
  const ignoreFile = (e: { code: string; rel: string; name: string }) => {
    setIgnorePattern(e.name);
    setIgnoreAsk(e);
  };
  const doIgnore = () => {
    if (!ignoreAsk) return;
    const pattern = ignorePattern.trim();
    if (!pattern) return;
    post
      .ignore(ignoreAsk.rel, pattern, ignoreTarget)
      .then((r) => {
        props.onToast(r.message);
        if (r.ok) {
          if (mode === 'tree') loadNode('', true);
          else void load(dir, true);
          ft.setFilterTreeTick((t) => t + 1); // 过滤视图（仅新文件等）重拉：? 变 I 后应从列表消失
        }
      })
      .catch((err: Error) => props.onToast(`忽略失败: ${err.message}`));
    setIgnoreAsk(null);
  };

  /** 取消忽略：确认后调接口，该项变回未版本化(?)（具体规则由接口返回,toast 展示） */
  const doUnignore = () => {
    if (!unignoreAsk) return;
    post
      .unignore(unignoreAsk.rel)
      .then((r) => {
        props.onToast(r.message);
        if (r.ok) {
          if (mode === 'tree') loadNode('', true);
          else void load(dir, true);
          ft.setFilterTreeTick((t) => t + 1); // 过滤视图重拉：I 变回 ? 后应出现在"仅新文件"里
        }
      })
      .catch((err: Error) => props.onToast(`取消忽略失败: ${err.message}`));
    setUnignoreAsk(null);
  };

  /** 列表/浏览模式共用的条目行渲染 */
  const renderEntryRow = (e: FsEntry, i: number) => {
    const rel = relOf(e);
    const focused = i === focusIndex;
    const multi = selected.has(rel);
    const locked = data?.selfLocked?.includes(rel);
    const isMatch = currentMatchNames.has(e.name);
    return (
      <div
        key={rel}
        className={`tree-row ${isMatch ? 'search-hit' : ''}${pulseRels.includes(rel) ? ' file-pulse' : ''}${e.miss ? ' miss' : ''}`}
        style={{
          background: focused || multi ? 'var(--panel2)' : undefined,
          outline: focused ? '1px solid var(--accent)' : multi ? '1px solid var(--accent)' : undefined,
        }}
        onMouseEnter={() => {
          if (!ctxLocked) setFocusIndex(-1);
          else if (ctxRelRef.current === rel) cancelCtxClose(); // 鼠标回到右键的条目，保持菜单
        }}
        onMouseLeave={() => {
          closeCtxSoon();
          setTip(null);
        }}
        onClick={(ev) => {
          onRowClick(rel, i, ev, e);
          // 缺失目录：磁盘已不存在，进入会 ENOENT——拦截并提示还原
          if (e.isDir && e.miss) {
            props.onToast('目录已在磁盘上缺失，请右键「还原」恢复');
            return;
          }
          if (e.isDir && !ev.ctrlKey && !ev.shiftKey) {
            setDir(rel); // Ctrl/Shift 时仅选择不进入
            setPendingLocate(null); // 点击进入目录：取消残留定位
          }
        }}
        onDoubleClick={() => {
          setTip(null); // 双击即关闭悬浮卡片
          if (e.miss) {
            props.onToast('文件已在磁盘上缺失，请右键「还原」恢复');
            return;
          }
          if (!e.isDir) void openFile(e.name, e.code, rel);
        }}
        onContextMenu={(ev) => onRowContext(ev, { isDir: e.isDir, code: e.code, rel, name: e.name }, i)}
      >
        {e.isDir ? <DirBadge codes={e.codes} /> : <CodeBadge code={e.code} />}
        <span className="arrow">{e.isDir ? '▸' : ''}</span>
        {locked && <IconLock size={13} />}
        <span className={`name ${e.isDir ? 'dir' : 'file'}`} style={{ flex: 1, color: statusColor(e.isDir ? e.codes?.[0] : e.code) }}>
          {e.name}
          {e.count ? <span className="count"> （{e.count} 项）</span> : null}
          {descOf(rel) && (
            <span className="dim small" style={{ marginLeft: 10, maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              · {descOf(rel)}
            </span>
          )}
          {e.miss && (
            <span className="dim small" style={{ marginLeft: 10 }}>
              · 已在磁盘上缺失，右键可还原
            </span>
          )}
        </span>
        {rowButtons({ ...e, rel })}
        {!e.isDir && <span className="dim small nowrap">{fmtSize(e.size)}</span>}
        {!e.isDir && <span className="dim small nowrap" style={{ width: 110 }}>{e.mtime}</span>}
      </div>
    );
  };

  /** svn 锁定/解锁 */
  const svnLock = (rel: string, action: 'lock' | 'unlock') => {
    void post
      .svnLock(action, rel)
      .then((r) => props.onToast(r.message))
      .catch((err: Error) => props.onToast((err as Error).message));
  };

  const rowButtons = (e: { code: string; isDir: boolean; rel: string; name: string; miss?: boolean }) => (
    <span className="actions" onClick={(ev) => ev.stopPropagation()}>
      {/* diff 仅限版本化文件（文件夹无 diff；未版本化/干净文件无差异可看；缺失文件磁盘无内容） */}
      {e.code !== '' && e.code !== '?' && !e.isDir && !e.miss && (
        <ActionBtn icon={<IconDiff />} label="diff" title="查看差异" cmd={cmdOfRepo(props.repoType, 'diff', { path: e.rel })} onClick={() => props.onDiff(e.rel)} />
      )}
      {/* 缺失条目：还原（svn revert / git checkout 拉回） */}
      {e.code === '!' && (
        <ActionBtn icon={<IconRevert />} label="还原" title="文件已在磁盘上缺失，还原从版本库恢复" cmd={cmdOfRepo(props.repoType, 'revert', { paths: e.rel })} onClick={() => onAction('revert', e.rel)} />
      )}
      {e.code === '?' && (
        <>
          <ActionBtn icon={<IconPlus />} label="添加" cmd={cmdOfRepo(props.repoType, 'add', { paths: e.rel })} onClick={() => onAction('add', e.rel)} />
          <ActionBtn icon={<IconEyeOff />} label="忽略" title="加入忽略" cmd={cmdOfRepo(props.repoType, 'ignore_add', { path: e.rel, pattern: '…' })} onClick={() => ignoreFile(e)} />
        </>
      )}
      {e.isDir && e.code && e.code !== '?' && !e.miss && (
        <ActionBtn icon={<IconCommit />} label="提交" title="提交此目录修改" cmd={cmdOfRepo(props.repoType, 'commit', { msg: '…' })} onClick={() => props.onAction('commit', [e.rel])} />
      )}
      {(e.code === 'M' || e.code === 'A' || e.code === 'D' || e.code === 'R') && (
        <>
          <ActionBtn icon={<IconRevert />} label="还原" cmd={cmdOfRepo(props.repoType, 'revert', { paths: e.rel })} onClick={() => onAction('revert', e.rel)} />
          <ActionBtn icon={<IconClean />} label="从版本库移除" cmd={cmdOfRepo(props.repoType, 'remove_keep', { paths: e.rel })} onClick={() => onAction('delete', e.rel, true)} />
        </>
      )}
      {!e.isDir && e.code !== '?' && !e.miss && props.repoType === 'svn' && (
        <>
          <ActionBtn icon={<IconLock />} label="锁定" onClick={() => svnLock(e.rel, 'lock')} />
          <ActionBtn icon={<IconUnlock />} label="解锁" onClick={() => svnLock(e.rel, 'unlock')} />
        </>
      )}
      {!e.isDir && e.code !== '?' && <ActionBtn icon={<IconClock />} label="历史" onClick={() => props.onLog(e.rel)} />}
    </span>
  );

  return (
    <div style={{ display: 'flex', gap: 14, height: '100%', minHeight: 0 }}>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        {/* 工具栏 */}
        <div className="row" style={{ marginBottom: 8, flexWrap: 'wrap' }}>
          {/* 导航：回到根目录 */}
          <button
            className="mini tool-btn"
            disabled={!data?.dir}
            onClick={() => {
              setDir('');
              setPendingLocate(null); // 手动导航：取消残留定位
              if (mode === 'tree') setExpanded(new Set());
              setFocusIndex(0);
            }}
            title="回到项目根目录"
          >
            <IconHome /> 根目录
          </button>
          {/* 刷新已由顶部工具栏全局刷新覆盖（tick 机制连带重载本视图），不重复提供 */}
          <button className="mini tool-btn" onClick={() => setShowHidden((s) => !s)} title="显示/隐藏隐藏文件">
            {showHidden ? <IconEye /> : <IconEyeOff />} {showHidden ? '隐藏' : '隐藏文件'}
          </button>
          <span className="row" style={{ gap: 4 }}>
            {(['changed', 'new', 'deleted'] as Filter[]).map((f) => (
              <button
                key={f}
                className={`mini tool-btn ${filters.has(f) ? 'primary' : ''}`}
                onClick={() => {
                  const willActive = !filters.has(f);
                  const next = new Set(filters);
                  if (next.has(f)) next.delete(f);
                  else next.add(f);
                  setFilters(next);
                  if (willActive) {
                    // 激活过滤 → 切树视图展示过滤树
                    if (filters.size === 0) prevModeRef.current = mode;
                    setMode('tree');
                  } else if (next.size === 0) {
                    // 全部取消 → 恢复原视图
                    setMode(prevModeRef.current);
                  }
                }}
                title={f === 'changed' ? '只看有修改的文件' : f === 'new' ? '只看未添加的新文件（树视图，双击文件跳转）' : '只看已删除的文件'}
              >
                {f === 'changed' ? <IconDiff /> : f === 'new' ? <IconPlus /> : <IconClean />}
                {f === 'changed' ? '仅修改' : f === 'new' ? '仅新文件' : '仅删除'}
              </button>
            ))}
            {filters.size > 0 && (
              <button className="mini" onClick={() => { setFilters(new Set()); setMode(prevModeRef.current); }}>全部</button>
            )}
          </span>
          <span className="row" style={{ gap: 4, marginLeft: 4 }}>
            <button className={`mini tool-btn ${mode === 'list' ? 'primary' : ''}`} onClick={() => setMode('list')} title="列表视图">
              <IconList /> 列表
            </button>
            <button className={`mini tool-btn ${mode === 'tree' ? 'primary' : ''}`} onClick={() => setMode('tree')} title="树视图">
              <IconTree /> 树
            </button>
            <button className={`mini tool-btn ${mode === 'browse' ? 'primary' : ''}`} onClick={() => setMode('browse')} title="文件浏览器视图">
              <IconGrid /> 浏览
            </button>
            {props.repoType === 'svn' && (
              <button className={`mini tool-btn ${favs.length > 0 ? 'primary' : ''}`} onClick={() => setFavModal(true)} title="常用文件夹：指定后后台预加载缓存，进入秒开">
                ⭐ 常用{favs.length > 0 ? `(${favs.length})` : ''}
              </button>
            )}
          </span>
          {/* 上一级：浏览按钮右侧、搜索框左侧，带间隔 */}
          <button
            className="mini tool-btn"
            disabled={!data?.dir}
            onClick={() => {
              const up = dir.includes('/') ? dir.slice(0, dir.lastIndexOf('/')) : '';
              setDir(up);
              setFocusIndex(0);
              if (mode === 'tree') setPendingLocate({ rel: up, at: 0 });
              else setPendingLocate(null); // 列表/浏览：取消残留定位（树模式用新定位替换）
            }}
            title="上一级"
            style={{ marginLeft: 12 }}
          >
            <IconUp /> 上级
          </button>
          <FsSearchBox search={search} onPick={(rel, at) => setPendingLocate({ rel, at })} />
          <span className="dim small">（{rows.length} 项 · 键盘: ↑↓ 选择 · →/Enter 进入 · ← 返回 · 空白处右键菜单）</span>
        </div>
        {/* 面包屑导航（所有模式，从仓库根开始） */}
        <div className="breadcrumb" ref={breadcrumbRef} style={{ marginBottom: 8, overflowX: 'auto', whiteSpace: 'nowrap', flexShrink: 0 }}>
          {breadcrumbs.map((b, i) => (
            <React.Fragment key={i}>
              {i > 0 && <span style={{ margin: '0 4px', color: 'var(--dim)' }}>›</span>}
              <a
                href="#"
                data-rel={b.rel}
                onClick={(e) => {
                  e.preventDefault();
                  // 树模式：展开父链并高亮 + 同步当前位置；列表/浏览：直接跳转
                  if (mode === 'tree') {
                    setDir(b.rel);
                    setPendingLocate({ rel: b.rel, at: 0 });
                  } else {
                    setDir(b.rel);
                    setPendingLocate(null); // 列表/浏览：直接跳转并取消残留定位
                    setFocusIndex(0);
                  }
                }}
                style={{ color: i === breadcrumbs.length - 1 ? 'var(--accent)' : 'var(--dim)' }}
              >
                {b.label}
              </a>
            </React.Fragment>
          ))}
        </div>
        {error && (
          <div className="error" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>{error}</span>
            <button className="mini" style={{ flexShrink: 0 }} onClick={() => setError('')} title="关闭错误提示">✕</button>
          </div>
        )}
        {bigTip && <div className="fs-big-tip">⚠ {bigTip}</div>}
        {/* 树模式首次加载 */}
        {mode === 'tree' && nodeData.size === 0 && !error && (
          <div className="loading">
            <div className="spinner" style={{ width: 24, height: 24 }} />
            <div style={{ marginTop: 8 }}>正在加载…</div>
          </div>
        )}
        {/* 列表/浏览模式：加载中转圈提示条（切换目录/首次加载都有反馈，不再干等） */}
        {(mode === 'list' || mode === 'browse') && fsLoading && !error && (
          <div className="fs-loading-bar">
            <span className="spinner" style={{ width: 14, height: 14, margin: 0 }} />
            <span>{data ? '正在加载目录…' : '正在加载…'}</span>
          </div>
        )}
        {/* 常用文件夹后台预加载进度 */}
        {preload && (
          <div className="fs-preload-bar">
            <span className="spinner" style={{ width: 14, height: 14, margin: 0 }} />
            <span>
              {preload.running
                ? `正在后台预加载常用文件夹：${preload.done}/${preload.total}（${preload.cur}）`
                : `✅ 常用文件夹后台预加载完成（${preload.done} 个目录），进入秒开`}
            </span>
          </div>
        )}
        {/* 树模式扁平化行 */}
        {mode === 'tree' && !preview && (
          <div
            className="list"
            style={{ overflow: 'auto', flex: 1 }}
            onContextMenu={onBlankContext}
            onClick={(ev) => {
              if (ev.target === ev.currentTarget) {
                setSelected(new Set()); // 空白处点击清空多选
                setFocusIndex(-1); // 同时清除焦点选中高亮
              }
            }}
          >
            {/* 过滤激活：渲染过滤树（树列表同款行样式，仅数据过滤；目录可折叠，双击文件跳转） */}
            {filters.size > 0 ? (
              ft.filterTree && ft.filterTree.length === 0 ? (
                <div className="empty">没有符合条件的文件</div>
              ) : (
                ft.filterRows.map((row, i) => renderTreeRow(row, i, true))
              )
            ) : (
              <>
                {visibleRows.length === 0 && !error && <div className="empty">空文件夹（← 上级 · 空白处右键菜单）</div>}
                {visibleRows.map((row, i) => renderTreeRow(row, i, false))}
              </>
            )}
          </div>
        )}
        {/* 列表模式 */}
        {mode === 'list' && !preview && (
          <div
            className="list"
            style={{ overflow: 'auto', flex: 1 }}
            onContextMenu={onBlankContext}
            onClick={(ev) => {
              if (ev.target === ev.currentTarget) {
                setSelected(new Set()); // 空白处点击清空多选
                setFocusIndex(-1); // 同时清除焦点选中高亮
              }
            }}
          >
            {listEntries.length === 0 && !error && (
              <div className="empty">
                {filters.size > 0
                  ? filters.has('deleted')
                    ? '该目录下没有已删除的文件'
                    : filters.has('new') && filters.has('changed')
                      ? '该目录下没有修改或未版本化的文件'
                      : filters.has('new')
                        ? '该目录下没有未版本化的新文件'
                        : '该目录下没有修改的文件'
                  : '空文件夹（← 返回上级 · 空白处右键菜单）'}
              </div>
            )}
            {listEntries.map((e, i) => renderEntryRow(e, i))}
          </div>
        )}
        {/* 浏览模式：文件管理器图标网格 */}
        {mode === 'browse' && !preview && (
          <div
            className="grid-view"
            onContextMenu={onBlankContext}
            ref={(el) => {
              if (el) gridRef.current = el;
            }}
            onMouseDown={(ev) => {
              // 空白处按下启动框选（点击条目由条目自身处理）；仅左键——右键按下会打开菜单，
              // 若也启动框选，菜单打开后无按键移动鼠标就会画出"幽灵框选"
              if (ev.button !== 0 || (ev.target as HTMLElement).closest('.grid-item')) return;
              lastWasDragRef.current = false; // 消费上次可能残留的拖拽标记（mouseup 丢失时），避免吞掉本次空白点击的清空
              selDragRef.current = { startX: ev.clientX, startY: ev.clientY };
            }}
            onMouseMove={(ev) => {
              const d = selDragRef.current;
              if (!d) return;
              const dx = ev.clientX - d.startX;
              const dy = ev.clientY - d.startY;
              if (Math.abs(dx) < 4 && Math.abs(dy) < 4) return; // 未达到拖动阈值
              lastWasDragRef.current = true;
              // 矩形直接改 DOM 样式，不 setState（避免 mousemove 每帧全量 re-render）
              const el = selBoxRef.current;
              if (el) {
                el.style.display = 'block';
                el.style.left = `${Math.min(d.startX, ev.clientX)}px`;
                el.style.top = `${Math.min(d.startY, ev.clientY)}px`;
                el.style.width = `${Math.abs(dx)}px`;
                el.style.height = `${Math.abs(dy)}px`;
              }
            }}
            onMouseUp={(ev) => {
              const d = selDragRef.current;
              if (d) {
                if (lastWasDragRef.current) {
                  // 与框选矩形相交的条目全部选中（矩形内无条目时清空）
                  const rect = {
                    left: Math.min(d.startX, ev.clientX),
                    top: Math.min(d.startY, ev.clientY),
                    right: Math.max(d.startX, ev.clientX),
                    bottom: Math.max(d.startY, ev.clientY),
                  };
                  const s = new Set<string>();
                  rowRefs.current.forEach((el, rel) => {
                    const r = el.getBoundingClientRect();
                    if (r.left < rect.right && r.right > rect.left && r.top < rect.bottom && r.bottom > rect.top) s.add(rel);
                  });
                  setSelected(s);
                  shiftAnchorRef.current = s.size > 0 ? [...s][s.size - 1]! : null;
                }
                selDragRef.current = null;
                if (selBoxRef.current) selBoxRef.current.style.display = 'none';
              }
            }}
            onClick={(ev) => {
              if (ev.target !== ev.currentTarget) return;
              if (lastWasDragRef.current) {
                lastWasDragRef.current = false; // 刚框选过，忽略本次空白点击，避免清空框选结果
                return;
              }
              setSelected(new Set()); // 空白处点击清空多选
              setFocusIndex(-1); // 同时清除焦点选中高亮
            }}
          >
            {listEntries.length === 0 && !error && (
              <div className="empty">
                {filters.size > 0
                  ? filters.has('deleted')
                    ? '该目录下没有已删除的文件'
                    : filters.has('new') && filters.has('changed')
                      ? '该目录下没有修改或未版本化的文件'
                      : filters.has('new')
                        ? '该目录下没有未版本化的新文件'
                        : '该目录下没有修改的文件'
                  : '空文件夹（← 返回上级 · 空白处右键菜单）'}
              </div>
            )}
            {listEntries.map((e, i) => {
              const rel = relOf(e);
              return (
                <GridItem
                  key={rel}
                  entry={e}
                  rel={rel}
                  focused={i === focusIndex}
                  multi={selected.has(rel)}
                  searchHit={currentMatchNames.has(e.name)}
                  pulse={pulseRels.includes(rel)}
                  locked={data?.selfLocked?.includes(rel) ?? false}
                  rowRef={(el) => {
                    if (el) rowRefs.current.set(rel, el);
                    else rowRefs.current.delete(rel); // 行卸载（切换模式/目录刷新）时移除，避免残留导致泄漏
                  }}
                  onMouseEnter={(ev) => {
                    if (!ctxLocked) setFocusIndex(-1);
                    else if (ctxRelRef.current === rel) cancelCtxClose(); // 鼠标回到右键的条目，保持菜单
                    // 悬浮提示: 目录带状态字母显示彩色徽标;文件始终显示信息卡片（含大小/时间/状态）
                    setTip({
                      x: ev.clientX, y: ev.clientY, name: e.name, isDir: e.isDir,
                      size: e.size, mtime: e.mtime, code: e.code, codes: e.codes, count: e.count,
                      miss: e.miss,
                    });
                  }}
                  onMouseLeave={() => {
                    closeCtxSoon();
                    setTip(null);
                  }}
                  onClick={(ev) => onRowClick(rel, i, ev, e)}
                  onDoubleClick={() => {
                    setTip(null); // 双击即关闭悬浮卡片
                    if (e.miss) {
                      props.onToast(e.isDir ? '目录已在磁盘上缺失，请右键「还原」恢复' : '文件已在磁盘上缺失，请右键「还原」恢复');
                      return;
                    }
                    if (e.isDir) {
                      setDir(rel);
                      setPendingLocate(null); // 双击进入目录：取消残留定位
                    } else void openFile(e.name, e.code, rel);
                  }}
                  onContextMenu={(ev) => onRowContext(ev, { isDir: e.isDir, code: e.code, rel, name: e.name }, i)}
                  locateBadge={(relf, code) => void locateBadge(relf, code)}
                />
              );
            })}
            {/* 拖拽框选矩形（常驻，样式由 mousemove 直接改，避免 setState 高频 re-render） */}
            <div
              ref={selBoxRef}
              style={{
                display: 'none',
                position: 'fixed',
                left: 0,
                top: 0,
                border: '1.5px solid var(--accent)',
                background: 'rgba(88,166,255,.15)',
                zIndex: 200,
                pointerEvents: 'none',
              }}
            />
          </div>
        )}
        {/* 文件预览（文本/图片/md/blame + 搜索均在 PreviewPane 内；文本读取失败时面板回调退回列表） */}
        {preview && (
          <PreviewPane
            target={preview}
            active={props.active}
            onClose={() => setPreview(null)}
            onError={(msg) => setError(msg)}
            onOpenError={(msg) => {
              setError(msg);
              setPreview(null); // 文本读取失败：红条提示并退回列表（对应旧 openFile 读取失败后的终态）
            }}
          />
        )}
      </div>
      {/* 详情面板（列表模式） */}
      {mode === 'list' && sel && !preview && (
        <div style={{ width: 240, flexShrink: 0 }}>
          <div className="panel">
            <div className="panel-title">文件详情</div>
            <div className="panel-body">
              <div className="detail-name">{sel.name}</div>
              <div className="dim small" style={{ wordBreak: 'break-all' }}>{relOf(sel)}</div>
              <table className="detail-table">
                <tbody>
                  <tr><td>状态</td><td>{sel.code ? `${CODE_DESC[sel.code] ?? sel.code} (${sel.code})` : '无变更'}</td></tr>
                  <tr><td>大小</td><td>{fmtSize(sel.size)}</td></tr>
                  <tr><td>修改时间</td><td>{sel.mtime}</td></tr>
                  <tr><td>类型</td><td>{sel.isDir ? '文件夹' : '文件'}</td></tr>
                </tbody>
              </table>
              <div className="row mt16" style={{ flexWrap: 'wrap', gap: 6 }}>
                {sel.code !== '' && sel.code !== '?' && <button className="mini" onClick={() => props.onDiff(relOf(sel))}>查看 diff</button>}
                {sel.code === '?' && <button className="mini" onClick={() => onAction('add', relOf(sel))}>添加到版本库</button>}
                {(sel.code === 'M' || sel.code === 'A' || sel.code === 'D') && (
                  <>
                    <button className="mini" onClick={() => onAction('revert', relOf(sel))}>还原</button>
                    <button className="mini" onClick={() => onAction('delete', relOf(sel), true)}>从版本库移除</button>
                  </>
                )}
                <button className="mini" onClick={() => props.onLog(relOf(sel))}>历史记录</button>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* 无历史记录提示（点击位置，1 秒后淡出） */}
      {noHist && (
        <div className="no-hist-tip" style={{ left: noHist.x, top: noHist.y }}>
          没有历史记录
        </div>
      )}

      {/* 忽略设置弹窗 */}
      {ignoreModal && (
        <IgnoreModal
          dir={ignoreModal.dir}
          onClose={() => setIgnoreModal(null)}
          onChanged={() => {
            ft.setFilterTreeTick((t) => t + 1); // 忽略规则增删 → ?/I 互换，过滤视图重拉
            if (mode === 'tree') loadNode('', true);
            else void load(dir, true);
          }}
          onToast={props.onToast}
        />
      )}
      {/* 加入忽略输入弹窗（替代 window.prompt） */}
      {ignoreAsk && (
        <ModalShell
          title={`⚠ 加入忽略（写入 ${IGNORE_WHERE_LABEL[ignoreTarget]}）`}
          width={440}
          onClose={() => setIgnoreAsk(null)}
          foot={
            <>
              <button onClick={() => setIgnoreAsk(null)}>取消</button>
              <button className="primary" disabled={!ignorePattern.trim()} onClick={doIgnore}>
                加入忽略
              </button>
            </>
          }
        >
          <div className="dim small" style={{ marginBottom: 8, wordBreak: 'break-all' }}>
            加入忽略规则（默认当前文件名）：<span className="mono">{ignoreAsk.rel}</span>
          </div>
          <FormRow label="规则">
            <input
              type="text"
              placeholder="如 *.log 或 目录名/"
              value={ignorePattern}
              onChange={(e) => setIgnorePattern(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && ignorePattern.trim()) doIgnore();
              }}
              autoFocus
            />
          </FormRow>
        </ModalShell>
      )}

      {/* 取消忽略确认弹窗：变回未版本化(?)后可右键「添加到版本库」 */}
      {unignoreAsk && (
        <ConfirmModal
          title="取消忽略"
          message={
            <div style={{ lineHeight: 1.7 }}>
              <div className="dim small mono" style={{ wordBreak: 'break-all' }}>
                {unignoreAsk.rel}（{unignoreAsk.isDir ? '目录' : '文件'}）
              </div>
              {props.repoType === 'git' ? (
                <div style={{ marginTop: 8 }}>
                  将向 <span className="mono">.gitignore</span> 追加否定规则，该项将变为未版本化（<b>?</b>），之后可右键「添加到版本库」。
                  {unignoreAsk.isDir && (
                    <div className="dim" style={{ marginTop: 6 }}>若匹配的是父目录规则，该目录下其他文件将按剩余规则重新判定。</div>
                  )}
                </div>
              ) : (
                <div style={{ marginTop: 8 }}>
                  将删除匹配的忽略规则，该项将变为未版本化（<b>?</b>），之后可右键「添加到版本库」。
                  <div className="dim" style={{ marginTop: 6 }}>同目录下匹配该规则的其他文件也会一起变为未版本化（?）。</div>
                </div>
              )}
            </div>
          }
          confirmLabel="取消忽略"
          onConfirm={doUnignore}
          onCancel={() => setUnignoreAsk(null)}
        />
      )}

      {/* md 文件说明注入弹窗 */}
      {moduleIndexModal && (
        <ModuleIndexDialog
          dir={data?.dir ?? ''}
          dirLabel={data?.dir ?? '（仓库根）'}
          md={moduleIndexModal.md}
          onClose={() => setModuleIndexModal(null)}
          onDone={loadModuleIndex}
          onToast={props.onToast}
        />
      )}

      {/* 常用文件夹管理弹窗 */}
      {favModal && (
        <FavDirsModal
          favs={favs}
          preload={preload}
          onRemove={removeFav}
          onPreloadAll={() => {
            for (const f of favs) preloadDir(f.path);
          }}
          onClose={() => setFavModal(false)}
        />
      )}

      {/* 右键菜单：延迟关闭/悬停保持逻辑在此控制（onMouseEnter/onMouseLeave 透传给菜单） */}
      {ctx && (
        <ContextMenu
          x={ctx.x}
          y={ctx.y}
          items={ctx.items}
          onClose={closeCtx}
          onMouseEnter={cancelCtxClose} // 鼠标移入菜单 → 取消延迟关闭
          onMouseLeave={closeCtxSoon} // 鼠标移出菜单 → 延迟关闭
        />
      )}
      <FileTipCard tip={tip} />
    </div>
  );
}
