/** 顶栏可定制工具栏：按钮注册表 + 布局读写。
 *
 *  所有按钮/菜单项都在 TOOLS 里声明（zone 决定默认位置，visible 决定何时出现），
 *  AppHeader 只按用户布局渲染——新增一个入口改这里，不用动头部组件。 */
import React from 'react';
import { post } from '../../shared/api.js';
import { cmdOfRepo } from '../../shared/cmd-preview.js';
import { startTaskDeferred } from '../bg-defer.js';
import { launchMagicFlight } from '../../animations/index.js';
import { baseName } from '../../shared/utils.js';
import { parseGithub } from '../../../shared/github.js';
import { t, type I18nKey } from '../../../shared/i18n/index.js';
import { IconBranch, IconGear, IconTag, IconStash, IconPlus, IconDownload, IconClean, IconFolder, IconRefresh, IconLogin, IconExit, IconCommit, IconFont, IconTerminal, IconGitHub, IconGitHubPlus, IconTrash, IconFork } from '../../ui/icons.js';
import { type Modal } from '../modal-types.js';

/** 顶部工具按钮（图标 + 文字，统一样式；mousedown 可启动拖拽定制） */
export function ToolBtn(props: {
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

export const LAYOUT_KEY = 'svngit-toolbar';

/** shown 序列项：按钮 key 或分隔符唯一 id（'sep-N'，多个分隔符必须唯一——布局跨仓库类型共享）
 *  分隔符 id 前缀固定 'sep-'，按钮 key 均为纯字母 */
type ToolbarItem = string;
export type ToolbarLayout = { shown: ToolbarItem[]; hidden: string[] };

/** 默认布局：工具栏按钮（可见时按此顺序渲染，sep=分隔符可拖拽调整），其余固定项默认收在 ⋯ 菜单 */
export const DEFAULT_LAYOUT: ToolbarLayout = {
  // 标签紧跟分支（都是仓库级操作，放在一起）：默认可见，不再收在 ⋯ 菜单
  shown: ['conflicts', 'pull', 'update', 'push', 'stash', 'sep-1', 'branch', 'tags', 'sep-2', 'clean', 'refresh', 'sep-3', 'exit'],
  hidden: ['open', 'create', 'get', 'terminal', 'font', 'git-info', 'login'],
};

/** 新分隔符唯一 id（Date.now 毫秒，工具内足够） */
export function newSepId() {
  return `sep-${Date.now()}`;
}
export const isSepItem = (k: string) => k.startsWith('sep-');

/** 按钮渲染所需的上下文（由 AppHeader 组装） */
export type ToolCtx = {
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
  /** git 凭据里的 GitHub 用户名（Fork 菜单按 owner 粗判"是不是别人的仓库"；空 = 未知，宁多显勿漏显） */
  gitUser?: string;
  onRefresh: () => void;
  setModal: (m: Modal) => void;
  onToast: (m: string, err?: boolean) => void;
  onPush: () => void;
  onUpdate: () => void;
  onExit: () => void;
};

export type ToolDef = {
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
export const TOOLS: ToolDef[] = [
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
    key: 'tags', zone: 'toolbar', visible: (c) => !!c.repoType, // 标签属于仓库操作，未进入仓库时不显示
    render: (c) => ({
      icon: <IconTag />,
      // 标签
      label: t('shell.tool.tags'),
      onClick: () => c.setModal({ type: 'tags' }),
    }),
  },
  {
    // 终端：非交互 git / svn 命令的快捷通道（护栏见 routes/terminal.ts）。默认收在 ⋯ 菜单里；
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
    key: 'githubCreate', zone: 'menu', menuLabelKey: 'shell.tool.githubCreate',
    visible: (c) => c.repoType === 'git' && !/github\.com/i.test(c.repoUrl ?? ''),
    render: (c) => ({
      icon: <IconGitHubPlus />,
      // GitHub 新建仓库
      label: t('shell.tool.githubCreate'),
      // 在当前 GitHub 账号下新建远程仓库，并把 origin 指向它
      title: t('shell.tool.githubCreateTitle'),
      onClick: () => c.setModal({ type: 'github-create-repo' }),
    }),
  },
  {
    // GitHub 仓库信息（描述/Star/语言构成）：**只对 origin 指向 github.com 的项目存在**——
    // 其他远程（自建 git/GitLab/无远程）这项整个不出现（用户定稿），不是灰置
    key: 'githubRepo', zone: 'menu', menuLabelKey: 'shell.tool.githubRepo',
    visible: (c) => c.repoType === 'git' && /github\.com/i.test(c.repoUrl ?? ''),
    render: (c) => ({
      icon: <IconGitHub />,
      // GitHub 仓库信息
      label: t('shell.tool.githubRepo'),
      // 查看远程 GitHub 仓库信息（描述、Star、语言构成等）
      title: t('shell.tool.githubRepoTitle'),
      onClick: () => c.setModal({ type: 'github-repo' }),
    }),
  },
  {
    // GitHub 删除仓库：与「GitHub 仓库信息」同条件（origin 指向 github.com 才出现）。
    // 危险操作：远程仓库删除不可恢复，弹窗里要求输入完整仓库名才解锁删除按钮
    key: 'githubDelete', zone: 'menu', menuLabelKey: 'shell.tool.githubDelete',
    visible: (c) => c.repoType === 'git' && /github\.com/i.test(c.repoUrl ?? ''),
    render: (c) => ({
      icon: <IconTrash />,
      // GitHub 删除仓库
      label: t('shell.tool.githubDelete'),
      // 永久删除 origin 指向的 GitHub 远程仓库（不可恢复，需输入仓库名确认）
      title: t('shell.tool.githubDeleteTitle'),
      onClick: () => c.setModal({ type: 'github-delete-repo' }),
    }),
  },
  {
    // Fork 到自己账号：origin 指向 github.com 且 owner 不是本人时出现（自己账号的仓库无需 Fork）。
    // gitUser 未知（未配 git 凭据）时也显示——宁多显勿漏显，进弹窗后服务端判定归属兜底
    key: 'githubFork', zone: 'menu', menuLabelKey: 'shell.tool.githubFork',
    visible: (c) =>
      c.repoType === 'git' &&
      /github\.com/i.test(c.repoUrl ?? '') &&
      (!c.gitUser || parseGithub(c.repoUrl ?? '')?.owner.toLowerCase() !== c.gitUser.toLowerCase()),
    render: (c) => ({
      icon: <IconFork />,
      // Fork 到自己账号
      label: t('shell.tool.githubFork'),
      // 把该仓库 Fork 到你的 GitHub 账号（给开源项目贡献代码前需要先 Fork）
      title: t('shell.tool.githubForkTitle'),
      onClick: () => c.setModal({ type: 'github-fork' }),
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

export function loadLayout(): ToolbarLayout {
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
