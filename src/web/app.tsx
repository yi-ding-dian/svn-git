/** 根组件：侧边栏布局 + 全局状态 + 操作流程 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { get, post, type RepoInfo, type VcsResult } from './api.js';
import { LogView } from './log.js';
import { DiffView, type DiffTarget } from './diff.js';
import { FsView } from './fs.js';
import { OpenView, OpenModal } from './open.js';
import { CommitModal, LoginModal, ConfirmModal, CommitSelectModal, UpdateResultModal, EnvInstallModal, type Modal } from './modals.js';
import { BranchDialog, TagDialog, StashDialog, CreateRepoDialog, CleanDialog, GitInfoModal, GitPushAuthModal } from './vcs-dialogs.js';
import { ConflictResolverModal } from './conflicts.js';
import { RemoteConflictModal } from './remote-conflicts.js';
import { AppHeader, THEMES, FONT_SIZES } from './header.js';
import { Sidebar, type View } from './sidebar.js';
import { pathAutoWidth } from './utils.js';

type Op = 'add' | 'commit' | 'update' | 'revert' | 'delete' | 'push';

export function App() {
  const [info, setInfo] = useState<RepoInfo | null>(null);
  const repo = info?.type ? info : null;
  const [view, setView] = useState<View>('browse');
  const [history, setHistory] = useState<{ path: string; type: 'svn' | 'git'; lastOpened: number }[]>([]);
  const [tick, setTick] = useState(0);
  const [toast, setToast] = useState('');
  const [modal, setModal] = useState<Modal>(null);
  const [diffTarget, setDiffTarget] = useState<DiffTarget | null>(null);
  // 从「提交修改的文件」弹窗进入差异视图时记录，返回时恢复该弹窗
  const [diffReturnModal, setDiffReturnModal] = useState<Modal>(null);
  const [logPath, setLogPath] = useState<string | undefined>(undefined);
  const [configUser, setConfigUser] = useState('');
  // toast：跟随鼠标位置悬浮提示，1.5 秒后淡出（不用底部固定条）
  const mouseRef = useRef({ x: window.innerWidth / 2, y: 60 });
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      mouseRef.current = { x: e.clientX, y: e.clientY };
    };
    window.addEventListener('mousemove', onMove);
    return () => window.removeEventListener('mousemove', onMove);
  }, []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(''), 1500);
    return () => clearTimeout(t);
  }, [toast]);
  const [updateResult, setUpdateResult] = useState<{
    dir: string;
    ok: boolean;
    message: string;
    files?: { path: string; status: string; code?: string }[];
    warnings?: string[];
  } | null>(null);
  const [env, setEnv] = useState<{ svn: { installed: boolean; version: string }; git: { installed: boolean; version: string } } | null>(null);
  const [theme, setTheme] = useState(() => {
    try {
      const t = localStorage.getItem('svnkit-theme');
      return THEMES.some((x) => x.key === t) ? t! : 'light';
    } catch {
      return 'light';
    }
  });
  const [fontSize, setFontSize] = useState(() => {
    try {
      const n = Number(localStorage.getItem('svnkit-fontsize'));
      return FONT_SIZES.includes(n) ? n : 14;
    } catch {
      return 14;
    }
  });

  // 应用主题
  useEffect(() => {
    document.body.dataset.theme = theme;
    try {
      localStorage.setItem('svnkit-theme', theme);
    } catch {
      /* ignore */
    }
  }, [theme]);

  // 应用字号
  useEffect(() => {
    document.documentElement.style.setProperty('--font-size', `${fontSize}px`);
    try {
      localStorage.setItem('svnkit-fontsize', String(fontSize));
    } catch {
      /* ignore */
    }
  }, [fontSize]);

  const refresh = useCallback(() => setTick((t) => t + 1), []);

  // 冲突计数：有 C 状态文件时显示"解决冲突"入口
  const [conflictCount, setConflictCount] = useState(0);
  useEffect(() => {
    if (!repo?.type) {
      setConflictCount(0);
      return;
    }
    get
      .status()
      .then((r) => setConflictCount(r.items.filter((i) => i.code === 'C').length))
      .catch(() => {});
  }, [repo?.type, tick]);

  // 加载历史项目
  const loadHistory = useCallback(() => {
    get
      .history()
      .then((r) => setHistory(r.items))
      .catch(() => {});
  }, []);

  useEffect(() => {
    get
      .info()
      .then((r) => setInfo(r))
      .catch(() => setInfo(null));
    get.config().then((c) => setConfigUser(c.username)).catch(() => {});
    loadHistory();
    // 环境检测：缺失 svn/git 时顶部横幅提示安装
    get
      .envCheck()
      .then((r) => setEnv(r))
      .catch(() => {});
  }, [loadHistory]);

  // 删除最近项目（侧边栏右键菜单）：删除后刷新列表
  const removeHistory = useCallback((path: string) => {
    void post
      .historyRemove(path)
      .then((r) => setHistory(r.items))
      .catch(() => setToast('删除失败'));
  }, []);

  // 环境缺失:只提示「当前仓库类型需要」的引擎;未打开仓库时任一缺失都提示
  // (用户可能只用 Git 或只用 SVN,不强制两者都装)
  const needSvn = !repo?.type || repo.type === 'svn';
  const needGit = !repo?.type || repo.type === 'git';
  const missingSvn = !!(env && needSvn && !env.svn.installed);
  const missingGit = !!(env && needGit && !env.git.installed);
  const envMissing = missingSvn || missingGit;

  // 远程更新监控：每 2 分钟检查一次（git fetch / svn status -u 均为轻量操作）
  // 重点：你正在修改的文件是否被他人先提交（冲突风险预警）
  const [remoteHint, setRemoteHint] = useState<{ behind: number; locked: number; risk: number; files?: string[] } | null>(null);
  const [riskFiles, setRiskFiles] = useState<string[]>([]);
  // 检查远程状态并刷新提示条；更新完成后立即调用，避免提示条残留旧状态
  const checkRemote = useCallback(() => {
    get
      .preflight()
      .then((r) => {
        const risk = r.conflictRisk?.length ?? 0;
        if (r.behind > 0 || (r.lockedByOthers?.length ?? 0) > 0 || risk > 0) {
          setRemoteHint({ behind: r.behind, locked: r.lockedByOthers?.length ?? 0, risk, files: r.updatedFiles ?? [] });
          setRiskFiles((r.conflictRisk ?? []).map((f) => f.path));
        } else {
          setRemoteHint(null);
          setRiskFiles([]);
        }
      })
      .catch(() => {});
  }, []);
  useEffect(() => {
    checkRemote();
    const t = setInterval(checkRemote, 120_000);
    return () => clearInterval(t);
  }, [info?.root, checkRemote]);

  // 从历史列表打开项目
  const openHistoryItem = useCallback(
    async (h: { path: string }) => {
      try {
        await post.open(h.path);
        const r = await get.info();
        if (r.type) {
          setInfo(r);
          refresh();
          loadHistory();
        } else {
          setToast('打开失败：未识别为仓库');
        }
      } catch (e) {
        setToast((e as Error).message);
      }
    },
    [refresh, loadHistory]
  );

  // 执行操作
  const runOp = useCallback(
    async (op: Op, paths: string[]): Promise<VcsResult> => {
      let r: VcsResult;
      if (op === 'add') r = await post.add(paths);
      else if (op === 'commit') r = await post.commit(paths, '');
      else if (op === 'update') r = await post.update();
      else if (op === 'revert') r = await post.revert(paths);
      else if (op === 'delete') r = await post.delete(paths);
      else r = await post.push();
      setToast(r.message);
      if (r.ok) refresh();
      if (r.authError) setModal({ type: 'login' });
      return r;
    },
    [refresh]
  );

  // 推送：进度窗口(转圈可取消) + 认证引导（GitHub token / 服务器密码）；定义在 handleAction 之前供其依赖
  const [pushing, setPushing] = useState(false);
  const pushAbortRef = useRef<AbortController | null>(null);
  const [pushAuth, setPushAuth] = useState<{ type: 'github' | 'server' | 'ssh'; error?: string } | null>(null);
  // 实际执行推送（进度窗口 + 认证引导）
  const pushNow = useCallback(async () => {
    setPushing(true);
    const ac = new AbortController();
    pushAbortRef.current = ac;
    try {
      const r = await post.push(ac.signal);
      if (r.ok) {
        setToast(r.message);
        refresh();
      } else if (r.authType) {
        // 认证失败 → 弹认证引导（带上失败原因，避免用户不明所以）
        setPushAuth({ type: r.authType, error: r.message });
      } else {
        // 其他失败：弹窗明确显示错误（避免 toast 一闪而过"没反应"）
        setModal({
          type: 'confirm',
          title: '❌ 推送失败',
          message: (
            <div className="error" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
              {r.message}
            </div>
          ),
          confirmLabel: '知道了',
          action: () => setModal(null),
        });
      }
    } catch (e) {
      setToast((e as Error).message === '已取消' ? '已取消推送' : `推送失败: ${(e as Error).message}`);
    } finally {
      setPushing(false);
      pushAbortRef.current = null;
    }
  }, [refresh]);
  const cancelPush = () => pushAbortRef.current?.abort();
  // 推送入口：点击立即弹推送窗口，落后检查在窗口内进行（网络慢也有反馈，不让人干等）
  const doPush = useCallback(() => {
    void (async () => {
      setPushing(true);
      const ac = new AbortController();
      pushAbortRef.current = ac;
      try {
        // 落后检查（窗口内，15 秒超时，超时视为无落后直接推）
        const pac = new AbortController();
        const pt = setTimeout(() => pac.abort(), 15_000);
        const pf = await get.preflight(pac.signal).catch(() => null);
        clearTimeout(pt);
        if (pf && pf.behind > 0) {
          setPushing(false);
          setModal({
            type: 'confirm',
            title: '⚠ 推送前需要拉取',
            message: (
              <>
                远程有 <b>{pf.behind}</b> 个新提交，当前分支落后。直接推送会被拒绝，建议先拉取合并。
                {pf.conflictRisk.length > 0 && (
                  <div className="error mt8">
                    ⚠ 以下文件双方都有修改，拉取时可能冲突：{pf.conflictRisk.map((f) => f.path).join('、')}
                  </div>
                )}
              </>
            ),
            confirmLabel: '仍然推送',
            secondaryLabel: '先拉取',
            action: () => void pushNow(),
            secondaryAction: () => {
              setModal(null);
              void doUpdateDir('');
            },
          });
          return;
        }
        // 实际推送（pushNow 负责进度窗口/认证引导/失败弹窗）
        await pushNow();
      } catch (e) {
        setToast((e as Error).message === '已取消' ? '已取消推送' : `推送失败: ${(e as Error).message}`);
      } finally {
        setPushing(false);
        pushAbortRef.current = null;
      }
    })();
  }, [pushNow]);

  // 跳转 diff 视图（提交冲突提示"双击查看差异"使用；定义在 handleAction 之前供其依赖）
  const gotoDiff = useCallback(
    (path?: string, a?: string, b?: string) => {
      setDiffFrom(view);
      setDiffTarget({ path, a, b });
      if (path) setLogPath(path); // 历史视图联动记住当前文件
      setView('diff');
    },
    [view]
  );

  // 操作请求分派
  const handleAction = useCallback(
    (op: Op, paths: string[]) => {
      if (op === 'commit') {
        // 提交前检查：行冲突 → 强制拦截；仅服务器更新 → 提示先更新
        void (async () => {
          try {
            const pf = await get.preflight();
            const clash = pf.conflictRisk.filter((f) => f.lines.length > 0);
            if (clash.length > 0) {
              // ⚠ 行冲突：禁止提交，引导手动处理（备份→删除→更新→手动合并）
              setModal({
                type: 'confirm',
                title: '⚠ 存在行冲突，禁止提交',
                message: (
                  <>
                    以下文件与服务器版本存在<b>行冲突</b>，请先手动处理后再提交：
                    <div className="error mt8" style={{ maxHeight: 120, overflow: 'auto' }}>
                      {clash.map((f) => (
                        <div key={f.path} className="mono">
                          ⚠ {f.path}：{f.lines.map((l) => (l === 0 ? '文件开头' : `第 ${l} 行`)).join('、')} 冲突
                        </div>
                      ))}
                    </div>
                    <div className="dim small mt8" style={{ lineHeight: 1.8 }}>
                      处理步骤：
                      <br />1. 点「查看对比」确认对方改了哪里、你改了哪里
                      <br />2. <b>先备份你的修改</b>（复制内容保存到本地）
                      <br />3. 删除该文件，再点「更新」获取服务器最新版本
                      <br />4. 按冲突位置手动合并两边内容 → 重新提交
                    </div>
                  </>
                ),
                confirmLabel: '知道了',
                secondaryLabel: '查看对比',
                action: () => setModal(null),
                secondaryAction: () => {
                  setModal({ type: 'remote-conflicts', files: clash.map((f) => f.path) });
                },
              });
              return; // 不放行提交
            }
            if (pf.remoteHasUpdate) {
              // 仅当待提交文件与服务器更新文件有交集时才提示（列出可能冲突文件，双击看差异）；
              // 无交集 → 不打扰，直接进提交界面
              const same = (pf.updatedFiles ?? []).filter((f) => paths.includes(f));
              if (same.length === 0) {
                setModal({ type: 'commit', paths });
                return;
              }
              setModal({
                type: 'confirm',
                title: '⚠ 服务器有新版本',
                message: (
                  <>
                    服务器有 <b>{pf.behind}</b> 个新提交，以下 <b>{same.length}</b> 个待提交文件服务器也有新版本，<b>可能冲突</b>（双击查看差异）：
                    <div className="vcs-list" style={{ maxHeight: 180, marginTop: 8 }}>
                      {same.map((f) => (
                        <div
                          key={f}
                          className="vcs-row"
                          title="双击查看差异"
                          onDoubleClick={() => {
                            setModal(null);
                            gotoDiff(f);
                          }}
                        >
                          <span className="mono small" style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {f}
                          </span>
                          <span className="dim small nowrap">双击查看差异</span>
                        </div>
                      ))}
                    </div>
                  </>
                ),
                confirmLabel: '继续提交',
                secondaryLabel: '先更新',
                action: () => setModal({ type: 'commit', paths }),
                secondaryAction: () => {
                  setModal(null);
                  void doUpdateDir('');
                },
              });
            } else {
              setModal({ type: 'commit', paths });
            }
          } catch {
            setModal({ type: 'commit', paths });
          }
        })();
      } else if (op === 'push') {
        // 统一走 doPush（落后检查 + 进度窗口 + 认证引导）
        doPush();
      } else if (op === 'revert') {
        setModal({
          type: 'confirm',
          title: '还原确认',
          message: (
            <>
              将放弃对 <b>{paths[0] ?? '所选'}</b> 的本地修改，不可恢复。确认还原？
            </>
          ),
          action: () => void runOp('revert', paths),
        });
      } else if (op === 'delete') {
        setModal({
          type: 'confirm',
          title: '删除确认',
          danger: true,
          message: (
            <>
              将从版本库中删除 <b>{paths[0] ?? '所选'}</b>。确认删除？
            </>
          ),
          action: () => void runOp('delete', paths),
        });
      } else {
        void runOp(op, paths);
      }
    },
    [runOp, gotoDiff, doPush]
  );

  const doCommit = useCallback(
    async (paths: string[], message: string) => {
      const r = await post.commit(paths, message);
      setToast(r.message);
      if (r.ok) refresh();
      if (r.authError) setModal({ type: 'login' });
      setModal(null);
    },
    [refresh]
  );

  // 打开勾选式提交弹窗（收集当前目录变更）
  const openCommitSelect = useCallback(
    async (dir: string, dirLabel: string) => {
      try {
        const st = await get.status();
        const prefix = dir ? dir + '/' : '';
        const items = st.items
          // 未版本化（?）文件不在提交列表（需先"添加到版本库"）
          .filter((i) => i.code !== '?')
          // 指定目录 → 该目录及其子目录；根目录 → 全部修改文件（含子目录）
          .filter((i) => (prefix ? i.path.startsWith(prefix) : true))
          .map((i) => ({ path: i.path, code: i.code, isDir: i.isDir }));
        if (items.length === 0) {
          setToast('当前目录下没有变更文件');
          return;
        }
        setModal({ type: 'commit-select', dir, dirLabel, items });
      } catch (e) {
        setToast(`读取变更失败: ${(e as Error).message}`);
      }
    },
    []
  );

  // 勾选提交：二次确认后执行（svn 未版本化文件先 add）
  const doCommitSelected = useCallback(
    async (paths: string[], message: string) => {
      setModal(null);
      try {
        if (repo?.type === 'svn') {
          const st = await get.status();
          const needAdd = paths.filter((p) => st.items.some((i) => i.path === p && i.code === '?'));
          if (needAdd.length > 0) await post.add(needAdd);
        }
        const r = await post.commit(paths, message);
        setToast(r.message);
        if (r.ok) refresh();
        if (r.authError) setModal({ type: 'login' });
      } catch (e) {
        setToast(`提交失败: ${(e as Error).message}`);
      }
    },
    [refresh, repo?.type]
  );

  // 更新当前目录（右键菜单）：立即弹"正在更新"窗口（转圈可取消），完成后显示结果
  const [updating, setUpdating] = useState(false);
  const updateAbortRef = useRef<AbortController | null>(null);
  const doUpdateDir = useCallback(
    async (dir: string) => {
      setUpdating(true);
      const ac = new AbortController();
      updateAbortRef.current = ac;
      try {
        const r = await post.update(dir || undefined, ac.signal);
        setUpdateResult({ dir: dir || '（仓库根）', ok: r.ok, message: r.message, files: r.files, warnings: r.warnings });
        if (r.ok) {
          refresh();
          checkRemote(); // 更新完成立即刷新远程提示条（否则要等下一轮 2 分钟轮询）
        }
        if (r.authError) setModal({ type: 'login' });
      } catch (e) {
        setToast((e as Error).message === '已取消' ? '已取消更新' : `更新失败: ${(e as Error).message}`);
      } finally {
        setUpdating(false);
        updateAbortRef.current = null;
      }
    },
    [refresh, checkRemote]
  );
  const cancelUpdate = () => updateAbortRef.current?.abort();
  // 耗时（秒）：更新/推送中每秒刷新
  const [updateElapsed, setUpdateElapsed] = useState(0);
  useEffect(() => {
    if (!updating && !pushing) return;
    setUpdateElapsed(0);
    const t = setInterval(() => setUpdateElapsed((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [updating, pushing]);

  const [diffFrom, setDiffFrom] = useState<View>('browse');

  const showLog = useCallback((path?: string) => {
    setLogPath(path);
    setView('log');
  }, []);

  return (
    <div className="app">
      <AppHeader
        view={view}
        repo={repo}
        conflictCount={conflictCount}
        configUser={configUser}
        theme={theme}
        fontSize={fontSize}
        setTheme={setTheme}
        setFontSize={setFontSize}
        onRefresh={refresh}
        setModal={setModal}
        onToast={setToast}
        onPush={doPush}
      />

      {/* 远程更新提示条：含"你修改的文件被他人先提交"预警 */}
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
                ⚠ <b>你修改的 {remoteHint.risk} 个文件已被他人先提交新版本</b>
                {remoteHint.behind > 0 ? `（远程共 ${remoteHint.behind} 个新提交）` : ''}
              </>
            ) : (
              <>🔔 远程有 <b>{remoteHint.behind}</b> 个新提交</>
            )}
            {remoteHint.locked > 0 ? ` · ${remoteHint.locked} 个文件被他人锁定` : ''}
          </span>
          <span className="grow" />
          {remoteHint.risk > 0 && (
            <button className="mini" onClick={() => setModal({ type: 'remote-conflicts', files: riskFiles })}>
              查看对比
            </button>
          )}
          {/* 去查看：弹窗列出新提交涉及的文件 */}
          <button
            className="mini"
            onClick={() =>
              setModal({
                type: 'confirm',
                title: `远程有 ${remoteHint.behind} 个新提交`,
                message: (
                  <>
                    <div className="small dim" style={{ marginBottom: 6 }}>
                      新提交涉及的文件（{remoteHint.files?.length ?? 0} 个）：
                    </div>
                    <div className="vcs-list" style={{ maxHeight: 320 }}>
                      {(remoteHint.files ?? []).map((f) => (
                        <div key={f} className="vcs-row" style={{ cursor: 'default' }}>
                          <span className="mono small" style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={f}>
                            {f}
                          </span>
                        </div>
                      ))}
                      {(remoteHint.files ?? []).length === 0 && <div className="dim" style={{ padding: 10 }}>（无法获取文件列表）</div>}
                    </div>
                  </>
                ),
                confirmLabel: '关闭',
                action: () => setModal(null),
              })
            }
          >
            去查看
          </button>
          <button className="mini primary" onClick={() => void doUpdateDir('')}>去更新</button>
        </div>
      )}

      {/* 环境缺失横幅:仅提示当前仓库类型需要的引擎 */}
      {envMissing && !modal && (
        <div className="env-banner">
          <span>
            ⚠ 未检测到{missingSvn ? ' SVN' : ''}{missingGit ? ' Git' : ''}
            {missingSvn && missingGit
              ? '，无法操作任何版本库'
              : missingSvn
                ? '，无法操作 SVN 仓库（使用 Git 不受影响）'
                : '，无法操作 Git 仓库（使用 SVN 不受影响）'}
          </span>
          <span className="grow" />
          <button className="mini primary" onClick={() => setModal({ type: 'env' })}>查看指引</button>
        </div>
      )}

      <div className="main">
        {repo?.type ? (
          <>
            <Sidebar
              view={view}
              history={history}
              version={info?.version}
              onNav={setView}
              onOpenHistory={openHistoryItem}
              onRemoveHistory={removeHistory}
            />
            <div className="content">
              {/* 视图常驻（display 切换），切换回来保留原位置/展开状态 */}
              <div style={{ display: view === 'log' ? undefined : 'none', height: '100%' }}>
                <LogView path={logPath} tick={tick} onClearPath={() => setLogPath(undefined)} />
              </div>
              <div style={{ display: view === 'diff' ? undefined : 'none', height: '100%' }}>
                <DiffView
                  target={diffTarget}
                  tick={tick}
                  onBack={() => {
                    setView(diffFrom);
                    // 从「提交修改的文件」弹窗双击进入差异：返回时恢复该弹窗
                    if (diffReturnModal) {
                      setModal(diffReturnModal);
                      setDiffReturnModal(null);
                    }
                  }}
                />
              </div>
              <div style={{ display: view === 'browse' ? undefined : 'none', height: '100%' }}>
                <FsView
                  tick={tick}
                  repoType={repo.type}
                  onAction={handleAction}
                  onDiff={(p) => gotoDiff(p)}
                  onLog={(p) => showLog(p)}
                  onCommitSelect={openCommitSelect}
                  onUpdateDir={doUpdateDir}
                  onToast={setToast}
                />
              </div>
            </div>
          </>
        ) : (
          <div className="content" style={{ flex: 1 }}>
            <OpenView startDir={info?.home ?? info?.startDir ?? ''} onOpened={(r) => { setInfo(r); refresh(); }} onToast={setToast} />
          </div>
        )}
      </div>

      {/* 操作结果提示：鼠标位置悬浮，淡出 */}
      {toast && (
        <div
          className="toast-tip"
          style={{
            left: Math.min(mouseRef.current.x, window.innerWidth - 180),
            top: Math.max(8, mouseRef.current.y - 26),
          }}
          title={toast}
        >
          {toast}
        </div>
      )}

      {modal?.type === 'commit' && (
        <CommitModal
          repoType={repo?.type ?? ''}
          paths={modal.paths}
          onClose={() => setModal(null)}
          onDone={async (msg, paths) => doCommit(paths, msg)}
        />
      )}
      {modal?.type === 'login' && (
        <LoginModal
          username={configUser}
          onClose={() => setModal(null)}
          onSaved={() => { setConfigUser(''); get.config().then((c) => setConfigUser(c.username)).catch(() => {}); refresh(); }}
          onToast={setToast}
        />
      )}
      {modal?.type === 'open' && (
        <OpenModal
          startDir={info?.home ?? info?.startDir ?? ''}
          onOpened={(r) => { setInfo(r); refresh(); setModal(null); loadHistory(); }}
          onToast={setToast}
          onClose={() => setModal(null)}
        />
      )}
      {/* 推送中：转圈提示，可取消 */}
      {pushing && (
        <div className="modal-mask">
          <div className="modal" style={{ width: 380 }}>
            <div className="body" style={{ textAlign: 'center', padding: '26px 18px' }}>
              <div className="spinner" />
              <div style={{ marginTop: 14, fontWeight: 600 }}>正在推送…</div>
              <div className="dim small" style={{ marginTop: 6 }}>视网络情况可能需要一些时间，可随时取消</div>
              <div className="small" style={{ marginTop: 8, color: 'var(--accent)' }}>已耗时 {updateElapsed}s</div>
              <button className="mini danger" style={{ marginTop: 18 }} onClick={cancelPush}>
                取消推送
              </button>
            </div>
          </div>
        </div>
      )}
      {/* 更新中：转圈提示，可取消 */}
      {updating && (
        <div className="modal-mask">
          <div className="modal" style={{ width: 380 }}>
            <div className="body" style={{ textAlign: 'center', padding: '26px 18px' }}>
              <div className="spinner" />
              <div style={{ marginTop: 14, fontWeight: 600 }}>正在更新…</div>
              <div className="dim small" style={{ marginTop: 6 }}>视仓库大小和网络情况可能需要一些时间，可随时取消</div>
              <div className="small" style={{ marginTop: 8, color: 'var(--accent)' }}>已耗时 {updateElapsed}s</div>
              <button className="mini danger" style={{ marginTop: 18 }} onClick={cancelUpdate}>
                取消更新
              </button>
            </div>
          </div>
        </div>
      )}
      {updateResult && (
        <UpdateResultModal
          dir={updateResult.dir}
          ok={updateResult.ok}
          message={updateResult.message}
          files={updateResult.files}
          warnings={updateResult.warnings}
          onClose={() => setUpdateResult(null)}
        />
      )}

      {/* 版本管理对话框：操作后刷新数据 + 重新拉取仓库信息（分支/版本变化） */}
      {modal?.type === 'branches' && repo?.type && (
        <BranchDialog
          repoType={repo.type}
          onClose={() => setModal(null)}
          onChanged={() => {
            refresh();
            get.info().then((r) => setInfo(r)).catch(() => {});
          }}
        />
      )}
      {modal?.type === 'tags' && repo?.type && (
        <TagDialog
          repoType={repo.type}
          onClose={() => setModal(null)}
          onChanged={() => {
            refresh();
            get.info().then((r) => setInfo(r)).catch(() => {});
          }}
        />
      )}
      {modal?.type === 'stash' && (
        <StashDialog
          onClose={() => setModal(null)}
          onChanged={() => refresh()}
        />
      )}
      {modal?.type === 'clean' && (
        <CleanDialog
          onClose={() => setModal(null)}
          onDone={() => {
            refresh();
            setModal(null);
          }}
        />
      )}
      {modal?.type === 'env' && env && (
        <EnvInstallModal
          env={env}
          onClose={() => setModal(null)}
          onInstalled={() => location.reload()}
        />
      )}
      {modal?.type === 'conflicts' && (
        <ConflictResolverModal
          onClose={() => setModal(null)}
          onResolved={() => {
            setModal(null);
            refresh();
          }}
        />
      )}
      {modal?.type === 'remote-conflicts' && (
        <RemoteConflictModal riskFiles={modal.files} onClose={() => setModal(null)} />
      )}
      {modal?.type === 'git-info' && <GitInfoModal onClose={() => setModal(null)} onToast={setToast} />}
      {pushAuth && (
        <GitPushAuthModal
          type={pushAuth.type}
          error={pushAuth.error}
          onClose={() => setPushAuth(null)}
          onToast={setToast}
          onSaved={() => {
            setPushAuth(null);
            void doPush(); // 保存凭据后自动重试推送（后端用 GIT_ASKPASS 携带凭据）
          }}
        />
      )}
      {modal?.type === 'create-repo' && (
        <CreateRepoDialog
          home={info?.home}
          onClose={() => setModal(null)}
          onCreated={(dir) => {
            setModal(null);
            // 打开新创建的仓库
            void post
              .open(dir)
              .then(async () => {
                const r = await get.info();
                if (r.type) {
                  setInfo(r);
                  refresh();
                  loadHistory();
                }
              })
              .catch((e: Error) => setToast(`创建完成，但打开失败: ${(e as Error).message}`));
          }}
        />
      )}

      {modal?.type === 'commit-select' && (
        <CommitSelectModal
          repoType={repo?.type ?? ''}
          dirLabel={modal.dirLabel}
          items={modal.items}
          checked={modal.checked}
          onClose={() => setModal(null)}
          onDiff={(path, checked) => {
            // 双击文件 → 打开差异视图；返回时恢复本弹窗（含勾选状态）
            setDiffReturnModal({ type: 'commit-select', dir: modal.dir, dirLabel: modal.dirLabel, items: modal.items, checked });
            setModal(null);
            gotoDiff(path);
          }}
          onConfirm={(paths, msg) =>
            setModal({
              type: 'confirm',
              title: '✅ 提交确认',
              // 宽度自适应最长文件名（与提交弹窗同规则）
              width: pathAutoWidth(paths.reduce((m, p) => Math.max(m, p.length), 0), 520, 1200),
              message: (
                <>
                  <div className="small" style={{ marginBottom: 8 }}>
                    确认提交以下 <b>{paths.length}</b> 个文件？
                  </div>
                  {/* 文件列表：容器 + mono + 滚动 + 省略号，超长路径可读 */}
                  <div className="vcs-list" style={{ maxHeight: 220 }}>
                    {paths.map((p) => (
                      <div key={p} className="vcs-row" style={{ cursor: 'default' }}>
                        <span className="mono small" style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={p}>
                          {p}
                        </span>
                      </div>
                    ))}
                  </div>
                  {msg && (
                    <div className="dim small mt8" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                      注释：{msg}
                    </div>
                  )}
                </>
              ),
              confirmLabel: '确认提交',
              secondaryLabel: '返回修改',
              // 返回修改：回到「提交修改的文件」弹窗（保留原目录、列表与勾选）
              secondaryAction: () => setModal({ type: 'commit-select', dir: modal.dir, dirLabel: modal.dirLabel, items: modal.items, checked: paths }),
              action: () => void doCommitSelected(paths, msg),
            })
          }
        />
      )}
      {modal?.type === 'confirm' && (
        <ConfirmModal
          title={modal.title}
          message={modal.message}
          danger={modal.danger}
          confirmLabel={modal.confirmLabel}
          secondaryLabel={modal.secondaryLabel}
          width={modal.width}
          onConfirm={() => {
            const a = modal.action;
            setModal(null);
            a();
          }}
          onCancel={() => setModal(null)}
          onSecondary={
            modal.secondaryAction
              ? () => {
                  const a = modal.secondaryAction!;
                  setModal(null);
                  a();
                }
              : undefined
          }
        />
      )}
    </div>
  );
}
