/** 项目代码统计弹窗（⋯ 菜单 → 项目代码统计）
 *
 *  流程：勾选目录（复用检出/常用文件夹的目录勾选树）→ 选文件范围 → 开始统计（流式进度）
 *       → 结果树（目录显示子树合计，文件显示自身行数）→ 导出 md。
 *
 *  复用说明：
 *   - 目录树 `ui/dir-check-tree`：勾选单位是目录、懒加载、祖先覆盖，判据与「选择性检出」完全一致；
 *   - 扫描 `use-code-stats`：与「行数过滤」同一套服务端计数口径（同文件行数不会出现两个数）；
 *   - 导出 `md-export`：系统「另存为」默认落在**当前项目目录**，浏览器模式退到原生保存框/下载。
 *
 *  范围语义（踩过的坑）：
 *   - 「整个项目」必须**显式勾选**（含仓库根目录下的文件，如 package.json）——
 *     早先「一个都没选」会静默统计整个仓库，用户点「全不选」后照样统计全部文件（实报 bug）；
 *   - 因此现在：一个目录都没勾且没勾「整个项目」时，「开始统计」置灰并提示，服务端也会 400。
 *
 *  高度布局：**没有结果时目录树占满剩余高度**（选目录时看得全）；出结果后目录树自动收成
 *  固定高（160px），把空间让给统计结果树，用户可用「展开/收起目录」临时要回高度。
 *
 *  图标一律用 ui/icons 的彩色 SVG（不用 📁 emoji）：本项目刻意不依赖系统 emoji 字体，
 *  缺字形时那类字符会变成豆腐块。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { t } from '../../shared/i18n/index.js';
import { get, type CodeStatsNode } from '../shared/api.js';
import { ModalShell } from '../shell/modal-shell.js';
import { DirCheckTree } from '../ui/dir-check-tree.js';
import { Tooltip } from '../ui/tooltip.js';
import { IconFile, IconFolder, IconHome, IconStats } from '../ui/icons.js';
import { useCodeStats } from './use-code-stats.js';
import { formatLines } from './format-lines.js';
import { buildCodeStatsMd, saveTextFile } from './md-export.js';

/** 扁平化后的展示行（目录可折叠） */
interface Row {
  node: CodeStatsNode;
  depth: number;
  hasKids: boolean;
  open: boolean;
}

/** 结果树节点数（文件 + 目录）不超过此值时默认全展开；超过则只展开前两层。
 *  大项目全展开会在统计完成瞬间渲染整棵树，直接卡死（实报）。 */
const EXPAND_ALL_LIMIT = 500;
/** 自动限制时展开到第几层目录：0 = 只展开根级目录（展示到二级目录，更深收起） */
const AUTO_EXPAND_DEPTH = 0;
/** 出结果后设置区默认高度（px） */
const SETTINGS_DEFAULT_HEIGHT = 250;
/** 拖到低于此高度松手 → 自动折叠 */
const SETTINGS_COLLAPSE_THRESHOLD = 40;
/** 结果树至少保留高度：设置区最大高度 = 内容高度 - 这个值 */
const RESULT_MIN_HEIGHT = 200;

export function CodeStatsDialog(props: {
  /** 项目根目录名（树的第一行 / 导出 md 的根） */
  rootName: string;
  /** 项目根目录绝对路径：导出对话框默认打开在这里（当前项目目录） */
  repoRoot: string;
  onClose: () => void;
}) {
  const stats = useCodeStats();
  /** 显式勾选的相对路径集合（祖先覆盖子级，见 DirCheckTree 文件头） */
  const [checked, setChecked] = useState<Set<string>>(() => new Set());
  /** 「整个项目」：与目录勾选互斥（含仓库根目录下的文件） */
  const [wholeProject, setWholeProject] = useState(false);
  /** 根级一级目录（全选按钮用） */
  const [rootDirs, setRootDirs] = useState<string[]>([]);
  /** 默认全选一级目录只给首次（用户改过勾选后不覆盖） */
  const initedRef = useRef(false);
  const onRootDirs = (dirs: string[]) => {
    setRootDirs(dirs);
    if (!initedRef.current) {
      initedRef.current = true;
      setChecked(new Set(dirs));
    }
  };
  const allRootChecked = rootDirs.length > 0 && rootDirs.every((d) => checked.has(d));
  /** 有没有可统计的范围：勾了「整个项目」或有目录勾选 —— 都没有就不许点「开始统计」 */
  const canCount = wholeProject || checked.size > 0;

  /** 文件范围：默认只统计代码文件（日志/产物算进去会把数字撑得没意义） */
  const [codeOnly, setCodeOnly] = useState(true);
  /** 导出文件名（可改） */
  const [fileName, setFileName] = useState(() => t('stats.export.defaultName'));
  /** 导出结果提示 */
  const [out, setOut] = useState<{ text: string; err: boolean } | null>(null);
  /** 结果树的展开集合（白名单：只有记录在案的目录才展开子级）。
   *  用白名单而不是折叠黑名单——否则默认全部展开，大项目统计完直接渲染整棵树卡死。 */
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  /** 目录/文件过多时自动只展开前两层，标记一下给用户提示 */
  const [autoLimited, setAutoLimited] = useState(false);
  /** 设置区（统计目录 + 文件范围）高度：出结果后拖动分隔条调整；低于阈值自动折叠 */
  const [settingsHeight, setSettingsHeight] = useState(SETTINGS_DEFAULT_HEIGHT);
  const [settingsCollapsed, setSettingsCollapsed] = useState(false);
  /** 折叠前的高度：展开时恢复 */
  const lastSettingsHeightRef = useRef(SETTINGS_DEFAULT_HEIGHT);
  const settingsRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  /** 树的数据源：本地工作副本目录（与「常用文件夹」同一套 /api/fs 取法）。
   *  过滤掉统计口径里本来就不算的目录：隐藏目录（.svn/.git/.build…）与 node_modules
   *  ——服务端候选文件收集就跳过它们，留在树里只会让人勾了却统计不到。 */
  const loadDirs = useCallback(async (rel: string): Promise<string[] | null> => {
    try {
      const r = await get.fs(rel);
      return r.entries
        .filter((e) => e.isDir && !e.name.startsWith('.') && e.name !== 'node_modules')
        .map((e) => e.name);
    } catch {
      return null;
    }
  }, []);

  /** 勾选目录：同时取消「整个项目」（两者互斥） */
  const onTreeChange = (v: Set<string>) => {
    setChecked(v);
    if (v.size > 0) setWholeProject(false);
  };

  /** 切换「整个项目」：勾上 = 清空目录勾选；取消 = 回到默认全选一级目录（没有一级目录就保持空） */
  const toggleWhole = (on: boolean) => {
    setWholeProject(on);
    if (on) setChecked(new Set());
    else setChecked(new Set(rootDirs));
  };

  const start = () => {
    if (!canCount) return; // 防御：按钮本身已置灰
    setOut(null);
    setExpanded(new Set());
    setSettingsCollapsed(false);
    setSettingsHeight(SETTINGS_DEFAULT_HEIGHT);
    lastSettingsHeightRef.current = SETTINGS_DEFAULT_HEIGHT;
    stats.scan(wholeProject ? [] : [...checked], wholeProject, codeOnly);
  };

  /** 结果树拍平（只有展开集合里的目录才带出子级） */
  const rows = useMemo<Row[]>(() => {
    const acc: Row[] = [];
    const walk = (nodes: CodeStatsNode[], depth: number) => {
      for (const node of nodes) {
        const hasKids = node.isDir && node.children.length > 0;
        const open = hasKids && expanded.has(node.path);
        acc.push({ node, depth, hasKids, open });
        if (open) walk(node.children, depth + 1);
      }
    };
    walk(stats.result?.tree ?? [], 0);
    return acc;
  }, [stats.result, expanded]);

  const toggle = (path: string) => {
    setExpanded((s) => {
      const n = new Set(s);
      if (n.has(path)) n.delete(path);
      else n.add(path);
      return n;
    });
  };

  /** 统计完成后决定默认展开范围：树不大就全展开（看全貌方便）；
   *  节点多（大项目）只展开前两层——否则统计完成瞬间要渲染整棵树，界面直接卡死（实报）。 */
  useEffect(() => {
    const tree = stats.result?.tree;
    if (!tree) return;
    let total = 0;
    const count = (nodes: CodeStatsNode[]) => {
      for (const n of nodes) {
        total++;
        if (n.isDir) count(n.children);
      }
    };
    count(tree);
    const next = new Set<string>();
    if (total <= EXPAND_ALL_LIMIT) {
      const addAll = (nodes: CodeStatsNode[]) => {
        for (const n of nodes) {
          if (!n.isDir) continue;
          next.add(n.path);
          addAll(n.children);
        }
      };
      addAll(tree);
      setAutoLimited(false);
    } else {
      const addToDepth = (nodes: CodeStatsNode[], depth: number) => {
        for (const n of nodes) {
          if (!n.isDir) continue;
          if (depth <= AUTO_EXPAND_DEPTH) next.add(n.path);
          if (depth < AUTO_EXPAND_DEPTH) addToDepth(n.children, depth + 1);
        }
      };
      addToDepth(tree, 0);
      setAutoLimited(true);
    }
    setExpanded(next);
  }, [stats.result]);

  const result = stats.result;
  const skipped = result
    ? result.skippedEmpty + result.skippedBinary + result.skippedLarge + result.skippedError
    : 0;
  const scanning = stats.status === 'scanning';
  /** 目录树容器：设置区高度由外层拖拽控制，树自身占满剩余空间 */
  const dirsStyle = { flex: 1, minHeight: 0 } as const;

  /** 拖拽分隔条：上下调整设置区高度；松手时低于阈值自动折叠 */
  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = settingsRef.current?.getBoundingClientRect().height ?? settingsHeight;
    const contentH = contentRef.current?.clientHeight ?? 600;
    const maxH = Math.max(SETTINGS_DEFAULT_HEIGHT, contentH - RESULT_MIN_HEIGHT);
    let h = startH;
    document.body.style.userSelect = 'none';
    const onMove = (ev: MouseEvent) => {
      h = Math.min(maxH, Math.max(0, startH + (ev.clientY - startY)));
      setSettingsHeight(h);
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.userSelect = '';
      if (h < SETTINGS_COLLAPSE_THRESHOLD) {
        lastSettingsHeightRef.current = Math.min(maxH, Math.max(SETTINGS_DEFAULT_HEIGHT, startH));
        setSettingsCollapsed(true);
      } else {
        lastSettingsHeightRef.current = h;
      }
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  const expandSettings = () => {
    setSettingsCollapsed(false);
    setSettingsHeight(lastSettingsHeightRef.current);
  };

  const exportMd = async () => {
    if (!result) {
      setOut({ text: t('stats.export.noResult'), err: true });
      return;
    }
    const name = fileName.trim() || t('stats.export.defaultName');
    const content = buildCodeStatsMd({
      rootName: props.rootName,
      tree: result.tree,
      lines: result.lines,
      files: result.files,
      dirs: result.dirs,
      codeOnly: stats.scope?.codeOnly ?? codeOnly,
      skipped,
      truncated: !!result.truncated,
    });
    // startDir = 当前项目目录：系统「另存为」打开时就在项目里，文件名也已填好
    const r = await saveTextFile(name, content, { startDir: props.repoRoot });
    if (r.cancelled) return; // 用户取消保存框：静默
    if (!r.ok) {
      setOut({ text: t('stats.export.failed', { msg: r.error ?? '' }), err: true });
      return;
    }
    setOut({ text: t('stats.export.saved', { path: r.path ?? name }), err: false });
  };

  return (
    <ModalShell
      title={
        <>
          {/* 项目代码统计 */}
          {t('stats.title')}
          {/* 项目名：标题后紧跟的灰色等宽小字（与仓库浏览弹窗的 host 同款）；悬浮看完整路径 */}
          <Tooltip content={<span className="mono small">{props.repoRoot}</span>}>
            <span
              className="dim small mono"
              style={{
                marginLeft: 10,
                fontWeight: 400,
                verticalAlign: 'middle',
                display: 'inline-block',
                maxWidth: 300,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {props.rootName}
            </span>
          </Tooltip>
        </>
      }
      icon={<IconStats size={16} />}
      width={780}
      minWidth={600}
      height={660}
      maxable
      closeIcon
      // 说明收进标题栏「?」（悬浮显示）：内容区全部让给目录树与结果
      help={t('stats.hint')}
      // 压掉 body 的上内边距（默认 16px）：目录区贴着标题栏，少一层空白
      bodyStyle={{ paddingTop: 6 }}
      onClose={props.onClose}
      foot={
        // 整组靠右：导出文件名 + 输入框(240) + 导出 md，紧挨「开始/重新统计」
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', minWidth: 0, justifyContent: 'flex-end' }}>
          {result && !scanning && (
            <>
              <span className="small" style={{ flexShrink: 0 }}>
                {/* 导出文件名 */}
                {t('stats.export.label')}
              </span>
              <input
                type="text"
                style={{ width: 240, flexShrink: 0 }}
                value={fileName}
                onChange={(e) => setFileName(e.target.value)}
                placeholder={t('stats.export.defaultName')}
              />
              <button className="primary" style={{ flexShrink: 0 }} onClick={() => void exportMd()}>
                {t('stats.export.button')}
              </button>
            </>
          )}
          {scanning ? (
            // 取消
            <button style={{ flexShrink: 0 }} onClick={stats.cancel}>{t('stats.cancel')}</button>
          ) : (
            <button
              className="primary"
              style={{ flexShrink: 0 }}
              disabled={!canCount}
              title={canCount ? undefined : t('stats.needDirs')}
              onClick={start}
            >
              {/* 开始统计 / 重新统计 */}
              {result ? t('stats.restart') : t('stats.start')}
            </button>
          )}
        </div>
      }
    >
      {/* 整块纵向 flex：设置区 / 结果树轮流占满剩余高度（弹窗拉大、最大化时都不留空白） */}
      <div ref={contentRef} style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
        {result && settingsCollapsed ? (
          // 折叠态：保留一行摘要，点击展开（拖动分隔条到阈值也会进入这里）
          <div
            className="row"
            style={{ gap: 8, alignItems: 'center', padding: '2px 0', flexShrink: 0, cursor: 'pointer' }}
            title={t('stats.settings.expandTip')}
            onClick={expandSettings}
          >
            <span className="small" style={{ fontWeight: 600 }}>{t('stats.settings.summary')}</span>
            <span className="dim small">▾</span>
          </div>
        ) : (
          <>
        <div
          ref={settingsRef}
          style={
            result
              ? { height: settingsHeight, flexShrink: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }
              : { flex: 1, minHeight: 160, display: 'flex', flexDirection: 'column' }
          }
        >
        {/* ── 目录选择 ── */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '0 0 6px', flexShrink: 0 }}>
          <span className="small" style={{ fontWeight: 600 }}>
            {/* 统计目录 */}
            {t('stats.section.dirs')}
          </span>
          <span className="dim small" style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {/* 默认全选一级目录；展开可细选子目录 */}
            {t('stats.defaultAll')}
          </span>
          <button
            className="mini tool-btn"
            disabled={rootDirs.length === 0 || scanning || wholeProject}
            onClick={() => setChecked(allRootChecked ? new Set() : new Set(rootDirs))}
            title={allRootChecked ? t('stats.unselectAllTip') : t('stats.selectAllTip')}
          >
            {allRootChecked ? t('stats.unselectAll') : t('stats.selectAll')}
          </button>
        </div>

        {/* 整个项目（含根目录文件）：与目录勾选互斥——勾它才统计仓库根下的文件 */}
        <label
          className="row"
          title={t('stats.wholeProjectTip')}
          style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6, cursor: 'pointer', flexShrink: 0 }}
        >
          <input type="checkbox" checked={wholeProject} disabled={scanning} onChange={(e) => toggleWhole(e.target.checked)} />
          <IconHome size={13} />
          <span className="small">{t('stats.wholeProject')}</span>
        </label>

        <div style={{ display: 'flex', flexDirection: 'column', ...dirsStyle }}>
          <DirCheckTree loadDirs={loadDirs} value={checked} onChange={onTreeChange} onRootDirs={onRootDirs} />
        </div>

        {/* ── 文件范围 + 扫描状态 ── */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '8px 0', flexWrap: 'wrap', flexShrink: 0 }}>
          <span className="small" style={{ fontWeight: 600 }}>
            {/* 文件范围 */}
            {t('stats.scope.label')}
          </span>
          <label className="row" style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 0, cursor: 'pointer' }}>
            <input type="radio" checked={codeOnly} onChange={() => setCodeOnly(true)} disabled={scanning} />
            <span className="small">{t('stats.scope.codeOnly')}</span>
          </label>
          <label className="row" style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 0, cursor: 'pointer' }}>
            <input type="radio" checked={!codeOnly} onChange={() => setCodeOnly(false)} disabled={scanning} />
            <span className="small">{t('stats.scope.allFiles')}</span>
          </label>
          <span style={{ flex: 1 }} />
          {!canCount && !scanning && <span className="warn small">{t('stats.needDirs')}</span>}
          {scanning && (
            <span className="dim small" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <span className="search-spin" />
              {stats.progress && stats.progress.total > 0
                ? t('stats.scanning', { done: stats.progress.scanned, total: stats.progress.total })
                : t('stats.collecting')}
            </span>
          )}
          {stats.status === 'error' && <span className="err small">{stats.error}</span>}
        </div>
        </div>
        {result && (
          // 拖拽分隔条：上下调整设置区高度，拖到底自动折叠
          <div
            onMouseDown={startResize}
            title={t('stats.settings.dragTip')}
            style={{ height: 6, flexShrink: 0, margin: '2px 0', borderRadius: 3, background: 'var(--border)', cursor: 'row-resize' }}
          />
        )}
          </>
        )}

        {/* ── 结果（树占满剩余高度） ── */}
        {result && (
          <>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 6, flexWrap: 'wrap', flexShrink: 0 }}>
              <span style={{ fontSize: 21, fontWeight: 700, lineHeight: 1.1, color: 'var(--accent)' }}>
                {formatLines(result.lines)}
              </span>
              <span className="dim small">
                {t('stats.result.unit', { files: result.files, sec: (result.elapsedMs / 1000).toFixed(1) })}
              </span>
              {skipped > 0 && (
                <span
                  className="dim small"
                  title={t('stats.result.skippedTitle', {
                    empty: result.skippedEmpty,
                    binary: result.skippedBinary,
                    large: result.skippedLarge,
                    error: result.skippedError,
                  })}
                >
                  · {t('stats.result.skipped', { n: skipped })}
                </span>
              )}
              {result.truncated === 'time' && <span className="warn small">· {t('stats.result.truncated')}</span>}
              {result.capped && <span className="warn small">· {t('stats.result.capped', { n: result.total })}</span>}
              {/* 导出结果提示（导出按钮已移到 foot，提示就近显示在统计结果行尾） */}
              {out && <span className={`small ${out.err ? 'err' : 'ok'}`}>{out.text}</span>}
            </div>
            {autoLimited && rows.length > 0 && (
              <div className="dim small" style={{ marginBottom: 4, flexShrink: 0 }}>
                {t('stats.result.autoLimited')}
              </div>
            )}
            {rows.length === 0 ? (
              <div className="dim small" style={{ padding: '12px 0', flex: 1 }}>
                {/* 没有可统计的文件 */}
                {t('stats.result.empty')}
              </div>
            ) : (
              <div
                className="tree"
                style={{
                  flex: 1,
                  minHeight: 100,
                  overflow: 'auto',
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                  padding: 4,
                }}
              >
                {rows.map((r) => (
                  <div
                    key={r.node.path}
                    className="tree-row"
                    style={{ paddingLeft: 4 + r.depth * 16, cursor: r.hasKids ? 'pointer' : 'default', flexShrink: 0 }}
                    onClick={() => r.hasKids && toggle(r.node.path)}
                  >
                    <span className="arrow">{r.hasKids ? (r.open ? '▾' : '▸') : ''}</span>
                    {r.node.isDir ? <IconFolder size={14} /> : <IconFile size={14} />}
                    <span className={`name ${r.node.isDir ? 'dir' : 'file'} mono`}>
                      {r.node.name}
                      {r.node.isDir ? '/' : ''}
                    </span>
                    <span className="count" style={{ marginLeft: 'auto', flexShrink: 0 }}>
                      {r.node.isDir
                        ? t('stats.md.dirNote', { lines: formatLines(r.node.lines), files: r.node.files })
                        : t('stats.md.fileNote', { lines: formatLines(r.node.lines) })}
                    </span>
                  </div>
                ))}
              </div>
            )}

          </>
        )}
      </div>
    </ModalShell>
  );
}
