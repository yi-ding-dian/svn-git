/** 推送（Git） */
import React from 'react';
import { t } from '../../../../../shared/i18n/index.js';
import { IconCommit } from '../../../../ui/icons.js';
import type { ToolDef } from '../types.js';

export const pushTool: ToolDef = {
  key: 'push', zone: 'toolbar', menuLabelKey: 'shell.tool.push',
  visible: (c) => c.repoType === 'git',
  render: (c) => ({
    icon: <IconCommit />,
    label: c.unpushedCount != null ? (
      <>{t('shell.tool.push')}<span className={`push-count ${c.unpushedCount > 0 ? 'on' : ''}`}>{c.unpushedCount}</span></>
    ) : t('shell.tool.push'),
    title: c.unpushedCount != null && c.unpushedCount <= 0
      ? t('shell.tool.pushNothing')
      : t('shell.tool.pushTitle', { n: c.unpushedCount ?? 0 }),
    onClick: c.onPush,
    disabled: c.unpushedCount != null && c.unpushedCount <= 0,
    cmd: 'git push',
  }),
};
