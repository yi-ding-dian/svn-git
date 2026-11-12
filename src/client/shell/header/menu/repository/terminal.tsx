/** 终端：非交互 git / svn 命令的快捷通道（护栏见 server/routes/terminal.ts）。
 *  默认收在 ⋯ 菜单里，和别的项一样可拖到工具栏常驻；快捷键 Ctrl+` 见 app.tsx。 */
import React from 'react';
import { t } from '../../../../../shared/i18n/index.js';
import { IconTerminal } from '../../../../ui/icons.js';
import type { ToolDef } from '../types.js';

export const terminalTool: ToolDef = {
  key: 'terminal', zone: 'menu', visible: (c) => !!c.repoType,
  render: (c) => ({
    icon: <IconTerminal />,
    label: t('shell.tool.terminal'),
    title: t('shell.tool.terminalTitle'),
    onClick: () => c.setModal({ type: 'terminal' }),
  }),
};
