/** 标签管理 */
import React from 'react';
import { t } from '../../../../../shared/i18n/index.js';
import { IconTag } from '../../../../ui/icons.js';
import type { ToolDef } from '../types.js';

export const tagsTool: ToolDef = {
  key: 'tags', zone: 'toolbar', visible: (c) => !!c.repoType, // 标签属于仓库操作，未进入仓库时不显示
  render: (c) => ({
    icon: <IconTag />,
    label: t('shell.tool.tags'),
    onClick: () => c.setModal({ type: 'tags' }),
  }),
};
