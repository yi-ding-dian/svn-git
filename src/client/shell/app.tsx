/** 根组件：侧边栏布局 + 全局状态 + 操作流程（全部弹窗集中在 modal-host.tsx）
 *
 *  职责已按 hooks 拆分：
 *   - use-toast              跟随鼠标的轻提示（toast / mouseRef）
 *   - use-app-shortcuts      全局快捷键与缩放提示
 *   - use-task-notifications 后台任务完成通知（铃铛）
 *   - use-share-watch        共享访问状态轮询
 *   - use-env-check          svn / git 环境检测
 *   - use-repo-actions       提交/推送/更新/还原等操作编排
 *  本组件只保留：布局、顶层状态（modal / diffTarget / view）与各 hook 的组合。 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { get, type RepoInfo } from '../shared/api.js';
import { HistoryView } from '../history/history.js';
import { DiffView, type DiffTarget } from '../history/diff/index.js';
import { FsView } from '../filesystem/index.js';
import { OpenView } from '../repo/open.js';
import { type Modal } from './modal-types.js';
import { AppHeader } from './header/index.js';
import { TitleStrip } from './title-strip.js';
import { useAppearance } from '../appearance/use-appearance.js';
import { useRepoStatus } from './use-repo-status.js';
import { useProjectHistory } from '../repo/use-project-history.js';
import { ModalHost, onboardText } from './modal-host.js';
import { Sidebar, type View } from './sidebar.js';
import { IconOk, IconErr } from '../ui/icons.js';
import { pathAutoWidth, isBinaryFile, isImageFile, isKnownTextFile } from '../shared/utils.js';
import { translateVcsError } from '../shared/vcs/errors.js';
import { useToast } from './use-toast.js';
import { useAppShortcuts } from './use-app-shortcuts.js';
import { useTaskNotifications } from './use-task-notifications.js';
import { useShareWatch } from './use-share-watch.js';
import { useEnvCheck } from './use-env-check.js';
import { useRepoActions } from './use-repo-actions.js';
import { useLang } from '../shared/use-lang.js';
import { FileSessionsDock } from './file-sessions-dock.js';
import {
  addSession,
  captureActiveSession,
  setPendingSession,
  openSessionInPlace,
  setPendingDir,
  openDirInPlace,
} from '../shared/file-sessions.js';
import { t } from '../../shared/i18n/index.js';

export function App() {
  // 订阅界面语言，**不接返回值**：这里只为让语言变化时整树重渲染。
  // （Header 里另有一处拿 changeLang；若只在 Header 订阅，兄弟视图的 t() 不会重算）
  useLang();
  const [info, setInfo] = useState<RepoInfo | null>(null);
  const repo = info?.type ? info : null;
  const [view, setView] = useState<View>('browse');
  const [tick, setTick] = useState(0);
  /** 「打开项目」信号（每次打开成功 +1）：文件视图据此重挂载，浏览位置回到新的操作范围。
   *  同一项目重新打开（换子项目范围，或上次手动切到了根目录）时不能沿用旧的 dir。 */
  const [openTick, setOpenTick] = useState(0);
  /** 远程状态重算信号（更新/切分支/合并成功后 +1）：侧边栏据此重跑「远程检查」。
   *  与 tick 分开——tick 连文件保存都会加，不能每次都触发一批联网探测。 */
  const [remoteCheckTick, setRemoteCheckTick] = useState(0);
  /** 「整个仓库已同步」事件号（拉取/根目录更新成功后 +1）：侧边栏当前项目的 ⬇ 角标
   *  据此**立即归零**——不等那轮联网重查回来（实测 fetch 5s，用户要的是"拉完马上消失"）。
   *  与 remoteCheckTick 分开：那个是"去重查"，这个是"本地已确定没有待拉取"。 */
  const [remoteSyncedTick, setRemoteSyncedTick] = useState(0);
  const [modal, setModal] = useState<Modal>(null);
  // modal 最新引用：后台校验（提交前检查）完成后判断用户是否已关窗/切换，避免结果打扰
  const modalRef = useRef<Modal>(null);
  modalRef.current = modal;
  const [diffTarget, setDiffTarget] = useState<DiffTarget | null>(null);
  // 从「提交修改的文件」弹窗进入差异视图时记录，返回时恢复该弹窗
  const [diffReturnModal, setDiffReturnModal] = useState<Modal>(null);
  const [logPath, setLogPath] = useState<string | undefined>(undefined);
  /** 历史视图的路径是否为目录：目录还原走反向合并，确认框文案与命令预览按它区分 */
  const [logIsDir, setLogIsDir] = useState(false);
  /** 文件夹视图当前浏览的相对目录：侧边栏切「历史」时按它过滤。
   *  不带它的话，历史视图用的是**上一次查看过的路径**（或整仓库）——用户实报"点击历史不是当前目录的历史"。 */
  const browseDirRef = useRef('');
  const [configUser, setConfigUser] = useState('');
  /** git 凭据里的 GitHub 用户名（⋯ 菜单「Fork 到自己账号」按 owner 粗判可见性用；空=未知，宁多显勿漏显） */
  const [gitUser, setGitUser] = useState('');
  // 点开过但打不开的项目（目录已删/不是工作副本）：路径 → 错误消息。
  // 列表项上常驻一个 × 供直接移除；鼠标悬浮该项时用同一条消息做浮层提示
  const [invalidPaths, setInvalidPaths] = useState<Record<string, string>>({});

  // toast：跟随鼠标位置悬浮提示，1.5 秒后淡出（不用底部固定条）
  const { toast, toastErr, toastQuick, toastRef, mouseRef, showToast } = useToast();

  // 外观（主题 / 我的主题 / 字号 / 界面与代码字体）：状态、localStorage 持久化与应用 effect 都在 hook 内
  const {
    theme,
    setTheme,
    myThemes,
    previewTheme,
    saveMyTheme,
    deleteMyTheme,
    themePop,
    setThemePop,
    fontSize,
    setFontSize,
    zoom,
    setZoom,
    contentZoom,
    setContentZoom,
    uiFont,
    setUiFont,
    codeFont,
    setCodeFont,
  } = useAppearance();

  // 仓库状态角标（未推送 / stash / 冲突 / 可否 stash）+ 远程更新监控，一并抽到 useRepoStatus
  const {
    unpushedCount,
    stashCount,
    conflictCount,
    canStash,
    remoteHint,
    riskFiles,
    onboard,
    setOnboard,
    checkRemote,
    markRemoteSynced,
    remoteFileCount,
    refreshUnpushed,
    refreshStash,
  } = useRepoStatus({ repoType: repo?.type, repoRoot: info?.root, tick });

  const refresh = useCallback((opts?: { remote?: boolean }) => {
    setTick((t) => t + 1);
    // 更新/切分支/合并：连侧边栏的「远程检查」一起重跑（它有自己的 state，不重探就停在旧值）
    if (opts?.remote) setRemoteCheckTick((t) => t + 1);
    void refreshUnpushed();
    void refreshStash();
    // 远程提示条也一并重查（否则侧栏 ⬇ 拉完当前项目后，顶部横条/⬇ 角标（三源取大里的
    // remoteHint）要等下一轮 2 分钟轮询才消失——用户实报"更新完成仍显示 ⬇1"）
    void checkRemote();
  }, [refreshUnpushed, refreshStash, checkRemote]);

  // 最近项目列表（加载 / 删除 / 设常用 / 备注）抽到 useProjectHistory；错误统一走 toast
  const { history, loadHistory, removeHistory, setFav, setRemark } = useProjectHistory((msg) => {
    showToast(msg, true);
  });

  const [diffFrom, setDiffFrom] = useState<View>('browse');

  // 跳转 diff 视图（提交冲突提示"双击查看差异"使用；定义在 useRepoActions 之前供其依赖）
  const gotoDiff = useCallback(
    (path?: string, a?: string, b?: string) => {
      // 二进制文件（Word/PDF/图片等）：不支持文本对比，提示而不进入差异视图
      if (path && isBinaryFile(path)) {
        // 用户要的操作没做成——按错误态显示（停留久一点，别一闪而过）
        // 二进制文件，不支持文本对比
        showToast(t('shell.diff.binary'), true);
        return;
      }
      setDiffFrom(view);
      setDiffTarget({ path, a, b });
      if (path) {
        setLogPath(path); // 历史视图联动记住当前文件
        setLogIsDir(false);
      }
      setView('diff');
    },
    [view, showToast]
  );

  const showLog = useCallback((path?: string, isDir = false) => {
    setLogPath(path);
    setLogIsDir(isDir);
    setView('log');
  }, []);

  // 提交 / 推送 / 更新 / 还原 / 打开差异 / 最近项目打开：全部流程编排抽到 useRepoActions
  const {
    opBusy,
    runOp,
    pushAuth,
    setPushAuth,
    pushNow,
    doPush,
    handleAction,
    doUpdateDir,
    doCommit,
    doCommitSelected,
    openCommitSelect,
    openRepoBrowse,
    openHistoryItem,
    touchHistory,
  } = useRepoActions({
    repo,
    unpushedCount,
    showToast,
    refresh,
    loadHistory,
    gotoDiff,
    markRemoteSynced,
    mouseRef,
    modalRef,
    setModal,
    setInfo,
    setOnboard,
    setInvalidPaths,
    setOpenTick,
    setRemoteSyncedTick,
  });

  // 全局快捷键（Ctrl+` / Ctrl+滚轮 / Ctrl+0 / Ctrl+A / F5）+ 缩放提示
  const { zoomTip } = useAppShortcuts({
    zoom,
    setZoom,
    contentZoom,
    setContentZoom,
    mouseRef,
    refresh,
    showToast,
    setModal,
  });

  // 后台任务完成通知（铃铛留档 + 气泡）
  useTaskNotifications();
  // 共享访问状态：本机在开启局域网共享时轮询远程加入/离开事件
  const shareStatus = useShareWatch();
  // 环境检测（缺失 svn/git 时顶部横幅提示安装；「环境检测」弹窗每次打开重查）
  const { env, missingSvn, missingGit, envMissing } = useEnvCheck({ modalType: modal?.type, repoType: repo?.type });

  useEffect(() => {
    get
      .info()
      .then((r) => setInfo(r))
      .catch(() => setInfo(null));
    get.config().then((c) => setConfigUser(c.username)).catch(() => {});
    // git 凭据的 GitHub 用户名（Fork 菜单可见性粗判；凭据更新后下次刷新生效即可）
    get.gitAuth().then((a) => setGitUser(a.username)).catch(() => {});
    loadHistory();
  }, [loadHistory]);

  // 每次「打开项目」动作后（openTick 变化）：浏览目录重置到打开范围，
  // 保证历史/搜索等默认按子项目，而不是上次浏览的目录或整个仓库
  useEffect(() => {
    browseDirRef.current = repo?.startRel ?? '';
  }, [repo?.root, repo?.startRel, openTick]);

  return (
    <div className="app">
      {/* 自绘标题条（仅 Windows 打包版；浏览器/ Linux 里不渲染） */}
      <TitleStrip version={info?.version} />
      <AppHeader
        view={view}
        repo={repo}
        conflictCount={conflictCount}
        configUser={configUser}
        gitUser={gitUser}
        // 顶栏「浏览仓库」快捷入口（仅 SVN）：与最近项目右键同一逻辑——取仓库根 URL 后开仓库浏览
        onBrowseRepo={() => {
          if (repo?.root) openRepoBrowse(repo.root);
        }}
        onRefresh={refresh}
        setModal={setModal}
        onToast={showToast}
        onPush={doPush}
        // 打开的是子项目（操作范围非空）时只更新该子项目（svn update <scope>），
        // 大工作副本不会一点更新就把几十个子项目全拉一遍
        onUpdate={() => void doUpdateDir(repo?.startRel ?? '')}
        unpushedCount={unpushedCount}
        stashCount={stashCount}
        canStash={canStash ?? true}
      />

      {/* 新建仓库成功后的引导条（一次性，可关闭） */}
      {onboard && (
        <div
          className="env-banner"
          style={{ background: 'rgba(88,166,255,.12)', color: 'var(--accent)', borderBottomColor: 'var(--accent)' }}
        >
          <span style={{ flex: 1, minWidth: 0 }}>{onboard}</span>
          {/* 知道了 */}
          <button className="mini" onClick={() => setOnboard(null)}>{t('ui.modal.gotIt')}</button>
        </div>
      )}

      {remoteHint && !modal && (
        <div
          className="env-banner"
          style={{
            background: remoteHint.risk > 0 ? 'rgba(224,178,92,.18)' : 'rgba(88,166,255,.15)',
            color: remoteHint.risk > 0 ? 'var(--warn)' : 'var(--accent)',
            borderBottomColor: remoteHint.risk > 0 ? 'var(--warn)' : 'var(--accent)',
          }}
        >
          <span>
            {remoteHint.risk > 0 ? (
              <>
                {/* 有 {n} 个文件你和对方改了同一处，更新时会冲突 */}
                ⚠ <b>{t('shell.remote.riskBold', { n: remoteHint.risk })}</b>
                {/* （远程 {n} 个新提交 /  · 共 {n} 个文件） */}
                {remoteHint.behind > 0 ? `${t('shell.remote.riskSuffixA', { n: remoteHint.behind })}${t('shell.remote.riskSuffixB', { n: remoteFileCount })}` : ''}
              </>
            ) : (
              // 🔔 远程有  /  个新提交 · 共  /  个文件
              <>{t('shell.remote.newA')}<b>{remoteHint.behind}</b>{t('shell.remote.newB', { n: remoteHint.behind })}<b>{remoteFileCount}</b>{t('shell.remote.newC', { n: remoteFileCount })}</>
            )}
            {/*  · {n} 个文件被他人锁定 */}
            {remoteHint.locked > 0 ? t('shell.remote.lockedSuffix', { n: remoteHint.locked }) : ''}
          </span>
          <span className="grow" />
          {/* 远程新提交涉及的文件总数（remoteLogs 去重；无 logs 时用 updatedFiles 数） */}
          {remoteHint.risk > 0 && (
            <button className="mini" onClick={() => setModal({ type: 'remote-conflicts', files: riskFiles })}>
              {/* 查看对比 */}
              {t('shell.viewDiff')}
            </button>
          )}
          {/* 去查看：弹窗列出新提交涉及的文件，确认后即更新 */}
          <button
            className="mini primary"
            onClick={() =>
              setModal({
                type: 'confirm',
                // 远程有 {n} 个新提交 /  · 共 {n} 个文件
                title: `${t('shell.remote.titleA', { n: remoteHint.behind })}${t('shell.remote.titleB', {
                  n: remoteHint.remoteLogs?.length
                    ? new Set(remoteHint.remoteLogs.flatMap((l) => l.changed.map((c) => c.path))).size
                    : (remoteHint.files?.length ?? 0),
                })}`,
                // 宽度随最长文件名自适应（与提交确认弹窗同规则）
                width: pathAutoWidth((remoteHint.files ?? []).reduce((m, p) => Math.max(m, p.length), 0), 520, 1200),
                message: (
                  <>
                    {remoteHint.remoteLogs && remoteHint.remoteLogs.length > 0 ? (
                      // 按提交分组：分隔线 + 提交人/时间/消息 + 提交的文件
                      <div className="vcs-list" style={{ minHeight: 120 }}>
                        {remoteHint.remoteLogs.map((l, i) => (
                          <React.Fragment key={l.rev}>
                            {i > 0 && <div className="remote-log-sep">──────────</div>}
                            <div className="remote-log-head">
                              <span className="mono small" style={{ fontWeight: 700, color: 'var(--accent)', flexShrink: 0 }}>{l.rev}</span>
                              <span className="small" style={{ flexShrink: 0 }}>{l.author}</span>
                              <span className="small dim" style={{ flexShrink: 0 }}>{l.date.slice(0, 16)}</span>
                            </div>
                            {l.msg && <div className="small dim" style={{ padding: '2px 10px' }}>{l.msg}</div>}
                            {l.changed.map((c) => (
                              <div key={c.path} className="vcs-row" style={{ cursor: 'default' }}>
                                <span className={`act ${c.action}`} style={{ flexShrink: 0 }}>{c.action}</span>
                                <span className="mono small" style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={c.path}>
                                  {c.path}
                                </span>
                              </div>
                            ))}
                          </React.Fragment>
                        ))}
                      </div>
                    ) : (
                      <div className="vcs-list" style={{ minHeight: 120 }}>
                        {(remoteHint.files ?? []).map((f) => (
                          <div key={f} className="vcs-row" style={{ cursor: 'default' }}>
                            <span className="mono small" style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={f}>
                              {f}
                            </span>
                          </div>
                        ))}
                        {/* （无法获取文件列表） */}
                        {(remoteHint.files ?? []).length === 0 && <div className="dim" style={{ padding: 10 }}>{t('shell.remote.noFiles')}</div>}
                      </div>
                    )}
                  </>
                ),
                // 更新
                confirmLabel: t('shell.tool.update'),
                confirmCmd: repo?.type === 'svn' ? 'svn update' : 'git pull',
                action: () => {
                  setModal(null);
                  void doUpdateDir('');
                },
              })
            }
          >
            {/* 查看对比 */}
            {t('shell.viewDiff')}
          </button>
        </div>
      )}

      {/* 环境缺失横幅:仅提示当前仓库类型需要的引擎 */}
      {envMissing && !modal && (
        <div className="env-banner">
          <span>
            {missingSvn && missingGit
              // ⚠ 未检测到 SVN 和 Git，无法操作任何版本库
              ? t('shell.env.missingBoth')
              : missingSvn
                // ⚠ 未检测到 SVN，无法操作 SVN 仓库（使用 Git 不受影响）
                ? t('shell.env.missingSvn')
                // ⚠ 未检测到 Git，无法操作 Git 仓库（使用 SVN 不受影响）
                : t('shell.env.missingGit')}
          </span>
          <span className="grow" />
          {/* 查看指引 */}
          <button className="mini primary" onClick={() => setModal({ type: 'env' })}>{t('shell.env.guide')}</button>
        </div>
      )}

      <div className="main">
        {repo?.type ? (
          <>
            <Sidebar
              view={view}
              history={history}
              version={info?.version}
              currentRoot={repo?.root}
              currentScope={repo?.startRel}
              // 顶栏「刷新」信号：侧边栏重跑状态探测（当前项目绕过后端缓存——刚提交后点刷新，↑ 角标立刻准）
              refreshTick={tick}
              // 远程状态重算信号（更新/切分支/合并后 +1）：侧栏据此重跑一遍「远程检查」，
              // 否则 ⬇ 角标会停在操作前的数（后端缓存虽已失效，前端不重探也看不到）
              remoteCheckTick={remoteCheckTick}
              // 「整个仓库已同步」（拉取/根目录更新成功）：当前项目 ⬇ 立即归零，不等联网重查
              remoteSyncedTick={remoteSyncedTick}
              // 当前项目的"远程有新提交"（preflight 实时检查结果，顶部提示条同源）——
              // 侧边栏当前项目条目据此显示 ⬇（SVN 项目本地探测拿不到 behind，靠这条补上）
              remoteBehind={remoteHint?.behind ?? 0}
              onToast={showToast}
              onRefresh={refresh}
              onBrowseRepo={openRepoBrowse}
              onManageWorktrees={() => setModal({ type: 'worktrees' })}
              onNav={(v) => {
                // 点「历史」带上当前浏览目录（'' = 仓库根 → 传 undefined 看全仓库）；浏览目录恒为目录
                if (v === 'log') showLog(browseDirRef.current || undefined, true);
                else setView(v);
              }}
              onOpenHistory={openHistoryItem}
              onRemoveHistory={removeHistory}
              onSetFav={setFav}
              onSetRemark={setRemark}
              theme={theme}
              setTheme={setTheme}
              onOpenThemePop={(x, y) => setThemePop({ x, y })}
              themePopOpen={Boolean(themePop)}
              invalidPaths={invalidPaths}
              onOpenProject={() => setModal({ type: 'open' })} // 与顶栏 ⋯ 菜单里的「打开项目」同一个弹窗
              onShowTip={(msg) => {
                showToast(msg, true); // 失效项目的原因说明（打不开/已删除）：按错误态显示
              }}
            />
            {/* 点内容区（文件/空白都行）= 在用这个项目 → 刷新最近项目里的"最近使用时间" */}
            <div className="content" onClick={touchHistory}>
              {/* 视图常驻（display 切换），切换回来保留原位置/展开状态 */}
              <div style={{ display: view === 'log' ? undefined : 'none', height: '100%' }}>
                <HistoryView path={logPath} pathIsDir={logIsDir} tick={tick} active={view === 'log'} repoType={repo?.type ?? 'git'} onChanged={refresh} onToast={showToast} onOpenDiff={(path, rev) => gotoDiff(path, rev)} onBack={() => setView('browse')} />
              </div>
              <div style={{ display: view === 'diff' ? undefined : 'none', height: '100%' }}>
                <DiffView
                  target={diffTarget}
                  tick={tick}
                  active={view === 'diff'}
                  onToast={showToast}
                  // 全屏查看/编辑整个工作区文件：复用文件预览的全屏（切到文件视图打开并全屏）
                  onFullscreen={(path) => {
                    const name = path.split('/').pop() ?? path;
                    setView('browse');
                    openSessionInPlace({
                      root: info?.root ?? '',
                      type: repo?.type ?? 'git',
                      rel: path,
                      name,
                      mode: 'raw',
                      full: true,
                      fromDiff: true,
                      worktree: true, // 对比里看的是工作区内容（含未提交修改），不是 HEAD
                      ts: Date.now(),
                    });
                  }}
                  onBack={() => {
                    setView(diffFrom);
                    // 从「提交修改的文件」弹窗双击进入差异：返回时恢复该弹窗
                    if (diffReturnModal) {
                      const m = diffReturnModal;
                      setDiffReturnModal(null);
                      if (m.type === 'commit-select') {
                        // 重新收集状态：文件可能在编辑器里被改回原样/还原过，旧的 items 快照会把 M 留在列表里
                        void openCommitSelect(m.dir, m.dirLabel, {
                          checked: m.checked,
                          msg: m.msg,
                          stagedOnly: m.stagedOnly,
                        });
                      } else {
                        setModal(m);
                      }
                    }
                  }}
                />
              </div>
              <div style={{ display: view === 'browse' ? undefined : 'none', height: '100%' }}>
                <FsView
                  key={`${repo.root ?? ''}::${openTick}`}
                  tick={tick}
                  active={view === 'browse'}
                  repoType={repo.type}
                  remote={shareStatus ? !shareStatus.local : false}
                  shareReadOnly={shareStatus ? shareStatus.readOnly : false}
                  repoRoot={repo.root}
                  startRel={repo.startRel}
                  onAction={handleAction}
                  onDiff={(p) => gotoDiff(p)}
                  onLog={(p, isDir) => showLog(p, isDir)}
                  onDirChange={(d) => {
                    browseDirRef.current = d;
                  }}
                  onCommitSelect={openCommitSelect}
                  onUpdateDir={doUpdateDir}
                  onToast={showToast}
                  // 从对比视图进入的全屏退出时：回到对比视图（DiffView 常驻，位置保留）
                  onReturnToDiff={() => setView('diff')}
                />
              </div>
            </div>
          </>
        ) : (
          <div className="content" style={{ flex: 1 }}>
            <OpenView
              startDir={info?.home ?? info?.startDir ?? ''}
              onOpened={(r) => {
                // 打开项目同样是切换：把当前文件预览/编辑现场挂到右侧胶囊
                const snap = captureActiveSession();
                if (snap && (!r.root || snap.root !== r.root)) addSession(snap);
                setInfo(r);
                setOnboard(null);
                refresh();
                loadHistory();
              }}
              onCreatedRepo={(r) => setOnboard(onboardText(r))}
              onToast={showToast}
              onOpenPractice={() => setModal({ type: 'practice' })}
            />
          </div>
        )}
      </div>

      {/* 短操作进行中指示条（revert/delete/add 等无独立进度窗的操作） */}
      {opBusy && (
        <div style={{ position: 'fixed', top: 8, left: '50%', transform: 'translateX(-50%)', zIndex: 500,
          background: 'var(--panel2)', border: '1px solid var(--border)', borderRadius: 6,
          padding: '6px 14px', fontSize: 13, boxShadow: '0 6px 20px rgba(0,0,0,.18)' }}>
          <span className="loading">⏳</span> {opBusy}
        </div>
      )}
      {/* 文字缩放提示（Ctrl+滚轮 / Ctrl+0）：跟随鼠标，滚动停止后消失 */}
      {zoomTip && (
        <div
          className="zoom-tip"
          style={{
            left: Math.max(8, Math.min(zoomTip.x - 40, window.innerWidth - 140)),
            top: Math.max(8, zoomTip.y - 52),
          }}
        >
          {t(zoomTip.content ? 'shell.zoomTipContent' : 'shell.zoomTip', { pct: zoomTip.percent })}
        </div>
      )}
      {/* 操作结果提示：鼠标位置悬浮，淡出；错误态停留更久（见 .toast-tip.err） */}
      {toast && (
        <div
          ref={toastRef}
          className={`toast-tip${toastErr ? ' err' : ''}${toastQuick ? ' quick' : ''}`}
          style={{
            left: Math.min(mouseRef.current.x, window.innerWidth - 360),
            top: Math.max(8, mouseRef.current.y - 26),
            color: toastErr ? 'var(--err)' : 'var(--text)',
            maxWidth: 'min(620px, 80vw)',
            border: toastErr ? '1px solid var(--err)' : '1px solid var(--border)',
          }}
          title={toast}
        >
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
            {toastErr ? <IconErr /> : <IconOk />}
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>{translateVcsError(toast)}</span>
          </span>
        </div>
      )}

      {/* 全部弹窗 + 「更新中」遮罩：集中在 modal-host.tsx（原先 21 个分支平铺在本文件 JSX 里，约 340 行） */}
      <ModalHost
        state={{ modal, pushAuth, themePop, invalidPaths, openHistoryItem, configUser }}
        onRepoOpened={() => setOpenTick((n) => n + 1)}
        set={{
          setModal,
          setPushAuth,
          setThemePop,
          setConfigUser,
          setInfo,
          setOnboard,
          setView,
          showToast,
          setDiffReturnModal,
        }}
        ctx={{ repo, env, info, browseDir: browseDirRef.current }}
        appearance={{ fontSize, setFontSize, uiFont, setUiFont, codeFont, setCodeFont }}
        theme={{ current: theme, myThemes, setTheme, previewTheme, saveMyTheme, deleteMyTheme }}
        actions={{ doCommit, doCommitSelected, runOp, refresh, loadHistory, gotoDiff, pushNow }}
      />

      {/* 右侧文件会话胶囊：切换项目后一键回到刚才的浏览/编辑现场 */}
      <FileSessionsDock
        onOpen={async (s) => {
          // 目录书签 / 已知二进制 / 未知扩展名探测为二进制 → 不进预览，在父目录里选中它并刷新一次
          // （点条目才进入）。二进制当文本读会把大文件拖死——用户实报：右键二进制「稍后看」后
          // 点胶囊直接卡死。图片有自己的预览（applySession 会带 img），不算在这一类。
          let locate = s.kind === 'dir' || (!isImageFile(s.rel) && isBinaryFile(s.rel));
          if (!locate && !isImageFile(s.rel) && !isKnownTextFile(s.rel)) {
            if (info?.root && s.root === info.root) {
              // 未知扩展名（如自定义 .tgg、无扩展名文件）：读文件头探测，二进制就只定位
              const k = await get.fileKind(s.rel).catch(() => null);
              locate = k?.binary === true;
            } else {
              // 跨项目时探测接口基于当前项目、用不了 → 保守定位（切过去后双击会走内容探测）
              locate = true;
            }
          }
          if (locate) {
            const parent = s.rel.includes('/') ? s.rel.slice(0, s.rel.lastIndexOf('/')) : '';
            const payload = { root: s.root, dir: parent, selectRel: s.rel };
            if (info?.root && s.root === info.root) {
              setView('browse');
              refresh(); // 刷新一次列表状态
              window.setTimeout(() => openDirInPlace(payload), 0);
            } else {
              setPendingDir(payload);
              void openHistoryItem({ path: s.root, type: s.type });
            }
            return;
          }
          // 同一项目：直接打开（不切项目、不重挂载），先把当前现场挂起
          if (info?.root && s.root === info.root) {
            const cur = captureActiveSession();
            if (cur && cur.rel !== s.rel) addSession(cur);
            setView('browse'); // 若在历史/diff，先回到文件视图
            // 等视图切换渲染完成后再派发，确保文件视图能收到
            window.setTimeout(() => openSessionInPlace(s), 0);
            return;
          }
          // 跨项目：当前如果也在另一个项目的预览里，先把它也挂起（别丢现场）
          const snap = captureActiveSession();
          if (snap && snap.root !== s.root) addSession(snap);
          setPendingSession(s);
          void openHistoryItem({ path: s.root, type: s.type });
        }}
        onOpenDir={(s) => {
          // 目录书签：打开的就是这个目录本身；文件：打开它所在的目录并选中它
          const dir =
            s.kind === 'dir'
              ? s.rel
              : s.rel.includes('/')
                ? s.rel.slice(0, s.rel.lastIndexOf('/'))
                : '';
          const payload = { root: s.root, dir, selectRel: s.kind === 'dir' ? undefined : s.rel };
          // 同一项目：直接定位到目录并选中文件（不切项目、不打开预览）
          if (info?.root && s.root === info.root) {
            setView('browse');
            window.setTimeout(() => openDirInPlace(payload), 0);
            return;
          }
          // 跨项目：切换项目后由文件视图消费
          setPendingDir(payload);
          void openHistoryItem({ path: s.root, type: s.type });
        }}
      />
    </div>
  );
}
