/** 顶部工具栏：仓库信息 + 版本管理操作（可定制：拖拽重排 / 拖入拖出 ⋯ 菜单，localStorage 持久化）+ 主题/字号 + 打开项目/登录/退出。
 *  实现按职责拆分在 header/ 下：主题清单 themes.ts、网络灯 net-light、身份徽标 github-identity-badge、
 *  可定制项注册表 toolbar-tools、布局拖拽 use-toolbar-layout、任务/通知面板各自独立。 */
import React, { useEffect, useRef, useState } from 'react';
import { get, post, type RepoInfo } from '../../shared/api.js';
import { useTasks, cancelTask } from '../../shared/tasks.js';
import { useNotices } from '../../shared/notices.js';
import { TaskDetailModal } from '../task-detail.js';
import { CancelCheckoutConfirm } from '../../repo/checkout-task.js';
import { AboutModal } from '../about.js';
import { ContextMenu } from '../../ui/context-menu.js';
import { Tooltip } from '../../ui/tooltip.js';
import { parseGithub } from '../../../shared/github.js';
import { type Modal } from '../modal-types.js';
import { type View } from '../sidebar.js';
import { useLang } from '../../shared/use-lang.js';
import { t, LANGS } from '../../../shared/i18n/index.js';
import { IconServer, IconGitHub, IconHourglassRun, IconBell, IconFolder, IconOk, IconErr, IconGlobe, IconShare, IconInfo } from '../../ui/icons.js';
import { GithubIdentityBadge } from './github-identity-badge.js';
import { NetLight } from './net-light.js';
import { TaskPopover } from './task-popover.js';
import { NoticePopover } from './notice-popover.js';
import { ToolBtn, TOOLS, isSepItem, newSepId, type ToolCtx } from './toolbar-tools.js';
import { useToolbarLayout } from './use-toolbar-layout.js';
import { useShareStatus } from '../../share/share-context.js';

export function AppHeader(props: {
  view: View;
  repo: RepoInfo | null;
  conflictCount: number;
  configUser: string;
  /** git 凭据里的 GitHub 用户名（Fork 菜单可见性判断用） */
  gitUser?: string;
  onRefresh: () => void;
  setModal: (m: Modal) => void;
  onToast: (m: string, err?: boolean) => void;
  /** 推送（含进度窗口与认证引导） */
  onPush: () => void;
  /** 更新/拉取（git=pull, svn=update；后台任务——任务面板可取消，完成走铃铛气泡通知） */
  onUpdate: () => void;
  /** 未推送提交数（git；null=未知/svn 不显示角标） */
  unpushedCount?: number | null;
  /** 顶栏「浏览仓库」快捷入口（仅 SVN 项目；点击 = 打开当前项目的仓库浏览器，与右键菜单同一功能） */
  onBrowseRepo?: () => void;
  /** stash 条数（角标；git 仓库有效，未加载/异常为 null 不显示） */
  stashCount?: number | null;
  /** 工作区是否有可 stash 的改动（无改动时 Stash 按钮置灰） */
  canStash?: boolean;
}) {
  const repo = props.repo;
  /** 界面语言：切换即整树重渲染（订阅见 shared/use-lang.ts） */
  const { lang, changeLang } = useLang();
  // 「⋯」更多菜单（低频操作 + 工具栏定制）定位
  const [moreMenu, setMoreMenu] = useState<{ x: number; y: number } | null>(null);

  // 工具栏布局与拖拽定制（布局条目来自 toolbar-tools 的 TOOLS）
  const { layout, resetLayout, dragKey, dragPos, dropBefore, dropMenuBefore, moreDrop, beginDrag } =
    useToolbarLayout(() => setMoreMenu(null));

  // 系统应用菜单集成状态（AppImage 方式下有「安装/卸载」入口；源码/浏览器运行不显示）
  const [appMenuState, setAppMenuState] = useState<{ appImage: boolean; installed: boolean }>({ appImage: false, installed: false });
  /** 共享访问状态：远程只读/可写标记；本机才请求系统菜单等本机专属能力 */
  const share = useShareStatus();
  const shareLocal = share?.local ?? true;
  // 关于弹窗（版本 + 构建日期 + 构建提交；打开时拉取 /api/info）
  const [aboutOpen, setAboutOpen] = useState(false);
  const [aboutInfo, setAboutInfo] = useState<{ version: string; buildDate: string; commit: string; dirty: boolean }>({
    version: '',
    buildDate: '',
    commit: '',
    dirty: false,
  });
  const openAbout = () => {
    setMoreMenu(null);
    setAboutInfo({ version: '', buildDate: '', commit: '', dirty: false });
    void get
      .info()
      .then((r) => setAboutInfo({ version: r.version ?? '', buildDate: r.buildDate ?? '', commit: r.commit ?? '', dirty: r.dirty === true }))
      .catch(() => {});
    setAboutOpen(true);
  };
  useEffect(() => {
    // 系统应用菜单只在本机有意义；远程请求会被门禁 403
    if (!shareLocal) return;
    get
      .appMenu()
      .then((r) => setAppMenuState({ appImage: r.appImage, installed: r.installed }))
      .catch(() => {});
  }, [shareLocal]);
  // 后台任务：指示器 + 面板（进行中列表 + 取消；完成结果归铃铛——见下方 notices）
  const bgTasks = useTasks();
  const runningCount = bgTasks.filter((tk) => tk.status === 'running').length;
  const [taskPop, setTaskPop] = useState<{ x: number; y: number } | null>(null);
  /** 打开中的任务详情弹窗（点任务面板条目；面板先关再去开它） */
  const [taskDetailId, setTaskDetailId] = useState<number | null>(null);
  /** 待确认取消的检出任务（半截目录会被清理——面板先关，确认窗由本层渲染） */
  const [cancelConfirmId, setCancelConfirmId] = useState<number | null>(null);
  const taskBtnRef = useRef<HTMLButtonElement | null>(null);
  const openTaskPop = () => {
    const r = taskBtnRef.current?.getBoundingClientRect();
    if (r) setTaskPop({ x: r.right, y: r.bottom + 6 });
  };
  // 任务通知：铃铛（有通知才存在）+ 未读红点 + 到货轻摆一下
  const notices = useNotices();
  const unreadCount = notices.filter((n) => !n.read).length;
  const [noticePop, setNoticePop] = useState<{ x: number; y: number } | null>(null);
  const bellBtnRef = useRef<HTMLButtonElement | null>(null);
  const openNoticePop = () => {
    const r = bellBtnRef.current?.getBoundingClientRect();
    if (r) setNoticePop({ x: r.right, y: r.bottom + 6 });
    // 气泡（z 450）与面板同位重叠、会挡住面板顶部几行的点击——开面板即收气泡
    setBubble(null);
  };
  // 通知到货：铃铛轻摆 + 铃铛正下方弹出小气泡（约 3.5 秒；无人点击播放"收回"动画消失——
  // 内容在铃铛里已留档；点击气泡 = 打开通知面板）。连续到达时后一条顶替前一条并重新计时
  const [bellBounce, setBellBounce] = useState(false);
  const [bubbleOut, setBubbleOut] = useState(false);
  const [bubble, setBubble] = useState<{ id: number; title: string; message: string; err: boolean; x: number; y: number } | null>(null);
  const lastNoticeIdRef = useRef(0);
  useEffect(() => {
    const latest = notices[0];
    // **id 单调递增**：只认"比上次弹过的更大"的 id 才算新通知。
    // 不能用 "!= 上次的 id" —— 删掉头部通知后，列表新头是旧通知（id 更小），
    // 会被误判为"新到货"再弹一次气泡（用户实报：多条时点 × 会弹一条消息出来）
    if (!latest || latest.id <= lastNoticeIdRef.current) return;
    lastNoticeIdRef.current = latest.id;
    setBellBounce(true);
    const hb = window.setTimeout(() => setBellBounce(false), 700);
    // 气泡锚定铃铛（本帧铃铛随 notices 一起渲染，ref 已就绪；取不到就兜到右上角）
    const r = bellBtnRef.current?.getBoundingClientRect();
    setBubbleOut(false);
    setBubble({
      id: latest.id,
      title: latest.title,
      message: latest.message,
      err: latest.err,
      x: r?.right ?? window.innerWidth - 24,
      y: (r?.bottom ?? 44) + 6,
    });
    // 无人点击 → 进"收回"动画（动画结束由 onAnimationEnd 移除）
    const hOut = window.setTimeout(() => setBubbleOut(true), 3500);
    return () => {
      window.clearTimeout(hb);
      window.clearTimeout(hOut);
    };
  }, [notices]);

  /** 退出确认：先智能收集当前状态（未提交修改/未跟踪文件/未推送提交），在确认框里如实提示；
   *  查询失败不阻塞退出（仅少展示提示）——改动都在磁盘，退出不丢数据，提示是"别忘了提交/推送" */
  const exitConfirm = async () => {
    let changed = 0;
    let untracked = 0;
    let unpushed = 0;
    try {
      const [st, lg] = await Promise.all([
        get.status(),
        props.repo?.type === 'git' ? get.log(undefined, 1) : Promise.resolve(null),
      ]);
      const items = st.items ?? [];
      changed = items.filter((i) => i.code && i.code !== ' ' && i.code !== 'I' && i.code !== 'X').length;
      untracked = items.filter((i) => i.code === '?').length;
      unpushed = lg?.unpushed?.length ?? 0;
    } catch {
      /* 忽略：查询失败按 0 提示 */
    }
    // 将关闭本地服务并退出应用（页面将无法访问）。
    const lines: string[] = [t('shell.exit.lead')];
    const warns: string[] = [];
    // {n} 个未提交的修改 / （含 {n} 个未跟踪）
    if (changed > 0) warns.push(`${t('shell.exit.changed', { n: changed })}${untracked > 0 ? t('shell.exit.changedUntracked', { n: untracked }) : ''}`);
    // {n} 个提交未推送到远程
    if (unpushed > 0) warns.push(t('shell.exit.unpushed', { n: unpushed }));
    // \n⚠ 当前有 {list}。 / 、
    if (warns.length > 0) lines.push(t('shell.exit.warnLine', { list: warns.join(t('shell.listSep')) }));
    // 确认退出应用？
    lines.push(t('shell.exit.confirmQ'));
    props.setModal({
      type: 'confirm',
      // 退出应用
      title: t('shell.exit.title'),
      message: lines.join(''),
      // 退出应用
      confirmLabel: t('shell.exit.btn'),
      danger: true,
      action: () => {
        void post
          .shutdown()
          .then(() => {
            // 先替换为提示页，再尝试关闭标签：关闭成功则页面瞬间消失；被浏览器拦截则提示页已就位
            document.body.innerHTML =
              '<div style="display:flex;align-items:center;justify-content:center;height:100vh;flex-direction:column;gap:10px;font-family:sans-serif;background:#0d1117;color:#e6edf3">' +
              // ✅ 服务已退出
              '<div style="font-size:20px">' + t('shell.exit.pageDone') + '</div>' +
              // 本地服务已关闭，此页面已无法使用，请手动关闭本标签页
              '<div style="color:#8b949e">' + t('shell.exit.pageHint') + '</div>' +
              '</div>';
            window.close();
          })
          // 退出失败: {msg}
          .catch((e: Error) => props.onToast(t('shell.exit.fail', { msg: e.message }), true));
      },
    });
  };

  // 当前仓库类型下实际渲染的按钮定义
  const ctx: ToolCtx = {
    repoRoot: repo?.root ?? null,
    repoType: repo?.type ?? null,
    repoUrl: repo?.url ?? null,
    conflictCount: props.conflictCount,
    unpushedCount: props.unpushedCount,
    stashCount: props.stashCount,
    canStash: props.canStash,
    configUser: props.configUser,
    gitUser: props.gitUser,
    onRefresh: props.onRefresh,
    setModal: props.setModal,
    onToast: props.onToast,
    onPush: props.onPush,
    onUpdate: props.onUpdate,
    onExit: () => void exitConfirm(),
  };
  const defs = TOOLS.filter((d) => d.visible?.(ctx) ?? true);
  /** tool 序列（含分隔符；过滤：按钮需可见 defs 且非 exit——exit 单独固定在末尾）
   *  未进入仓库时不渲染任何按钮与分隔符（分隔符是给按钮分组用的，无按钮无意义） */
  const shownList = ctx.repoType
    ? layout.shown.filter((k) => isSepItem(k) || (defs.some((d) => d.key === k) && k !== 'exit'))
    : [];
  const shownKeys = layout.shown.filter((k) => defs.some((d) => d.key === k));
  const hiddenSet = new Set(layout.hidden);
  const menuKeys = [
    ...layout.hidden.filter((k) => defs.some((d) => d.key === k) && k !== 'exit'),
    ...defs.map((d) => d.key).filter((k) => !shownKeys.includes(k) && !hiddenSet.has(k) && k !== 'exit'),
  ];
  const defOf = (k: string) => TOOLS.find((d) => d.key === k);

  /** 我的 GitHub 仓库图标可见性：origin 指向 github.com 的 git 项目（与 TOOLS 的判定同源） */
  const githubRepo = parseGithub(repo?.url ?? '');

  return (
    <div className="header" style={{ display: props.view === 'diff' ? 'none' : undefined }}>
      {/* svn-git 文件版本管理 */}
      <Tooltip content={t('shell.appName')}>
        <span className="logo" style={{ display: 'flex', alignItems: 'center' }}>
          <img src="/icon.png" width="26" height="26" alt="logo" style={{ borderRadius: 6 }} />
        </span>
      </Tooltip>
      {repo?.type ? <span className={`badge ${repo.type}`}>{repo.type.toUpperCase()}</span> : null}
      {/* 未选择仓库 */}
      <span className="path">{repo?.root ?? t('shell.header.noRepo')}</span>
      {repo?.url ? <span className="dim small nowrap">{repo.url}</span> : null}
      {repo?.revOrBranch ? <span className="dim small nowrap">[{repo.revOrBranch}]</span> : null}
      {repo?.url ? <NetLight hostCheckKey={repo.url + repo.revOrBranch} /> : null}
      {/* GitHub 身份徽标（origin 指向 github.com 且配了凭据、查到身份时才出现）：
          自己的仓库 / 协作者 / 只读 / 无法访问；点击打开「GitHub 仓库信息」弹窗 */}
      <GithubIdentityBadge repo={repo} onOpen={() => props.setModal({ type: 'github-repo' })} />
      {/* 浏览仓库（仅 SVN）：点一下直接打开仓库浏览器（与最近项目右键「浏览仓库」同功能）；
          无边框纯图标按钮（用户定稿），悬浮出淡背景 */}
      {repo?.type === 'svn' && props.onBrowseRepo && (
        <Tooltip content={t('repo.browse.entryTip')}>
          <button className="header-icon-btn" onClick={props.onBrowseRepo}>
            <IconServer size={14} />
          </button>
        </Tooltip>
      )}
      {/* 我的 GitHub 仓库（仅 origin 指向 github.com 的 git 项目）：点一下打开仓库列表，选中即克隆。
          与 SVN 的「浏览仓库」图标同位同款式（入口对齐）；git 本身没有"直连浏览远程"的语义，
          这里给的是**我名下的仓库清单**——列表里再选定具体那个 */}
      {repo?.type === 'git' && githubRepo && (
        <Tooltip content={t('repo.githubMyRepos.entryTip')}>
          <button className="header-icon-btn" onClick={() => props.setModal({ type: 'github-my-repos' })}>
            <IconGitHub size={14} />
          </button>
        </Tooltip>
      )}
      {/* 后台任务指示器：**仅运行中显示**（后台没有任务时不存在——用户定稿）：流沙动画沙漏 + 数量。
          点击展开任务面板（进行中 + 取消）。data-task-anchor：魔法飞行线的落点锚
          （锚点随按钮生灭——magic-flight 启动时轮询等它出现） */}
      {runningCount > 0 && (
        <Tooltip content={t('shell.tasks.indicatorTip', { n: runningCount })}>
          <button
            ref={taskBtnRef}
            data-task-anchor
            className="header-icon-btn"
            onClick={() => (taskPop ? setTaskPop(null) : openTaskPop())}
          >
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
              <IconHourglassRun size={15} />
              <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--accent)' }}>{runningCount}</span>
            </span>
          </button>
        </Tooltip>
      )}
      {/* 任务通知铃铛：有通知才存在（全关掉即消失）；未读红点；点开面板（打开即已读） */}
      {notices.length > 0 && (
        <Tooltip content={t('shell.notify.tip')}>
          <button
            ref={bellBtnRef}
            data-notice-anchor="true"
            className={`header-icon-btn${bellBounce ? ' bell-bounce' : ''}`}
            onClick={() => (noticePop ? setNoticePop(null) : openNoticePop())}
          >
            <span style={{ position: 'relative', display: 'inline-flex' }}>
              <IconBell size={15} />
              {unreadCount > 0 && <span className="bell-dot" />}
            </span>
          </button>
        </Tooltip>
      )}
      <span className="spacer" />
      {/* 远程访问标记：局域网访问一律只读 */}
      {share && !share.local && (
        <span
          className="share-badge"
          title={share.readOnly ? t('share.readOnlyNote') : t('share.readWriteWarn')}
        >
          {share.readOnly ? t('share.readOnlyBadge') : t('share.sharedBadge')}
          {share.max > 0 ? ` · ${t('share.online', { n: share.viewers, max: share.max })}` : ''}
        </span>
      )}
      {/* 可定制工具栏按钮 + 可拖拽分隔符（顺序 = 用户布局 shown；退出应用固定末尾不在此区） */}
      <span
        data-tool-bar
        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0 }}
      >
        {shownList.map((item) => {
          const line = dragKey !== null && dropBefore === item ? <span className="tool-drop-line" /> : null;
          if (isSepItem(item)) {
            return (
              <React.Fragment key={item}>
                {line}
                <span
                  className="header-sep"
                  data-item-key={item}
                  // 按住拖动：移动分隔位置 / 拖到 ⋯ 删除
                  title={t('shell.toolbar.sepTitle')}
                  style={{ cursor: 'grab', opacity: dragKey === item ? 0.4 : undefined }}
                  onMouseDown={beginDrag(item)}
                />
              </React.Fragment>
            );
          }
          const d = defOf(item);
          if (!d) return null;
          const b = d.render(ctx);
          return (
            <React.Fragment key={item}>
              {line}
              <ToolBtn
                dndKey={item}
                itemKey={item}
                isDragging={dragKey === item}
                onMouseDown={beginDrag(item)}
                {...b}
              />
            </React.Fragment>
          );
        })}
        {dragKey !== null && dropBefore === null && <span className="tool-drop-line" />}
      </span>
      {/* 低频操作收进「⋯」菜单（可拖入/拖出；含恢复默认布局） */}
      <Tooltip content={t('shell.toolbar.moreTitle')}>
        <button
          className="mini tool-btn"
          style={moreDrop ? { boxShadow: '0 0 0 2px var(--accent) inset' } : undefined}
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            setMoreMenu({ x: Math.max(8, r.right - 180), y: r.bottom + 4 });
          }}
        >
          ⋯
        </button>
      </Tooltip>
      {moreMenu && (
        <ContextMenu
          x={moreMenu.x}
          y={moreMenu.y}
          mask
          onClose={() => setMoreMenu(null)}
          items={[
            ...menuKeys.map((k) => {
              const d = defOf(k);
              if (!d) return { sep: true } as const;
              const b = d.render(ctx);
              return {
                icon: b.icon,
                label: d.menuLabelKey ? t(d.menuLabelKey) : (typeof b.label === 'string' ? b.label : ''),
                title: b.title,
                dndKey: k,
                dropTop: dropMenuBefore === k,
                onMouseDown: beginDrag(k),
                action: () => {
                  setMoreMenu(null);
                  b.onClick();
                },
              } as const;
            }),
            // 局域网共享配置：仅本机显示（远程访问只读，且配置接口只允许本机调用）
            ...(shareLocal
              ? [{
                  icon: <IconShare size={14} />,
                  label: t('share.title'),
                  title: t('share.title'),
                  action: () => {
                    setMoreMenu(null);
                    props.setModal({ type: 'share' });
                  },
                }]
              : []),
            { sep: true } as const,
            // 系统应用菜单集成：固定项（分隔符上方，不参与拖拽定制；仅 AppImage 显示）
            ...(appMenuState.appImage
              ? [{
                  icon: <IconFolder />,
                  // 卸载系统应用菜单 / 安装到系统应用菜单…
                  label: appMenuState.installed ? t('shell.appMenu.uninstall') : t('shell.appMenu.install'),
                  title: appMenuState.installed
                    // 撤销集成：删除系统应用菜单里本工具条目（.desktop 与图标）
                    ? t('shell.appMenu.uninstallTitle')
                    // 生成系统应用菜单条目（.desktop + 图标），之后可从系统左上角菜单直接启动本工具（可卸载）
                    : t('shell.appMenu.installTitle'),
                  action: () => {
                    setMoreMenu(null);
                    void (appMenuState.installed ? post.appMenuUninstall() : post.appMenuInstall())
                      .then((r) => props.onToast(r.message, !r.ok))
                      .catch((e: Error) => props.onToast(e.message, true))
                      .finally(() => {
                        get.appMenu().then((r) => setAppMenuState({ appImage: r.appImage, installed: r.installed })).catch(() => {});
                      });
                  },
                }]
              : []),
            {
              icon: '|',
              // 分隔符
              label: t('shell.toolbar.sep'),
              // 按住拖到工具栏任意位置插入分隔线；已插入的分隔符也可拖动/拖到 ⋯ 删除
              title: t('shell.toolbar.sepInsertTitle'),
              onMouseDown: beginDrag(newSepId()),
              action: () => {
                setMoreMenu(null);
                // 按住「分隔符」拖到工具栏即可插入
                props.onToast(t('shell.toolbar.sepHint'));
              },
            },
            {
              icon: '↺',
              // 恢复默认布局
              label: t('shell.toolbar.reset'),
              // 重置工具栏布局（按钮重新按默认顺序显示）
              title: t('shell.toolbar.resetTitle'),
              action: () => {
                setMoreMenu(null);
                resetLayout();
                // 已恢复默认布局
                props.onToast(t('shell.toolbar.resetDone'));
              },
            },
            {
              icon: '🔍',
              // 环境检测
              label: t('shell.tool.envCheck'),
              // 查看 SVN / Git 的安装状态与版本；缺失时可一键安装
              title: t('shell.tool.envCheckTitle'),
              action: () => {
                setMoreMenu(null);
                props.setModal({ type: 'env' });
              },
            },
            {
              // 语言：固定项（与「关于」同为设置类，**不参与拖拽定制** —— 工具栏按钮语义是"点击即执行"，
              // 而语言是"展开选一个"，拖过去会变成语义怪异的按钮）
              icon: <IconGlobe />,
              // 语言
              label: t('lang.title'),
              // 切换界面语言（操作结果与报错消息一并切换）
              title: t('lang.hint'),
              noArrow: true, // 不显示右侧 ▶（用户要求）：展开选择是这一项的唯一用途，箭头多余
              submenu: LANGS.map((l) => ({
                icon: lang === l.key ? <IconOk /> : undefined,
                label: t(l.labelKey),
                action: () => changeLang(l.key),
              })),
            },
            {
              icon: <IconInfo />,
              // 关于
              label: t('shell.about.title'),
              // 版本号与构建日期
              title: t('shell.about.menuTitle'),
              action: openAbout,
            },
          ]}
        />
      )}
      {aboutOpen && (
        <AboutModal
          version={aboutInfo.version}
          buildDate={aboutInfo.buildDate}
          commit={aboutInfo.commit}
          dirty={aboutInfo.dirty}
          onClose={() => setAboutOpen(false)}
        />
      )}
      {/* 退出应用：固定在 ⋯ 左侧的最右位（不纳入拖拽定制，防误移/误隐藏） */}
      {shownKeys.includes('exit') &&
        (() => {
          const d = defOf('exit');
          if (!d) return null;
          const b = d.render(ctx);
          return <ToolBtn key="exit" {...b} />;
        })()}
      {/* 拖拽 ghost：跟随鼠标的半透明按钮预览 */}
      {dragKey && dragPos && (
        <span
          className="tool-drag-ghost"
          style={{ left: dragPos.x + 8, top: dragPos.y + 8 }}
        >
          {(() => {
            if (isSepItem(dragKey ?? '')) {
              return (
                <>
                  {/* 分隔符 */}
                  <span style={{ color: 'var(--accent)' }}>|</span> {t('shell.toolbar.sep')}
                </>
              );
            }
            const d = defOf(dragKey);
            const b = d?.render(ctx);
            return b ? (
              <>
                {b.icon} {b.label}
              </>
            ) : null;
          })()}
        </span>
      )}
      {/* 后台任务面板（贴指示器展开；fixed 定位，在 header 内渲染不影响布局） */}
      {taskPop && (
        <TaskPopover
          x={taskPop.x}
          y={taskPop.y}
          onClose={() => setTaskPop(null)}
          onOpenDetail={(id) => {
            setTaskPop(null);
            setTaskDetailId(id);
          }}
          onRequestCancel={(id) => {
            setTaskPop(null);
            setCancelConfirmId(id);
          }}
        />
      )}
      {/* 任务详情弹窗（点任务面板条目打开；面板先关——其层级 299/300 会压住 modal 的 100） */}
      {taskDetailId !== null && <TaskDetailModal taskId={taskDetailId} onClose={() => setTaskDetailId(null)} />}
      {/* 取消检出二次确认（从任务面板发起；面板已关——它层级更高会压住弹窗） */}
      {cancelConfirmId !== null && (
        <CancelCheckoutConfirm
          onKeep={() => setCancelConfirmId(null)}
          onCancel={() => {
            cancelTask(cancelConfirmId);
            setCancelConfirmId(null);
          }}
        />
      )}
      {/* 通知气泡（铃铛正下方弹出；无人点击 3.5s 播放"收回"动画——见上方 effect）：
          点击 = 打开通知面板（气泡本身不留档，内容在铃铛里） */}
      {bubble && (
        <div
          key={bubble.id}
          className={`notice-bubble${bubbleOut ? ' out' : ''}`}
          style={{ right: Math.max(8, window.innerWidth - bubble.x), top: bubble.y }}
          onClick={() => {
            setBubble(null);
            openNoticePop();
          }}
          onAnimationEnd={() => {
            if (bubbleOut) setBubble(null);
          }}
        >
          <span style={{ flexShrink: 0, display: 'inline-flex', marginTop: 2, color: bubble.err ? 'var(--err)' : 'var(--ok)' }}>
            {bubble.err ? <IconErr /> : <IconOk />}
          </span>
          <span style={{ flex: 1, minWidth: 0 }}>
            <div className="small" style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={bubble.title}>{bubble.title}</div>
            {bubble.message && (
              // 气泡消息同样**最多两行**（与通知列表一致——气泡高度稳定，细节点开看）
              <div
                className={bubble.err ? 'small' : 'dim small'}
                style={{
                  color: bubble.err ? 'var(--err)' : undefined,
                  marginTop: 1,
                  display: '-webkit-box',
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical',
                  overflow: 'hidden',
                  wordBreak: 'break-all',
                }}
              >
                {bubble.message}
              </div>
            )}
          </span>
        </div>
      )}
      {noticePop && <NoticePopover x={noticePop.x} y={noticePop.y} onClose={() => setNoticePop(null)} onOpenTaskDetail={(id) => { setNoticePop(null); setTaskDetailId(id); }} />}
    </div>
  );
}
