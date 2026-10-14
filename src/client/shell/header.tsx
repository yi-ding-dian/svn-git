/** 顶部工具栏：仓库信息 + 版本管理操作（可定制：拖拽重排 / 拖入拖出 ⋯ 菜单，localStorage 持久化）+ 主题/字号 + 打开项目/登录/退出 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { get, post, type RepoInfo } from '../shared/api.js';
import { cmdOfRepo } from '../shared/cmd-preview.js';
import { useTasks, cancelTask } from '../shared/tasks.js';
import { useNotices, markAllRead, removeNotice } from '../shared/notices.js';
import { startTaskDeferred } from './bg-defer.js';
import { launchMagicFlight } from './magic-flight.js';
import { baseName } from '../shared/utils.js';
import { UpdateResultModal, type UpdateResultDetail } from '../ops/update-result.js';
import { InfoModal } from '../ui/prompt.js';
import { IconBranch, IconGear, IconTag, IconStash, IconPlus, IconDownload, IconClean, IconFolder, IconRefresh, IconLogin, IconExit, IconCommit, IconFont, IconInfo, IconTerminal, IconGlobe, IconOk, IconErr, IconServer, IconHourglassRun, IconBell, IconGitHub, IconGitHubPlus, IconTrash } from '../ui/icons.js';
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
  /** 当前仓库根（清理等任务标题里显示项目名用） */
  repoRoot?: string | null;
  repoType: 'git' | 'svn' | null;
  /** 当前仓库的远程地址（git；/api/info 带回）；GitHub 信息菜单的可见性判断用 */
  repoUrl?: string | null;
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
                // 3 秒延迟后台化（用户定稿）：快完成照旧（气泡通知）；慢（大工作副本）→ 自动转后台 +
                // 飞线（从清理按钮起飞）+ 轻提示"已转入后台"
                const title = t('shell.tasks.cleanupTitle', { repo: baseName(c.repoRoot ?? '') });
                const rect = document.querySelector<HTMLElement>('[data-tool-key="clean"]')?.getBoundingClientRect();
                startTaskDeferred({
                  kind: 'cleanup',
                  title,
                  run: async (signal) => {
                    const r = await post.svnExtra('cleanup', '', 'working', '', signal);
                    return { ok: r.ok, message: r.message };
                  },
                  onSlow: () => {
                    if (rect) launchMagicFlight(rect);
                    c.onToast(t('shell.tasks.backgrounded', { title }), false);
                  },
                });
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
    // GitHub 新建仓库（在当前 GitHub 账号下建远程仓库并设为 origin）：git 项目且 origin 尚未指向
    // github.com 时出现——与下面的「GitHub 仓库信息」（origin 指向 github.com 才出现）互补，两项不重叠
    key: 'ghCreate', zone: 'menu', menuLabelKey: 'shell.tool.ghCreate',
    visible: (c) => c.repoType === 'git' && !/github\.com/i.test(c.repoUrl ?? ''),
    render: (c) => ({
      icon: <IconGitHubPlus />,
      // GitHub 新建仓库
      label: t('shell.tool.ghCreate'),
      // 在当前 GitHub 账号下新建远程仓库，并把 origin 指向它
      title: t('shell.tool.ghCreateTitle'),
      onClick: () => c.setModal({ type: 'gh-create-repo' }),
    }),
  },
  {
    // GitHub 仓库信息（描述/Star/语言构成）：**只对 origin 指向 github.com 的项目存在**——
    // 其他远程（自建 git/GitLab/无远程）这项整个不出现（用户定稿），不是灰置
    key: 'ghRepo', zone: 'menu', menuLabelKey: 'shell.tool.ghRepo',
    visible: (c) => c.repoType === 'git' && /github\.com/i.test(c.repoUrl ?? ''),
    render: (c) => ({
      icon: <IconGitHub />,
      // GitHub 仓库信息
      label: t('shell.tool.ghRepo'),
      // 查看远程 GitHub 仓库信息（描述、Star、语言构成等）
      title: t('shell.tool.ghRepoTitle'),
      onClick: () => c.setModal({ type: 'gh-repo' }),
    }),
  },
  {
    // GitHub 删除仓库：与「GitHub 仓库信息」同条件（origin 指向 github.com 才出现）。
    // 危险操作：远程仓库删除不可恢复，弹窗里要求输入完整仓库名才解锁删除按钮
    key: 'ghDelete', zone: 'menu', menuLabelKey: 'shell.tool.ghDelete',
    visible: (c) => c.repoType === 'git' && /github\.com/i.test(c.repoUrl ?? ''),
    render: (c) => ({
      icon: <IconTrash />,
      // GitHub 删除仓库
      label: t('shell.tool.ghDelete'),
      // 永久删除 origin 指向的 GitHub 远程仓库（不可恢复，需输入仓库名确认）
      title: t('shell.tool.ghDeleteTitle'),
      onClick: () => c.setModal({ type: 'gh-delete-repo' }),
    }),
  },
  {
    key: 'login', zone: 'menu', visible: (c) => c.repoType === 'svn',
    render: (c) => ({
      icon: <IconLogin />,
      // SVN 信息
      label: t('shell.tool.svnInfo'),
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

  // 工具栏布局（默认 → localStorage；拖拽即时更新）
  const [layout, setLayout] = useState<ToolbarLayout>(loadLayout);
  // 系统应用菜单集成状态（AppImage 方式下有「安装/卸载」入口；源码/浏览器运行不显示）
  const [appMenuState, setAppMenuState] = useState<{ appImage: boolean; installed: boolean }>({ appImage: false, installed: false });
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
  // 后台任务：指示器 + 面板（进行中列表 + 取消；完成结果归铃铛——见下方 notices）
  const bgTasks = useTasks();
  const runningCount = bgTasks.filter((tk) => tk.status === 'running').length;
  const [taskPop, setTaskPop] = useState<{ x: number; y: number } | null>(null);
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
    repoRoot: repo?.root ?? null,
    repoType: repo?.type ?? null,
    repoUrl: repo?.url ?? null,
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
      {/* 浏览仓库（仅 SVN）：点一下直接打开仓库浏览器（与最近项目右键「浏览仓库」同功能）；
          无边框纯图标按钮（用户定稿），悬浮出淡背景 */}
      {repo?.type === 'svn' && props.onBrowseRepo && (
        <button className="header-icon-btn" title={t('repo.browse.entryTip')} onClick={props.onBrowseRepo}>
          <IconServer size={14} />
        </button>
      )}
      {/* 后台任务指示器：**仅运行中显示**（后台没有任务时不存在——用户定稿）：流沙动画沙漏 + 数量。
          点击展开任务面板（进行中 + 取消）。data-task-anchor：魔法飞行线的落点锚
          （锚点随按钮生灭——magic-flight 启动时轮询等它出现） */}
      {runningCount > 0 && (
        <button
          ref={taskBtnRef}
          data-task-anchor
          className="header-icon-btn"
          title={t('shell.tasks.indicatorTip', { n: runningCount })}
          onClick={() => (taskPop ? setTaskPop(null) : openTaskPop())}
        >
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
            <IconHourglassRun size={15} />
            <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--accent)' }}>{runningCount}</span>
          </span>
        </button>
      )}
      {/* 任务通知铃铛：有通知才存在（全关掉即消失）；未读红点；点开面板（打开即已读） */}
      {notices.length > 0 && (
        <button
          ref={bellBtnRef}
          className={`header-icon-btn${bellBounce ? ' bell-bounce' : ''}`}
          // 任务通知（点击查看）
          title={t('shell.notify.tip')}
          onClick={() => (noticePop ? setNoticePop(null) : openNoticePop())}
        >
          <span style={{ position: 'relative', display: 'inline-flex' }}>
            <IconBell size={15} />
            {unreadCount > 0 && <span className="bell-dot" />}
          </span>
        </button>
      )}
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
      {taskPop && <TaskPopover x={taskPop.x} y={taskPop.y} onClose={() => setTaskPop(null)} />}
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
      {noticePop && <NoticePopover x={noticePop.x} y={noticePop.y} onClose={() => setNoticePop(null)} />}
    </div>
  );
}

/** 后台任务面板：进行中（沙漏/已用秒/[取消]）——完成结果归铃铛（NoticePopover）留档，不在这里重复。
 *  运行中的"已用 n 秒"每秒刷新（面板开着才 tick）；点空白/Esc…… 面板同 ContextMenu 的 mask 手法 */
function TaskPopover(props: { x: number; y: number; onClose: () => void }) {
  const tasks = useTasks();
  const [, force] = useState(0);
  useEffect(() => {
    const h = window.setInterval(() => force((n) => n + 1), 1000);
    return () => window.clearInterval(h);
  }, []);
  const running = tasks.filter((tk) => tk.status === 'running');
  // 进行中清空（全部完成/取消）→ 自动收起：只剩空态没有留着的意义。
  // 用 prev 判"从有到无"——空闲时打开（running 本来就是 0）不误关
  const prevRunningRef = useRef(running.length);
  useEffect(() => {
    if (prevRunningRef.current > 0 && running.length === 0) props.onClose();
    prevRunningRef.current = running.length;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running.length]);
  const now = Date.now();
  return (
    <>
      {/* 点击面板外关闭（右键也关，避免菜单叠菜单） */}
      <div
        style={{ position: 'fixed', inset: 0, zIndex: 299 }}
        onClick={props.onClose}
        onContextMenu={(ev) => {
          ev.preventDefault();
          props.onClose();
        }}
      />
      <div
        className="ctx-menu"
        style={{ position: 'fixed', right: Math.max(8, window.innerWidth - props.x), top: props.y, minWidth: 300, maxWidth: 380, padding: 8 }}
      >
        {/* 进行中（面板只在有任务时能打开——指示器仅运行中显示；全完成后 prevRef 会把它自动收起） */}
        <div className="dim small" style={{ padding: '2px 6px 4px' }}>{t('shell.tasks.running')}</div>
        {running.map((tk) => (
          <div key={tk.id} className="row" style={{ gap: 8, padding: 6, alignItems: 'center' }}>
            <IconHourglassRun size={14} />
            <span style={{ flex: 1, minWidth: 0 }}>
              <div className="small" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={tk.title}>{tk.title}</div>
              {/* 已用 {n} 秒 */}
              <div className="dim small">{t('shell.tasks.elapsed', { n: Math.max(0, Math.floor((now - tk.startedAt) / 1000)) })}</div>
            </span>
            {/* 取消 */}
            <button className="mini" onClick={() => cancelTask(tk.id)}>{t('common.cancel')}</button>
          </div>
        ))}
      </div>
    </>
  );
}

/** 通知里的「更新结果」详情判别：detail 由任务 data 透传（app 的完成观察者），
 *  带 kind='update' 的通知行才可点开「更新结果」窗；其余通知行不可点 */
function asUpdateDetail(d: unknown): UpdateResultDetail | null {
  const o = d as { kind?: string } | null;
  return o && o.kind === 'update' ? (d as UpdateResultDetail) : null;
}

/** 任务通知面板（铃铛）：完成/失败通知列表——✓/✗ + 标题 + 消息 + 时间 + [×]逐条关闭；
 *  带更新详情的行可点开「更新结果」窗（文件清单/警告——更新不再自动弹，详情从这里看）；
 *  打开即全部已读（红点消失）；全部关掉 → 铃铛随之消失（父层条件渲染），面板自动收起 */
function NoticePopover(props: { x: number; y: number; onClose: () => void }) {
  const notices = useNotices();
  /** 打开的「更新结果」详情窗（点面板里带「详情 ▸」的通知行） */
  const [detail, setDetail] = useState<UpdateResultDetail | null>(null);
  /** 「全文」小窗（无更新详情的通知——消息被两行截断后，点开看完整内容） */
  const [fullMsg, setFullMsg] = useState<{ title: string; message: string } | null>(null);
  // 打开即已读（放 effect 里，避免渲染期改 store）
  useEffect(() => {
    markAllRead();
  }, []);
  // 全部关闭（铃铛消失）→ 面板自动收起
  useEffect(() => {
    if (notices.length === 0) props.onClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notices.length]);
  /** HH:MM（通知面板的时间戳；数字格式不入 i18n） */
  const hm = (at: number) => {
    const d = new Date(at);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };
  return (
    <>
      {/* 点击面板外关闭（右键也关，避免菜单叠菜单） */}
      <div
        style={{ position: 'fixed', inset: 0, zIndex: 299 }}
        onClick={props.onClose}
        onContextMenu={(ev) => {
          ev.preventDefault();
          props.onClose();
        }}
      />
      <div
        className="ctx-menu"
        // maxHeight + 滚动：通知多了不顶出屏幕（用户定稿：列表超出加滚动）
        style={{ position: 'fixed', right: Math.max(8, window.innerWidth - props.x), top: props.y, minWidth: 320, maxWidth: 430, padding: 8, maxHeight: 'min(70vh, 480px)', overflowY: 'auto' }}
      >
        {notices.map((n) => {
          const ud = asUpdateDetail(n.detail);
          // 有更新详情 → 点开「更新结果」窗；否则有消息就点开「全文」小窗；都没有 = 不可点
          const clickable = Boolean(ud || n.message);
          return (
            <div
              key={n.id}
              className="row"
              style={{ gap: 8, padding: 6, alignItems: 'flex-start', cursor: clickable ? 'pointer' : undefined }}
              title={clickable ? t('shell.notify.detailTip') : undefined}
              onClick={clickable ? () => (ud ? setDetail(ud) : setFullMsg({ title: n.title, message: n.message })) : undefined}
            >
              <span style={{ flexShrink: 0, display: 'inline-flex', marginTop: 2, color: n.err ? 'var(--err)' : 'var(--ok)' }}>
                {n.err ? <IconErr /> : <IconOk />}
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <div className="row" style={{ gap: 6, alignItems: 'baseline' }}>
                  <span className="small" style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={n.title}>{n.title}</span>
                  <span className="dim small nowrap" style={{ marginLeft: 'auto', flexShrink: 0 }}>{hm(n.at)}</span>
                </div>
                {n.message && (
                  // 消息**最多两行**（超出截断成 …）——想细看点行开弹窗（用户定稿）
                  <div
                    className={n.err ? 'small' : 'dim small'}
                    style={{
                      color: n.err ? 'var(--err)' : undefined,
                      marginTop: 1,
                      display: '-webkit-box',
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical',
                      overflow: 'hidden',
                      wordBreak: 'break-all',
                    }}
                    title={n.message}
                  >
                    {n.message}
                  </div>
                )}
              </span>
              <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
                {/* 详情（点击查看更新文件清单/警告） */}
                {ud && <span className="dim small nowrap">{t('shell.notify.detail')} ▸</span>}
                {/* 关闭这条通知（stopPropagation：行可点时点 × 不应打开详情） */}
                <button className="mini" title={t('shell.notify.removeTip')} onClick={(e) => { e.stopPropagation(); removeNotice(n.id); }}>×</button>
              </span>
            </div>
          );
        })}
      </div>
      {/* 更新结果详情窗（从面板点开；关闭后回到面板） */}
      {detail && <UpdateResultModal {...detail} onClose={() => setDetail(null)} />}
      {/* 通知全文小窗（消息两行截断后的完整内容；zIndex 460 高于面板与气泡） */}
      {fullMsg && (
        <InfoModal
          title={fullMsg.title}
          message={<span style={{ wordBreak: 'break-all' }}>{fullMsg.message}</span>}
          onClose={() => setFullMsg(null)}
          zIndex={460}
        />
      )}
    </>
  );
}
