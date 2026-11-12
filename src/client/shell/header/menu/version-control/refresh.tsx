/** 刷新：重新扫描本地状态（不联网） */
import React from 'react';
import { cmdOfRepo } from '../../../../shared/cmd-preview.js';
import { t } from '../../../../../shared/i18n/index.js';
import { IconRefresh } from '../../../../ui/icons.js';
import type { ToolDef } from '../types.js';

export const refreshTool: ToolDef = {
  key: 'refresh', zone: 'toolbar',
  visible: (c) => !!c.repoType,
  render: (c) => ({
    icon: <IconRefresh />,
    label: t('common.refresh'),
    title: t('shell.tool.refreshTitle'),
    cmd: cmdOfRepo(c.repoType, 'status'),
    onClick: c.onRefresh,
  }),
};
