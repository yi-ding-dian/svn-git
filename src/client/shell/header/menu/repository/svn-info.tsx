/** SVN 信息与账号（仅 SVN 项目） */
import React from 'react';
import { t } from '../../../../../shared/i18n/index.js';
import { IconLogin } from '../../../../ui/icons.js';
import type { ToolDef } from '../types.js';

export const svnInfoTool: ToolDef = {
  key: 'svn-info', zone: 'menu', visible: (c) => c.repoType === 'svn',
  render: (c) => ({
    icon: <IconLogin />,
    label: t('shell.tool.svnInfo'),
    onClick: () => c.setModal({ type: 'svn-info' }),
  }),
};
