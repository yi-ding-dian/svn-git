/** 顶栏菜单与工具栏注册类型。
 *
 *  - ToolDef：可定制项（可在工具栏和 ⋯ 菜单之间拖拽、参与布局持久化）
 *  - CtxMenuItem：固定菜单项（不参与拖拽定制，由 AppHeader 按条件拼装）
 *
 *  按钮 key 是布局持久化的唯一标识（localStorage 'svngit-toolbar'），**不要随意改名**。 */
import type React from 'react';
import type { Modal } from '../../modal-types.js';
import type { I18nKey } from '../../../../shared/i18n/index.js';

/** shown 序列项：按钮 key 或分隔符唯一 id（'sep-N'，多个分隔符必须唯一——布局跨仓库类型共享）
 *  分隔符 id 前缀固定 'sep-'，按钮 key 均为纯字母 */
export type ToolbarItem = string;
export type ToolbarLayout = { shown: ToolbarItem[]; hidden: string[] };

/** 按钮渲染所需的上下文（由 AppHeader 组装） */
export type ToolCtx = {
  /** 当前仓库根（清理等任务标题里显示项目名用） */
  repoRoot?: string | null;
  /** 项目根有 deploy/release.mjs：显示「发布新版本」菜单 */
  canRelease?: boolean;
  /** 项目里有打包脚本：即使没有远程也能打开「本地打包」 */
  canLocalBuild?: boolean;
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

/** 可定制按钮/菜单项定义 */
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

/** 固定菜单项（⋯ 菜单里不参与拖拽定制的项）的构造结果；字段与 ui/context-menu 的
 *  CtxMenuItem 兼容，由 AppHeader 直接拼进 items。 */
export type FixedMenuEntry = {
  icon?: React.ReactNode;
  label?: string;
  title?: string;
  dot?: boolean;
  noArrow?: boolean;
  submenu?: { icon?: React.ReactNode; label: string; action: () => void }[];
  onMouseDown?: (e: React.MouseEvent) => void;
  action?: () => void;
};
