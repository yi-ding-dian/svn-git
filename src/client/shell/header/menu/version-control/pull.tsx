/** 拉取（Git） */
import React from 'react';
import { t } from '../../../../../shared/i18n/index.js';
import { IconDownload } from '../../../../ui/icons.js';
import type { ToolDef } from '../types.js';

export const pullTool: ToolDef = {
  key: 'pull', zone: 'toolbar', visible: (c) => c.repoType === 'git',
  render: (c) => ({
    icon: <IconDownload />,
    label: t('shell.tool.pull'),
    title: t('shell.tool.pullTitle'),
    cmd: 'git pull',
    onClick: c.onUpdate,
  }),
};
