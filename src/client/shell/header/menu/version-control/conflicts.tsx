/** 解决冲突（有冲突文件时才出现） */
import React from 'react';
import { t } from '../../../../../shared/i18n/index.js';
import { IconClean } from '../../../../ui/icons.js';
import type { ToolDef } from '../types.js';

export const conflictsTool: ToolDef = {
  key: 'conflicts', zone: 'toolbar', menuLabelKey: 'shell.tool.conflicts',
  visible: (c) => c.conflictCount > 0,
  render: (c) => ({
    icon: <IconClean />,
    label: (
      <>
        {t('shell.tool.conflicts')} (<span style={{ color: 'var(--err)', fontWeight: 700 }}>{c.conflictCount}</span>)
      </>
    ),
    title: t('shell.tool.conflictsTitle'),
    onClick: () => c.setModal({ type: 'conflicts' }),
  }),
};
