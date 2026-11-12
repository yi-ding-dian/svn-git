/** 获取仓库（检出 / 克隆） */
import React from 'react';
import { t } from '../../../../../shared/i18n/index.js';
import { IconDownload } from '../../../../ui/icons.js';
import type { ToolDef } from '../types.js';

export const getRepositoryTool: ToolDef = {
  key: 'get', zone: 'menu',
  render: (c) => ({
    icon: <IconDownload />,
    label: t('shell.tool.get'),
    onClick: () => c.setModal({ type: 'get-repo' }),
  }),
};
