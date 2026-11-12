/** 字体设置 */
import React from 'react';
import { t } from '../../../../../shared/i18n/index.js';
import { IconFont } from '../../../../ui/icons.js';
import type { ToolDef } from '../types.js';

export const fontTool: ToolDef = {
  key: 'font', zone: 'menu',
  render: (c) => ({
    icon: <IconFont />,
    label: t('shell.tool.font'),
    onClick: () => c.setModal({ type: 'font' }),
  }),
};
