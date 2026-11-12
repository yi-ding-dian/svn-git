/** 发布中心：整合发布历史 + 发布新版本。有远程仓库的 git 项目都能发版；
 *  GitHub 项目额外显示发布历史。实际发版交给 deploy/release.mjs（脚本是唯一实现）。 */
import React from 'react';
import { t } from '../../../../../shared/i18n/index.js';
import { IconRelease } from '../../../../ui/icons.js';
import type { ToolDef } from '../types.js';

export const releaseCenterTool: ToolDef = {
  key: 'release', zone: 'menu', menuLabelKey: 'shell.tool.release',
  visible: (c) => c.repoType === 'git' && (!!c.repoUrl || c.canRelease === true || c.canLocalBuild === true),
  render: (c) => ({
    icon: <IconRelease />,
    label: t('shell.tool.release'),
    title: t('shell.tool.releaseTitle'),
    onClick: () => c.setModal({ type: 'release-hub' }),
  }),
};
