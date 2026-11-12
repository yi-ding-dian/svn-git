/** GitHub 仓库信息（描述 / Star / 语言构成）：只对 origin 指向 github.com 的项目存在——
 *  其他远程（自建 git / GitLab / 无远程）这项整个不出现（用户定稿），不是灰置。 */
import React from 'react';
import { t } from '../../../../../shared/i18n/index.js';
import { IconGitHub } from '../../../../ui/icons.js';
import type { ToolDef } from '../types.js';
import { isGithubRemote } from './shared.js';

export const githubRepositoryInfoTool: ToolDef = {
  key: 'githubRepo', zone: 'menu', menuLabelKey: 'shell.tool.githubRepo',
  visible: (c) => c.repoType === 'git' && isGithubRemote(c),
  render: (c) => ({
    icon: <IconGitHub />,
    label: t('shell.tool.githubRepo'),
    title: t('shell.tool.githubRepoTitle'),
    onClick: () => c.setModal({ type: 'github-repo' }),
  }),
};
