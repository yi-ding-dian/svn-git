/** 全局弹窗状态类型（App 根组件 / 顶部工具栏 / ModalHost 共用） */
import type React from 'react';

/** 全局弹窗状态（App 根组件 / 顶部工具栏共用） */
export type Modal =
  | { type: 'commit'; paths: string[] }
  | { type: 'commit-select'; dir: string; dirLabel: string; items: { path: string; code: string; isDir: boolean }[]; checked?: string[]; stagedOnly?: string[]; msg?: string }
  | { type: 'login' }
  | { type: 'open' }
  | { type: 'branches' }
  | { type: 'tags' }
  | { type: 'stash' }
  | { type: 'create-repo' }
  | { type: 'get-repo' }
  | { type: 'git-info' }
  | { type: 'git-push-auth'; authType: 'github' | 'server' | 'ssh' }
  | { type: 'push-confirm' }
  | { type: 'clean' }
  | { type: 'env' }
  | { type: 'font' }
  | { type: 'conflicts' }
  | { type: 'remote-conflicts'; files: { path: string; lines: number[] }[] }
  | { type: 'revert-confirm'; dir: string; dirLabel: string; items: { path: string; code: string }[] }
  | { type: 'rename'; from: string; fsMode: boolean }
  | { type: 'terminal' }
  | {
      type: 'confirm';
      title: React.ReactNode;
      message: React.ReactNode;
      danger?: boolean;
      confirmLabel?: string;
      secondaryLabel?: string;
      /** 副按钮是否红色（危险选项） */
      secondaryDanger?: boolean;
      action: () => void;
      secondaryAction?: () => void;
      /** 命令预览：悬浮确认/副确认按钮时显示将执行的命令 */
      confirmCmd?: string;
      secondaryCmd?: string;
      /** 弹窗宽度（默认 440；文件列表类确认框按内容自适应传入） */
      width?: number;
    }
  | null;
