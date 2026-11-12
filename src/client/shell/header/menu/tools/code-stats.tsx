/** 项目代码统计：勾选目录 → 统计行数 → 导出 md（默认收在 ⋯ 菜单，可拖到工具栏常驻） */
import React from 'react';
import { t } from '../../../../../shared/i18n/index.js';
import { IconStats } from '../../../../ui/icons.js';
import type { ToolDef } from '../types.js';

export const codeStatsTool: ToolDef = {
  key: 'code-stats', zone: 'menu', visible: (c) => !!c.repoType, menuLabelKey: 'stats.tool.label',
  render: (c) => ({
    icon: <IconStats />,
    label: t('stats.tool.label'),
    title: t('stats.tool.title'),
    onClick: () => c.setModal({ type: 'code-stats' }),
  }),
};
