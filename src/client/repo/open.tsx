/** 打开项目：目录浏览选择仓库（启动页 / 打开项目模态框共用） */
import React, { useEffect, useRef, useState } from 'react';
import { baseName } from '../shared/utils.js';
import { get, post, type BrowseResult, type RepoInfo } from '../shared/api.js';
import { ModalShell } from '../shell/modal-shell.js';
import { GridIcon } from '../ui/icons.js';
import { ContextMenu } from '../ui/context-menu.js';
import { t } from '../../shared/i18n/index.js';
import { CreateRepoDialog, GetRepoDialog } from './repo-create.js';

/** svnadmin 版本库存储目录特征（format 文件 + db/conf/hooks 等）：不是工作副本，需要打开同名 -wc */
function isSvnBareDir(entries: { name: string }[]): boolean {
  const names = new Set(entries.map((e) => e.name));
  return names.has('format') && names.has('db') && names.has('conf');
}

/** 打开项目弹窗的最近项目：默认列 10 项，点「…」展开到 15 项（再多靠滚动） */
const RECENT_COLLAPSED = 10;
const RECENT_EXPANDED = 15;

export function OpenBrowser(props: {
  startDir: string;
  /** 点开过但打不开的项目：路径 → 错误消息（这些项上常驻 ×，悬浮时显示同一条） */
  invalidPaths?: Record<string, string>;
  onOpened: (repo: RepoInfo) => void;
  onToast: (msg: string, err?: boolean) => void;
}) {
  const [data, setData] = useState<BrowseResult | null>(null);
  const [dir, setDir] = useState(props.startDir);
  const [error, setError] = useState('');
  const [svnBare, setSvnBare] = useState<string | null>(null); // 识别到 SVN 版本库存储目录 → 提示进入工作副本
  const [pathInput, setPathInput] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [history, setHistory] = useState<{ path: string; type: 'svn' | 'git'; lastOpened: number }[]>([]);
  // 最近项目右键菜单（删除）
  const [rmMenu, setRmMenu] = useState<{ x: number; y: number; path: string } | null>(null);
  // 最近项目默认只列 10 项，点「…」展开到 15 项（再多靠滚动）
  const [showAllRecent, setShowAllRecent] = useState(false);
  // startDir 由 /api/info 异步返回(home 目录)：首次拿到值才初始化浏览位置(仅一次,后续 info 刷新不重置)
  const dirInitRef = useRef(false);
  useEffect(() => {
    if (!dirInitRef.current && props.startDir) {
      dirInitRef.current = true;
      setDir(props.startDir);
    }
  }, [props.startDir]);

  // 加载最近项目
  useEffect(() => {
    get
      .history()
      .then((r) => setHistory(r.items))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!dir) return; // startDir 尚未就绪(异步返回 home)时不请求
    let cancelled = false;
    setError('');
    setSvnBare(null);
    get
      .browse(dir)
      .then((r) => {
        if (cancelled) return;
        setData(r);
        // 浏览到 svnadmin 版本库存储目录（非工作副本）：提示进入同名 -wc 工作副本（目录自身特征优先，即使嵌在别的仓库内）
        if (isSvnBareDir(r.entries)) setSvnBare(dir);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [dir]);

  const enter = async () => {
    if (!data?.repo) return;
    try {
      await post.open(data.repo.root ?? dir);
      const info = await get.info();
      if (info.type) props.onOpened(info);
      // 打开失败
      else props.onToast(t('repo.open.failed'), true);
    } catch (e) {
      props.onToast((e as Error).message, true);
    }
  };

  /** 输入/拖入的路径：仓库 → 直接进入；目录 → 跳转浏览；否则提示 */
  const openPath = async (p: string) => {
    const path = p.trim(); // 局部变量名避开 i18n 的 t()
    if (!path) return;
    setError('');
    try {
      const r = await get.browse(path);
      // SVN 版本库存储目录自身（svnadmin 特征）：优先于任何"向上识别"（如嵌套在 git 仓库内），引导进入同名 -wc
      if (isSvnBareDir(r.entries)) {
        setDir(path);
        setPathInput('');
        setSvnBare(path);
        // 检测到 SVN 版本库存储目录: {path}
        props.onToast(t('repo.open.detectedBare', { path }));
        return;
      }
      if (r.repo) {
        // 直接进入仓库
        await post.open(r.repo.root ?? path);
        const info = await get.info();
        if (info.type) props.onOpened(info);
        // 打开失败
        else props.onToast(t('repo.open.failed'), true);
        return;
      }
      // 目录：切换到浏览，并明确提示未识别到仓库（引导从下方文件列表继续找）
      setDir(path);
      setPathInput('');
      setSvnBare(null);
      // 当前目录未识别到 SVN/Git 仓库，请重新选择，或从下方文件列表中选择包含仓库的目录
      setError(t('repo.open.notRepo'));
      // 已切换到目录: {path}
      props.onToast(t('repo.open.switchedDir', { path }));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const goUp = () => setDir((d) => (d === '/' ? '/' : d.slice(0, d.lastIndexOf('/')) || '/'));

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0] as (File & { path?: string }) | undefined;
    if (!f) return;
    // ① Electron 内嵌窗口：webUtils.getPathForFile（preload 注入，替代已移除的 File.path）
    const el = window as unknown as { svngit?: { getPathForFile: (file: File) => string | null } };
    const epath = el.svngit?.getPathForFile(f);
    if (epath) {
      void openPath(epath);
      return;
    }
    // ② 浏览器（Chrome/Edge 等）：File.path 属性
    if (f.path) {
      void openPath(f.path);
      return;
    }
    // ③ 均不可用（Firefox/新版浏览器）：自动打开系统目录选择器，一步到位
    // 当前浏览器不支持拖拽路径识别，已自动打开系统目录选择，请选择项目目录
    setError(t('repo.open.dragUnsupported'));
    void pickDir();
  };

  /** 系统目录选择对话框（Electron 打包版） */
  const pickDir = async () => {
    try {
      const r = await get.pickDir();
      if (r.path) void openPath(r.path);
      // 当前运行环境不支持系统目录选择，请手动输入路径
      else if (r.unsupported) setError(t('repo.open.pickUnsupported'));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
      className={dragOver ? 'drop-zone dragover' : 'drop-zone'}
    >
      {/* 最近项目（点击直接打开） */}
      {history.length > 0 && (
        <>
          {/* 最近项目（点击打开） */}
          <div className="dim small" style={{ marginBottom: 6 }}>{t('repo.recent.title')}</div>
          <div className={`list recent-list${showAllRecent ? ' expanded' : ''}`} style={{ maxWidth: 640, marginBottom: 12 }}>
            {(showAllRecent ? history.slice(0, RECENT_EXPANDED) : history.slice(0, RECENT_COLLAPSED)).map((h) => (
              <div
                key={h.path}
                className={`recent-item${props.invalidPaths?.[h.path] ? ' invalid' : ''}`}
                title={
                  props.invalidPaths?.[h.path]
                    // {path}（打不开，目录已删除或不是工作副本）
                    ? t('repo.recent.invalidTip', { path: h.path })
                    // {path}\n点击打开 · 右键删除
                    : t('repo.recent.itemTip', { path: h.path })
                }
                onClick={() => void openPath(h.path)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setRmMenu({ x: e.clientX, y: e.clientY, path: h.path });
                }}
              >
                <span className={`badge ${h.type}`} style={{ fontSize: 9, padding: '0 5px' }}>
                  {h.type.toUpperCase()}
                </span>
                <span className="recent-path">{h.path}</span>
                {/* 悬浮显形的移除按钮：单击即移除（stopPropagation 防止触发本行的"点击打开"） */}
                <button
                  className={`recent-remove${props.invalidPaths?.[h.path] ? ' always' : ''}`}
                  // 从最近项目中移除（不影响仓库本身）
                  title={t('repo.recent.removeTip')}
                  // 移除 {path}
                  aria-label={t('repo.recent.removeAria', { path: h.path })}
                  onClick={(e) => {
                    e.stopPropagation();
                    void post
                      .historyRemove(h.path)
                      .then((r) => setHistory(r.items))
                      // 移除失败
                      .catch(() => props.onToast(t('repo.recent.removeFailed'), true));
                  }}
                >
                  ×
                </button>
              </div>
            ))}
            {/* 超出折叠上限：点「…」展开到 15 项（再多靠滚动；展开后本行消失） */}
            {!showAllRecent && history.length > RECENT_COLLAPSED && (
              <div
                className="recent-more"
                // 展开其余 {n} 个项目
                title={t('repo.recent.expandTip', { n: history.length - RECENT_COLLAPSED })}
                onClick={() => setShowAllRecent(true)}
              >
                {/* …（{n} 条） */}
                {t('repo.recent.expandCount', { n: history.length - RECENT_COLLAPSED })}
              </div>
            )}
            {/* 最近项目右键菜单：删除 / 取消 */}
            {rmMenu && (
              <ContextMenu
                x={rmMenu.x}
                y={rmMenu.y}
                mask
                onClose={() => setRmMenu(null)}
                items={
                  // 失效项（已打不开）：只剩「删除」；正常项保留「取消」作为"什么都不做"的出口
                  props.invalidPaths?.[rmMenu.path]
                    ? [
                        {
                          icon: '🗑',
                          // 删除
                          label: t('common.delete'),
                          danger: true,
                          action: () => {
                            const p = rmMenu.path;
                            void post
                              .historyRemove(p)
                              .then((r) => setHistory(r.items))
                              // 删除失败
                              .catch(() => props.onToast(t('repo.recent.delFailed'), true));
                          },
                        },
                      ]
                    : [
                        {
                          icon: '🗑',
                          // 删除
                          label: t('common.delete'),
                          danger: true,
                          action: () => {
                            const p = rmMenu.path;
                            void post
                              .historyRemove(p)
                              .then((r) => setHistory(r.items))
                              // 删除失败
                              .catch(() => props.onToast(t('repo.recent.delFailed'), true));
                          },
                        },
                        // 取消
                        { icon: '✕', label: t('common.cancel') },
                      ]
                }
              />
            )}
          </div>
        </>
      )}
      {/* 路径输入 */}
      <div className="row" style={{ marginBottom: 10 }}>
        <input
          type="text"
          style={{ flex: 1 }}
          // 输入完整项目路径后回车，或将文件夹拖入下方区域识别…
          placeholder={t('repo.open.pathPlaceholder')}
          value={pathInput}
          onChange={(e) => setPathInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void openPath(pathInput);
          }}
        />
        {/* 打开系统目录选择框 / 📁 选择目录… */}
        <button onClick={() => void pickDir()} title={t('repo.open.pickDirTip')}>{t('repo.open.pickDirBtn')}</button>
        {/* 打开 */}
        <button className="primary" onClick={() => void openPath(pathInput)}>{t('repo.open.openBtn')}</button>
      </div>
      <div className="dim small" style={{ marginBottom: 8 }}>
        {/* 📁 或将文件夹直接拖入此窗口，自动识别 SVN/Git 仓库 */}
        {t('repo.open.dropHint')}
      </div>
      <div className="breadcrumb">
        {dir}
        {dir !== '/' && (
          <a href="#" onClick={(e) => { e.preventDefault(); goUp(); }}>
            {/* ← 上级 */}
            {' '}{t('repo.up')}
          </a>
        )}
      </div>
      {error && <div className="error">{error}</div>}
      {svnBare && (
        <div className="repo-enter" style={{ marginBottom: 10 }}>
          <span className="badge svn">SVN</span>
          <span className="info" style={{ flex: 1 }}>
            {/* 是 SVN 版本库存储目录（服务器数据，不能直接编辑）。 */}
            <b>{baseName(svnBare)}</b> {t('repo.bare.isStore')}
            {/* 请打开它的工作副本进行日常操作： */}
            {' '}{t('repo.bare.openWcHint')}
          </span>
          <button
            className="primary"
            onClick={() => void openPath(`${svnBare.replace(/\/+$/, '')}-wc`)}
          >
            {/* 进入工作副本 {name} → */}
            {t('repo.bare.enterWc', { name: `${baseName(svnBare)}-wc` })}
          </button>
        </div>
      )}
      {/* ⏳ 读取目录… */}
      {!data && !error && <div className="loading">{t('repo.open.loading')}</div>}
      {data && (
        <>
          {(() => {
            const rp = data.repo;
            if (!rp) return null;
            return (
              <div className="repo-enter">
                <span className={`badge ${rp.type!}`}>{rp.type!.toUpperCase()}</span>
                <span className="info">
                  {/* {root} — SVN/Git 工作副本 */}
                  {t('repo.open.wcLabel', { root: rp.root ?? '' })}
                </span>
                {/* 进入此仓库 → */}
                <button className="primary" onClick={() => void enter()}>{t('repo.open.enterThis')}</button>
              </div>
            );
          })()}
          {/* 文件浏览形式：图标网格，点击目录进入 */}
          <div className="open-grid">
            {/* 空目录 */}
            {data.entries.length === 0 && <div className="empty" style={{ gridColumn: '1 / -1' }}>{t('repo.open.emptyDir')}</div>}
            {data.entries.map((it) => (
              <div
                key={it.name}
                className={`open-grid-item ${it.isDir ? 'dir' : ''}`}
                // 双击进入目录 {name}
                title={it.isDir ? t('repo.open.dblClickDir', { name: it.name }) : it.name}
                onDoubleClick={() => {
                  if (it.isDir) {
                    setDir((d) => (d === '/' ? `/${it.name}` : `${d}/${it.name}`));
                  }
                }}
              >
                <GridIcon isDir={it.isDir} name={it.name} size={38} />
                <span className="open-grid-name">{it.name}{it.isDir ? '/' : ''}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/** 启动页（无仓库时全页显示） */
export function OpenView(props: {
  startDir: string;
  onOpened: (repo: RepoInfo) => void;
  onToast: (msg: string, err?: boolean) => void;
  /** 新建仓库并成功打开后通知（引导条等） */
  onCreatedRepo?: (repo: RepoInfo) => void;
}) {
  const [showCreate, setShowCreate] = useState(false);
  const [showGet, setShowGet] = useState(false);

  // 打开（新建/获取后）：自动进入该仓库；新建的额外回调整 onCreatedRepo（引导条）
  const openRepo = async (dir: string, notifyCreated: boolean) => {
    void post
      .open(dir)
      .then(async () => {
        const r = await get.info();
        if (r.type && r.root) {
          props.onOpened(r);
          if (notifyCreated) props.onCreatedRepo?.(r);
          // 已打开仓库: {root}
          else props.onToast(t('repo.open.opened', { root: r.root }));
        // 打开失败
        } else props.onToast(t('repo.open.failed'), true);
      })
      // 打开失败: {msg}
      .catch((e: Error) => props.onToast(t('repo.open.failedMsg', { msg: (e as Error).message }), true));
  };

  // 新建仓库成功后：自动打开（git=仓库目录；svn=xxx-wc 工作副本，由服务端返回）
  const onCreated = (dir: string) => {
    setShowCreate(false);
    void openRepo(dir, true);
  };
  // 获取仓库成功后：自动打开（克隆/检出目标目录）
  const onGot = (dir: string) => {
    setShowGet(false);
    void openRepo(dir, false);
  };

  return (
    <div className="open-wrap">
      <h1 style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <img src="/icon.png" width="30" height="30" alt="logo" style={{ borderRadius: 7 }} />
        {/* svn-git文件版本管理 */}
        {t('repo.home.title')}
      </h1>
      {/* 浏览并选择 SVN/Git 仓库目录 */}
      <div className="sub">{t('repo.home.sub')}</div>
      <div className="row" style={{ gap: 8, marginBottom: 10 }}>
        {/* ＋ 新建仓库（git init / SVN 建库）… */}
        <button className="primary" onClick={() => setShowCreate(true)}>{t('repo.home.newRepo')}</button>
        {/* ⬇ 获取仓库… */}
        <button className="primary" onClick={() => setShowGet(true)}>{t('repo.home.getRepo')}</button>
      </div>
      <OpenBrowser startDir={props.startDir} onOpened={props.onOpened} onToast={props.onToast} />
      {showCreate && (
        <CreateRepoDialog
          home={props.startDir}
          onClose={() => setShowCreate(false)}
          onCreated={onCreated}
        />
      )}
      {showGet && (
        <GetRepoDialog
          home={props.startDir}
          onClose={() => setShowGet(false)}
          onCreated={onGot}
        />
      )}
    </div>
  );
}

/** 打开项目模态框 */
export function OpenModal(props: {
  startDir: string;
  /** 点开过但打不开的项目：路径 → 错误消息（这些项上常驻 ×，悬浮时显示同一条） */
  invalidPaths?: Record<string, string>;
  onOpened: (repo: RepoInfo) => void;
  onToast: (msg: string, err?: boolean) => void;
  onClose: () => void;
}) {
  return (
    // 📂 打开项目
    <ModalShell title={t('repo.open.title')} width={600} closeIcon hideFoot onClose={props.onClose}>
      <OpenBrowser startDir={props.startDir} invalidPaths={props.invalidPaths} onOpened={props.onOpened} onToast={props.onToast} />
    </ModalShell>
  );
}
