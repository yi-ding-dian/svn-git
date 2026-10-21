/** 全局弹窗状态类型（App 根组件 / 顶部工具栏 / ModalHost 共用） */
import type React from 'react';

/** 全局弹窗状态（App 根组件 / 顶部工具栏共用） */
export type Modal =
  | { type: 'commit'; paths: string[] }
  | { type: 'commit-select'; dir: string; dirLabel: string; items: { path: string; code: string; isDir: boolean }[]; checked?: string[]; stagedOnly?: string[]; msg?: string }
  | { type: 'login' }
  | { type: 'open' }
  | { type: 'practice' }
  | { type: 'branches' }
  | { type: 'tags' }
  | { type: 'stash' }
  | { type: 'create-repo' }
  /** url/name 有值 = 预填（「我的 GitHub 仓库」列表选中一个仓库后走克隆） */
  | { type: 'get-repo'; url?: string; name?: string }
  | { type: 'git-info' }
  /** Git 身份（user.name / user.email）未配置：提交被 git 拒绝时弹出，而不是糊原始报错。
   *  retry 有值 = 保存成功后自动重试这次提交（原样重放路径/消息/部分暂存）；returnTo 有值 = 关闭后回退到该弹窗 */
  | { type: 'git-identity'; retry?: { paths: string[]; message: string; stagedOnly: string[] }; returnTo?: Modal }
  | { type: 'github-create-repo' }
  | { type: 'github-delete-repo' }
  | { type: 'github-fork' }
  | { type: 'github-repo' }
  | { type: 'github-my-repos' }
  | { type: 'git-push-auth'; authType: 'github' | 'server' | 'ssh' }
  | { type: 'push-confirm' }
  | { type: 'clean' }
  | { type: 'env' }
  | { type: 'repo-browse'; url: string; wcRel?: string }
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
