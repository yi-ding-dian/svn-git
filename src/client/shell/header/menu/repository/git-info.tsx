/** Git 信息与配置（仅 Git 项目） */
import React from 'react';
import { t } from '../../../../../shared/i18n/index.js';
import { IconGear } from '../../../../ui/icons.js';
import type { ToolDef } from '../types.js';

export const gitInfoTool: ToolDef = {
  key: 'git-info', zone: 'menu', visible: (c) => c.repoType === 'git',
  render: (c) => ({
    icon: <IconGear />,
    label: t('shell.tool.gitInfo'),
    onClick: () => c.setModal({ type: 'git-info' }),
  }),
};
