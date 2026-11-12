/** 更新（SVN） */
import React from 'react';
import { t } from '../../../../../shared/i18n/index.js';
import { IconDownload } from '../../../../ui/icons.js';
import type { ToolDef } from '../types.js';

export const updateTool: ToolDef = {
  key: 'update', zone: 'toolbar', visible: (c) => c.repoType === 'svn',
  render: (c) => ({
    icon: <IconDownload />,
    label: t('shell.tool.update'),
    title: t('shell.tool.updateTitle'),
    cmd: 'svn update',
    onClick: c.onUpdate,
  }),
};
