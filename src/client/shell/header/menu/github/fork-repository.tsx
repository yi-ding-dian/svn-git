/** Fork 到自己账号：origin 指向 github.com 且 owner 不是本人时出现（判定见 shared.ts）。 */
import React from 'react';
import { t } from '../../../../../shared/i18n/index.js';
import { IconFork } from '../../../../ui/icons.js';
import type { ToolDef } from '../types.js';
import { shouldOfferFork } from './shared.js';

export const githubForkRepositoryTool: ToolDef = {
  key: 'githubFork', zone: 'menu', menuLabelKey: 'shell.tool.githubFork',
  visible: (c) => c.repoType === 'git' && shouldOfferFork(c),
  render: (c) => ({
    icon: <IconFork />,
    label: t('shell.tool.githubFork'),
    title: t('shell.tool.githubForkTitle'),
    onClick: () => c.setModal({ type: 'github-fork' }),
  }),
};
