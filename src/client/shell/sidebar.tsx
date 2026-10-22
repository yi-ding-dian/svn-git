/** 侧边栏：视图导航 + 最近项目列表（右键设常用/备注/删除）+ 版本号 */
import React, { useEffect, useRef, useState } from 'react';
import { IconClock, IconEye, IconEyeClosed, IconFolder, IconRename, IconServer } from '../ui/icons.js';
// import { IconDiff } from '../ui/icons.js'; // 差异入口隐藏，恢复时连同 NAV 项一起打开
import { ContextMenu } from '../ui/context-menu.js';
import { Tooltip } from '../ui/tooltip.js';
import { RemarkModal } from '../repo/remark.js';
import { THEMES, THEME_PINNED } from './header/index.js';
import { get, post, type HistoryItem, type ProjectProbe } from '../shared/api.js';
import { baseName } from '../shared/utils.js';
import { startTask, useTasks } from '../shared/tasks.js';
import { launchMagicFlight } from '../animations/index.js';
import { ResizeCursor, useResizeCursor } from '../shared/use-resize-cursor.js';
import { t } from '../../shared/i18n/index.js';

/** 主视图类型（侧边栏导航目标） */
export type View = 'log' | 'diff' | 'browse';

/** 最近打开时间（列表第二行的小字）：越近越具体、越远越粗略——侧边栏只有 160px 宽，省着用 */
function relTime(ts: number): string {
  if (!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  const mins = Math.floor((now.getTime() - ts) / 60000);
  // 刚刚
  if (mins < 1) return t('shell.time.justNow');
  // {n} 分钟前
  if (mins < 60) return t('shell.time.minutesAgo', { n: mins });
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const dayKey = (x: Date) => `${x.getFullYear()}-${x.getMonth()}-${x.getDate()}`;
  // 今天 {time}
  if (dayKey(d) === dayKey(now)) return t('shell.time.today', { time: hm });
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  // 昨天 {time}
  if (dayKey(d) === dayKey(y)) return t('shell.time.yesterday', { time: hm });
  const days = Math.floor((now.getTime() - ts) / 86400000);
  // {n} 天前
  if (days < 7) return t('shell.time.daysAgo', { n: days });
  const mmdd = `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return d.getFullYear() === now.getFullYear() ? mmdd : `${d.getFullYear()}-${mmdd}`;
}

/** 徽标数字压缩：>99 显示 99+（避免长数字把行挤歪；悬浮明细里是原始数字） */
const fmtCount = (n: number): string => (n > 99 ? '99+' : String(n));

/** 状态行有没有"信号"（⬆未推送 / ⬇待拉取 / ●未提交 / ⚠冲突 / ⚠不可用）——
 *  全无 = 整行不显示（用户定稿：干净项目不留中间行，分支信息悬浮看） */
function probeHasSignal(st: ProjectProbe): boolean {
  return (
    Boolean(st.error) ||
    (st.ahead ?? 0) > 0 ||
    (st.behind ?? 0) > 0 ||
    (st.changed ?? 0) > 0 ||
    (st.conflict ?? 0) > 0
  );
}

/** 仪表盘徽标（最近项目的状态行）：只留强信号（未推送/未提交/冲突——**未跟踪归悬浮明细**，
 *  噪音大不代表"有活没干"）；git 带分支名作上下文、**svn 不带**（位置串太长，用户定稿去掉）。
 *  pull：⬇ 徽标变可点按钮（就地更新该项目）；busy 时显示 ⏳ 防重复点。 */
function probeBadges(st: ProjectProbe, pull?: { busy: boolean; onClick: (from: { x: number; y: number }) => void }) {
  if (st.error) {
    return (
      <Tooltip content={st.error === 'unavailable' ? t('shell.recent.probeUnavailable') : st.error}>
        <span className="st-bad">⚠</span>
      </Tooltip>
    );
  }
  return (
    <>
      {st.type !== 'svn' && st.branch && <span className="st-branch">{st.branch}</span>}
      {(st.ahead ?? 0) > 0 && <span className="st-ahead">⬆{fmtCount(st.ahead!)}</span>}
      {(st.behind ?? 0) > 0 &&
        (pull ? (
          // 点击就地更新（拉取远程新提交）；stopPropagation：别触发行点击（切项目）
          <Tooltip content={t('shell.recent.pullTip')}>
            <button
              className="st-behind st-pull"
              disabled={pull.busy}
              onClick={(e) => {
                e.stopPropagation();
                // 飞行线起点 = ⬇ 按钮位置（同推送/检出/更新入口）
                pull.onClick(e.currentTarget.getBoundingClientRect());
              }}
            >
              {pull.busy ? '⏳' : `⬇${fmtCount(st.behind!)}`}
            </button>
          </Tooltip>
        ) : (
          <span className="st-behind">⬇{fmtCount(st.behind!)}</span>
        ))}
      {(st.changed ?? 0) > 0 && <span className="st-changed">●{fmtCount(st.changed!)}</span>}
      {(st.conflict ?? 0) > 0 && <span className="st-conflict">⚠{fmtCount(st.conflict!)}</span>}
    </>
  );
}

/** 悬浮明细（拼进最近项目条目的 title）：分支/位置、未推送、待拉取、未提交、未跟踪、冲突——有一条列一行。
 *  live=true：behind 用"远程检查"措辞，否则标"基于上次获取"（本地记录，可能过期）；
 *  remoteFailed=true：远程检查失败（网络/凭据）——如实标注，别让人以为"没有远程更新" */
function probeTip(st: ProjectProbe, live = false, remoteFailed = false): string {
  if (st.error) return st.error === 'unavailable' ? t('shell.recent.probeUnavailable') : st.error;
  const out: string[] = [];
  // 当前分支 / 工作副本位置
  if (st.branch) out.push(t(st.type === 'svn' ? 'shell.recent.tipSvnLoc' : 'shell.recent.tipBranch', { b: st.branch }));
  // 未推送：{n} 个提交
  if ((st.ahead ?? 0) > 0) out.push(t('shell.recent.tipAhead', { n: st.ahead! }));
  // 待拉取：{n} 个提交（远程检查）/ 待拉取：{n} 个提交（基于上次获取）
  if ((st.behind ?? 0) > 0) out.push(t(live ? 'shell.recent.tipBehindLive' : 'shell.recent.tipBehind', { n: st.behind! }));
  // 远程检查失败（网络或凭据问题）
  if (remoteFailed) out.push(t('shell.recent.remoteFailed'));
  // 未提交：{n} 个文件
  if ((st.changed ?? 0) > 0) out.push(t('shell.recent.tipChanged', { n: st.changed! }));
  // 未跟踪：{n} 个文件
  if ((st.untracked ?? 0) > 0) out.push(t('shell.recent.tipUntracked', { n: st.untracked! }));
  // 冲突：{n} 个文件
  if ((st.conflict ?? 0) > 0) out.push(t('shell.recent.tipConflict', { n: st.conflict! }));
  return out.join('\n');
}

/** 侧栏宽度持久化 key 与范围（右边缘拖拽调整；上限拖拽时再压 min(400, 40% 视口) 防小窗挤压内容区） */
const SIDEBAR_W_KEY = 'sidebar.width';
const SIDEBAR_W_DEFAULT = 160;
const SIDEBAR_W_MIN = 140;
const SIDEBAR_W_MAX = 400;

export function Sidebar(props: {
  view: View;
  history: HistoryItem[];
  version?: string;
  /** 当前打开的仓库根：匹配的最近项目高亮选中，标明正在操作的项目 */
  currentRoot?: string | null;
  /** 顶栏「刷新」信号（App 的 tick 递增）：重跑一轮状态探测——当前项目**强制绕过后端
   *  30s 缓存**（刚提交/改文件后点刷新，↑● 角标必须立刻准，用户实报"刷新后 ↑18 还是旧的"） */
  refreshTick?: number;
  /** 远程状态重算信号（App 在更新/切分支/合并成功后递增）：重跑「远程检查」。
   *  与 refreshTick 分开：后者连文件操作都会变，不能每次都触发一批联网探测。 */
  remoteCheckTick?: number;
  onNav: (v: View) => void;
  onOpenHistory: (h: { path: string }) => void;
  onRemoveHistory: (path: string) => void;
  /** 设置/取消常用项目（星号标记，启动时优先打开） */
  onSetFav: (path: string, fav: boolean) => void;
  /** 设置/清除项目备注（显示在第二行、时间前面）；传空串 = 清除备注 */
  onSetRemark: (path: string, remark: string) => void;
  /** 外观区：主题色块（位于最近项目上方；字体设置在顶栏 ⋯ 菜单） */
  theme: string;
  setTheme: (t: string) => void;
  /** 打开主题气泡（参数为「…」按钮的屏幕坐标，气泡贴其下方展开） */
  onOpenThemePop: (x: number, y: number) => void;
  /** 主题气泡是否打开（「…」按钮高亮态） */
  themePopOpen: boolean;
  /** 当前项目的远程新提交数（preflight 实时检查结果，与顶部提示条同源）：
   *  补进当前项目条目的 ⬇ 徽标——本地探测拿不到它（尤其 SVN，远端更新必须联网查） */
  remoteBehind?: number;
  /** 轻提示（点 ⬇ 更新的结果等）：复用 app 的 showToast */
  onToast: (msg: string, err?: boolean) => void;
  /** 刷新主界面（App 的 refresh：文件列表 + 顶栏角标）——侧栏 ⬇ 拉取的正好是当前项目时调用 */
  onRefresh?: () => void;
  /** 右键「浏览仓库」（仅 SVN 项目）：app 取仓库根 URL 后开仓库浏览弹窗 */
  onBrowseRepo: (path: string) => void;
  /** 点开过但打不开的项目：路径 → 错误消息（这些项上常驻 ×，悬浮时显示同一条消息） */
  invalidPaths: Record<string, string>;
  /** 打开 Git 工作树管理（仅当前 Git 项目） */
  onManageWorktrees?: () => void;
  /** 悬浮失效项时显示提示（复用点击后那套浮层） */
  onShowTip: (msg: string) => void;
  /** 最近项目下方的「＋ 打开项目」：打开项目选择弹窗（与顶栏 ⋯ 菜单里那个同一入口） */
  onOpenProject: () => void;
  /** 最近项目下方的「🧪 练习仓库」：打开创建练习仓库弹窗 */
  onOpenPractice: () => void;
}) {
  // 最近项目右键菜单（设常用 / 备注 / 浏览仓库 / 删除 / 取消）。remark/type 一并带出：
  // 菜单项要用它预填备注弹窗、决定是否显示「浏览仓库」（仅 SVN）
  const [rmMenu, setRmMenu] = useState<{ x: number; y: number; path: string; fav: boolean; remark: string; type: 'svn' | 'git' } | null>(null);
  // 备注弹窗（右键「备注」打开）：null = 关闭
  const [remarkFor, setRemarkFor] = useState<{ path: string; name: string; current: string } | null>(null);

  // 最近项目仪表盘：路径 → 摘要状态。异步补上（先列表后状态，不阻塞渲染）；后端 30 秒缓存挡重复查询。
  // 依赖用"路径串"而非 history 数组——数组引用每次应用刷新都会新建，会让所有项目被无谓重查。
  const [probes, setProbes] = useState<Record<string, ProjectProbe>>({});
  // 状态行显隐开关（「最近项目」标题右侧的眼睛；偏好持久化、默认显示）：
  // 只控制"平时那行"——悬浮明细（title）不受影响，想看了悬浮仍有
  const [showStatus, setShowStatus] = useState(() => {
    try {
      return localStorage.getItem('svngit-recent-status') !== '0';
    } catch {
      return true;
    }
  });
  const toggleStatus = () => {
    setShowStatus((v) => {
      const next = !v;
      try {
        localStorage.setItem('svngit-recent-status', next ? '1' : '0');
      } catch {
        /* ignore */
      }
      return next;
    });
  };
  const historyKey = props.history.map((h) => h.path).join('|');
  // 渲染顺序：**当前打开的项目固定置顶**，其余保持原顺序（时间序）——稳定排序只把当前项提前，
  // 所以「刚检出/刚打开的其它项目」自然落在第二（用户定稿）
  const ordered = props.currentRoot
    ? [...props.history].sort((a, b) => Number(b.path === props.currentRoot) - Number(a.path === props.currentRoot))
    : props.history;
  // 远程检查（⬇ 待拉取）：打开/刷新时**自动**对全部项目跑一轮（后台异步、先回来先显示）——
  // SVN 等"必须联网才知道"的远程新提交由此覆盖（不切换过去也能看到）；
  // 后端自带超时（15s/20s）与缓存，卡住的项目不影响其他项目、也不阻塞界面。
  const [remoteBehinds, setRemoteBehinds] = useState<Record<string, { behind?: number; failed?: boolean }>>({});
  useEffect(() => {
    let alive = true;
    // **限并发 2**：弱网下每个探测（git fetch / svn status -u）最长 15~20s；全部项目一起发
    // 会占满浏览器同域连接槽（HTTP/1.1 为 6 个），把文件列表等主操作挤到队尾——用户实报
    // 打开项目时"正在加载…"迟迟不结束（网络好时探测秒回、无感，所以是"有时"）
    const queue = [...props.history];
    const worker = async (): Promise<void> => {
      while (alive) {
        const h = queue.shift();
        if (!h) return;
        try {
          const r = await get.remoteProbe(h.path);
          if (alive) setRemoteBehinds((p) => ({ ...p, [h.path]: r.error ? { failed: true } : { behind: r.behind ?? 0 } }));
        } catch {
          if (alive) setRemoteBehinds((p) => ({ ...p, [h.path]: { failed: true } }));
        }
      }
    };
    void worker();
    void worker(); // 两个并发 worker 消费同一队列
    return () => {
      alive = false;
    };
    // remoteCheckTick：更新/切分支/合并后重跑一轮——这几种操作会改变 behind，而本 effect
    // 原先只在项目清单变化时跑，拉取成功后 ⬇ 角标会一直停在旧数字（用户实报）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historyKey, props.remoteCheckTick]);
  // 点 ⬇ 就地更新该项目（**后台任务**——与推送/检出/更新同套）：飞行线从 ⬇ 按钮起飞，
  // 沙漏 / 任务面板可取消；完成/失败走统一通知（气泡 + 铃铛）。busy 态（⏳）由任务查询得出
  const tasks = useTasks();
  const pullProject = (path: string, from?: { x: number; y: number }) => {
    // 该项目已有拉取在跑：忽略（⬇ 按钮已显示 ⏳）
    if (tasks.some((tk) => tk.kind === `pull:${path}` && tk.status === 'running')) return;
    if (from) launchMagicFlight(from);
    startTask({
      kind: `pull:${path}`,
      // 标题：项目名 · 分支 · 拉取（分支取探测值；未探测到就省略——同检出标题的拼接先例）
      title: `${baseName(path)}${probes[path]?.branch ? ` · ${probes[path]!.branch}` : ''} · ${t('shell.tasks.pullAction')}`,
      run: async (signal) => {
        const r = await post.pullAny(path, signal);
        if (r.ok) {
          setRemoteBehinds((p) => ({ ...p, [path]: { behind: 0 } }));
          // 刚拉完：重探该项目状态（↑● 角标立刻准——force 绕过后端缓存）。
          // 它可能不是当前打开的项目，refreshTick（顶栏刷新）覆盖不到，单独重探
          get
            .projectStatus(path, true)
            .then((st) => setProbes((p) => ({ ...p, [path]: st })))
            .catch(() => {});
          // 拉的正好是当前项目：工作副本已变——顺带刷新主界面（文件列表/顶栏角标，否则还是旧数据）
          if (path === props.currentRoot) props.onRefresh?.();
        }
        // 与「手动进该项目右键更新」对齐（用户定稿）：svn 警告拼进通知消息（列表里看得见 ⚠），
        // 完整结果（文件清单/警告）装进通知详情 → 点通知弹**同一个「更新结果」窗**（不再是全文小窗）
        const base = r.message ?? t('shell.recent.pullTip');
        const msg = r.warnings?.length ? `${base}\n⚠ ${r.warnings.join('\n⚠ ')}` : base;
        const detail = { kind: 'update' as const, dir: '', ok: r.ok, message: base, files: r.files, warnings: r.warnings };
        return { ok: r.ok, message: msg, data: detail };
      },
    });
  };
  useEffect(() => {
    let alive = true;
    // 全部项目都探测（本地探测 + 后端 30 秒缓存 + 异步逐个回来）。原先只探前 10 项，
    // 超出的项目没有状态徽标——列表能滚之后那就是另一种"藏信息"（与紧凑模式一并去掉）
    // **当前项目强制绕过缓存**（force）：它是我"现在在用"的，刚提交/刷新后角标必须立刻准；
    // 其余项目走缓存（挡侧边栏成批请求的重复探测）
    for (const h of props.history) {
      get
        .projectStatus(h.path, h.path === props.currentRoot)
        .then((r) => {
          if (alive) setProbes((p) => ({ ...p, [h.path]: r }));
        })
        .catch(() => {
          if (alive) setProbes((p) => ({ ...p, [h.path]: { error: 'unavailable' } }));
        });
    }
    return () => {
      alive = false;
    };
    // currentRoot 变化（切了项目）→ 重查一遍（被切换项目的状态一定变了）；
    // refreshTick（顶栏刷新）→ 重跑一轮（当前项目 force——刚提交后角标立刻准）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historyKey, props.currentRoot, props.refreshTick]);

  /** 侧栏宽度：右边缘拖拽调整，localStorage 持久化；双击手柄恢复默认（项目路径长时可拉宽看全） */
  const [barWidth, setBarWidth] = useState(() => {
    const saved = Number(localStorage.getItem(SIDEBAR_W_KEY));
    return Number.isFinite(saved) && saved >= SIDEBAR_W_MIN && saved <= SIDEBAR_W_MAX ? saved : SIDEBAR_W_DEFAULT;
  });
  /** 最新宽度（mouseup 落盘用）——事件闭包拿不到最新 state，走 ref */
  const barWidthRef = useRef(barWidth);
  /** 统一的分隔条拖拽光标：所有可调整尺寸的分隔条共用 */
  const { ghostRef, start: startResizeCursor, move: moveResizeCursor, stop: stopResizeCursor } = useResizeCursor();
  /** 拖拽右边缘：左右移动调宽。拖动期间隐藏系统光标、由应用内图标跟随 */
  const onBarResizeDown = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const start = { x: e.clientX, w: barWidthRef.current };
    startResizeCursor(e.clientX, e.clientY);
    const onMove = (ev: MouseEvent) => {
      moveResizeCursor(ev.clientX, ev.clientY);
      // 上限取 min(400, 40% 视口)：小窗口下别把内容区挤没
      const max = Math.min(SIDEBAR_W_MAX, Math.round(window.innerWidth * 0.4));
      const w = Math.min(max, Math.max(SIDEBAR_W_MIN, start.w + (ev.clientX - start.x)));
      barWidthRef.current = w;
      setBarWidth(w);
    };
    const onUp = () => {
      stopResizeCursor();
      localStorage.setItem(SIDEBAR_W_KEY, String(barWidthRef.current));
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };
  /** 双击手柄：恢复默认宽度 */
  const resetBarWidth = () => {
    barWidthRef.current = SIDEBAR_W_DEFAULT;
    setBarWidth(SIDEBAR_W_DEFAULT);
    localStorage.setItem(SIDEBAR_W_KEY, String(SIDEBAR_W_DEFAULT));
  };

  const NAV = [
    // 历史
    { key: 'log' as View, label: t('shell.nav.history'), icon: <IconClock size={16} /> },
    // 差异入口隐藏：提交弹窗双击文件/冲突界面仍可进入差异视图
    // { key: 'diff' as View, label: '差异', icon: <IconDiff size={16} /> },
    // 文件夹
    { key: 'browse' as View, label: t('shell.nav.files'), icon: <IconFolder size={16} /> },
  ];

  return (
    <div className="sidebar" style={{ width: barWidth, display: props.view === 'diff' ? 'none' : undefined }}>
      <ResizeCursor ghostRef={ghostRef} />
      {/* 右边缘拖拽手柄：左右拖调整侧栏宽度（双击恢复默认），与文件搜索框手柄同款交互 */}
      <span className="sidebar-resize" onMouseDown={onBarResizeDown} onDoubleClick={resetBarWidth} title={t('shell.sidebarResize')} />
      {NAV.map((n) => (
        <div
          key={n.key}
          className={`item ${props.view === n.key ? 'active' : ''}`}
          onClick={() => props.onNav(n.key)}
        >
          <span style={{ display: 'flex', width: 20, justifyContent: 'center' }}>{n.icon}</span>
          <span>{n.label}</span>
        </div>
      ))}
      <div style={{ flex: 1 }} />
      {/* 外观区：前 5 套主题为快捷圆点，其余全部在「…」气泡里（含自定义配色/我的主题） */}
      <div className="row small dim nowrap" style={{ gap: 5, padding: '2px 20px 4px' }}>
        {/* map 参数名用 th：本文件 import 了 i18n 的 t()，同名会遮蔽 */}
        {THEMES.slice(0, THEME_PINNED).map((th) => (
          <button
            key={th.key}
            className={`theme-btn ${props.theme === th.key ? 'active' : ''}`}
            title={t(th.nameKey)}
            style={{ background: th.color, width: 18, height: 18 }}
            onClick={() => props.setTheme(th.key)}
          />
        ))}
        <Tooltip content={t('shell.theme.more')}>
          <button
            className={`theme-more ${props.themePopOpen ? 'active' : ''}`}
            // 更多主题 · 自定义配色
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              props.onOpenThemePop(r.left, r.bottom + 6);
            }}
          >
            ⋯
          </button>
        </Tooltip>
      </div>
      {/* 最近项目：底部区域（版本号上方） */}
      {props.history.length > 0 && (
        <>
          {/* 最近项目：标题右侧的眼睛 = 状态行显隐开关（关掉后列表更干净；悬浮明细仍在） */}
          <div className="sidebar-title">
            <span>{t('shell.recent.title')}</span>
            {/* 睁眼（绿）= 状态信息显示中；闭眼（灰）= 已关闭（用户定稿：不用斜杠版、也不靠淡化） */}
            <button
              className="recent-status-eye"
              // 隐藏状态信息 / 显示状态信息
              title={t(showStatus ? 'shell.recent.hideStatus' : 'shell.recent.showStatus')}
              aria-label={t(showStatus ? 'shell.recent.hideStatus' : 'shell.recent.showStatus')}
              aria-pressed={showStatus}
              onClick={toggleStatus}
            >
              {showStatus ? <IconEye size={14} /> : <IconEyeClosed size={14} />}
            </button>
          </div>
          {/* 列表在可用高度内自己滚动（用户定稿：项目多时滚列表，不裁进「…」、
              也不把整个侧边栏/页面撑出滚动条）；NAV / 主题 / 标题 / 打开按钮都固定不动 */}
          <div className="history-list">
            {ordered.map((h) => {
              const invalidMsg = props.invalidPaths[h.path];
              const invalid = Boolean(invalidMsg);
              // 展示用状态：当前项目的 behind 与"远程实时检查"（remoteHint）取大——
              // SVN 项目本地探测恒 0，靠这里把顶部条那 2 个新提交补进侧边栏
              const probe = probes[h.path];
              const rb = remoteBehinds[h.path];
              // behind 三源取大：本地记录（probe）· 远程检查（remoteProbe，覆盖任意项目——SVN 靠它）
              // · 当前项目顶部条同源（remoteHint，2 分钟巡检）
              const stView: ProjectProbe | undefined = probe
                ? {
                    ...probe,
                    behind: Math.max(probe.behind ?? 0, rb?.behind ?? 0, h.path === props.currentRoot ? (props.remoteBehind ?? 0) : 0),
                  }
                : undefined;
              // 实时措辞：顶部条或刚远程检查过的项目 = "远程检查"；其余本地的标"基于上次获取"
              const behindLive = (h.path === props.currentRoot && (props.remoteBehind ?? 0) > 0) || (rb?.behind ?? 0) > 0;
              return (
                <div
                  key={h.path}
                  data-path={h.path}
                  className={`history-item ${h.path === props.currentRoot ? 'active' : ''}${invalid ? ' invalid' : ''}`}
                  title={
                    invalidMsg
                      // {path}（打不开，目录已删除或不是工作副本）
                      ? t('shell.recent.invalid', { path: h.path })
                      // 备注：{remark} / （当前操作的项目） / （常用项目） / 点击打开 · 右键设常用/备注/删除
                      : `${h.path}${h.remark ? `\n${t('shell.recent.tipRemark', { remark: h.remark })}` : ''}${h.path === props.currentRoot ? `\n${t('shell.recent.tipCurrent')}` : ''}${h.fav ? `\n${t('shell.recent.tipFav')}` : ''}${stView ? `\n${probeTip(stView, behindLive, Boolean(rb?.failed))}` : ''}\n${t('shell.recent.tipClick')}`
                  }
                  onClick={() => props.onOpenHistory(h)}
                  onMouseEnter={() => {
                    if (invalidMsg) props.onShowTip(invalidMsg); // 悬浮失效项：提示和点击后完全一致
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setRmMenu({ x: e.clientX, y: e.clientY, path: h.path, fav: Boolean(h.fav), remark: h.remark ?? '', type: h.type });
                  }}
                >
                  <span className={`badge ${h.type}`} style={{ fontSize: 9, padding: '0 5px' }}>
                    {h.type.toUpperCase()}
                  </span>
                  {/* 两行式：第一行=名字（徽标与星号之间），第二行=备注+时间。
                      第二行改由 flex-basis:100% 换行、**占满整行**（含徽标下方那块）——原先它缩进在
                      名字下方，徽标底下那 30 多 px 白空着；160px 的侧边栏里这是很大一块
                      （用户实报「左边那么多空位」，备注"git仓库"因此被压成 "g…"） */}
                  <span className="history-path">{baseName(h.path)}</span>
                  {/* 常用项目（启动时优先打开） */}
                  {h.fav && (
                    <Tooltip content={t('shell.recent.favStar')}>
                      <span className="fav-star">★</span>
                    </Tooltip>
                  )}
                  {/* 点开过但打不开：常驻 × 直接移除（不必再右键或悬浮）。
                      必须排在第二行**之前**——第二行 flex-basis:100% 会换行，× 写在它后面会被挤到第二行 */}
                  {invalid && (
                    <Tooltip content={t('shell.recent.removeInvalid')}>
                      <button
                        className="history-remove"
                        // 移除 {path}
                        aria-label={t('shell.recent.removeAria', { path: h.path })}
                        onClick={(e) => {
                          e.stopPropagation();
                          props.onRemoveHistory(h.path);
                        }}
                      >
                        ×
                      </button>
                    </Tooltip>
                  )}
                  {/* 仪表盘状态行（名字行与备注行之间）：只显示"有事"的项目（有 ⬆/●/⚠ 任一才出行——
                      用户定稿：干净项目整行隐藏，分支/未跟踪等细节都在悬浮明细里）。
                      异步查得，回来前不占位（不做"…"占位——会先撑高列表再缩回，反而跳） */}
                  {showStatus && stView && probeHasSignal(stView) && (
                    <span className="history-status">
                      {probeBadges(stView, { busy: tasks.some((tk) => tk.kind === `pull:${h.path}` && tk.status === 'running'), onClick: (rect) => pullProject(h.path, rect) })}
                    </span>
                  )}
                  {/* 第二行 = 备注 + 时间（**始终显示**，项目多时列表内部滚动）。时间 flex:0 0 auto
                      钉死不被压缩，备注吃掉剩余宽度、超长截断成「…」——所以备注写多长都挤不掉时间
                      （用户要求"保证时间正常显示"），全文靠悬浮看 */}
                  <span className="history-time">
                    {h.remark && <span className="history-remark">{h.remark}</span>}
                    <span className="history-time-text">{relTime(h.lastOpened)}</span>
                  </span>
                </div>
              );
            })}
            {/* 超出部分靠列表滚动查看（用户定稿：不再折叠成「…」行） */}
            {/* 右键菜单：设为常用 / 删除 / 取消 */}
            {rmMenu && (
              <ContextMenu
                x={rmMenu.x}
                y={rmMenu.y}
                mask
                onClose={() => setRmMenu(null)}
                items={
                  // 失效项（已打不开）：只留「删除」——设为常用没意义，"取消"项也多余（点外面即可关）
                  props.invalidPaths[rmMenu.path]
                    // 删除
                    ? [{ icon: '🗑', label: t('common.delete'), danger: true, action: () => props.onRemoveHistory(rmMenu.path) }]
                    : [
                        {
                          icon: rmMenu.fav ? '★' : '☆',
                          // 取消常用 / 设为常用
                          label: rmMenu.fav ? t('shell.recent.unsetFav') : t('shell.recent.setFav'),
                          action: () => props.onSetFav(rmMenu.path, !rmMenu.fav),
                        },
                        {
                          // 铅笔用项目里的 SVG（IconRename），不引 emoji——没装彩色 emoji 字体的桌面会渲染成单色
                          icon: <IconRename size={14} />,
                          // 编辑备注 / 备注
                          label: rmMenu.remark ? t('shell.recent.editRemark') : t('shell.recent.remark'),
                          action: () => {
                            // 先收菜单再开弹窗：两者都带全屏遮罩，叠在一起点哪儿都像没反应
                            setRmMenu(null);
                            setRemarkFor({
                              path: rmMenu.path,
                              name: baseName(rmMenu.path),
                              current: rmMenu.remark,
                            });
                          },
                        },
                        // 工作树管理（仅当前 Git 项目：worktree 命令作用于当前仓库）
                        ...(rmMenu.path === props.currentRoot && rmMenu.type === 'git' && props.onManageWorktrees
                          ? [
                              {
                                icon: '🌿',
                                label: t('repo.worktree.title'),
                                action: () => {
                                  setRmMenu(null);
                                  props.onManageWorktrees?.();
                                },
                              },
                            ]
                          : []),
                        // 浏览仓库（仅 SVN：SVN 有"仓库地址"可直连浏览；git 没有等价语义——要 clone 才看得到）
                        ...(rmMenu.type === 'svn'
                          ? [
                              {
                                icon: <IconServer size={14} />,
                                // 浏览仓库（说明放悬浮：菜单里四个字清爽）
                                label: t('repo.browse.entry'),
                                title: t('repo.browse.entryTip'),
                                action: () => {
                                  setRmMenu(null);
                                  props.onBrowseRepo(rmMenu.path);
                                },
                              },
                            ]
                          : []),
                        // 删除
                        { icon: '🗑', label: t('common.delete'), danger: true, action: () => props.onRemoveHistory(rmMenu.path) },
                        // 取消
                        { icon: '✕', label: t('common.cancel') },
                      ]
                }
              />
            )}
            {/* 备注弹窗（右键「备注」）：确认后写回后端，useProjectHistory 拿新列表刷新 */}
            {remarkFor && (
              <RemarkModal
                projectName={remarkFor.name}
                current={remarkFor.current}
                onCancel={() => setRemarkFor(null)}
                onConfirm={(remark) => {
                  props.onSetRemark(remarkFor.path, remark);
                  setRemarkFor(null);
                }}
              />
            )}
          </div>
        </>
      )}
      {/* 打开项目 / 创建练习仓库：常驻在最近项目下方（没有历史记录时更要有这个入口） */}
      <div className="row" style={{ gap: 6, margin: '6px 10px 0 20px' }}>
        {/* 打开其它项目（选择目录） */}
        <Tooltip content={t('shell.recent.openOther')}>
          <button className="history-open" style={{ flex: 1, minWidth: 0, margin: 0 }} onClick={props.onOpenProject}>
            {/* ＋ 打开项目 */}
            {t('shell.recent.open')}
          </button>
        </Tooltip>
        {/* 创建练习仓库（不影响当前项目） */}
        <Tooltip content={t('repo.practice.entryTip')}>
          <button className="history-open" style={{ flexShrink: 0, margin: 0 }} onClick={props.onOpenPractice}>
            {/* 🧪 练习 */}
            {t('repo.practice.entryShort')}
          </button>
        </Tooltip>
      </div>
    </div>
  );
}
