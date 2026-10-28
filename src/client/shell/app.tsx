/** 根组件：侧边栏布局 + 全局状态 + 操作流程（全部弹窗集中在 modal-host.tsx） */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { get, post, type RepoInfo, type VcsResult } from '../shared/api.js';
import { HistoryView } from '../history/history.js';
import { DiffView, type DiffTarget } from '../history/diff/index.js';
import { FsView } from '../filesystem/index.js';
import { OpenView } from '../repo/open.js';
import { type Modal } from './modal-types.js';
import { AppHeader } from './header/index.js';
import { TitleStrip } from './title-strip.js';
import {
  useAppearance,
  ZOOM_DEFAULT,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_STEP,
  CONTENT_ZOOM_DEFAULT,
  CONTENT_ZOOM_MAX,
  CONTENT_ZOOM_MIN,
} from '../appearance/use-appearance.js';
import { useRepoStatus } from './use-repo-status.js';
import { useProjectHistory } from '../repo/use-project-history.js';
import { ModalHost, onboardText, type Op } from './modal-host.js';
import { Sidebar, type View } from './sidebar.js';
import { IconOk, IconErr } from '../ui/icons.js';
import { pathAutoWidth, isBinaryFile, translateVcsError, isOutOfDateError, baseName } from '../shared/utils.js';
import { cmdOfRepo } from '../shared/cmd-preview.js';
import { useTasks, startTask, hasRunningTask, pollTransferProgress } from '../shared/tasks.js';
import { addNotice } from '../shared/notices.js';
import { useShareStatus } from '../share/share-context.js';
import { clearCommittedRows, flyRowsToTrash, launchMagicFlight, settleUpdatedRows, shakeEl, stampAddedRows, sweepRevertedRows } from '../animations/index.js';
import { useLang } from '../shared/use-lang.js';
import { t, type I18nKey } from '../../shared/i18n/index.js';

/** 短操作进行中提示的文案 key（revert/delete/add 等没有独立进度窗，靠它防"点了没反应"）。
 *  ⚠️ 存 key 而非文案：模块级常量直接存文案会冻在首次语言，渲染时才 t()。
 *  放**模块级**而非组件内：对象字面量每次渲染都会重建，放进依赖数组会让 useCallback 每次都失效；
 *  不进依赖又会被 react-hooks/exhaustive-deps 判为缺失。提到模块级两边都解决（且省一次重建）。 */
const OP_BUSY_KEY: Record<Op, I18nKey> = {
  add: 'shell.busy.add',
  commit: 'shell.busy.commit',
  update: 'shell.busy.update',
  revert: 'shell.busy.revert',
  delete: 'shell.busy.delete',
  'fs-delete': 'shell.busy.fsDelete',
  push: 'shell.busy.push',
  move: 'shell.busy.move',
  'fs-move': 'shell.busy.fsMove',
};

export function App() {
  // 订阅界面语言，**不接返回值**：这里只为让语言变化时整树重渲染。
  // （Header 里另有一处拿 changeLang；若只在 Header 订阅，兄弟视图的 t() 不会重算）
  useLang();
  const [info, setInfo] = useState<RepoInfo | null>(null);
  const repo = info?.type ? info : null;
  const [view, setView] = useState<View>('browse');
  const [tick, setTick] = useState(0);
  /** 远程状态重算信号（更新/切分支/合并成功后 +1）：侧边栏据此重跑「远程检查」。
   *  与 tick 分开——tick 连文件保存都会加，不能每次都触发一批联网探测。 */
  const [remoteCheckTick, setRemoteCheckTick] = useState(0);
  const [toast, setToast] = useState('');
  const [toastErr, setToastErr] = useState(false);
  /** 轻提示（1.5s 消失；重复操作提醒等"扫一眼就够"的）——见 showToast 的 quick 参数 */
  const [toastQuick, setToastQuick] = useState(false);
  /** 自定义停留时长（ms）：转后台提示用 2s；null = 按错误/成功/quick 的默认档 */
  const [toastDuration, setToastDuration] = useState<number | null>(null);
  const toastRef = useRef<HTMLDivElement>(null);
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
  const mouseRef = useRef({ x: window.innerWidth / 2, y: 60 });
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      mouseRef.current = { x: e.clientX, y: e.clientY };
    };
    window.addEventListener('mousemove', onMove);
    return () => window.removeEventListener('mousemove', onMove);
  }, []);
  // Ctrl+` 打开终端（跟 VSCode 一致）。用 e.code === 'Backquote' 而不是 e.key ——
  // 后者随键盘布局变（中文输入法/非美式布局下 e.key 未必是反引号）。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.code === 'Backquote') {
        // 已有弹窗打开时不响应：直接 setModal 会把当前弹窗替换掉，未提交的注释等状态随卸载丢失
        if (document.querySelector('.modal-mask')) return;
        e.preventDefault();
        setModal({ type: 'terminal' });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => {
    if (!toast) return;
    // 成功 1.5s 淡出；失败停留 3 秒（够读完一行报错，又不至于赖着不走）；轻提示（quick）1.5s
    // 局部变量名用 timer 而非 t：本文件 import 了 i18n 的 t()，同名会遮蔽
    const timer = setTimeout(() => setToast(''), toastDuration ?? (toastQuick || !toastErr ? 1500 : 3000));
    return () => clearTimeout(timer);
  }, [toast, toastErr, toastQuick, toastDuration]);
  // 错误提示出场时轻抖一下（"出了状况"的肢体语言；成功提示不抖）
  useEffect(() => {
    if (toastErr) shakeEl(toastRef.current);
  }, [toast, toastErr]);
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
    zoom,
    setZoom,
    contentZoom,
    setContentZoom,
    uiFont,
    setUiFont,
    codeFont,
    setCodeFont,
  } = useAppearance();

  /** 缩放提示（Ctrl+滚轮 / Ctrl+0）：跟随鼠标，停止滚动后消失；content = 缩放的是文件内容 */
  const [zoomTip, setZoomTip] = useState<{ x: number; y: number; percent: number; content: boolean } | null>(null);
  const zoomTipTimerRef = useRef<number | null>(null);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const contentZoomRef = useRef(contentZoom);
  contentZoomRef.current = contentZoom;
  const showZoomTip = useCallback((x: number, y: number, percent: number, content: boolean) => {
    setZoomTip({ x, y, percent, content });
    // 滚动过程中不断重置计时器：一直在滚就一直显示，松手约 0.9 秒后消失
    if (zoomTipTimerRef.current !== null) window.clearTimeout(zoomTipTimerRef.current);
    zoomTipTimerRef.current = window.setTimeout(() => setZoomTip(null), 900);
  }, []);
  useEffect(() => {
    return () => {
      if (zoomTipTimerRef.current !== null) window.clearTimeout(zoomTipTimerRef.current);
    };
  }, []);
  // Ctrl+滚轮：鼠标在文件内容区（预览正文 / 差异正文）时只缩放内容文字、界面不动；
  // 在界面其它地方缩放界面文字（±10%/格）。触摸板捏合也会发 ctrl+wheel 且事件很密，
  // 用 60ms 节流避免一次手势直接冲到上限；preventDefault 掉页面滚动和浏览器自带的缩放。
  useEffect(() => {
    let lastStepAt = 0;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey || e.deltaY === 0) return;
      e.preventDefault();
      const now = performance.now();
      if (now - lastStepAt < 60) return;
      lastStepAt = now;
      const step = e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP;
      const el = e.target instanceof Element ? e.target : null;
      if (el?.closest('[data-content-zoom]')) {
        const cur = contentZoomRef.current;
        const next = Math.min(CONTENT_ZOOM_MAX, Math.max(CONTENT_ZOOM_MIN, cur + step));
        if (next !== cur) setContentZoom(next);
        showZoomTip(e.clientX, e.clientY, next, true);
        return;
      }
      const cur = zoomRef.current;
      const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, cur + step));
      if (next !== cur) setZoom(next);
      showZoomTip(e.clientX, e.clientY, next, false);
    };
    window.addEventListener('wheel', onWheel, { passive: false });
    return () => window.removeEventListener('wheel', onWheel);
  }, [setZoom, setContentZoom, showZoomTip]);
  // 内容区快捷键：
  //  - Ctrl+0：把鼠标所在位置的缩放复原到 100%（内容区复原内容缩放，其它地方复原界面缩放）
  //  - Ctrl+A：鼠标在文件内容区时全选该内容（统一差异里 = 所有文件的正文），不选界面文字；
  //    输入框 / 编辑区里保持原生行为（选它们自己的内容）。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyA') {
        const el = e.target as HTMLElement | null;
        if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
        const { x, y } = mouseRef.current;
        const under = document.elementFromPoint(x, y) as Element | null;
        // 鼠标不在内容区时退一步看当前选区：刚点选过文字、鼠标稍微移开也还能全选
        const sel = window.getSelection();
        const anchor = sel?.anchorNode ?? null;
        const anchorEl = anchor
          ? anchor.nodeType === Node.ELEMENT_NODE
            ? (anchor as Element)
            : anchor.parentElement
          : null;
        const scope = under?.closest('[data-content-zoom]') ?? anchorEl?.closest('[data-content-zoom]');
        if (!scope) return;
        e.preventDefault();
        const range = document.createRange();
        range.selectNodeContents(scope);
        sel?.removeAllRanges();
        sel?.addRange(range);
        return;
      }
      if (!((e.ctrlKey || e.metaKey) && (e.code === 'Digit0' || e.code === 'Numpad0'))) return;
      e.preventDefault();
      const { x, y } = mouseRef.current;
      const under = document.elementFromPoint(x, y) as Element | null;
      if (under?.closest('[data-content-zoom]')) {
        setContentZoom(CONTENT_ZOOM_DEFAULT);
        showZoomTip(x, y, CONTENT_ZOOM_DEFAULT, true);
      } else {
        setZoom(ZOOM_DEFAULT);
        showZoomTip(x, y, ZOOM_DEFAULT, false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setZoom, setContentZoom, showZoomTip]);

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

  /** 统一提示入口（**跟随鼠标**的即时反馈——你主动操作的反馈；后台任务的完成通知不在这里：
   *  走铃铛气泡，见 header）。默认按「成功」显示，是错误必须由调用方显式传 err=true。
   *  quick：**轻提示**（1.5s 且淡出动画配套缩短）——重复操作提醒这类"扫一眼就够"的，
   *  不需要错误那 3 秒的阅读时间（用户定稿：重复操作的提示 1.5s 消失）。
   *  旧写法把裸 setToast 当 onToast 往下传，而 toastErr 只在错误分支被置 true、
   *  成功分支没人复位，于是一次失败之后所有普通提示都红着显示（实报：右键「复制完整路径」弹红 ✗）——
   *  红不红与那次操作毫无关系，只取决于这次会话之前有没有出过错。此处默认复位，由调用方声明错误。 */
  const showToast = useCallback((msg: string, err = false, quick = false, durationMs?: number) => {
    setToastErr(err);
    setToastQuick(quick);
    // 每次显式设置（含 null）：上一次的自定义时长不能影响下一条提示
    setToastDuration(durationMs ?? null);
    setToast(msg);
  }, []);

  // 后台任务完成通知：统一走「铃铛气泡」（header：气泡弹出 3.5 秒 + 铃铛留档，见 notices）。
  // 取消不通知（用户自己点的）；结果任何时候都在铃铛里可翻
  const bgTasks = useTasks();
  /** 共享访问状态：本机在开启局域网共享时轮询远程加入/离开事件 */
  const shareStatus = useShareStatus();
  const shareLocal = shareStatus?.local ?? true;
  const shareMode = shareStatus?.mode ?? 'local';
  useEffect(() => {
    // 只有本机需要接收远程加入/离开通知
    if (!shareLocal || shareMode === 'local') return;
    // since=-1 表示首次调用：只记录游标，不补发历史事件（避免每次刷新都弹一堆旧通知）
    let since = -1;
    let alive = true;
    const poll = async () => {
      if (!alive) return;
      try {
        const r = await get.shareEvents(since < 0 ? Number.MAX_SAFE_INTEGER : since);
        if (!alive) return;
        if (since < 0) {
          since = r.lastId;
          return;
        }
        if (r.events.length === 0) return;
        since = r.lastId;
        for (const e of r.events) {
          addNotice({
            title: t('share.noticeTitle'),
            message: t(e.type === 'join' ? 'share.noticeJoin' : 'share.noticeLeave', {
              ip: e.ip,
              n: e.viewers,
              max: e.max > 0 ? e.max : '∞',
            }),
            err: false,
          });
        }
      } catch {
        /* 服务重启/网络抖动：下一轮再试 */
      }
    };
    const timer = window.setInterval(() => void poll(), 3000);
    void poll();
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [shareLocal, shareMode]);
  const notifiedTaskIdsRef = useRef<Set<number>>(new Set());
  useEffect(() => {
    for (const tk of bgTasks) {
      if (tk.status === 'running' || notifiedTaskIdsRef.current.has(tk.id)) continue;
      notifiedTaskIdsRef.current.add(tk.id);
      if (tk.status === 'cancelled') continue;
      // 铃铛留档（携带任务详情——更新结果可在面板里点开）+ 气泡由 header 按最新通知弹出
      addNotice({ title: tk.title, message: tk.message ?? '', err: tk.status === 'error', detail: tk.data, taskId: tk.id });
    }
  }, [bgTasks]);

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

  // F5 刷新：拦掉浏览器整页重载，改为重新扫描当前项目（与顶栏「刷新」同一动作）。
  // 不重载页面 → 输入框内容、弹窗和视图状态都不会丢；轻提示 1.5 秒确认已生效。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'F5' || e.repeat) return;
      e.preventDefault();
      refresh();
      showToast(t('common.refreshed'), false, true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [refresh, showToast]);

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
    // git 凭据的 GitHub 用户名（Fork 菜单可见性粗判；凭据更新后下次刷新生效即可）
    get.gitAuth().then((a) => setGitUser(a.username)).catch(() => {});
    loadHistory();
    // 环境检测：缺失 svn/git 时顶部横幅提示安装
    get
      .envCheck()
      .then((r) => setEnv(r))
      .catch(() => {});
  }, [loadHistory]);

  // 「环境检测」弹窗每次打开都重新检测一次（⋯ 菜单入口）：
  // 确保看到的是最新状态（用户可能刚在别处装完 svn/git）
  useEffect(() => {
    if (modal?.type !== 'env') return;
    get
      .envCheck()
      .then((r) => setEnv(r))
      .catch(() => {});
  }, [modal?.type]);

  // 环境缺失:只提示「当前仓库类型需要」的引擎;未打开仓库时任一缺失都提示
  // (用户可能只用 Git 或只用 SVN,不强制两者都装)
  const needSvn = !repo?.type || repo.type === 'svn';
  const needGit = !repo?.type || repo.type === 'git';
  const missingSvn = !!(env && needSvn && !env.svn.installed);
  const missingGit = !!(env && needGit && !env.git.installed);
  const envMissing = missingSvn || missingGit;

  // 从历史列表打开项目
  /** 右键「浏览仓库」（SVN 项目）：取仓库根 URL → 打开仓库浏览弹窗（不检出直接看远程） */
  const openRepoBrowse = (path: string) => {
    get
      .repoRoot(path)
      .then((r) => {
        if (r.ok && r.root) setModal({ type: 'repo-browse', url: r.root, wcRel: r.rel ?? '' });
        // 取仓库地址失败：{msg}
        else showToast(t('repo.browse.errNoRoot', { msg: r.error ?? '' }), true);
      })
      .catch((e: Error) => showToast(t('repo.browse.errNoRoot', { msg: e.message }), true));
  };

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
            // 「{path}」不是工作副本（目录可能已被删除或改名）。已打开它所属的仓库：{root}
            const msg = t('shell.repo.notWC', { path: h.path, root });
            showToast(msg, true);
            setInvalidPaths((prev) => ({ ...prev, [h.path]: msg }));
          } else {
            setInvalidPaths((prev) => { const n = { ...prev }; delete n[h.path]; return n; }); // 路径有效：撤掉标记
          }
        } else {
          // 打开失败：未识别为仓库
          showToast(t('shell.repo.openFailed'), true);
        }
      } catch (e) {
        showToast((e as Error).message, true);
        // 共享门禁拒绝（如远程不允许切换项目）不是"项目失效"：只提示，不要打 × 标记
        if (!(e as { shareDenied?: boolean }).shareDenied) {
          // 打不开（目录已删 / 不是工作副本）：标为失效 → 该项上常驻一个 ×，悬浮时也用这条消息提示
          setInvalidPaths((prev) => ({ ...prev, [h.path]: (e as Error).message }));
        }
      }
    },
    [refresh, loadHistory, showToast, setOnboard] // setOnboard 是 useState 的 setter，引用稳定
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
  // 执行操作
  const runOp = useCallback(
    async (op: Op, paths: string[], keep = false, force = false): Promise<VcsResult> => {
      let r: VcsResult;
      // update/push 有独立进度窗,不重复显示短条
      setOpBusy(op === 'add' || op === 'revert' || op === 'delete' || op === 'fs-delete' || op === 'move' || op === 'fs-move' ? t(OP_BUSY_KEY[op]) : null);
      try {
        if (op === 'add') r = await post.add(paths);
        else if (op === 'commit') r = await post.commit(paths, '');
        else if (op === 'update') r = await post.update();
        else if (op === 'revert') r = await post.revert(paths);
        else if (op === 'fs-delete') r = await post.fsDelete(paths, force);
        else if (op === 'move') r = await post.move(paths[0], paths[1]);
        else if (op === 'fs-move') r = await post.fsMove(paths[0], paths[1]);
        else if (op === 'delete') r = keep ? await post.delete(paths, true) : await post.delete(paths);
        else r = await post.push();
      } catch (e) {
        // 网络失败等异常:给用户可见反馈,避免 unhandled rejection 后"点了没反应"
        // 操作失败
        const msg = (e as Error).message || t('shell.op.failed');
        showToast(msg, true);
        setOpBusy(null);
        return { ok: false, message: msg };
      }
      setOpBusy(null);
      // 回收站不可用：不弹普通失败 toast，由调用方弹「直接删除？」二次确认（结果里带未成功的路径）；
      // 部分成功时已有文件进回收站，列表照常刷新
      if (r.trashUnavailable) {
        refresh();
        return r;
      }
      showToast(r.message, !r.ok);
      if (r.ok) {
        refresh();
        // 动作落到行上的回馈（animations 动画域）：刷新换数据后行上给「刚刚发生了什么」的反馈；
        // 行不在当前视图/视口外由 playOnRow 静默跳过，不会出错。
        // （update 的"落座"不在这里——更新走 doUpdateDir 的后台任务，动画接在那里）
        if (op === 'add') stampAddedRows(paths);
        else if (op === 'revert') sweepRevertedRows(paths);
        // 更新后工作副本版本变化，重拉仓库信息（头部 [rN]），与分支/标签弹窗 onChanged 一致
        if (op === 'update') get.info().then((ri) => setInfo(ri)).catch(() => {});
      }
      if (r.authError) setModal({ type: 'login' });
      return r;
    },
    [refresh, showToast] // setOpBusy 为稳定 setter,无需入依赖（OP_BUSY_KEY 已提到模块级）
  );

  // 推送（后台任务）：确认后弹窗即关、飞行线飞向顶栏沙漏；任务在后台跑，任务面板可取消。
  // 完成/失败走「顶部横幅 + 铃铛」（App 的任务完成观察者统一通知）；认证失败仍弹认证引导重试
  const [pushAuth, setPushAuth] = useState<{ type: 'github' | 'server' | 'ssh'; error?: string } | null>(null);
  const pushNow = useCallback(() => {
    /** 传输进度轮询的停止函数（startTask 返回 id 之后才挂得上） */
    let stopPoll: (() => void) | null = null;
    const taskId = startTask({
      kind: 'push',
      // 任务标题：推送 · {项目名} · {分支}（带项目名——切换项目后也能分清是哪个仓库在推）
      title: t('shell.tasks.pushTitle', { repo: baseName(repo?.root ?? ''), branch: repo?.revOrBranch ?? '' }),
      run: async (signal) => {
        try {
          const r = await post.push(signal);
          if (r.ok) refresh();
          // 认证失败 → 弹认证引导（带失败原因）；其余失败只回给任务（横幅/铃铛提示，详情点铃铛看）
          else if (r.authType) setPushAuth({ type: r.authType, error: r.message });
          else if (r.code !== 'ABORTED') {
            // 非认证类失败：可能是"推别人的仓库、没有写权限"→ 查一次权限（带凭据的只读接口）确认后引导 Fork。
            // 不用正则猜 git 报错文本（措辞不可靠）；仅 canPush===false 才引导，其余原因保持原样只回报错。
            // ABORTED（用户主动取消）不引导——取消是用户意志，不是"推不上去"
            try {
              const perm = await get.githubPermissions();
              if (perm.ok && perm.isGithub && perm.canPush === false) setModal({ type: 'github-fork' });
            } catch {
              /* 权限查询失败不改变原报错路径 */
            }
          }
          return { ok: r.ok, message: r.message, data: r };
        } finally {
          stopPoll?.(); // 任务收尾就停轮询
        }
      },
    });
    // 进度轮询挂在 startTask **之后**：run 是被同步调起的，在里面拿不到自己的 id。
    // 通道固定为 'push'——同一时刻只对一个仓库推送（上面 hasRunningTask 已防重入）
    stopPoll = pollTransferProgress(taskId, 'push');
  }, [refresh, repo?.root, repo?.revOrBranch, setModal]);
  // 推送入口：弹出「确认推送」窗口（未推送提交列表 + 推送条件），确认后执行
  const doPush = useCallback(() => {
    if (unpushedCount != null && unpushedCount <= 0) return; // 无未推送提交（按钮已置灰，双保险）
    // 已有推送在跑：别叠第二个（git 层面也会 lock 打架）——在任务面板里等它或取消它
    // （hasRunningTask 直接读任务 store 快照——不经 React 渲染，快速连点也可靠）
    if (hasRunningTask('push')) {
      showToast(t('shell.tasks.pushBusy'), true, true); // 重复操作轻提示（1.5s）
      return;
    }
    setModal({ type: 'push-confirm' });
  }, [unpushedCount, showToast]);

  // 跳转 diff 视图（提交冲突提示"双击查看差异"使用；定义在 handleAction 之前供其依赖）
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
        // 取消添加确认 / 撤销删除确认 / 还原确认
        title: isA ? t('shell.revert.cancelAddTitle') : isD ? t('shell.revert.undoDeleteTitle') : t('shell.revert.title'),
        message: isA ? (
          // 将 / 取消添加到版本库 / ： /  变回未版本化（?），磁盘文件保留。确认？
          <>{t('shell.revert.lead')}<b>{t('shell.revert.cancelAddBold')}</b>{t('shell.revert.sep')}<b>{dir}</b>{t('shell.revert.cancelAddTail')}</>
        ) : isD ? (
          // 将 / 撤销删除 / ： /  回到版本库内容。确认？
          <>{t('shell.revert.lead')}<b>{t('shell.revert.undoDeleteBold')}</b>{t('shell.revert.sep')}<b>{dir}</b>{t('shell.revert.undoDeleteTail')}</>
        ) : (
          // 将放弃对  /  的本地修改，不可恢复。确认还原？
          <>{t('shell.revert.discardLead')}<b>{dir}</b>{t('shell.revert.discardTail')}</>
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
        // 选择的 {n} 项
        setModal({ type: 'revert-confirm', dir, dirLabel: paths.length > 1 ? t('shell.revert.selectedCount', { n: list.length }) : dir, items: list });
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
          // 未知错误
          const msg = (e as Error).message || t('shell.unknownError');
          setModal({
            type: 'confirm',
            // ⚠ 冲突检查未完成
            title: t('shell.commitCheck.incompleteTitle'),
            message: (
              <>
                {/* 提交前的冲突检查 / 未能完成 / （{msg}）。本次提交将 / 不经过行级冲突拦截 / ： */}
                {t('shell.commitCheck.incLead')}<b>{t('shell.commitCheck.incBold')}</b>{t('shell.commitCheck.incMid', { msg })}<b>{t('shell.commitCheck.incBold2')}</b>{t('shell.commitCheck.incTail')}
                <div className="error mt8" style={{ lineHeight: 1.8 }}>
                  {/* 若服务器上有他人修改与你的修改冲突，提交可能失败或覆盖对方修改。请先更新后再提交。 */}
                  {t('shell.commitCheck.incWarn')}
                </div>
              </>
            ),
            // 仍然提交
            confirmLabel: t('shell.commitCheck.submitAnyway'),
            // 取消
            secondaryLabel: t('common.cancel'),
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
            // ⚠ 存在行冲突，禁止提交
            title: t('shell.commitCheck.clashTitle'),
            // 宽度随最长文件名自适应
            width: pathAutoWidth(clash.reduce((m, f) => Math.max(m, f.path.length), 0), 520, 1200),
            message: (
              <>
                {/* 以下文件与服务器版本存在 / 行冲突 / ，请先手动处理后再提交： */}
                {t('shell.commitCheck.clashLeadA')}<b>{t('shell.commitCheck.clashLeadBold')}</b>{t('shell.commitCheck.clashLeadB')}
                <div className="error mt8" style={{ minHeight: 100, overflow: 'auto' }}>
                  {clash.map((f) => (
                    <div key={f.path} className="mono">
                      {/* ⚠ {path}：{lines} 冲突 / 文件开头 / 第 {n} 行 / 、 */}
                      {t('shell.commitCheck.clashRow', { path: f.path, lines: f.lines.map((l) => (l === 0 ? t('shell.commitCheck.fileStart') : t('shell.commitCheck.line', { n: l }))).join(t('shell.listSep')) })}
                    </div>
                  ))}
                </div>
                <div className="dim small mt8" style={{ lineHeight: 1.8 }}>
                  {/* 处理步骤： */}
                  {t('shell.commitCheck.stepsLead')}
                  {/* 1. 点「查看对比」确认对方改了哪里、你改了哪里 */}
                  <br />{t('shell.commitCheck.step1')}
                  {/* 2.  / 先备份你的修改 / （复制内容保存到本地） */}
                  <br />{t('shell.commitCheck.step2Lead')}<b>{t('shell.commitCheck.step2Bold')}</b>{t('shell.commitCheck.step2Tail')}
                  {/* 3. 删除该文件，再点「更新」获取服务器最新版本 */}
                  <br />{t('shell.commitCheck.step3')}
                  {/* 4. 按冲突位置手动合并两边内容 → 重新提交 */}
                  <br />{t('shell.commitCheck.step4')}
                </div>
              </>
            ),
            // 知道了
            confirmLabel: t('ui.modal.gotIt'),
            // 查看对比
            secondaryLabel: t('shell.viewDiff'),
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
            // ⚠ 服务器有新版本
            title: t('shell.commitCheck.serverNewTitle'),
            // 宽度随最长文件名自适应
            width: pathAutoWidth(same.reduce((m, p) => Math.max(m, p.length), 0), 520, 1200),
            message: (
              <>
                {/* 服务器有  /  个新提交，以下  /  个待提交文件服务器也有新版本， / 可能冲突 / （双击查看差异）： */}
                {t('shell.commitCheck.serverNewA')}<b>{pf.behind}</b>{t('shell.commitCheck.serverNewB', { n: pf.behind })}<b>{same.length}</b>{t('shell.commitCheck.serverNewC')}<b>{t('shell.commitCheck.serverNewBold')}</b>{t('shell.commitCheck.serverNewD')}
                <div className="vcs-list" style={{ minHeight: 120, marginTop: 8 }}>
                  {same.map((f) => (
                    <div
                      key={f}
                      className="vcs-row"
                      // 双击查看差异
                      title={t('shell.dblClickDiff')}
                      onDoubleClick={() => {
                        setModal(null);
                        gotoDiff(f);
                      }}
                    >
                      <span className="mono small" style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {f}
                      </span>
                      {/* 双击查看差异 */}
                      <span className="dim small nowrap">{t('shell.dblClickDiff')}</span>
                    </div>
                  ))}
                </div>
              </>
            ),
            // 继续提交
            confirmLabel: t('shell.commitCheck.continueSubmit'),
            // 先更新
            secondaryLabel: t('shell.commitCheck.updateFirst'),
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
        // 移到回收站（未版本化 ? / 忽略 I 文件/目录）：仅动本地文件、不做版本库操作。
        // 回收站不可用时（runOp 返回 trashUnavailable，已跳过普通 toast）弹第二道确认：
        // 直接磁盘删除不可恢复，确认后 force 重发（跳过回收站），取消则文件原样
        const doDelete = (list: string[], force = false) => {
          // 丢出屏幕：点确认的瞬间即播（不等删除结果——本地删除很快；回收站不可用/失败时
          // 行会随列表刷新回来，二次确认后重发会再飞一次）
          flyRowsToTrash(list);
          void runOp('fs-delete', list, false, force).then((res) => {
            if (res.trashUnavailable && res.failedPaths?.length) {
              const failed = res.failedPaths;
              setModal({
                type: 'confirm',
                // 系统回收站不可用
                title: t('shell.fsDelete.noTrash.title'),
                danger: true,
                message: (
                  <div>
                    {/* 系统回收站命令不可用，{n} 项未能移入回收站。是否直接从磁盘删除？ */}
                    {t('shell.fsDelete.noTrash.body', { n: failed.length })}
                    {res.trashReason ? (
                      <div className="dim small" style={{ marginTop: 6, lineHeight: 1.8 }}>
                        {/* 原因：{msg} */}
                        {t('shell.fsDelete.noTrash.reason', { msg: res.trashReason })}
                      </div>
                    ) : null}
                    {/* 此操作不可恢复！ */}
                    <div style={{ marginTop: 6 }}>{t('shell.fsDelete.noTrash.warn')}</div>
                  </div>
                ),
                // 直接删除
                confirmLabel: t('shell.fsDelete.noTrash.confirm'),
                action: () => doDelete(failed, true),
              });
            }
          });
        };
        setModal({
          type: 'confirm',
          // 移到回收站
          title: t('shell.fsDelete.title'),
          danger: true,
          message: (
            <div>
              {/* 将把 / 移到系统回收站 /  {n} 项（不在版本库中的文件）。 */}
              {t('shell.fsDelete.lead')}<b>{t('shell.fsDelete.bold')}</b>{t('shell.fsDelete.tail', { n: paths.length })}
              {/* 可从回收站恢复，确认移入？ */}
              <div style={{ marginTop: 6 }}>{t('shell.fsDelete.warn')}</div>
            </div>
          ),
          // 移到回收站
          confirmLabel: t('shell.fsDelete.confirm'),
          action: () => doDelete(paths),
        });
      } else if (op === 'delete') {
        // 从版本库移除 = 仅标记删除、磁盘文件不受影响（提交后生效；提交前可还原）
        // 缺失条目（磁盘已删未走移除流程）同走此入口：保持缺失状态，仅从版本库删除记录
        setModal({
          type: 'confirm',
          // 从版本库移除
          title: t('shell.remove.title'),
          message: (
            <div>
              {/* 将 / 从版本库移除 /  {n} 项（ / 磁盘文件不受影响 / ；提交后从版本库删除）。 */}
              {t('shell.remove.lead')}<b>{t('shell.remove.bold')}</b>{t('shell.remove.tail', { n: paths.length })}<b>{t('shell.remove.bold2')}</b>{t('shell.remove.tail2')}
              <div className="dim small" style={{ marginTop: 6, lineHeight: 1.8 }}>
                {/* · 提交前可右键「还原」取消移除；版本库历史保留 */}
                {t('shell.remove.note')}
              </div>
            </div>
          ),
          // 从版本库移除
          confirmLabel: t('shell.remove.confirm'),
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
    // confirmRevert 是普通函数（每次渲染都是新引用）、checkCommitBackground 依赖较杂：
    // 入依赖会让本回调每次渲染都重建，进而牵连依赖它的 handleAction 等。闭包捕获即可。
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [runOp, gotoDiff, doPush, repo]
  );

  // 更新（后台任务，同推送/检出模板）：立即返回、不弹遮罩——沙漏指示器 + 任务面板可取消；
  // 结果一律走铃铛通知（用户定稿：成功/失败都不弹结果窗）；取消不通知
  const doUpdateDir = useCallback(
    (dir: string) => {
      // 已有更新在跑：别叠第二个（hasRunningTask 直接读任务 store 快照——不经 React
      // 渲染，快速连点/旧闭包捕获（如 checkCommitBackground）都可靠）
      if (hasRunningTask('update')) {
        showToast(t('shell.tasks.updateBusy'), true, true); // 重复操作轻提示（1.5s）
        return;
      }
      // 飞行线：起点用当前鼠标位置——更新没有确认窗，入口各异（顶栏按钮 / 右键菜单 /
      // 各弹窗的「先更新」按钮），点哪飞哪；推送/检出仍用各自确认按钮的 rect
      launchMagicFlight({ x: mouseRef.current.x, y: mouseRef.current.y });
      /** 传输进度轮询的停止函数（startTask 返回 id 之后才挂得上） */
      let stopPoll: (() => void) | null = null;
      const taskId = startTask({
        kind: 'update',
        // 任务标题：{repo} · {branch} · 更新（右键子目录更新时追加目录——同检出标题的拼接先例）
        title: `${t('shell.tasks.updateTitle', { repo: baseName(repo?.root ?? ''), branch: repo?.revOrBranch ?? '' })}${dir ? ` · ${dir}` : ''}`,
        run: async (signal) => {
          try {
            const r = await post.update(dir || undefined, signal);
            if (r.ok) {
              // remote: 连侧栏的「远程检查」一起重跑——它的 ⬇ 角标有三个来源，只刷顶栏
              // remoteHint 的话，旧的 remoteProbe 值会继续把角标撑在 12（用户实报）
              refresh({ remote: true });
              // 更新带来的文件行「落座」（animations 动画域）：从上方滑入 + 左侧绿竖条标记新入列
              settleUpdatedRows(r.files?.map((f) => f.path) ?? []);
              get.info().then((ri) => setInfo(ri)).catch(() => {}); // 更新后工作副本版本变化，重拉仓库信息（头部 [rN]）
            }
            if (r.authError) setModal({ type: 'login' });
            // 结果一律走铃铛通知（成功/失败都不自动弹窗——用户定稿）；svn 警告（外部定义失败等）
            // 拼进通知消息，通知里别丢掉
            const msg = r.warnings?.length ? `${r.message}\n⚠ ${r.warnings.join('\n⚠ ')}` : r.message;
            // data = 完整更新详情（kind 判别）→ 完成通知携带它，铃铛面板里点开「更新结果」窗
            // （文件清单/警告；dir 空由组件兜底显示「（仓库根）」）
            const detail = { kind: 'update' as const, dir, ok: r.ok, message: r.message, files: r.files, warnings: r.warnings };
            return { ok: r.ok, message: msg, data: detail };
          } finally {
            stopPoll?.(); // 任务收尾就停轮询
          }
        },
      });
      // 进度轮询（git 拉取才有数据；svn update 那侧后端一直 ok=false，面板自然不显示进度条）
      stopPoll = pollTransferProgress(taskId, 'pull');
    },
    [refresh, showToast, repo?.root, repo?.revOrBranch]
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
            {/* 提交失败 */}
            {t('shell.commit.failed')}
          </span>
        ),
        message: (
          <>
            <div className="error" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
              {translateVcsError(msg)}
            </div>
            {aheadFiles.length > 0 && (
              <>
                {/* 被他人领先提交（{n} 项）： */}
                <div className="small mt8">{t('shell.commit.aheadLead', { n: aheadFiles.length })}</div>
                <div className="vcs-list" style={{ marginTop: 8 }}>
                  {aheadFiles.map((f) => (
                    <div
                      key={f}
                      className="vcs-row"
                      // 双击查看差异
                      title={t('shell.dblClickDiff')}
                      onDoubleClick={() => {
                        setModal(null);
                        gotoDiff(f);
                      }}
                    >
                      <span className="mono small" style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {f}
                      </span>
                      {/* 双击查看差异 */}
                      <span className="dim small nowrap">{t('shell.dblClickDiff')}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </>
        ),
        // 知道了
        confirmLabel: t('ui.modal.gotIt'),
        action: () => setModal(null),
        // 先更新
        secondaryLabel: isOutOfDate ? t('shell.commitCheck.updateFirst') : undefined,
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
        clearCommittedRows(paths); // 提交成功的行反馈：绿对勾"收走"
      } else if (r.code === 'NO_IDENTITY') {
        // git 身份未配置（git 拒绝提交，报 NO_IDENTITY）：不糊原始报错，改弹「设置身份」窗，
        // 保存后自动重试本次提交（重试逻辑在 modal-host，凭这里带上的 retry 数据原样重放）
        setModal({ type: 'git-identity', retry: { paths, message, stagedOnly: [] } });
        return; // 提前返回：下面的 setModal(null) 会把刚弹的身份窗关掉
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
    async (
      dir: string,
      dirLabel: string,
      /** 从差异视图返回时保留用户已勾选/注释；items 按最新状态重新收集（已还原的文件自动消失） */
      preserve?: { checked?: string[]; msg?: string; stagedOnly?: string[] },
    ) => {
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
              // 当前目录下没有已版本化的变更；有 {n} 个未版本化文件（?），需先右键「添加到版本库」才能提交
              ? t('shell.commitSelect.noChangedWithUnversioned', { n: unversioned })
              : externals > 0
                // 当前目录下只有外部引用（{n} 个，链环图标）——它里面是另一个仓库路径的内容，请到那个目录提交
                ? t('shell.commitSelect.onlyExternals', { n: externals })
                // 当前目录下没有变更文件
                : t('shell.commitSelect.noChanges')
          );
          return;
        }
        // 从 index 恢复「已部分暂存」的文件：弹窗关掉再打开也认得（否则重开后会整文件 add，把未选的块也提交）
        const stagedOnly = preserve?.stagedOnly ?? (await get.stagedFiles().then((r) => r.files).catch(() => []));
        // 用户已勾选的路径按最新 items 过滤：已还原/已消失的文件不留在勾选集合里
        const checked = preserve?.checked?.filter((p) => items.some((i) => i.path === p));
        setModal({
          type: 'commit-select',
          dir,
          dirLabel,
          items,
          stagedOnly,
          ...(checked !== undefined ? { checked } : {}),
          ...(preserve?.msg !== undefined ? { msg: preserve.msg } : {}),
        });
        // 与"提交此文件"一致的提交前安全：行冲突/远程检查后台并行（用户勾选期间完成，关窗则丢弃）
        checkCommitBackground(items.map((i) => i.path), { type: 'commit-select', dir, dirLabel, items, stagedOnly });
      } catch (e) {
        // 读取变更失败: {msg}
        showToast(t('shell.commitSelect.readFailed', { msg: (e as Error).message }), true);
      }
    },
    // checkCommitBackground 是 useCallback，引用随其自身依赖变动；入依赖会让本回调频繁重建
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
          clearCommittedRows(paths); // 提交成功的行反馈：绿对勾"收走"
        } else if (r.code === 'NO_IDENTITY') {
          // 同 doCommit：身份未配置 → 弹「设置身份」窗（勾选清单/消息原样带上，保存后自动重试）
          setModal({ type: 'git-identity', retry: { paths, message, stagedOnly } });
        } else {
          showCommitFail(r.message, paths);
        }
        if (r.authError) setModal({ type: 'login' });
      } catch (e) {
        // 提交失败: {msg}
        showCommitFail(t('shell.commit.failMsg', { msg: (e as Error).message }), paths);
      }
    },
    [refresh, repo?.type, showCommitFail, showToast]
  );

  const [diffFrom, setDiffFrom] = useState<View>('browse');

  const showLog = useCallback((path?: string, isDir = false) => {
    setLogPath(path);
    setLogIsDir(isDir);
    setView('log');
  }, []);

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
              // 顶栏「刷新」信号：侧边栏重跑状态探测（当前项目绕过后端缓存——刚提交后点刷新，↑ 角标立刻准）
              refreshTick={tick}
              // 远程状态重算信号（更新/切分支/合并后 +1）：侧栏据此重跑一遍「远程检查」，
              // 否则 ⬇ 角标会停在操作前的数（后端缓存虽已失效，前端不重探也看不到）
              remoteCheckTick={remoteCheckTick}
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
                  tick={tick}
                  active={view === 'browse'}
                  repoType={repo.type}
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
    </div>
  );
}
