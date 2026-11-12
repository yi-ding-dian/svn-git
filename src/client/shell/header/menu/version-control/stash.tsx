/** 储藏（Git） */
import React from 'react';
import { t } from '../../../../../shared/i18n/index.js';
import { IconStash } from '../../../../ui/icons.js';
import type { ToolDef } from '../types.js';

export const stashTool: ToolDef = {
  key: 'stash', zone: 'toolbar', menuLabelKey: 'shell.tool.stash',
  visible: (c) => c.repoType === 'git',
  render: (c) => ({
    icon: <IconStash />,
    label: c.stashCount != null && c.stashCount > 0 ? (
      <>Stash<span className={`push-count ${c.stashCount > 0 ? 'on' : ''}`}>{c.stashCount}</span></>
    ) : 'Stash',
    title: c.canStash === false && !(c.stashCount != null && c.stashCount > 0)
      ? t('shell.tool.stashDisabled')
      : c.stashCount != null && c.stashCount > 0
        ? c.canStash === false
          ? t('shell.tool.stashViewOnly', { n: c.stashCount })
          : t('shell.tool.stashTitleCount', { n: c.stashCount })
        : t('shell.tool.stashTitle'),
    onClick: () => c.setModal({ type: 'stash' }),
    disabled: c.canStash === false && !(c.stashCount != null && c.stashCount > 0),
  }),
};
