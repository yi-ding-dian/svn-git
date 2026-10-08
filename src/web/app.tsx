/** 根组件：侧边栏布局 + 全局状态 + 操作流程（全部弹窗集中在 modal-host.tsx） */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { get, post, type RepoInfo, type VcsResult } from './api.js';
import { HistoryView } from './views/history.js';
import { DiffView, type DiffTarget } from './views/diff.js';
import { FsView } from './fileSystem/index.js';
import { OpenView } from './views/open.js';
import { type Modal } from './modals/modals.js';
import { AppHeader } from './header.js';
import { useAppearance } from './hooks/use-appearance.js';
import { useRepoStatus } from './hooks/use-repo-status.js';
import { useProjectHistory } from './hooks/use-project-history.js';
import { ModalHost, onboardText, type Op } from './modals/modal-host.js';
import { Sidebar, type View } from './sidebar.js';
import { IconOk, IconErr } from './ui/icons.js';
import { pathAutoWidth, isBinaryFile, translateVcsError, isOutOfDateError } from './utils.js';
import { cmdOfRepo } from './cmd-preview.js';

export function App() {
  const [info, setInfo] = useState<RepoInfo | null>(null);
  const repo = info?.type ? info : null;
  const [view, setView] = useState<View>('browse');
  const [tick, setTick] = useState(0);
  const [toast, setToast] = useState('');
  const [toastErr, setToastErr] = useState(false);
  const [modal, setModal] = useState<Modal>(null);
  // modal 最新引用：后台校验（提交前检查）完成后判断用户是否已关窗/切换，避免结果打扰
  const modalRef = useRef<Modal>(null);
  modalRef.current = modal;
  const [diffTarget, setDiffTarget] = useState<DiffTarget | null>(null);
  // 从「提交修改的文件」弹窗进入差异视图时记录，返回时恢复该弹窗
  const [diffReturnModal, setDiffReturnModal] = useState<Modal>(null);
  const [logPath, setLogPath] = useState<string | undefined>(undefined);
  /** 文件夹视图当前浏览的相对目录：侧边栏切「历史」时按它过滤。
   *  不带它的话，历史视图用的是**上一次查看过的路径**（或整仓库）——用户实报"点击历史不是当前目录的历史"。 */
  const browseDirRef = useRef('');
  const [configUser, setConfigUser] = useState('');
  // 侧边栏「最近项目」末尾的「…」：锚点坐标（null = 面板未打开）
  const [recentMore, setRecentMore] = useState<{ x: number; y: number } | null>(null);
  // 点开过但打不开的项目（目录已删/不是工作副本）：路径 → 错误消息。
  // 列表项上常驻一个 × 供直接移除；鼠标悬浮该项时用同一条消息做浮层提示
  const [invalidPaths, setInvalidPaths] = useState<Record<string, string>>({});
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
    // 成功 1.5s 淡出；失败停留 3 秒（够读完一行报错，又不至于赖着不走）
    const t = setTimeout(() => setToast(''), toastErr ? 3000 : 1500);
    return () => clearTimeout(t);
  }, [toast, toastErr]);
  const [updateResult, setUpdateResult] = useState<{
    dir: string;
    ok: boolean;
    message: string;
    files?: { path: string; status: string; code?: string }[];
    warnings?: string[];
  } | null>(null);
  const [env, setEnv] = useState<{ svn: { installed: boolean; version: string }; git: { installed: boolean; version: string } } | null>(null);
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
    remoteFileCount,
    refreshUnpushed,
    refreshStash,
  } = useRepoStatus({ repoType: repo?.type, repoRoot: info?.root, tick });

  /** 统一提示入口：默认按「成功」显示，是错误必须由调用方显式传 err=true。
   *  旧写法把裸 setToast 当 onToast 往下传，而 toastErr 只在错误分支被置 true、成功分支没人复位，
   *  于是一次失败之后所有普通提示都红着显示（实报：右键「复制完整路径」弹红 ✗）——
   *  红不红与那次操作毫无关系，只取决于这次会话之前有没有出过错。此处默认复位，由调用方声明错误。 */
  const showToast = useCallback((msg: string, err = false) => {
    setToastErr(err);
    setToast(msg);
  }, []);

  const refresh = useCallback(() => {
    setTick((t) => t + 1);
    void refreshUnpushed();
    void refreshStash();
  }, [refreshUnpushed, refreshStash]);

  // 最近项目列表（加载 / 删除 / 设常用 / 备注）抽到 useProjectHistory；错误统一走 toast
  const { history, loadHistory, removeHistory, setFav, setRemark } = useProjectHistory((msg) => {
    showToast(msg, true);
  });

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

  // 环境缺失:只提示「当前仓库类型需要」的引擎;未打开仓库时任一缺失都提示
  // (用户可能只用 Git 或只用 SVN,不强制两者都装)
  const needSvn = !repo?.type || repo.type === 'svn';
  const needGit = !repo?.type || repo.type === 'git';
  const missingSvn = !!(env && needSvn && !env.svn.installed);
  const missingGit = !!(env && needGit && !env.git.installed);
  const envMissing = missingSvn || missingGit;

  // 从历史列表打开项目
  const openHistoryItem = useCallback(
    async (h: { path: string }) => {
      try {
        const opened = await post.open(h.path);
        const r = await get.info();
        if (r.type) {
          setInfo(r);
          setOnboard(null); // 切换仓库时清除上次的新建引导条
          refresh();
          loadHistory();
          // 记录里的路径**不是工作副本**（子目录被删或改名了），服务端向上找到了它所属的仓库。
          // 这种情况原来完全静默：打开"成功"了，但打开的往往就是当前那个仓库 → 界面毫无变化，
          // 用户只会觉得"点了没反应、也没有提示"（实报：点 svn-std-wc 切不过去）。
          // 现在说清楚打开了什么，并给这行打上标记（行尾 × 可移除、悬浮显示原因），去留由用户定
          const root = opened.repo?.root;
          const same = root && h.path.replace(/\/+$/, '') === root;
          if (root && !same) {
            const msg = `「${h.path}」不是工作副本（目录可能已被删除或改名）。已打开它所属的仓库：${root}`;
            showToast(msg, true);
            setInvalidPaths((prev) => ({ ...prev, [h.path]: msg }));
          } else {
            setInvalidPaths((prev) => { const n = { ...prev }; delete n[h.path]; return n; }); // 路径有效：撤掉标记
          }
        } else {
          showToast('打开失败：未识别为仓库', true);
        }
      } catch (e) {
        showToast((e as Error).message, true);
        // 打不开（目录已删 / 不是工作副本）：标为失效 → 该项上常驻一个 ×，悬浮时也用这条消息提示
        setInvalidPaths((prev) => ({ ...prev, [h.path]: (e as Error).message }));
      }
    },
    [refresh, loadHistory, showToast]
  );

  /** 内容区点击 = "还在用这个项目"：刷新它在最近项目里的时间戳（后端按 path 更新 lastOpened）。
   *  60 秒节流——比"刚刚"的显示粒度（1 分钟）还密没有意义，还免得每点一下都写一次 history.json。
   *  点文件夹、点文件、点空白都算（事件冒泡到内容区容器），右键不触发（那是 contextmenu 事件） */
  const lastTouchRef = useRef(0);
  const touchHistory = useCallback(() => {
    if (!repo?.root || !repo.type) return;
    const now = Date.now();
    if (now - lastTouchRef.current < 60_000) return;
    lastTouchRef.current = now;
    void post
      .history(repo.root, repo.type)
      .then(() => loadHistory())
      .catch(() => {
        /* 只是刷新"最近使用时间"，失败不值得打扰用户 */
      });
  }, [repo?.root, repo?.type, loadHistory]);

  // 短操作进行中指示（revert/delete/add 无独立进度窗,防"点了没反应"）
  const [opBusy, setOpBusy] = useState<string | null>(null);
  const OP_BUSY_TEXT: Record<Op, string> = {
    add: '正在添加到版本库…',
    commit: '正在提交…',
    update: '正在更新…',
    revert: '正在还原…',
    delete: '正在删除…',
    'fs-delete': '正在删除磁盘文件…',
    push: '正在推送…',
    move: '正在重命名…',
    'fs-move': '正在重命名磁盘文件…',
  };
  // 执行操作
  const runOp = useCallback(
    async (op: Op, paths: string[], keep = false): Promise<VcsResult> => {
      let r: VcsResult;
      // update/push 有独立进度窗,不重复显示短条
      setOpBusy(op === 'add' || op === 'revert' || op === 'delete' || op === 'fs-delete' || op === 'move' || op === 'fs-move' ? OP_BUSY_TEXT[op] : null);
      try {
        if (op === 'add') r = await post.add(paths);
        else if (op === 'commit') r = await post.commit(paths, '');
        else if (op === 'update') r = await post.update();
        else if (op === 'revert') r = await post.revert(paths);
        else if (op === 'fs-delete') r = await post.fsDelete(paths);
        else if (op === 'move') r = await post.move(paths[0], paths[1]);
        else if (op === 'fs-move') r = await post.fsMove(paths[0], paths[1]);
        else if (op === 'delete') r = keep ? await post.delete(paths, true) : await post.delete(paths);
        else r = await post.push();
      } catch (e) {
        // 网络失败等异常:给用户可见反馈,避免 unhandled rejection 后"点了没反应"
        const msg = (e as Error).message || '操作失败';
        showToast(msg, true);
        setOpBusy(null);
        return { ok: false, message: msg };
      }
      setOpBusy(null);
      showToast(r.message, !r.ok);
      if (r.ok) {
        refresh();
        // 更新后工作副本版本变化，重拉仓库信息（头部 [rN]），与分支/标签弹窗 onChanged 一致
        if (op === 'update') get.info().then((ri) => setInfo(ri)).catch(() => {});
      }
      if (r.authError) setModal({ type: 'login' });
      return r;
    },
    [refresh, showToast] // setOpBusy/OP_BUSY_TEXT 为稳定 setter/常量,无需入依赖
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
        showToast(r.message);
        refresh();
      } else if (r.authType) {
        // 认证失败 → 弹认证引导（带上失败原因，避免用户不明所以）
        setPushAuth({ type: r.authType, error: r.message });
      } else {
        // 其他失败：弹窗明确显示错误（避免 toast 一闪而过"没反应"）
        setModal({
          type: 'confirm',
          title: (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <IconErr size={16} />
              推送失败
            </span>
          ),
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
      const msg = (e as Error).message;
      // 「已取消」是用户主动中止，不算失败——不标红
      showToast(msg === '已取消' ? '已取消推送' : `推送失败: ${msg}`, msg !== '已取消');
    } finally {
      setPushing(false);
      pushAbortRef.current = null;
    }
  }, [refresh, showToast]);
  const cancelPush = () => pushAbortRef.current?.abort();
  // 推送入口：弹出「确认推送」窗口（未推送提交列表 + 推送条件），确认后执行
  const doPush = useCallback(() => {
    if (unpushedCount != null && unpushedCount <= 0) return; // 无未推送提交（按钮已置灰，双保险）
    setModal({ type: 'push-confirm' });
  }, [unpushedCount]);

  // 跳转 diff 视图（提交冲突提示"双击查看差异"使用；定义在 handleAction 之前供其依赖）
  const gotoDiff = useCallback(
    (path?: string, a?: string, b?: string) => {
      // 二进制文件（Word/PDF/图片等）：不支持文本对比，提示而不进入差异视图
      if (path && isBinaryFile(path)) {
        // 用户要的操作没做成——按错误态显示（停留久一点，别一闪而过）
        showToast('二进制文件，不支持文本对比', true);
        return;
      }
      setDiffFrom(view);
      setDiffTarget({ path, a, b });
      if (path) setLogPath(path); // 历史视图联动记住当前文件
      setView('diff');
    },
    [view, showToast]
  );

  // 操作请求分派
  /** 还原：目录还原先弹"可还原文件清单"（默认全选可勾选，确认后只还原选中的）；
   *  路径下无子改动（纯文件/空目录）或 status 拉取失败 → 回退原简单确认（文案按状态语义化） */
  const confirmRevert = async (paths: string[]) => {
    const dir = (paths[0] ?? '').replace(/\/$/, '');
    const fallback = (code?: string) => {
      const isA = code === 'A';
      const isD = code === 'D';
      setModal({
        type: 'confirm',
        title: isA ? '取消添加确认' : isD ? '撤销删除确认' : '还原确认',
        message: isA ? (
          <>将<b>取消添加到版本库</b>：<b>{dir}</b> 变回未版本化（?），磁盘文件保留。确认？</>
        ) : isD ? (
          <>将<b>撤销删除</b>：<b>{dir}</b> 回到版本库内容。确认？</>
        ) : (
          <>将放弃对 <b>{dir}</b> 的本地修改，不可恢复。确认还原？</>
        ),
        action: () => void runOp('revert', paths),
        confirmCmd: cmdOfRepo(repo?.type ?? null, 'revert', { paths: paths.join(' ') }),
      });
    };
    try {
      const st = await get.status();
      const items = st.items ?? [];
      const byPath = new Map(items.map((i) => [i.path, i]));
      // treeConflicted 一并带进弹窗：从「放弃本地添加（解决树冲突）」进来时要能说清"这几项是树冲突"
      let list: { path: string; code: string; treeConflicted?: boolean }[] = [];
      if (paths.length > 1) {
        // 多选文件集合：按传入路径逐个取状态，直接列清单（不再按"目录下"语义），排除 ?/I/X
        list = paths
          .map((p) => ({ path: p, code: byPath.get(p)?.code ?? '', treeConflicted: byPath.get(p)?.treeConflicted }))
          .filter((i) => i.code !== '?' && i.code !== 'I' && i.code !== 'X');
      } else {
        // 目录自身是树冲突（服务器上该路径已删除/移动，本地还在）→ 处置方式只有一个：接受服务器的删除。
        // svn revert 目录是递归的，服务器上已经没有这个路径，谈不上"挑几个子文件留下"——把子项一项项
        // 列出来只会让人看不懂为什么要一起勾（用户实报：VWPublic 下面 2 个 collect/*.cpp/.h 被单独列出）。
        // 只列目录自身：清单里全是树冲突，弹窗标题/按钮自然切成「接受服务器的删除」
        const self = items.find((i) => i.path === dir && i.code !== '?' && i.code !== 'I' && i.code !== 'X');
        if (self?.treeConflicted) {
          list = [{ path: dir, code: self.code, treeConflicted: true }];
        } else {
          // 目录还原：仅收集其下（含子目录）的可还原文件，排除 ?(未版本化)/I(忽略)/X(外部)
          for (const it of items) {
            if (it.path === dir || !it.path.startsWith(dir + '/')) continue;
            if (it.code === '?' || it.code === 'I' || it.code === 'X') continue;
            list.push({ path: it.path, code: it.code, treeConflicted: it.treeConflicted });
          }
          // 目录自身也有调度（svn A/D 目录；git porcelain 不列目录故不会命中）→ 一并列入清单，避免取消添加后目录自身残留 A
          if (self) list.unshift({ path: dir, code: self.code, treeConflicted: self.treeConflicted });
        }
      }
      if (list.length > 0) {
        setModal({ type: 'revert-confirm', dir, dirLabel: paths.length > 1 ? `选择的 ${list.length} 项` : dir, items: list });
        return;
      }
      fallback(items.find((i) => i.path === dir)?.code);
    } catch {
      fallback(undefined);
    }
  };

  /** 提交前安全检查（提交窗已秒开，本函数后台并行）：
   * preflight 完成后若用户仍在原弹窗（back 类型），行冲突 → 覆盖拦截弹窗；远程更新且有交集 → 覆盖提示；
   * 用户已关窗/切换 → 结果丢弃；检查失败 → 明示"不经过行级冲突拦截"。 */
  const checkCommitBackground = useCallback(
    (paths: string[], back: Exclude<Modal, null>) => {
      void (async () => {
        let pf;
        try {
          pf = await get.preflight();
        } catch (e) {
          // 冲突检查未完成（网络抖动/服务器超时等）：不静默放行——明示本次提交不经过行级冲突拦截
          if (modalRef.current?.type !== back.type) return;
          const msg = (e as Error).message || '未知错误';
          setModal({
            type: 'confirm',
            title: '⚠ 冲突检查未完成',
            message: (
              <>
                提交前的冲突检查<b>未能完成</b>（{msg}）。本次提交将<b>不经过行级冲突拦截</b>：
                <div className="error mt8" style={{ lineHeight: 1.8 }}>
                  若服务器上有他人修改与你的修改冲突，提交可能失败或覆盖对方修改。请先更新后再提交。
                </div>
              </>
            ),
            confirmLabel: '仍然提交',
            secondaryLabel: '取消',
            action: () => setModal(back),
            secondaryAction: () => setModal(null),
          });
          return;
        }
        if (modalRef.current?.type !== back.type) return; // 用户已离开原弹窗 → 不打扰
        const clash = pf.conflictRisk.filter((f) => f.lines.length > 0);
        if (clash.length > 0) {
          // ⚠ 行冲突：禁止提交，引导手动处理（备份→删除→更新→手动合并）
          setModal({
            type: 'confirm',
            title: '⚠ 存在行冲突，禁止提交',
            // 宽度随最长文件名自适应
            width: pathAutoWidth(clash.reduce((m, f) => Math.max(m, f.path.length), 0), 520, 1200),
            message: (
              <>
                以下文件与服务器版本存在<b>行冲突</b>，请先手动处理后再提交：
                <div className="error mt8" style={{ minHeight: 100, overflow: 'auto' }}>
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
              setModal({ type: 'remote-conflicts', files: clash }); // 带 lines 一起传，弹窗才能标出冲突行
            },
          });
          return; // 不放行提交
        }
        if (pf.remoteHasUpdate) {
          // 仅当待提交文件与服务器更新文件有交集时才提示（列出可能冲突文件，双击看差异）；
          // 无交集 → 不打扰（原弹窗保持）
          const same = (pf.updatedFiles ?? []).filter((f) => paths.includes(f));
          if (same.length === 0) return;
          setModal({
            type: 'confirm',
            title: '⚠ 服务器有新版本',
            // 宽度随最长文件名自适应
            width: pathAutoWidth(same.reduce((m, p) => Math.max(m, p.length), 0), 520, 1200),
            message: (
              <>
                服务器有 <b>{pf.behind}</b> 个新提交，以下 <b>{same.length}</b> 个待提交文件服务器也有新版本，<b>可能冲突</b>（双击查看差异）：
                <div className="vcs-list" style={{ minHeight: 120, marginTop: 8 }}>
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
            action: () => setModal(back),
            secondaryAction: () => {
              setModal(null);
              void doUpdateDir('');
            },
          });
        }
      })();
    },
    // doUpdateDir 为稳定引用，闭包捕获即可（与 handleAction 同模式；不放入依赖避免使用前声明）
    [gotoDiff],
  );

  const handleAction = useCallback(
    (op: Op, paths: string[]) => {
      if (op === 'commit') {
        // 提交窗秒开（git fetch 是网络请求，不再堵住弹窗）；行冲突/远程检查后台并行（checkCommitBackground）
        setModal({ type: 'commit', paths });
        checkCommitBackground(paths, { type: 'commit', paths });
        return;
      } else if (op === 'push') {
        // 统一走 doPush（确认窗 + 进度窗口 + 认证引导）
        doPush();
      } else if (op === 'revert') {
        void confirmRevert(paths);
      } else if (op === 'fs-delete') {
        // 磁盘删除（未版本化 ? / 忽略 I 文件/目录）：仅删本地文件、不做版本库操作
        setModal({
          type: 'confirm',
          title: '删除磁盘文件',
          danger: true,
          message: (
            <div>
              将从<b>磁盘永久删除</b> {paths.length} 项（不在版本库中的文件）。
              <div style={{ marginTop: 6 }}>不可恢复，确认删除？</div>
            </div>
          ),
          confirmLabel: '删除磁盘文件',
          action: () => void runOp('fs-delete', paths),
        });
      } else if (op === 'delete') {
        // 从版本库移除 = 仅标记删除、磁盘文件不受影响（提交后生效；提交前可还原）
        // 缺失条目（磁盘已删未走移除流程）同走此入口：保持缺失状态，仅从版本库删除记录
        setModal({
          type: 'confirm',
          title: '从版本库移除',
          message: (
            <div>
              将<b>从版本库移除</b> {paths.length} 项（<b>磁盘文件不受影响</b>；提交后从版本库删除）。
              <div className="dim small" style={{ marginTop: 6, lineHeight: 1.8 }}>
                · 提交前可右键「还原」取消移除；版本库历史保留
              </div>
            </div>
          ),
          confirmLabel: '从版本库移除',
          action: () => void runOp('delete', paths, true),
          confirmCmd: cmdOfRepo(repo?.type ?? null, 'remove_keep', { paths: paths.join(' ') }),
        });
      } else if (op === 'move' || op === 'fs-move') {
        // 重命名：输入新名字弹窗（versions 文件 → vcs move；?/I → 磁盘改名）
        setModal({ type: 'rename', from: paths[0], fsMode: op === 'fs-move' });
      } else {
        void runOp(op, paths);
      }
    },
    [runOp, gotoDiff, doPush, repo]
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
          get.info().then((ri) => setInfo(ri)).catch(() => {}); // 更新后工作副本版本变化，重拉仓库信息（头部 [rN]）
        }
        if (r.authError) setModal({ type: 'login' });
      } catch (e) {
        const msg = (e as Error).message;
        showToast(msg === '已取消' ? '已取消更新' : `更新失败: ${msg}`, msg !== '已取消');
      } finally {
        setUpdating(false);
        updateAbortRef.current = null;
      }
    },
    [refresh, checkRemote, showToast]
  );

  // 提交失败弹窗：所有提交失败统一弹窗确认（不再 5 秒 toast 一闪而过）；
  // out-of-date 类错误（服务器有新版本）附「先更新」按钮，点击直接更新后再重新提交；
  // 并列出被领先提交的文件（本次提交文件 ∩ 服务器更新清单，5s 内取不到则降级为错误文案）
  const showCommitFail = useCallback(
    async (msg: string, paths?: string[]) => {
      const isOutOfDate = isOutOfDateError(msg);
      let aheadFiles: string[] = [];
      if (isOutOfDate) {
        const pf = await Promise.race([
          get.preflight(),
          new Promise<null>((r) => setTimeout(() => r(null), 5000)),
        ]).catch(() => null);
        if (pf) {
          const updated = new Set(pf.updatedFiles);
          // 优先展示"本次提交文件 ∩ 服务器更新清单"；取不到交集时降级展示服务器更新全清单
          aheadFiles = paths?.length ? paths.filter((p) => updated.has(p)) : pf.updatedFiles;
          if (aheadFiles.length === 0) aheadFiles = pf.updatedFiles;
        }
      }
      setModal({
        type: 'confirm',
        title: (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <IconErr size={16} />
            提交失败
          </span>
        ),
        message: (
          <>
            <div className="error" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
              {translateVcsError(msg)}
            </div>
            {aheadFiles.length > 0 && (
              <>
                <div className="small mt8">被他人领先提交（{aheadFiles.length} 项）：</div>
                <div className="vcs-list" style={{ marginTop: 8 }}>
                  {aheadFiles.map((f) => (
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
            )}
          </>
        ),
        confirmLabel: '知道了',
        action: () => setModal(null),
        secondaryLabel: isOutOfDate ? '先更新' : undefined,
        secondaryAction: isOutOfDate ? () => { setModal(null); void doUpdateDir(''); } : undefined,
      });
    },
    [doUpdateDir, gotoDiff]
  );

  const doCommit = useCallback(
    async (paths: string[], message: string) => {
      const r = await post.commit(paths, message);
      if (r.ok) {
        showToast(r.message);
        refresh();
      } else {
        showCommitFail(r.message, paths);
      }
      if (r.authError) setModal({ type: 'login' });
      setModal(null);
    },
    [refresh, showCommitFail, showToast]
  );

  // 打开勾选式提交弹窗（收集当前目录变更）
  const openCommitSelect = useCallback(
    async (dir: string, dirLabel: string) => {
      try {
        const st = await get.status();
        const prefix = dir ? dir + '/' : '';
        const inScope = (p: string) => (prefix ? p.startsWith(prefix) : true);
        const items = st.items
          // 未版本化（?）文件不在提交列表（需先"添加到版本库"）
          .filter((i) => i.code !== '?')
          // 外部引用（X，svn:externals）也不在：它装的是**另一个仓库路径**的内容，
          // 勾上提交 svn 会真的递归提交到那个路径（实测外部引用里的改动会被提交走），
          // 而列表里显示的相对路径与实际提交的路径对不上——要提交请到它自身那个目录去
          .filter((i) => i.code !== 'X')
          // 指定目录 → 该目录及其子目录；根目录 → 全部修改文件（含子目录）
          .filter((i) => inScope(i.path))
          .map((i) => ({ path: i.path, code: i.code, isDir: i.isDir }));
        if (items.length === 0) {
          const unversioned = st.items.filter((i) => i.code === '?' && inScope(i.path)).length;
          const externals = st.items.filter((i) => i.code === 'X' && inScope(i.path)).length;
          showToast(
            unversioned > 0
              ? `当前目录下没有已版本化的变更；有 ${unversioned} 个未版本化文件（?），需先右键「添加到版本库」才能提交`
              : externals > 0
                ? `当前目录下只有外部引用（${externals} 个，链环图标）——它里面是另一个仓库路径的内容，请到那个目录提交`
                : '当前目录下没有变更文件'
          );
          return;
        }
        // 从 index 恢复「已部分暂存」的文件：弹窗关掉再打开也认得（否则重开后会整文件 add，把未选的块也提交）
        const stagedOnly = await get.stagedFiles().then((r) => r.files).catch(() => []);
        setModal({ type: 'commit-select', dir, dirLabel, items, stagedOnly });
        // 与"提交此文件"一致的提交前安全：行冲突/远程检查后台并行（用户勾选期间完成，关窗则丢弃）
        checkCommitBackground(items.map((i) => i.path), { type: 'commit-select', dir, dirLabel, items, stagedOnly });
      } catch (e) {
        showToast(`读取变更失败: ${(e as Error).message}`, true);
      }
    },
    [showToast]
  );

  // 勾选提交：二次确认后执行（svn 未版本化文件先 add）
  const doCommitSelected = useCallback(
    async (paths: string[], message: string, stagedOnly: string[] = []) => {
      setModal(null);
      try {
        if (repo?.type === 'svn') {
          const st = await get.status();
          const needAdd = paths.filter((p) => st.items.some((i) => i.path === p && i.code === '?'));
          if (needAdd.length > 0) await post.add(needAdd);
        }
        const r = await post.commit(paths, message, stagedOnly);
        if (r.ok) {
          showToast(r.message);
          refresh();
        } else {
          showCommitFail(r.message, paths);
        }
        if (r.authError) setModal({ type: 'login' });
      } catch (e) {
        showCommitFail(`提交失败: ${(e as Error).message}`, paths);
      }
    },
    [refresh, repo?.type, showCommitFail, showToast]
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
        onRefresh={refresh}
        setModal={setModal}
        onToast={showToast}
        onPush={doPush}
        onUpdate={() => void doUpdateDir('')}
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
          <button className="mini" onClick={() => setOnboard(null)}>知道了</button>
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
                ⚠ <b>有 {remoteHint.risk} 个文件你和对方改了同一处，更新时会冲突</b>
                {remoteHint.behind > 0 ? `（远程 ${remoteHint.behind} 个新提交 · 共 ${remoteFileCount} 个文件）` : ''}
              </>
            ) : (
              <>🔔 远程有 <b>{remoteHint.behind}</b> 个新提交 · 共 <b>{remoteFileCount}</b> 个文件</>
            )}
            {remoteHint.locked > 0 ? ` · ${remoteHint.locked} 个文件被他人锁定` : ''}
          </span>
          <span className="grow" />
          {/* 远程新提交涉及的文件总数（remoteLogs 去重；无 logs 时用 updatedFiles 数） */}
          {remoteHint.risk > 0 && (
            <button className="mini" onClick={() => setModal({ type: 'remote-conflicts', files: riskFiles })}>
              查看对比
            </button>
          )}
          {/* 去查看：弹窗列出新提交涉及的文件，确认后即更新 */}
          <button
            className="mini primary"
            onClick={() =>
              setModal({
                type: 'confirm',
                title: `远程有 ${remoteHint.behind} 个新提交 · 共 ${
                  remoteHint.remoteLogs?.length
                    ? new Set(remoteHint.remoteLogs.flatMap((l) => l.changed.map((c) => c.path))).size
                    : (remoteHint.files?.length ?? 0)
                } 个文件`,
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
                        {(remoteHint.files ?? []).length === 0 && <div className="dim" style={{ padding: 10 }}>（无法获取文件列表）</div>}
                      </div>
                    )}
                  </>
                ),
                confirmLabel: '更新',
                confirmCmd: repo?.type === 'svn' ? 'svn update' : 'git pull',
                action: () => {
                  setModal(null);
                  void doUpdateDir('');
                },
              })
            }
          >
            去查看
          </button>
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
              currentRoot={repo?.root}
              onNav={(v) => {
                // 点「历史」带上当前浏览目录（'' = 仓库根 → 传 undefined 看全仓库）
                if (v === 'log') showLog(browseDirRef.current || undefined);
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
              onOpenRecentMore={(x, y) => setRecentMore({ x, y })}
              recentMoreOpen={Boolean(recentMore)}
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
                <HistoryView path={logPath} tick={tick} repoType={repo?.type ?? 'git'} onChanged={refresh} onBack={() => setView('browse')} />
              </div>
              <div style={{ display: view === 'diff' ? undefined : 'none', height: '100%' }}>
                <DiffView
                  target={diffTarget}
                  tick={tick}
                  active={view === 'diff'}
                  onToast={showToast}
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
                  active={view === 'browse'}
                  repoType={repo.type}
                  repoRoot={repo.root}
                  startRel={repo.startRel}
                  onAction={handleAction}
                  onDiff={(p) => gotoDiff(p)}
                  onLog={(p) => showLog(p)}
                  onDirChange={(d) => {
                    browseDirRef.current = d;
                  }}
                  onCommitSelect={openCommitSelect}
                  onUpdateDir={doUpdateDir}
                  onToast={showToast}
                />
              </div>
            </div>
          </>
        ) : (
          <div className="content" style={{ flex: 1 }}>
            <OpenView
              startDir={info?.home ?? info?.startDir ?? ''}
              onOpened={(r) => { setInfo(r); setOnboard(null); refresh(); loadHistory(); }}
              onCreatedRepo={(r) => setOnboard(onboardText(r))}
              onToast={showToast}
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
      {/* 操作结果提示：鼠标位置悬浮，淡出；错误态停留更久（见 .toast-tip.err） */}
      {toast && (
        <div
          className={`toast-tip${toastErr ? ' err' : ''}`}
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

      {/* 全部弹窗 + 「推送中/更新中」遮罩：集中在 modal-host.tsx（原先 21 个分支平铺在本文件 JSX 里，约 340 行） */}
      <ModalHost
        state={{ modal, pushAuth, updateResult, themePop, recentMore, history, invalidPaths, openHistoryItem, pushing, updating, updateElapsed, configUser }}
        set={{
          setModal,
          setPushAuth,
          setUpdateResult,
          setThemePop,
          setRecentMore,
          setConfigUser,
          setInfo,
          setOnboard,
          setView,
          showToast,
          setDiffReturnModal,
        }}
        ctx={{ repo, env, info }}
        appearance={{ fontSize, setFontSize, uiFont, setUiFont, codeFont, setCodeFont }}
        theme={{ current: theme, myThemes, setTheme, previewTheme, saveMyTheme, deleteMyTheme }}
        actions={{ doCommit, doCommitSelected, runOp, refresh, loadHistory, gotoDiff, pushNow, cancelPush, cancelUpdate }}
      />
    </div>
  );
}
