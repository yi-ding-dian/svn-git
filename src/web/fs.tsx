/** 文件夹浏览视图：列表/树/浏览(网格)三模式，支持键盘导航（↑↓ 选择、→/Enter 进入、← 返回） */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { get, post, CODE_DESC, codeRank, type FsData, type FsEntry, type FilterTreeNode } from './api.js';
import { langOf, highlightLine } from './highlight.js';
import { IconDiff, IconRevert, IconClock, IconEyeOff, IconEye, IconLock, IconUnlock, IconCommit, IconPlus, IconClean, IconRefresh, IconFolder, IconList, IconTree, IconGrid, IconHome, IconUp, IconUpload, IconHistory, IconIgnore, IconStar, IconCopy, IconFile, IconExternal, GridIcon } from './icons.js';
import { CodeBadge, DirBadge } from './badges.js';
import { ContextMenu, type CtxMenuItem } from './context-menu.js';
import { IgnoreModal } from './ignore-modal.js';
import { FavDirsModal } from './fav-dirs.js';
import { renderMarkdown } from './markdown.js';
import { fmtSize, statusColor, translateVcsError, isBinaryFile } from './utils.js';
import { cmdOfRepo } from './cmd-preview.js';
/** 命令预览: 多路径缩写（前 3 个 + …） */
const joinPaths = (arr: string[]) => arr.slice(0, 3).join(' ') + (arr.length > 3 ? ' …' : '');
import { ModalShell } from './modal-shell.js';
import { FormRow } from './ui.js';
import { ConfirmModal } from './modals.js';

/** 「打开方式」程序图标：/api/icon 按 .desktop Icon 名查系统图标,缺失/失败回退通用文件图标 */
function AppIcon({ icon }: { icon: string }) {
  const [err, setErr] = useState(false);
  if (!icon || err) return <IconFile />;
  return (
    <img
      src={`/api/icon?k=${encodeURIComponent(icon)}`}
      alt=""
      width={16}
      height={16}
      style={{ objectFit: 'contain' }}
      onError={() => setErr(true)}
    />
  );
}

interface Props {
  tick: number;
  /** 当前视图是否激活（视图常驻挂载、display 切换；键盘监听只在激活时生效，防止隐藏时按键穿透误改状态） */
  active: boolean;
  repoType: 'svn' | 'git';
  /** 仓库根（切换仓库时重置浏览位置，避免残留上次目录） */
  repoRoot?: string | null;
  /** 操作范围(相对仓库根):大仓库打开的子项目,浏览从这里开始 */
  startRel?: string | null;
  onAction: (op: 'add' | 'revert' | 'delete' | 'commit', paths: string[]) => void;
  onDiff: (path: string) => void;
  onLog: (path: string) => void;
  onCommitSelect: (dir: string, dirLabel: string) => void;
  onUpdateDir: (dir: string) => void;
  onToast: (msg: string) => void;
}

type Filter = 'changed' | 'new' | 'deleted';
type Mode = 'list' | 'tree' | 'browse';

/** fs 列表排序优先级：与旧版本地 CODE_RANK 严格一致（X 外部引用视为无状态，不与干净条目区分优先级） */
const fsSortRank = (c: string): number => (c === 'X' ? 0 : codeRank(c));

/** 过滤（多选）：changed=仅修改，new=仅新文件；同时选 = 并集；空 = 全部 */
function filterEntries<T extends { code: string }>(list: T[], filters: Set<Filter>): T[] {
  if (filters.size === 0) return list;
  const wantChanged = filters.has('changed');
  const wantNew = filters.has('new');
  const wantDeleted = filters.has('deleted');
  // 修改状态精确枚举：排除 ?(未版本化)、I(被忽略)、X(外部引用) 与无状态
  const MODIFIED = new Set(['M', 'A', 'D', 'R', 'C', '!', '~', 'U']);
  return list.filter((e) => {
    const isChanged = MODIFIED.has(e.code);
    const isNew = e.code === '?';
    const isDeleted = e.code === 'D';
    return (wantChanged && isChanged) || (wantNew && isNew) || (wantDeleted && isDeleted);
  });
}

/** 树模式扁平化可见行 */
interface VisibleRow {
  rel: string;
  name: string;
  code: string;
  isDir: boolean;
  size: number;
  mtime: string;
  count?: number;
  codes?: string[];
  depth: number;
  open: boolean;
  locked?: boolean;
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
  const [preview, setPreview] = useState<{ name: string; text: string; note?: string; rel: string; img?: boolean } | null>(null);
  // md 文件渲染预览模式（预览按钮切换；false=原文高亮，true=Markdown 渲染）
  const [mdPreview, setMdPreview] = useState(false);
  const [blameMode, setBlameMode] = useState(false);
  const [blameData, setBlameData] = useState<{ rev: string; author: string; date: string; line: number; text: string }[]>([]);
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
  const lastWasDragRef = useRef(false);
  const [ignoreModal, setIgnoreModal] = useState<{ dir: string } | null>(null);
  /** 加入忽略输入弹窗（替代 window.prompt：目标文件 + 规则输入） */
  const [ignoreAsk, setIgnoreAsk] = useState<{ rel: string; name: string } | null>(null);
  const [ignorePattern, setIgnorePattern] = useState('');
  /** 取消忽略确认弹窗（忽略项右键：git 追加 !规则 / svn 删规则 → 变回未版本化 ?） */
  const [unignoreAsk, setUnignoreAsk] = useState<{ rel: string; name: string; isDir: boolean } | null>(null);
  /** md 预览图片放大查看（点击图片 → 全屏显示原图） */
  const [imgViewer, setImgViewer] = useState<string | null>(null);
  useEffect(() => {
    if (!imgViewer) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setImgViewer(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [imgViewer]);
  /** md-render 容器点击：目标是图片则放大查看 */
  const onMdRenderClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const t = e.target as HTMLElement;
    if (t.tagName === 'IMG') setImgViewer((t as HTMLImageElement).src);
  };
  const [focusIndex, setFocusIndex] = useState(0);
  // 网格目录悬浮提示（替代原生 title：状态字母带颜色、紧凑排列）
  const [tip, setTip] = useState<{ x: number; y: number; name: string; isDir?: boolean; count?: number; size?: number; mtime?: string; code?: string; codes?: string[] } | null>(null);

  // 原文预览搜索
  const [searchQ, setSearchQ] = useState('');
  const [searchActive, setSearchActive] = useState(false);
  const [matchIdx, setMatchIdx] = useState(0);
  // 文件搜索（工具栏）
  const [fileQuery, setFileQuery] = useState('');
  const [searchResults, setSearchResults] = useState<string[]>([]);
  const [showResults, setShowResults] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const [pendingLocate, setPendingLocate] = useState<{ rel: string; at: number } | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const rowRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const previewRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const gridRef = useRef<HTMLDivElement | null>(null);

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
  const favKey = (root: string) => `svnkit:fav-dirs:${root}`;
  const loadFavs = (root: string): FavDir[] => {
    try {
      return JSON.parse(localStorage.getItem(favKey(root)) ?? '[]') as FavDir[];
    } catch {
      return [];
    }
  };
  const [favs, setFavs] = useState<FavDir[]>(() => (props.repoRoot ? loadFavs(props.repoRoot) : []));
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

  // 过滤激活时：拉取过滤后的树（仅修改/仅新文件/仅删除 → 树视图展示，双击文件跳转定位）
  const [filterTree, setFilterTree] = useState<FilterTreeNode[] | null>(null);
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
      .filteredTree(data?.dir ?? '', codes)
      .then((r) => {
        if (!cancelled) setFilterTree(r.tree);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [filters, data?.dir, props.tick]); // tick: 操作(添加/还原等)成功后 refresh() 会重置过滤树,防旧 ?/M 状态残留
  /** 过滤树双击文件 → 跳转到所在文件夹并选中（清除过滤恢复原视图） */
  const jumpToFile = (rel: string) => {
    const idx = rel.lastIndexOf('/');
    const parent = idx >= 0 ? rel.slice(0, idx) : '';
    setDir(parent);
    setSelected(new Set([rel]));
    setFocusIndex(0);
    setFilters(new Set());
    setMode(prevModeRef.current);
  };
  // 过滤树：转成扁平行（复用树列表行渲染），默认全展开，目录可点击收起
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
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
        const open = n.isDir && !collapsed.has(n.path);
        rows.push({
          rel: n.path,
          name: n.name,
          code: n.isDir ? '' : n.code,
          isDir: n.isDir,
          size: n.size ?? 0,
          mtime: n.mtime ?? '',
          count: n.isDir ? countFiles(n) : undefined,
          depth,
          open,
          locked: false,
        });
        if (n.isDir && open) walk(n.children, depth + 1);
      }
    };
    walk(filterTree ?? [], 0);
    return rows;
  }, [filterTree, collapsed]);
  /** 树行渲染（树列表与过滤树共用；filtered=true 时目录点击折叠、双击文件跳转） */
  const renderTreeRow = (row: VisibleRow, i: number, filtered: boolean) => (
    <div
      key={row.rel}
      ref={(el) => {
        if (el) rowRefs.current.set(row.rel, el);
        else rowRefs.current.delete(row.rel); // 行卸载（收起/切换模式）时移除，避免残留导致泄漏
      }}
      className={`tree-row ${searchResults.includes(row.rel) ? 'search-hit' : ''}`}
      style={{
        paddingLeft: 8 + row.depth * 18,
        background: i === focusIndex || selected.has(row.rel) ? 'var(--panel2)' : undefined,
        outline: i === focusIndex ? '1px solid var(--accent)' : selected.has(row.rel) ? '1px solid var(--accent)' : undefined,
      }}
      onMouseEnter={(ev) => {
        if (!ctxLocked) setFocusIndex(-1);
        else if (ctxRelRef.current === row.rel) cancelCtxClose(); // 鼠标回到右键的条目，保持菜单
        // 悬浮卡片: 显示名称/大小/修改时间/状态(与浏览网格一致)
        setTip({
          x: ev.clientX, y: ev.clientY, name: row.name, isDir: row.isDir,
          size: row.size, mtime: row.mtime, code: row.code, codes: row.codes, count: row.count,
        });
      }}
      onMouseLeave={() => {
        closeCtxSoon();
        setTip(null);
      }}
      onClick={(ev) => {
        onRowClick(row.rel, i, ev, { name: row.name, isDir: row.isDir, code: row.code, size: row.size, mtime: row.mtime, relPath: row.rel } as FsEntry);
        if (row.isDir && !ev.ctrlKey && !ev.shiftKey) {
          if (filtered) {
            // 过滤树：本地折叠（数据已全量，无需再加载）
            setCollapsed((s) => {
              const n = new Set(s);
              if (n.has(row.rel)) n.delete(row.rel);
              else n.add(row.rel);
              return n;
            });
          } else {
            toggleExpand(row.rel); // Ctrl/Shift 时仅选择不展开
          }
        }
      }}
      onDoubleClick={() => {
        setTip(null); // 双击即关闭悬浮卡片
        if (filtered) {
          if (!row.isDir) jumpToFile(row.rel);
        } else if (!row.isDir) void openFile(row.name, row.code, row.rel);
      }}
      onContextMenu={(ev) => onRowContext(ev, { isDir: row.isDir, code: row.code, rel: row.rel, name: row.name }, i)}
      // 悬浮信息卡片替代原生 title（见 onMouseEnter setTip）
    >
      {row.isDir ? <DirBadge codes={row.codes} /> : <CodeBadge code={row.code} />}
      <span className="arrow">{row.isDir ? (row.open ? '▾' : '▸') : ''}</span>
      {row.locked && <IconLock size={13} />}
      <span className={`name ${row.isDir ? 'dir' : 'file'}`} style={{ flex: 1, color: statusColor(row.isDir ? row.codes?.[0] : row.code) }}>
        {row.name}
        {row.count ? <span className="count"> （{row.count} 项）</span> : null}
      </span>
      {!filtered && !row.isDir && <span className="dim small nowrap">{fmtSize(row.size)}</span>}
      {!filtered && !row.isDir && <span className="dim small nowrap" style={{ width: 110 }}>{row.mtime}</span>}
      {rowButtons(row)}
    </div>
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

  /** 打开文件：有变更 → diff；无变更 → 原文 */
  const openFile = useCallback(
    async (name: string, code: string, rel: string) => {
      setTip(null); // 双击打开时关闭悬浮卡片（视图切换后不会再触发 mouseleave,需主动清）
      // 图片文件：双击直接看图（不读文本/diff,避免二进制乱码与"不支持文本对比"提示）
      if (/.(png|jpe?g|gif|svg|webp|bmp|ico)$/i.test(rel)) {
        setPreview({ name, text: '', rel, img: true });
        setMdPreview(false);
        setBlameMode(false);
        setBlameData([]);
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
      try {
        const r = await get.cat(rel);
        if (!r.ok) throw new Error(r.error ?? '读取失败');
        setPreview({ name, text: r.output, note: code === '?' ? '未版本化文件（原文）' : '无差异 — 文件原文', rel });
        setMdPreview(false); // 重新打开文件回到原文模式
        setBlameMode(false);
        setBlameData([]);
      } catch (err) {
        setError((err as Error).message);
      }
    },
    [props]
  );

  /** 追溯（Blame）：逐行标注提交/作者 */
  const toggleBlame = useCallback(async () => {
    if (!preview) return;
    if (blameMode) {
      setBlameMode(false);
      return;
    }
    try {
      const r = await get.blame(preview.rel);
      setBlameData(r.lines);
      setBlameMode(true);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [preview, blameMode]);

  type FsOp = 'add' | 'commit' | 'revert' | 'delete';
  const onAction = (op: FsOp, rel: string) => props.onAction(op, [rel]);

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

  // ---------- 原文预览搜索 ----------
  const previewLines = useMemo(() => (preview ? preview.text.split('\n') : []), [preview]);
  const matches = useMemo(() => {
    if (!searchActive || !searchQ.trim()) return [] as number[];
    const q = searchQ.toLowerCase();
    const out: number[] = [];
    previewLines.forEach((l, i) => {
      if (l.toLowerCase().includes(q)) out.push(i);
    });
    return out;
  }, [previewLines, searchActive, searchQ]);

  const goNextMatch = useCallback(() => {
    if (matches.length === 0) return;
    const next = (matchIdx + 1) % matches.length;
    setMatchIdx(next);
    const el = previewRefs.current.get(matches[next]!);
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [matches, matchIdx]);

  // 文件搜索（防抖）：仅显示结果下拉 + 当前目录匹配项框选，不自动跳转（点击/回车才定位）
  useEffect(() => {
    const q = fileQuery.trim();
    // 门槛：至少 2 个字符，或 1 个汉字
    const isCn = /[一-鿿]/.test(q);
    if (!q || q.length < (isCn ? 1 : 2)) {
      setSearchResults([]);
      setShowResults(false);
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      get
        .search(fileQuery, data?.dir ?? '')
        .then((r) => {
          setSearchResults(r.paths);
          setShowResults(true);
          setMatchIdx(0);
        })
        .catch(() => {});
    }, 400);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [fileQuery, data?.dir]);

  // 当前目录下的匹配文件名（网格/列表框选高亮）
  const currentMatchNames = useMemo(() => {
    if (!data) return new Set<string>();
    const prefix = data.dir ? data.dir + '/' : '';
    const set = new Set<string>();
    for (const p of searchResults) {
      if (p.startsWith(prefix)) {
        const rest = p.slice(prefix.length);
        if (rest && !rest.includes('/')) set.add(rest);
      }
    }
    return set;
  }, [searchResults, data]);

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
        setFocusIndex(idx);
        rowRefs.current.get(pendingLocate.rel)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
        setPendingLocate(null);
      }
    } else {
      const parent = pendingLocate.rel.includes('/') ? pendingLocate.rel.slice(0, pendingLocate.rel.lastIndexOf('/')) : '';
      if (data?.dir === parent) {
        const idx = listEntries.findIndex((e) => (parent ? `${parent}/${e.name}` : e.name) === pendingLocate.rel);
        if (idx >= 0) {
          setFocusIndex(idx);
          setSel(listEntries[idx]!);
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
  const matchIdxRef = useRef(matchIdx);
  matchIdxRef.current = matchIdx;
  const matchesRef = useRef(matches);
  matchesRef.current = matches;
  const goNextRef = useRef(goNextMatch);
  goNextRef.current = goNextMatch;
  const searchActiveRef = useRef(searchActive);
  searchActiveRef.current = searchActive;

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
      if (preview) {
        if (searchActiveRef.current) {
          if (e.key === 'Escape') setSearchActive(false);
          return;
        }
        if (e.key === 'Escape' || e.key === 'ArrowLeft' || e.key === 'Backspace') {
          e.preventDefault();
          setPreview(null); // ← 返回列表
          return;
        }
        if (e.key === '/') {
          e.preventDefault();
          setSearchActive(true);
          setSearchQ('');
          setMatchIdx(0);
          return;
        }
        return;
      }
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

  const onBlankContext = (e: React.MouseEvent) => {
    e.preventDefault();
    setTip(null); // 空白右键同样关闭悬浮卡片
    cancelCtxClose();
    ctxRelRef.current = null; // 空白右键：任何条目都不算"原条目"，鼠标离开即关
    setCtxLocked(false); // 空白右键不锁定任何条目（防止前一次右键的锁定残留）
    const items: CtxItem[] = [
      { icon: <IconRefresh />, label: '更新当前目录', cmd: cmdOfRepo(props.repoType, 'update', { path: data?.dir ?? '' }), action: () => props.onUpdateDir(data?.dir ?? '') },
      { icon: <IconUpload />, label: '提交修改的文件…', cmd: cmdOfRepo(props.repoType, 'commit', { msg: '…' }), action: () => props.onCommitSelect(data?.dir ?? '', data?.dir ?? '') },
      { icon: <IconHistory />, label: '查看历史记录', cmd: cmdOfRepo(props.repoType, 'view_history', { path: data?.dir ?? '.' }), action: () => props.onLog(data?.dir ?? '') },
      {
        icon: <IconCopy />,
        label: '复制当前路径',
        action: () => {
          const abs = data?.root ? `${data.root}${data?.dir ? `/${data.dir}` : ''}` : (data?.dir ?? '');
          void navigator.clipboard?.writeText(abs).then(() => props.onToast('当前路径已复制'));
        },
      },
      { icon: <IconFolder />, label: '打开文件管理器', action: () => openInFm(data?.dir ?? '') },
    ];
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
    const items: CtxItem[] = [];
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
      const tNew = tArr.filter((x) => x.code === '?');
      const tMod = tArr.filter((x) => ['M', 'A', 'D', 'R', 'C'].includes(x.code));
      if (tNew.length) {
        items.push({ icon: <IconPlus />, label: `添加到版本库（${tNew.length} 项）`, cmd: cmdOfRepo(props.repoType, 'add', { paths: joinPaths(tNew.map((x) => x.rel)) }), action: () => props.onAction('add', tNew.map((x) => x.rel)) });
      }
      if (tMod.length) {
        items.push({ icon: <IconUpload />, label: `提交修改（${tMod.length} 项）…`, cmd: cmdOfRepo(props.repoType, 'commit', { msg: '…' }), action: () => props.onAction('commit', tMod.map((x) => x.rel)) });
        items.push({ icon: <IconRevert />, label: `还原（${tMod.length} 项）`, cmd: cmdOfRepo(props.repoType, 'revert', { paths: joinPaths(tMod.map((x) => x.rel)) }), action: () => props.onAction('revert', tMod.map((x) => x.rel)) });
        items.push({ icon: <IconClean />, label: `删除（${tMod.length} 项）`, danger: true, cmd: cmdOfRepo(props.repoType, 'delete', { paths: joinPaths(tMod.map((x) => x.rel)) }), action: () => props.onAction('delete', tMod.map((x) => x.rel)) });
      }
      // 集合内无任何可操作项（全是干净/失效条目）时不加多余分隔线
      if (tNew.length || tMod.length) items.push({ sep: true });
      items.push({
        icon: <IconCopy />,
        label: `复制完整路径（${tArr.length} 项）`,
        action: () => {
          const abs = data?.root ? tArr.map((x) => `${data.root}/${x.rel}`).join('\n') : tArr.map((x) => x.rel).join('\n');
          void navigator.clipboard?.writeText(abs).then(() => props.onToast(`已复制 ${tArr.length} 个完整路径`));
        },
      });
      setCtx({ ...ctxPos(e, items.length), items });
      return;
    }
    // 单选（原有逻辑）：右键不在选中集合时，清空多选只留右键项
    setSelected(new Set([t.rel]));
    if (t.isDir) {
      if (t.code === 'I') {
        // 忽略目录：无版本操作（更新/提交/还原/历史均无意义），仅忽略设置/取消忽略/删除(git 可磁盘删)
        items.push({ icon: <IconIgnore />, label: '忽略设置…', action: () => setIgnoreModal({ dir: t.rel }) });
        items.push({ icon: <IconEyeOff />, label: '取消忽略', action: () => setUnignoreAsk({ rel: t.rel, name: t.name, isDir: true }) });
        if (props.repoType === 'git') {
          items.push({ sep: true });
          items.push({ icon: <IconClean />, label: '删除目录', danger: true, cmd: cmdOfRepo(props.repoType, 'delete', { paths: t.rel }), action: () => props.onAction('delete', [t.rel]) });
        }
      } else if (t.code !== '?') {
        // 版本化目录：更新/提交/还原/历史/忽略设置/删除（无 diff）
        items.push({ icon: <IconRefresh />, label: '更新此目录', cmd: cmdOfRepo(props.repoType, 'update', { path: t.rel }), action: () => props.onUpdateDir(t.rel) });
        if (t.code) {
          items.push({ icon: <IconUpload />, label: '提交此目录修改…', cmd: cmdOfRepo(props.repoType, 'commit', { msg: '…' }), action: () => props.onCommitSelect(t.rel, t.rel) });
          items.push({ sep: true });
          items.push({ icon: <IconRevert />, label: '还原目录', cmd: cmdOfRepo(props.repoType, 'revert', { paths: t.rel }), action: () => props.onAction('revert', [t.rel]) });
        }
        items.push({ sep: true });
        items.push({ icon: <IconHistory />, label: '查看历史', cmd: cmdOfRepo(props.repoType, 'view_history', { path: t.rel }), action: () => viewHistory(t.rel, e) });
        items.push({ icon: <IconIgnore />, label: '忽略设置…', cmd: cmdOfRepo(props.repoType, 'ignore_add', { path: t.rel, pattern: '…' }), action: () => setIgnoreModal({ dir: t.rel }) });
        // 常用文件夹（仅 svn：git 加载快无需预加载）：自身已加入显示移除；父目录已加入则不再显示；其余显示加入
        if (props.repoType === 'svn') {
          if (favs.some((f) => f.path === t.rel)) {
            items.push({ icon: <IconStar />, label: '已加入常用文件夹（点击移除）', action: () => removeFav(t.rel) });
          } else if (!favs.some((f) => t.rel.startsWith(f.path + '/'))) {
            items.push({ icon: <IconStar />, label: '加入常用文件夹（预加载缓存）', action: () => addFavDir(t.rel) });
          }
        }
        // 已版本化且磁盘存在（非 '!' 缺失）才可删除
        if (t.code !== '!') {
          items.push({ sep: true });
          items.push({ icon: <IconClean />, label: '删除目录', danger: true, cmd: cmdOfRepo(props.repoType, 'delete', { paths: t.rel }), action: () => props.onAction('delete', [t.rel]) });
        }
      } else {
        // 未版本化目录：只能添加/忽略（无历史/无 diff/无忽略设置/不可删除——不在版本管理里）
        items.push({ icon: <IconPlus />, label: '添加到版本库', cmd: cmdOfRepo(props.repoType, 'add', { paths: t.rel }), action: () => props.onAction('add', [t.rel]) });
        items.push({ icon: <IconIgnore />, label: '加入忽略…', cmd: cmdOfRepo(props.repoType, 'ignore_add', { path: t.rel, pattern: '…' }), action: () => ignoreFile(t) });
        // 常用文件夹（仅 svn：git 加载快无需预加载）：自身已加入显示移除；父目录已加入则不再显示；其余显示加入
        if (props.repoType === 'svn') {
          if (favs.some((f) => f.path === t.rel)) {
            items.push({ icon: <IconStar />, label: '已加入常用文件夹（点击移除）', action: () => removeFav(t.rel) });
          } else if (!favs.some((f) => t.rel.startsWith(f.path + '/'))) {
            items.push({ icon: <IconStar />, label: '加入常用文件夹（预加载缓存）', action: () => addFavDir(t.rel) });
          }
        }
      }
    } else {
      // 文件
      if (t.code === 'I') {
        // 忽略文件：仅取消忽略/删除(git 可磁盘删)/查看内容（无版本操作：差异/历史/锁定均无意义）
        items.push({ icon: <IconEyeOff />, label: '取消忽略', action: () => setUnignoreAsk({ rel: t.rel, name: t.name, isDir: false }) });
        if (props.repoType === 'git') {
          items.push({ sep: true });
          items.push({ icon: <IconClean />, label: '删除', danger: true, action: () => props.onAction('delete', [t.rel]) });
        }
        items.push({ sep: true });
        items.push({ icon: <IconFile />, label: '查看内容', action: () => void openFile(t.name, t.code, t.rel) });
      } else {
        if (t.code && t.code !== '?') items.push({ icon: <IconDiff />, label: '查看差异', cmd: cmdOfRepo(props.repoType, 'diff', { path: t.rel }), action: () => props.onDiff(t.rel) });
        if (t.code === '?') {
          // 未版本化文件：只能添加/忽略（不可删除——不在版本管理里）
          items.push({ icon: <IconPlus />, label: '添加到版本库', cmd: cmdOfRepo(props.repoType, 'add', { paths: t.rel }), action: () => props.onAction('add', [t.rel]) });
          items.push({ icon: <IconIgnore />, label: '加入忽略…', cmd: cmdOfRepo(props.repoType, 'ignore_add', { path: t.rel, pattern: '…' }), action: () => ignoreFile(t) });
        } else {
          const modified = t.code === 'M' || t.code === 'A' || t.code === 'D' || t.code === 'R' || t.code === 'C';
          if (modified) {
            items.push({ sep: true });
            items.push({ icon: <IconUpload />, label: '提交此文件', cmd: cmdOfRepo(props.repoType, 'commit', { msg: '…' }), action: () => props.onAction('commit', [t.rel]) });
            items.push({ icon: <IconRevert />, label: '还原', cmd: cmdOfRepo(props.repoType, 'revert', { paths: t.rel }), action: () => props.onAction('revert', [t.rel]) });
          }
          // 已版本化且磁盘存在（非 '!' 缺失）才可删除：干净文件也提供删除
          if (t.code !== '!') {
            items.push({ sep: true });
            items.push({ icon: <IconClean />, label: '删除', danger: true, cmd: cmdOfRepo(props.repoType, 'delete', { paths: t.rel }), action: () => props.onAction('delete', [t.rel]) });
          }
        }
        items.push({ sep: true });
        items.push({ icon: <IconFile />, label: '查看内容', action: () => void openFile(t.name, t.code, t.rel) });
        // 未版本化文件无历史记录 → 不显示"查看历史"
        if (t.code !== '?') items.push({ icon: <IconHistory />, label: '查看历史', cmd: cmdOfRepo(props.repoType, 'view_history', { path: t.rel }), action: () => viewHistory(t.rel, e) });
        if (props.repoType === 'svn' && t.code !== '?') {
          items.push({ sep: true });
          items.push({ icon: <IconLock />, label: '锁定', action: () => svnLock(t.rel, 'lock') });
          items.push({ icon: <IconUnlock />, label: '解锁', action: () => svnLock(t.rel, 'unlock') });
        }
      }
    }
    items.push({ sep: true });
    // 打开方式：所有文件都提供（办公文档/图片/文本/代码……二进制按扩展映射表匹配,文本类型回退 text/plain）
    {
      const ext = t.name.split('.').pop()!.toLowerCase();
      items.push({
        icon: <IconExternal />,
        label: '打开方式…',
        submenu: [{ label: '正在检测系统程序…', action: () => {} }],
      });
      const owIdx = items.length - 1;
      void get
        .appsFor(ext)
        .then((r) => {
          // 第一项「系统默认程序」：任何平台都能用（win=Start-Process / linux=xdg-open）,无需 .desktop 清单
          const subs = [
            {
              label: '系统默认程序',
              icon: <IconExternal />,
              action: () => {
                void post
                  .openWith(t.rel, '')
                  .then((x) => props.onToast(x.message ?? '已打开'))
                  .catch((er: Error) => props.onToast(`打开失败: ${er.message}`));
              },
            },
            ...(r.apps ?? []).slice(0, 5).map((a) => ({
              label: a.name,
              icon: <AppIcon icon={a.icon} />,
              action: () => {
                void post
                  .openWith(t.rel, a.exec)
                  .then((x) => props.onToast(x.message ?? '已打开'))
                  .catch((er: Error) => props.onToast(`打开失败: ${er.message}`));
              },
            })),
            // Windows 额外提供「选择其他应用…」（调系统打开方式选择器兜底，处理无默认程序/二进制文档）
            ...(r.chooseOpen
              ? [
                  {
                    label: '选择其他应用…',
                    icon: <IconExternal />,
                    action: () => {
                      void post
                        .openWith(t.rel, r.chooseOpen!)
                        .then((x) => props.onToast(x.message ?? '已打开'))
                        .catch((er: Error) => props.onToast(`打开失败: ${er.message}`));
                    },
                  },
                ]
              : []),
          ];
          setCtx((cur) =>
            cur && cur.items[owIdx]?.label === '打开方式…'
              ? {
                  ...cur,
                  items: cur.items.map((it, i) => (i === owIdx ? { ...it, submenu: subs.length ? subs : [{ label: '未检测到可用程序', action: () => {} }] } : it)),
                }
              : cur
          );
        })
        .catch(() => {});
    }
    items.push({
      icon: <IconCopy />,
      label: '复制完整路径',
      action: () => {
        // 复制文件在电脑上的完整路径（如 /data/.../bin/debug/libDataServer.so）
        const abs = data?.root ? `${data.root}/${t.rel}` : t.rel;
        void navigator.clipboard?.writeText(abs).then(() => props.onToast('完整路径已复制'));
      },
    });
    items.push({
      icon: <IconFile />,
      label: '复制文件名',
      action: () => {
        void navigator.clipboard?.writeText(t.name).then(() => props.onToast('文件名已复制'));
      },
    });
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
      .ignore(ignoreAsk.rel, pattern)
      .then((r) => {
        props.onToast(r.message);
        if (r.ok) {
          if (mode === 'tree') loadNode('', true);
          else void load(dir, true);
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
        className={`tree-row ${isMatch ? 'search-hit' : ''}`}
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
          if (e.isDir && !ev.ctrlKey && !ev.shiftKey) setDir(rel); // Ctrl/Shift 时仅选择不进入
        }}
        onDoubleClick={() => {
          setTip(null); // 双击即关闭悬浮卡片
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
        </span>
        {!e.isDir && <span className="dim small nowrap">{fmtSize(e.size)}</span>}
        {!e.isDir && <span className="dim small nowrap" style={{ width: 110 }}>{e.mtime}</span>}
        {rowButtons({ ...e, rel })}
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

  const rowButtons = (e: { code: string; isDir: boolean; rel: string; name: string }) => (
    <span className="actions" onClick={(ev) => ev.stopPropagation()}>
      {/* diff 仅限版本化文件（文件夹无 diff；未版本化/干净文件无差异可看） */}
      {e.code !== '' && e.code !== '?' && !e.isDir && (
        <ActionBtn icon={<IconDiff />} label="diff" title="查看差异" cmd={cmdOfRepo(props.repoType, 'diff', { path: e.rel })} onClick={() => props.onDiff(e.rel)} />
      )}
      {e.code === '?' && (
        <>
          <ActionBtn icon={<IconPlus />} label="添加" cmd={cmdOfRepo(props.repoType, 'add', { paths: e.rel })} onClick={() => onAction('add', e.rel)} />
          <ActionBtn icon={<IconEyeOff />} label="忽略" title="加入忽略" cmd={cmdOfRepo(props.repoType, 'ignore_add', { path: e.rel, pattern: '…' })} onClick={() => ignoreFile(e)} />
        </>
      )}
      {e.isDir && e.code && e.code !== '?' && (
        <ActionBtn icon={<IconCommit />} label="提交" title="提交此目录修改" cmd={cmdOfRepo(props.repoType, 'commit', { msg: '…' })} onClick={() => props.onAction('commit', [e.rel])} />
      )}
      {(e.code === 'M' || e.code === 'A' || e.code === 'D' || e.code === 'R') && (
        <>
          <ActionBtn icon={<IconRevert />} label="还原" cmd={cmdOfRepo(props.repoType, 'revert', { paths: e.rel })} onClick={() => onAction('revert', e.rel)} />
          <ActionBtn icon={<IconClean />} label="删除" danger cmd={cmdOfRepo(props.repoType, 'delete', { paths: e.rel })} onClick={() => onAction('delete', e.rel)} />
        </>
      )}
      {!e.isDir && e.code !== '?' && props.repoType === 'svn' && (
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
            }}
            title="上一级"
            style={{ marginLeft: 12 }}
          >
            <IconUp /> 上级
          </button>
          <span className="row" style={{ position: 'relative' }}>
            <span style={{ position: 'relative' }}>
              <input
                type="text"
                placeholder="🔍 搜索文件…"
                value={fileQuery}
                onChange={(e) => {
                  setFileQuery(e.target.value);
                  setActiveIdx(0);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    setActiveIdx((i) => Math.min(searchResults.length - 1, i + 1));
                  } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setActiveIdx((i) => Math.max(0, i - 1));
                  } else if (e.key === 'Enter') {
                    if (searchResults.length > 0) {
                      const at = Math.min(activeIdx, searchResults.length - 1);
                      setPendingLocate({ rel: searchResults[at]!, at });
                      setMatchIdx(0);
                    }
                  } else if (e.key === 'Escape') {
                    setFileQuery('');
                    setShowResults(false);
                  }
                }}
                style={{ width: 170, paddingRight: 24 }}
              />
              {fileQuery && (
                <button
                  className="search-clear"
                  title="清空"
                  onClick={() => {
                    setFileQuery('');
                    setShowResults(false);
                    setActiveIdx(0);
                  }}
                >
                  ×
                </button>
              )}
            </span>
            {showResults && fileQuery.trim() && (
              <div className="search-drop">
                {searchResults.length === 0 && <div className="dim" style={{ padding: '6px 10px' }}>无匹配文件</div>}
                {searchResults.slice(0, 10).map((p, i) => (
                  <div
                    key={p}
                    className={`search-item ${i === activeIdx ? 'active' : ''}`}
                    onClick={() => {
                      setPendingLocate({ rel: p, at: i });
                      setMatchIdx(0);
                      setActiveIdx(i);
                    }}
                  >
                    <span className="dim" style={{ flexShrink: 0 }}>{i + 1}.</span>
                    <span className="search-path" title={p}>{p}</span>
                  </div>
                ))}
                {searchResults.length > 10 && <div className="dim" style={{ padding: '4px 10px' }}>…共 {searchResults.length} 个匹配</div>}
              </div>
            )}
          </span>
          <span className="dim small">（{rows.length} 项 · 键盘: ↑↓ 选择 · →/Enter 进入 · ← 返回 · 空白处右键菜单）</span>
        </div>
        {/* 面包屑导航（所有模式，从仓库根开始） */}
        <div className="breadcrumb" style={{ marginBottom: 8, overflowX: 'auto', whiteSpace: 'nowrap', flexShrink: 0 }}>
          {breadcrumbs.map((b, i) => (
            <React.Fragment key={i}>
              {i > 0 && <span style={{ margin: '0 4px', color: 'var(--dim)' }}>›</span>}
              <a
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  // 树模式：展开父链并高亮 + 同步当前位置；列表/浏览：直接跳转
                  if (mode === 'tree') {
                    setDir(b.rel);
                    setPendingLocate({ rel: b.rel, at: 0 });
                  } else {
                    setDir(b.rel);
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
        {error && <div className="error">{error}</div>}
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
              filterTree && filterTree.length === 0 ? (
                <div className="empty">没有符合条件的文件</div>
              ) : (
                filterRows.map((row, i) => renderTreeRow(row, i, true))
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
              // 空白处按下启动框选（点击条目由条目自身处理）
              if ((ev.target as HTMLElement).closest('.grid-item')) return;
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
              const focused = i === focusIndex;
              const multi = selected.has(rel);
              // 网格模式：目录状态字母最多显示 2 个（按优先级 C>!>D>M>A>R>~>U，多字母横排会超出图标宽度），
              // 完整状态集合放进悬浮提示
              const dirCodes =
                e.isDir && e.codes && e.codes.length > 2
                  ? [...e.codes].sort((a, b) => codeRank(b) - codeRank(a)).slice(0, 2)
                  : e.codes;
              return (
                <div
                  key={rel}
                  className={`grid-item ${focused || multi ? 'selected' : ''} ${currentMatchNames.has(e.name) ? 'search-hit' : ''}`}
                  ref={(el) => {
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
                    });
                  }}
                  onMouseLeave={() => {
                    closeCtxSoon();
                    setTip(null);
                  }}
                  onClick={(ev) => onRowClick(rel, i, ev, e)}
                  onDoubleClick={() => {
                    setTip(null); // 双击即关闭悬浮卡片
                    if (e.isDir) setDir(rel);
                    else void openFile(e.name, e.code, rel);
                  }}
                  onContextMenu={(ev) => onRowContext(ev, { isDir: e.isDir, code: e.code, rel, name: e.name }, i)}
                >
                  {/* 图标 + 状态角标（叠在图标右下角，文件管理器风格） */}
                  <span className="grid-icon-wrap">
                    <GridIcon isDir={e.isDir} name={e.name} />
                    <span className="grid-badge">
                      {e.isDir ? <DirBadge codes={dirCodes} /> : <CodeBadge code={e.code} />}
                      {/* 目录：修改项数量标识（如 M 旁 15） */}
                      {e.isDir && e.count ? <span className="grid-count" title={`${e.count} 项有变更`}>{e.count}</span> : null}
                      {data?.selfLocked?.includes(rel) && <IconLock size={13} />}
                    </span>
                  </span>
                  <span className={`grid-name ${e.isDir ? 'dir' : ''}`}>{e.name}</span>
                  {!e.isDir && <span className="dim small nowrap">{fmtSize(e.size)}</span>}
                  {/* 悬浮操作面板已屏蔽（用户要求）：操作走右键菜单 */}
                </div>
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
        {/* 文件预览（语法高亮 + 搜索） */}
        {preview && (
          <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            <div className="row" style={{ marginBottom: 8, flexWrap: 'wrap' }}>
              <span className="dim">{preview.name}</span>
              {preview.note && <span className="small" style={{ color: 'var(--accent)' }}>ℹ {preview.note}</span>}
              {searchActive ? (
                <span className="row" style={{ gap: 6 }}>
                  <input
                    autoFocus
                    type="text"
                    placeholder="搜索代码…"
                    value={searchQ}
                    onChange={(e) => {
                      setSearchQ(e.target.value);
                      setMatchIdx(0);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') goNextMatch();
                      if (e.key === 'Escape') setSearchActive(false);
                    }}
                    style={{ width: 200 }}
                  />
                  <span className="dim small">
                    {searchQ.trim() && matches.length > 0 ? `${matchIdx + 1}/${matches.length}` : searchQ.trim() ? '无匹配' : ''}
                  </span>
                  <button className="mini" onClick={goNextMatch}>下一个 ↓</button>
                </span>
              ) : (
                <button className="mini" onClick={() => setSearchActive(true)}>🔍 搜索 (/)</button>
              )}
              <button className={`mini ${blameMode ? 'primary' : ''}`} onClick={() => void toggleBlame()} title="逐行标注提交/作者">
                📜 追溯
              </button>
              <span className="grow" />
              {preview.name.toLowerCase().endsWith('.md') && (
                <button className="mini" onClick={() => setMdPreview((v) => !v)} title="Markdown 渲染预览">
                  {mdPreview ? '📄 查看原文' : '👁 预览'}
                </button>
              )}
              <span className="dim small">← 键返回列表 · / 搜索</span>
              <button className="mini" onClick={() => setPreview(null)}>← 返回列表</button>
            </div>
            <div className="diff" style={{ flex: 1, overflow: 'auto' }}>
              {/* 图片预览：直接显示图片（点击放大复用 md-render 的放大机制） */}
              {preview.img ? (
                <div
                  className="md-render"
                  onClick={onMdRenderClick}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100%', padding: 16 }}
                >
                  <img
                    src={`/api/file?path=${encodeURIComponent(preview.rel)}`}
                    alt={preview.name}
                    style={{ maxWidth: '100%', maxHeight: 'calc(100% - 40px)', objectFit: 'contain', borderRadius: 6, cursor: 'zoom-in' }}
                    onError={(e) => setError(`图片读取失败: ${(e.target as HTMLImageElement).alt}`)}
                  />
                </div>
              ) : mdPreview && preview.name.toLowerCase().endsWith('.md') ? (
                <div
                  className="md-render"
                  onClick={onMdRenderClick}
                  dangerouslySetInnerHTML={{
                    __html: renderMarkdown(preview.text, { baseDir: preview.rel.includes('/') ? preview.rel.slice(0, preview.rel.lastIndexOf('/')) : '' }),
                  }}
                />
              ) : blameMode ? (
                // Blame 视图：行前缀显示 版本+作者
                blameData.map((b, i) => {
                  const isHit = searchActive && matches.includes(i);
                  const isCur = isHit && i === matches[matchIdx % Math.max(1, matches.length)];
                  return (
                    <div
                      key={i}
                      ref={(el) => {
                        if (el) previewRefs.current.set(i, el);
                      }}
                      className={`pv-line ${isHit ? 'pv-hit' : ''} ${isCur ? 'pv-cur' : ''}`}
                      title={`${b.rev} · ${b.author}${b.date ? ' · ' + b.date : ''}`}
                    >
                      <span className="blame-meta">{b.rev} {b.author}</span>
                      <span dangerouslySetInnerHTML={{ __html: highlightLine(b.text, langOf(preview.name)) }} />
                    </div>
                  );
                })
              ) : (
                previewLines.map((line, i) => {
                  const isHit = searchActive && matches.includes(i);
                  const isCur = isHit && i === matches[matchIdx % Math.max(1, matches.length)];
                  return (
                    <div
                      key={i}
                      ref={(el) => {
                        if (el) previewRefs.current.set(i, el);
                      }}
                      className={`pv-line ${isHit ? 'pv-hit' : ''} ${isCur ? 'pv-cur' : ''}`}
                    >
                      <span className="sb-no">{i + 1}</span>
                      <span className="pv-src" dangerouslySetInnerHTML={{ __html: highlightLine(line, langOf(preview.name)) }} />
                    </div>
                  );
                })
              )}
            </div>
          </div>
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
                    <button className="mini danger" onClick={() => onAction('delete', relOf(sel))}>删除</button>
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
          onChanged={() => (mode === 'tree' ? loadNode('', true) : void load(dir, true))}
          onToast={props.onToast}
        />
      )}
      {/* 加入忽略输入弹窗（替代 window.prompt） */}
      {ignoreAsk && (
        <ModalShell
          title="⚠ 加入忽略"
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
      {/* md 预览图片放大查看：全屏深色遮罩 + 原图自适应，点击遮罩 / ESC 关闭 */}
      {imgViewer && (
        <div
          className="modal-mask"
          style={{
            background: 'rgba(0,0,0,.78)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'zoom-out',
            zIndex: 500,
          }}
          onClick={() => setImgViewer(null)}
          title="点击关闭（ESC）"
        >
          <img
            src={imgViewer}
            style={{ maxWidth: '92vw', maxHeight: '92vh', objectFit: 'contain', borderRadius: 8, boxShadow: '0 12px 48px rgba(0,0,0,.55)' }}
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
      {/* 网格目录悬浮提示：彩色状态徽标 + 紧凑描述（原生 title 无法着色，自定义浮层替代） */}
      {tip && (
        <div
          style={{
            position: 'fixed',
            left: Math.min(tip.x + 12, window.innerWidth - 300),
            top: Math.min(tip.y + 14, window.innerHeight - 110),
            zIndex: 400,
            background: 'var(--panel)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            boxShadow: '0 4px 16px rgba(0,0,0,.18)',
            padding: '8px 10px',
            fontSize: 12,
            maxWidth: 280,
            pointerEvents: 'none',
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {tip.name}
            {tip.count ? <span className="dim">（{tip.count} 项有变更）</span> : null}
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 4 }}>
            {tip.codes && tip.codes.length > 0 && [...tip.codes]
              .sort((a, b) => codeRank(b) - codeRank(a))
              .map((c) => (
                <span key={c} style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                  <CodeBadge code={c} />
                  <span>{CODE_DESC[c] ?? c}</span>
                </span>
              ))}
            {(!tip.codes || tip.codes.length === 0) && tip.code !== undefined && tip.code !== '' && tip.code !== ' ' && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                <CodeBadge code={tip.code} />
                <span>{CODE_DESC[tip.code] ?? tip.code}</span>
              </span>
            )}
            {(!tip.codes || tip.codes.length === 0) && (!tip.code || tip.code === '' || tip.code === ' ') && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                <CodeBadge code={''} />
                <span>干净</span>
              </span>
            )}
          </div>
          {!tip.isDir && (tip.size !== undefined || tip.mtime) && (
            <div className="dim" style={{ fontSize: 11, marginBottom: 4 }}>
              {tip.size !== undefined ? fmtSize(tip.size) : ''}{tip.size !== undefined && tip.mtime ? ' · ' : ''}{tip.mtime ?? ''}
            </div>
          )}
          <div className="dim" style={{ fontSize: 11 }}>{tip.isDir ? '双击进入' : '双击查看'}</div>
        </div>
      )}
    </div>
  );
}
