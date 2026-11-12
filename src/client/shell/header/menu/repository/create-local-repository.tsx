/** 新建仓库（本地） */
import React from 'react';
import { t } from '../../../../../shared/i18n/index.js';
import { IconPlus } from '../../../../ui/icons.js';
import type { ToolDef } from '../types.js';

export const createLocalRepositoryTool: ToolDef = {
  key: 'create', zone: 'menu',
  render: (c) => ({
    icon: <IconPlus />,
    label: t('shell.tool.create'),
    onClick: () => c.setModal({ type: 'create-repo' }),
  }),
};
