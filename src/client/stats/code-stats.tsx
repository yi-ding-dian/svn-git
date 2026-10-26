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
import { useCallback, useMemo, useRef, useState } from 'react';
import { t } from '../../shared/i18n/index.js';
import { get, type CodeStatsNode } from '../shared/api.js';
import { ModalShell } from '../shell/modal-shell.js';
import { DirCheckTree } from '../ui/dir-check-tree.js';
import { Tooltip } from '../ui/tooltip.js';
import { IconFile, IconFolder, IconHome, IconStats } from '../ui/icons.js';
import { useCodeStats } from './use-code-stats.js';
import { buildCodeStatsMd, saveTextFile } from './md-export.js';

/** 扁平化后的展示行（目录可折叠） */
interface Row {
  node: CodeStatsNode;
  depth: number;
  hasKids: boolean;
  open: boolean;
}

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
  /** 结果树的折叠集合 */
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  /** 出结果后目录树默认收起；用户可手动展开要回高度 */
  const [dirsExpanded, setDirsExpanded] = useState(false);

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
    setCollapsed(new Set());
    setDirsExpanded(false);
    stats.scan(wholeProject ? [] : [...checked], wholeProject, codeOnly);
  };

  /** 结果树拍平（折叠的目录不展开子级） */
  const rows = useMemo<Row[]>(() => {
    const acc: Row[] = [];
    const walk = (nodes: CodeStatsNode[], depth: number) => {
      for (const node of nodes) {
        const hasKids = node.isDir && node.children.length > 0;
        const open = hasKids && !collapsed.has(node.path);
        acc.push({ node, depth, hasKids, open });
        if (open) walk(node.children, depth + 1);
      }
    };
    walk(stats.result?.tree ?? [], 0);
    return acc;
  }, [stats.result, collapsed]);

  const toggle = (path: string) => {
    setCollapsed((s) => {
      const n = new Set(s);
      if (n.has(path)) n.delete(path);
      else n.add(path);
      return n;
    });
  };

  const result = stats.result;
  const skipped = result
    ? result.skippedEmpty + result.skippedBinary + result.skippedLarge + result.skippedError
    : 0;
  const scanning = stats.status === 'scanning';
  /** 目录树高度：没结果时占满剩余空间；出结果后收起 160px，手动展开则给到 320px
   *  （固定高度而非 flex:1——否则和结果树平分，展开后几乎看不出变化） */
  const dirsStyle = !result
    ? { flex: 1, minHeight: 160 }
    : dirsExpanded
      ? { flex: '0 0 320px', minHeight: 160 }
      : { flex: '0 0 160px', minHeight: 120 };

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
      {/* 整块纵向 flex：目录树 / 结果树轮流占满剩余高度（弹窗拉大、最大化时都不留空白） */}
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
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
          {result && (
            // 展开/收起目录（出结果后目录树默认收起，把高度让给结果树）
            <button className="mini" disabled={scanning} onClick={() => setDirsExpanded((v) => !v)}>
              {dirsExpanded ? t('stats.collapseDirs') : t('stats.expandDirs')}
            </button>
          )}
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

        {/* ── 结果（树占满剩余高度） ── */}
        {result && (
          <>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 6, flexWrap: 'wrap', flexShrink: 0 }}>
              <span style={{ fontSize: 21, fontWeight: 700, lineHeight: 1.1, color: 'var(--accent)' }}>
                {result.lines.toLocaleString()}
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
                        ? t('stats.md.dirNote', { lines: r.node.lines, files: r.node.files })
                        : t('stats.md.fileNote', { lines: r.node.lines })}
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
