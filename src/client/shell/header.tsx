/** 顶部工具栏：仓库信息 + 版本管理操作（可定制：拖拽重排 / 拖入拖出 ⋯ 菜单，localStorage 持久化）+ 主题/字号 + 打开项目/登录/退出 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { get, post, type RepoInfo } from '../shared/api.js';
import { cmdOfRepo } from '../shared/cmd-preview.js';
import { IconBranch, IconGear, IconTag, IconStash, IconPlus, IconDownload, IconClean, IconFolder, IconRefresh, IconLogin, IconExit, IconCommit, IconFont, IconInfo, IconTerminal, IconGlobe, IconOk } from '../ui/icons.js';
import { type Modal } from './modal-types.js';
import { type View } from './sidebar.js';
import { ContextMenu } from '../ui/context-menu.js';
import { AboutModal } from './about.js';
import { useLang } from '../shared/use-lang.js';
import { t, LANGS, type I18nKey } from '../../shared/i18n/index.js';

/** 内置主题项（THEMES 的元素类型；theme-popover 的 chip 复用同一结构） */
export type ThemeDef = { key: string; nameKey: I18nKey; color: string; group: 'light' | 'dark' };

/** 内置主题清单。group 供主题气泡分组展示；color 是预览色块（取该主题的面板色）。
 *  前 5 套固定为侧边栏快捷圆点，其余全部在气泡里（见 sidebar.tsx 的 slice）。
 *  ⚠️ 存 `nameKey` 而非文案：模块顶层求值会冻在首次语言，渲染时才 t()（见 i18n/index.ts 头部说明）。 */
export const THEMES: ThemeDef[] = [
  // 浅色
  { key: 'light', nameKey: 'shell.theme.light', color: '#f6f8fa', group: 'light' },
  { key: 'warm', nameKey: 'shell.theme.warm', color: '#f3ede1', group: 'light' },
  { key: 'cool', nameKey: 'shell.theme.cool', color: '#e8eef5', group: 'light' },
  { key: 'lavender', nameKey: 'shell.theme.lavender', color: '#e8e2f7', group: 'light' },
  { key: 'mint', nameKey: 'shell.theme.mint', color: '#dcefe4', group: 'light' },
  { key: 'rose', nameKey: 'shell.theme.rose', color: '#f6e2e6', group: 'light' },
  { key: 'cream', nameKey: 'shell.theme.cream', color: '#f5edd8', group: 'light' },
  { key: 'sky', nameKey: 'shell.theme.sky', color: '#e1eefc', group: 'light' },
  { key: 'matcha', nameKey: 'shell.theme.matcha', color: '#e6efdc', group: 'light' },
  { key: 'lotus', nameKey: 'shell.theme.lotus', color: '#f9e4ea', group: 'light' },
  { key: 'mist', nameKey: 'shell.theme.mist', color: '#e8ecf0', group: 'light' },
  // 深色
  { key: 'night', nameKey: 'shell.theme.night', color: '#1f2228', group: 'dark' },
  { key: 'deepsea', nameKey: 'shell.theme.deepsea', color: '#161b22', group: 'dark' },
  { key: 'forest', nameKey: 'shell.theme.forest', color: '#17241d', group: 'dark' },
  { key: 'violet', nameKey: 'shell.theme.violet', color: '#231f33', group: 'dark' },
  { key: 'charcoal', nameKey: 'shell.theme.charcoal', color: '#25201b', group: 'dark' },
];

/** 侧边栏快捷圆点数量（其余主题在「…」气泡里选） */
export const THEME_PINNED = 5;

/** `/api/net-check`（server/routes/host.ts）返回"正常"时固定的 reason 文案。
 *  这是 tip 里**与返回值比较**用的跨层协议文本，不是界面文案 ——
 *  ⚠️ 若 srv 域将来翻译了 host.ts 的那条文案，这里的比较会失效（tip 会多余地显示 reason），需同步改。 */
/** 网络灯 tip：`reason` 只承载"有话说"的内容 —— 后端一切正常时返回空串（见 routes/host.ts），
 *  故这里判空即可。**不要改成比较某句固定文案**（那些文案会随界面语言变，比较必然失效）。 */

/**
 * 远程网络状态灯：30s 检测一次（get /api/net-check，只握手不取数据）。
 * 最近 3 次滑动窗口 → 全成功=绿、混合=黄（时通时断）、连续失败=红、未出结果=灰。
 * 认证失败=网络通的（绿，tooltip 说明）。点击圆点可立即手动检测。
 */
export function NetLight({ hostCheckKey }: { hostCheckKey?: string }) {
  const [lastResult, setLastResult] = useState<{ ok: boolean; reason: string; at: number } | null>(null);
  const [history, setHistory] = useState<boolean[]>([]);
  const [checking, setChecking] = useState(false);

  const check = useCallback(async () => {
    setChecking(true);
    try {
      const r = await get.netCheck();
      setLastResult({ ok: r.ok, reason: r.reason, at: Date.now() });
      setHistory((h) => [...h.slice(-2), r.ok]); // 滚动保留最近 3 次
    } catch {
      // 检测请求失败
      setLastResult({ ok: false, reason: t('shell.net.checkFailed'), at: Date.now() });
      setHistory((h) => [...h.slice(-2), false]);
    } finally {
      setChecking(false);
    }
  }, []);

  // 30s 周期 + 仓库变化时立即检测；页签隐藏暂停、切回补检
  useEffect(() => {
    void check();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void check();
    }, 30_000);
    const onVis = () => {
      if (document.visibilityState === 'visible') void check();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [check, hostCheckKey]);

  const h = history;
  const n = h.length;
  let color = 'var(--dim)'; // 灰:未出结果
  // 检测中…
  let label = t('shell.net.checking');
  if (n > 0) {
    const allOk = h.every(Boolean);
    // 远程网络正常
    if (allOk && n >= 2) { color = 'var(--ok)'; label = t('shell.net.ok'); }
    // 远程网络断开
    else if (!allOk && !h.some(Boolean)) { color = 'var(--err)'; label = t('shell.net.down'); }
    // 远程网络不稳定（近期检测有成功有失败）
    else { color = 'var(--warn)'; label = t('shell.net.unstable'); }
    // 远程网络正常
    if (h[0] === true && n === 1) { color = 'var(--ok)'; label = t('shell.net.ok'); } // 首检成功即绿
  }
  const tip = lastResult
    // 最近检测 {n} 秒前 / （{reason}） / 检测中… / 点击立即检测
    ? `${label} · ${t('shell.net.tipAgo', { n: Math.max(0, Math.round((Date.now() - lastResult.at) / 1000)) })}${lastResult.reason ? t('shell.net.tipReason', { reason: lastResult.reason }) : ''}${checking ? ` · ${t('shell.net.checking')}` : ''} · ${t('shell.net.tipClick')}`
    // 网络状态检测中…
    : t('shell.net.tipNoResult');
  return (
    <span
      className="dim small nowrap"
      style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}
      title={tip}
      onClick={() => void check()}
    >
      <span
        style={{
          width: 8, height: 8, borderRadius: '50%', background: color,
          boxShadow: color === 'var(--dim)' ? 'none' : `0 0 0 3px ${color}33`, display: 'inline-block',
        }}
      />
    </span>
  );
}

/** 顶部工具按钮（图标 + 文字，统一样式；mousedown 可启动拖拽定制） */
function ToolBtn(props: {
  icon: React.ReactNode;
  label: React.ReactNode;
  title?: string;
  onClick: () => void;
  disabled?: boolean;
  /** 危险操作：红色强调（防误触,如退出应用） */
  danger?: boolean;
  /** 命令预览：悬浮按钮时显示将执行的命令（title 追加） */
  cmd?: string;
  /** 拖拽定制：唯一键 + 拖拽状态 */
  dndKey?: string;
  /** 布局项唯一 id（插入线计算用） */
  itemKey?: string;
  onMouseDown?: (e: React.MouseEvent) => void;
  isDragging?: boolean;
  isDropBefore?: boolean;
}) {
  return (
    <button
      className="tool-btn"
      title={props.cmd ? `${props.title ?? ''}\n${props.cmd}` : props.title}
      data-tool-key={props.dndKey}
      data-item-key={props.itemKey}
      onMouseDown={props.onMouseDown}
      onClick={props.onClick}
      disabled={props.disabled}
      style={{
        ...(props.danger ? { color: 'var(--err)' } : undefined),
        ...(props.isDragging ? { opacity: 0.4 } : undefined),
        ...(props.isDropBefore ? { boxShadow: '0 0 0 2px var(--accent) inset' } : undefined),
      }}
    >
      {props.icon} {props.label}
    </button>
  );
}

// ==================== 工具栏定制：注册表 + localStorage ====================

const LAYOUT_KEY = 'svngit-toolbar';

/** shown 序列项：按钮 key 或分隔符唯一 id（'sep-N'，多个分隔符必须唯一——布局跨仓库类型共享）
 *  分隔符 id 前缀固定 'sep-'，按钮 key 均为纯字母 */
type ToolbarItem = string;
type ToolbarLayout = { shown: ToolbarItem[]; hidden: string[] };

/** 默认布局：工具栏按钮（可见时按此顺序渲染，sep=分隔符可拖拽调整），其余固定项默认收在 ⋯ 菜单 */
const DEFAULT_LAYOUT: ToolbarLayout = {
  shown: ['conflicts', 'pull', 'update', 'push', 'stash', 'sep-1', 'branch', 'sep-2', 'clean', 'refresh', 'sep-3', 'exit'],
  hidden: ['open', 'create', 'get', 'tags', 'terminal', 'font', 'git-info', 'login'], // terminal 紧跟 tags（用户要求）
};

/** 新分隔符唯一 id（Date.now 毫秒，工具内足够） */
function newSepId() {
  return `sep-${Date.now()}`;
}
const isSepItem = (k: string) => k.startsWith('sep-');

/** 按钮渲染所需的上下文（由 AppHeader 组装） */
type ToolCtx = {
  repoType: 'git' | 'svn' | null;
  conflictCount: number;
  unpushedCount?: number | null;
  stashCount?: number | null;
  canStash?: boolean;
  configUser: string;
  onRefresh: () => void;
  setModal: (m: Modal) => void;
  onToast: (m: string, err?: boolean) => void;
  onPush: () => void;
  onUpdate: () => void;
  onExit: () => void;
};

type ToolDef = {
  key: string;
  /** 默认区域：toolbar 或 menu（无用户配置时生效） */
  zone: 'toolbar' | 'menu';
  visible?: (c: ToolCtx) => boolean;
  /** 菜单里的纯文本标签 key（label 可能含计数等 JSX，拖入菜单时用此文本）；
   *  存 key 而非文案 —— 本表是模块级常量，渲染时才 t()（否则冻在首次语言） */
  menuLabelKey?: I18nKey;
  render: (c: ToolCtx) => {
    icon: React.ReactNode;
    label: React.ReactNode;
    title?: string;
    cmd?: string;
    onClick: () => void;
    disabled?: boolean;
    danger?: boolean;
  };
};

/** 全部可定制按钮/菜单项（顺序仅作默认展示参考，实际顺序由布局决定） */
const TOOLS: ToolDef[] = [
  {
    key: 'conflicts', zone: 'toolbar', menuLabelKey: 'shell.tool.conflicts',
    visible: (c) => c.conflictCount > 0,
    render: (c) => ({
      icon: <IconClean />,
      label: (
        <>
          {/* 解决冲突 */}
          {t('shell.tool.conflicts')} (<span style={{ color: 'var(--err)', fontWeight: 700 }}>{c.conflictCount}</span>)
        </>
      ),
      // 解决冲突文件
      title: t('shell.tool.conflictsTitle'),
      onClick: () => c.setModal({ type: 'conflicts' }),
    }),
  },
  {
    key: 'pull', zone: 'toolbar', visible: (c) => c.repoType === 'git',
    render: (c) => ({
      icon: <IconDownload />,
      // 拉取
      label: t('shell.tool.pull'),
      // 拉取远程更新（可取消）
      title: t('shell.tool.pullTitle'),
      cmd: 'git pull',
      onClick: c.onUpdate,
    }),
  },
  {
    key: 'update', zone: 'toolbar', visible: (c) => c.repoType === 'svn',
    render: (c) => ({
      icon: <IconDownload />,
      // 更新
      label: t('shell.tool.update'),
      // 更新工作副本（svn update，可取消）
      title: t('shell.tool.updateTitle'),
      cmd: 'svn update',
      onClick: c.onUpdate,
    }),
  },
  {
    key: 'push', zone: 'toolbar', menuLabelKey: 'shell.tool.push',
    visible: (c) => c.repoType === 'git',
    render: (c) => ({
      icon: <IconCommit />,
      label: c.unpushedCount != null ? (
        // 推送
        <>{t('shell.tool.push')}<span className={`push-count ${c.unpushedCount > 0 ? 'on' : ''}`}>{c.unpushedCount}</span></>
      // 推送
      ) : t('shell.tool.push'),
      title: c.unpushedCount != null && c.unpushedCount <= 0
        // 没有待推送的提交（未推送数为 0）
        ? t('shell.tool.pushNothing')
        // 推送 {n} 个未推送提交（含进度与认证引导）
        : t('shell.tool.pushTitle', { n: c.unpushedCount ?? 0 }),
      onClick: c.onPush,
      disabled: c.unpushedCount != null && c.unpushedCount <= 0,
      cmd: 'git push',
    }),
  },
  {
    key: 'stash', zone: 'toolbar', menuLabelKey: 'shell.tool.stash',
    visible: (c) => c.repoType === 'git',
    render: (c) => ({
      icon: <IconStash />,
      label: c.stashCount != null && c.stashCount > 0 ? (
        <>Stash<span className={`push-count ${c.stashCount > 0 ? 'on' : ''}`}>{c.stashCount}</span></>
      ) : 'Stash',
      title: c.canStash === false
        // 工作区没有改动可储藏（先修改文件，储藏才有东西可收）
        ? t('shell.tool.stashDisabled')
        : c.stashCount != null && c.stashCount > 0
          // Stash 储藏（{n} 条）
          ? t('shell.tool.stashTitleCount', { n: c.stashCount })
          // Stash 储藏
          : t('shell.tool.stashTitle'),
      onClick: () => c.setModal({ type: 'stash' }),
      disabled: c.canStash === false,
    }),
  },
  {
    key: 'branch', zone: 'toolbar',
    visible: (c) => !!c.repoType, // 未进入仓库时不显示
    render: (c) => ({
      icon: <IconBranch />,
      // 分支
      label: t('shell.tool.branch'),
      // 分支管理
      title: t('shell.tool.branchTitle'),
      onClick: () => c.setModal({ type: 'branches' }),
    }),
  },
  {
    key: 'clean', zone: 'toolbar',
    visible: (c) => !!c.repoType, // 未进入仓库时不显示
    render: (c) => c.repoType === 'svn'
      ? {
          icon: <IconClean />,
          // 清理
          label: t('shell.tool.clean'),
          // 清理工作副本的锁与中断残留（不删除任何文件）
          title: t('shell.tool.cleanSvnTitle'),
          cmd: 'svn cleanup',
          onClick: () =>
            c.setModal({
              type: 'confirm',
              title: 'svn cleanup',
              // 执行 svn cleanup（清理中断操作遗留的锁）？
              message: t('shell.tool.cleanConfirm'),
              // 执行
              confirmLabel: t('shell.tool.cleanConfirmBtn'),
              action: () => {
                void post
                  .svnExtra('cleanup')
                  .then((r) => c.onToast(r.message, !r.ok))
                  .catch((e: Error) => c.onToast((e as Error).message, true));
              },
            }),
        }
      : {
          icon: <IconClean />,
          // 清理
          label: t('shell.tool.clean'),
          // 清理未跟踪文件
          title: t('shell.tool.cleanGitTitle'),
          onClick: () => c.setModal({ type: 'clean' }),
        },
  },
  {
    key: 'refresh', zone: 'toolbar',
    visible: (c) => !!c.repoType, // 未进入仓库时不显示
    render: (c) => ({
      icon: <IconRefresh />,
      // 刷新
      label: t('common.refresh'),
      // 重新扫描本地状态（不联网）
      title: t('shell.tool.refreshTitle'),
      cmd: cmdOfRepo(c.repoType, 'status'),
      onClick: c.onRefresh,
    }),
  },
  {
    key: 'exit', zone: 'toolbar',
    render: (c) => ({
      icon: <IconExit />,
      // 退出
      label: t('shell.tool.exit'),
      // 关闭服务并退出应用（点击后需确认）
      title: t('shell.tool.exitTitle'),
      danger: true,
      onClick: c.onExit,
    }),
  },
  {
    key: 'open', zone: 'menu',
    render: (c) => ({
      icon: <IconFolder />,
      // 打开项目
      label: t('shell.tool.open'),
      onClick: () => c.setModal({ type: 'open' }),
    }),
  },
  {
    key: 'create', zone: 'menu',
    render: (c) => ({
      icon: <IconPlus />,
      // 新建仓库
      label: t('shell.tool.create'),
      onClick: () => c.setModal({ type: 'create-repo' }),
    }),
  },
  {
    key: 'get', zone: 'menu',
    render: (c) => ({
      icon: <IconDownload />,
      // 获取仓库
      label: t('shell.tool.get'),
      onClick: () => c.setModal({ type: 'get-repo' }),
    }),
  },
  {
    key: 'tags', zone: 'menu', visible: (c) => !!c.repoType, // 标签属于仓库操作，未进入仓库时不显示
    render: (c) => ({
      icon: <IconTag />,
      // 标签
      label: t('shell.tool.tags'),
      onClick: () => c.setModal({ type: 'tags' }),
    }),
  },
  {
    // 终端：非交互 git / svn 命令的快捷通道（护栏见 routes/terminal.ts）。默认紧跟「标签」在 ⋯ 菜单里；
    // 和别的项一样可拖到工具栏（想常驻也行）。快捷键 Ctrl+` 见 app.tsx。
    key: 'terminal', zone: 'menu', visible: (c) => !!c.repoType,
    render: (c) => ({
      icon: <IconTerminal />,
      // 终端
      label: t('shell.tool.terminal'),
      // 在仓库目录下执行 git / svn 命令（Ctrl+` 也可打开）。只支持非交互命令：不支持管道/重定向，需要 TTY 的命令请用系统终端
      title: t('shell.tool.terminalTitle'),
      onClick: () => c.setModal({ type: 'terminal' }),
    }),
  },
  {
    key: 'font', zone: 'menu',
    render: (c) => ({
      icon: <IconFont />,
      // 字体设置
      label: t('shell.tool.font'),
      onClick: () => c.setModal({ type: 'font' }),
    }),
  },
  {
    key: 'git-info', zone: 'menu', visible: (c) => c.repoType === 'git',
    render: (c) => ({
      icon: <IconGear />,
      // Git 信息与配置
      label: t('shell.tool.gitInfo'),
      onClick: () => c.setModal({ type: 'git-info' }),
    }),
  },
  {
    key: 'login', zone: 'menu', visible: (c) => c.repoType === 'svn',
    render: (c) => ({
      icon: <IconLogin />,
      // SVN 账号: {user} / SVN 登录
      label: c.configUser ? t('shell.tool.svnAccount', { user: c.configUser }) : t('shell.tool.svnLogin'),
      onClick: () => c.setModal({ type: 'login' }),
    }),
  },
];

function loadLayout(): ToolbarLayout {
  try {
    const raw = localStorage.getItem(LAYOUT_KEY);
    if (raw) {
      const p = JSON.parse(raw) as ToolbarLayout;
      if (Array.isArray(p.shown) && Array.isArray(p.hidden)) {
        const known = (k: string) => isSepItem(k) || TOOLS.some((d) => d.key === k);
        // 兼容旧数据：无编号分隔符 'sep' → 唯一化 'sep-1'
        const norm = (k: string) => (k === 'sep' ? 'sep-1' : k);
        return {
          shown: p.shown.filter((k) => known(k)).map(norm),
          hidden: p.hidden.filter((k) => known(k) && !isSepItem(k)),
        };
      }
    }
  } catch {
    /* 配置损坏按默认处理 */
  }
  return { shown: [...DEFAULT_LAYOUT.shown], hidden: [...DEFAULT_LAYOUT.hidden] };
}

export function AppHeader(props: {
  view: View;
  repo: RepoInfo | null;
  conflictCount: number;
  configUser: string;
  onRefresh: () => void;
  setModal: (m: Modal) => void;
  onToast: (m: string, err?: boolean) => void;
  /** 推送（含进度窗口与认证引导） */
  onPush: () => void;
  /** 更新/拉取（git=pull, svn=update, 含进度窗口可取消） */
  onUpdate: () => void;
  /** 未推送提交数（git；null=未知/svn 不显示角标） */
  unpushedCount?: number | null;
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

  // 工具栏布局（默认 → localStorage；拖拽即时更新）
  const [layout, setLayout] = useState<ToolbarLayout>(loadLayout);
  // 系统应用菜单集成状态（AppImage 方式下有「安装/卸载」入口；源码/浏览器运行不显示）
  const [appMenuState, setAppMenuState] = useState<{ appImage: boolean; installed: boolean }>({ appImage: false, installed: false });
  // 关于弹窗（版本 + 构建日期；打开时拉取 /api/info）
  const [aboutOpen, setAboutOpen] = useState(false);
  const [aboutInfo, setAboutInfo] = useState<{ version: string; buildDate: string }>({ version: '', buildDate: '' });
  const openAbout = () => {
    setMoreMenu(null);
    setAboutInfo({ version: '', buildDate: '' });
    void get
      .info()
      .then((r) => setAboutInfo({ version: r.version ?? '', buildDate: r.buildDate ?? '' }))
      .catch(() => {});
    setAboutOpen(true);
  };
  useEffect(() => {
    get
      .appMenu()
      .then((r) => setAppMenuState({ appImage: r.appImage, installed: r.installed }))
      .catch(() => {});
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout));
    } catch {
      /* 存储失败忽略 */
    }
  }, [layout]);
  // 拖拽状态（手动 mousedown 实现，不依赖 HTML5 DnD：真实/模拟环境都可靠）：
  // 当前拖的项（按钮 key 或分隔符唯一 id）+ 插入位置（参考项 id；null=末尾）+ ⋯ 高亮 + ghost 位置
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [dropBefore, setDropBefore] = useState<string | null | undefined>(undefined);
  const [moreDrop, setMoreDrop] = useState(false);
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null);
  // 插入位置的实时值（mousemove 写入；mouseup 读取——State 异步会读到闭包旧值，必须用 ref）
  const dropBeforeRef = useRef<string | null | undefined>(undefined);
  // 菜单内重排：落点参考项（hidden 数组中该项之前）+ 其 ref
  const [dropMenuBefore, setDropMenuBefore] = useState<string | null | undefined>(undefined);
  const dropMenuBeforeRef = useRef<string | null | undefined>(undefined);

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
    repoType: repo?.type ?? null,
    conflictCount: props.conflictCount,
    unpushedCount: props.unpushedCount,
    stashCount: props.stashCount,
    canStash: props.canStash,
    configUser: props.configUser,
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

  /** drop 落点：移到工具栏（beforeKey=插在哪个项（按钮/分隔符唯一 id）之前；null=末尾）。项 id 全局唯一，无索引偏移 */
  const moveToShown = (item: string, beforeKey: string | null) => {
    setLayout((l) => {
      const shown = l.shown.filter((x) => x !== item);
      let idx = shown.indexOf(beforeKey ?? '');
      if (beforeKey === null || idx < 0) idx = shown.length;
      shown.splice(Math.min(idx, shown.length), 0, item);
      return { shown, hidden: isSepItem(item) ? l.hidden : l.hidden.filter((k) => k !== item) };
    });
  };
  /** drop 落点：移入 ⋯ 菜单（分隔符无隐藏语义，直接删除；按钮收进菜单） */
  const moveToHidden = (item: string) => {
    setLayout((l) =>
      isSepItem(item)
        ? { shown: l.shown.filter((x) => x !== item), hidden: l.hidden }
        : { shown: l.shown.filter((x) => x !== item), hidden: [...l.hidden.filter((k) => k !== item), item] }
    );
  };
  /** 菜单内部重排：hidden 数组中移到 beforeKey（唯一 id）之前；null=末尾 */
  const moveHiddenOrder = (item: string, beforeKey: string | null) => {
    setLayout((l) => {
      const hidden = l.hidden.filter((k) => k !== item);
      const idx = hidden.indexOf(beforeKey ?? '');
      hidden.splice(idx < 0 ? hidden.length : idx, 0, item);
      return { shown: l.shown, hidden };
    });
  };

  /** 手动拖拽开始（mousedown，item=按钮 key 或分隔符唯一 id）：
   *  window 级 mousemove 更新插入线/ghost，mouseup 判定落点（工具栏 / ⋯ / 取消）
   *  移动距离 < 4px 视为普通点击：不动布局（onClick 正常执行） */
  const beginDrag = (item: string) => (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const sx = e.clientX;
    const sy = e.clientY;
    setDragKey(item);
    setDragPos({ x: e.clientX, y: e.clientY });
    const onMove = (ev: MouseEvent) => {
      // 菜单内部重排：鼠标在菜单面板内 → 落点参考项（纵向：该项中心之上→插其前）
      const menu = document.querySelector<HTMLElement>('.ctx-menu');
      const menuR = menu?.getBoundingClientRect();
      if (menuR && ev.clientX >= menuR.left && ev.clientX <= menuR.right && ev.clientY >= menuR.top && ev.clientY <= menuR.bottom) {
        const items = [...document.querySelectorAll<HTMLElement>('.ctx-menu [data-menu-key]')];
        let mBefore: string | null = null;
        for (const el of items) {
          const r = el.getBoundingClientRect();
          if (ev.clientY < r.top + r.height / 2) {
            mBefore = el.dataset.menuKey ?? null;
            break;
          }
        }
        dropMenuBeforeRef.current = mBefore;
        setDropMenuBefore(mBefore);
        setDropBefore(undefined);
        dropBeforeRef.current = undefined;
        setMoreDrop(false);
        setDragPos({ x: ev.clientX, y: ev.clientY });
        return;
      }
      // 工具栏插入线：按鼠标与各元素（按钮+分隔符，data-item-key 即唯一 id）中点位置
      const els = [...document.querySelectorAll<HTMLElement>('[data-tool-bar] [data-item-key]')];
      let beforeKey: string | null = null;
      for (const el of els) {
        const r = el.getBoundingClientRect();
        if (ev.clientX < r.left + r.width / 2) {
          beforeKey = el.dataset.itemKey ?? null;
          break;
        }
      }
      dropBeforeRef.current = beforeKey;
      setDropBefore(beforeKey);
      setDropMenuBefore(undefined);
      dropMenuBeforeRef.current = undefined;
      // ⋯ 按钮（无 data-tool-key 的 tool-btn）悬停高亮
      const more = document.querySelector<HTMLElement>('.header button.tool-btn:not([data-tool-key])');
      const inMore = !!more && (() => {
        const r = more.getBoundingClientRect();
        return ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom;
      })();
      setMoreDrop(inMore);
      setDragPos({ x: ev.clientX, y: ev.clientY });
    };
    const onUp = (ev: MouseEvent) => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      // 未移动（<4px）：普通点击，布局不动（onClick 事件照常执行）
      const moved = Math.hypot(ev.clientX - sx, ev.clientY - sy) > 4;
      if (moved) {
        const menu = document.querySelector<HTMLElement>('.ctx-menu');
        const menuR = menu?.getBoundingClientRect();
        const inMenu = !!menuR && ev.clientX >= menuR.left && ev.clientX <= menuR.right && ev.clientY >= menuR.top && ev.clientY <= menuR.bottom;
        if (inMenu) {
          // 菜单内部重排（只动顺序；落点在目标项之前）
          moveHiddenOrder(item, dropMenuBeforeRef.current ?? null);
        } else {
          const more = document.querySelector<HTMLElement>('.header button.tool-btn:not([data-tool-key])');
          const inMore = !!more && (() => {
            const r = more.getBoundingClientRect();
            return ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom;
          })();
          if (inMore) {
            moveToHidden(item);
            setMoreMenu(null); // 从菜单拖入工具栏后收起菜单（拖出行为的自然完成）
          } else {
            const bar = document.querySelector<HTMLElement>('.header [data-tool-bar]');
            const r = bar?.getBoundingClientRect();
            const inBar = !!r && ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom;
            if (inBar) {
              moveToShown(item, dropBeforeRef.current ?? null);
              setMoreMenu(null);
            }
            // 其他位置：取消（保持原布局）
          }
        }
      }
      setDragKey(null);
      setDragPos(null);
      setDropBefore(undefined);
      dropBeforeRef.current = undefined;
      setDropMenuBefore(undefined);
      dropMenuBeforeRef.current = undefined;
      setMoreDrop(false);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  return (
    <div className="header" style={{ display: props.view === 'diff' ? 'none' : undefined }}>
      {/* svn-git 文件版本管理 */}
      <span className="logo" style={{ display: 'flex', alignItems: 'center' }} title={t('shell.appName')}>
        <img src="/icon.png" width="26" height="26" alt="logo" style={{ borderRadius: 6 }} />
      </span>
      {repo?.type ? <span className={`badge ${repo.type}`}>{repo.type.toUpperCase()}</span> : null}
      {/* 未选择仓库 */}
      <span className="path">{repo?.root ?? t('shell.header.noRepo')}</span>
      {repo?.url ? <span className="dim small nowrap">{repo.url}</span> : null}
      {repo?.revOrBranch ? <span className="dim small nowrap">[{repo.revOrBranch}]</span> : null}
      {repo?.url ? <NetLight hostCheckKey={repo.url + repo.revOrBranch} /> : null}
      <span className="spacer" />
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
      <button
        className="mini tool-btn"
        // 更多操作（可把常用按钮拖入此菜单，或从这里拖回工具栏）
        title={t('shell.toolbar.moreTitle')}
        style={moreDrop ? { boxShadow: '0 0 0 2px var(--accent) inset' } : undefined}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setMoreMenu({ x: Math.max(8, r.right - 180), y: r.bottom + 4 });
        }}
      >
        ⋯
      </button>
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
                try { localStorage.removeItem(LAYOUT_KEY); } catch { /* ignore */ }
                setLayout({ shown: [...DEFAULT_LAYOUT.shown], hidden: [...DEFAULT_LAYOUT.hidden] });
                // 已恢复默认布局
                props.onToast(t('shell.toolbar.resetDone'));
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
      {aboutOpen && <AboutModal version={aboutInfo.version} buildDate={aboutInfo.buildDate} onClose={() => setAboutOpen(false)} />}
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
    </div>
  );
}
