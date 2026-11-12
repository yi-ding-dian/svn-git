/** 打开项目 */
import React from 'react';
import { t } from '../../../../../shared/i18n/index.js';
import { IconFolder } from '../../../../ui/icons.js';
import type { ToolDef } from '../types.js';

export const openProjectTool: ToolDef = {
  key: 'open', zone: 'menu',
  render: (c) => ({
    icon: <IconFolder />,
    label: t('shell.tool.open'),
    onClick: () => c.setModal({ type: 'open' }),
  }),
};
