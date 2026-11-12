/** GitHub 新建仓库：在当前 GitHub 账号下建远程仓库并设为 origin。
 *  git 项目且 origin 尚未指向 github.com 时出现——与「GitHub 仓库信息」互补，两项不重叠。 */
import React from 'react';
import { t } from '../../../../../shared/i18n/index.js';
import { IconGitHubPlus } from '../../../../ui/icons.js';
import type { ToolDef } from '../types.js';
import { isGithubRemote } from './shared.js';

export const githubCreateRepositoryTool: ToolDef = {
  key: 'githubCreate', zone: 'menu', menuLabelKey: 'shell.tool.githubCreate',
  visible: (c) => c.repoType === 'git' && !isGithubRemote(c),
  render: (c) => ({
    icon: <IconGitHubPlus />,
    label: t('shell.tool.githubCreate'),
    title: t('shell.tool.githubCreateTitle'),
    onClick: () => c.setModal({ type: 'github-create-repo' }),
  }),
};
