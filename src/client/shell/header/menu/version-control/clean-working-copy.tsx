/** 清理工作副本：SVN = svn cleanup（清锁与中断残留）；Git = 清理未跟踪文件 */
import React from 'react';
import { post } from '../../../../shared/api.js';
import { t } from '../../../../../shared/i18n/index.js';
import { baseName } from '../../../../shared/utils.js';
import { launchMagicFlight } from '../../../../animations/index.js';
import { IconClean } from '../../../../ui/icons.js';
import { startTaskDeferred } from '../../../bg-defer.js';
import type { ToolDef } from '../types.js';

export const cleanWorkingCopyTool: ToolDef = {
  key: 'clean', zone: 'toolbar',
  visible: (c) => !!c.repoType, // 未进入仓库时不显示
  render: (c) => c.repoType === 'svn'
    ? {
        icon: <IconClean />,
        label: t('shell.tool.clean'),
        title: t('shell.tool.cleanSvnTitle'),
        cmd: 'svn cleanup',
        onClick: () =>
          c.setModal({
            type: 'confirm',
            title: 'svn cleanup',
            message: t('shell.tool.cleanConfirm'),
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
        label: t('shell.tool.clean'),
        title: t('shell.tool.cleanGitTitle'),
        onClick: () => c.setModal({ type: 'clean' }),
      },
};
