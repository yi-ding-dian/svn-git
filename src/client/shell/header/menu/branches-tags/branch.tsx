/** 分支管理 */
import React from 'react';
import { t } from '../../../../../shared/i18n/index.js';
import { IconBranch } from '../../../../ui/icons.js';
import type { ToolDef } from '../types.js';

export const branchTool: ToolDef = {
  key: 'branch', zone: 'toolbar',
  visible: (c) => !!c.repoType, // 未进入仓库时不显示
  render: (c) => ({
    icon: <IconBranch />,
    label: t('shell.tool.branch'),
    title: t('shell.tool.branchTitle'),
    onClick: () => c.setModal({ type: 'branches' }),
  }),
};
