/** 退出应用（固定在 ⋯ 左侧最右位，不纳入拖拽定制，防误移/误隐藏） */
import React from 'react';
import { t } from '../../../../../shared/i18n/index.js';
import { IconExit } from '../../../../ui/icons.js';
import type { ToolDef } from '../types.js';

export const exitAppTool: ToolDef = {
  key: 'exit', zone: 'toolbar',
  render: (c) => ({
    icon: <IconExit />,
    label: t('shell.tool.exit'),
    title: t('shell.tool.exitTitle'),
    danger: true,
    onClick: c.onExit,
  }),
};
