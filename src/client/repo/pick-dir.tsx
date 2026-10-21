/** 目录选择弹窗：「下载到…」/「新建仓库·所在目录」/「获取仓库·所在目录」/「检出·所在目录」共用。
 *  与「打开项目」是同一个目录浏览器（OpenBrowser，pick 模式）：底部「选择此目录」+
 *  新建文件夹/右键重命名——全应用唯一的目录选择界面（原 DirPicker 退役）。
 *  独立成文件是为了避免 open.tsx ↔ repo-create.tsx 的循环 import（open 引 repo-create 的弹窗）。 */
import React from 'react';
import { ModalShell } from '../shell/modal-shell.js';
import { OpenBrowser } from './open.js';

export function PickDirModal(props: {
  title: string;
  startDir: string;
  /** 浏览下界：只允许在这个目录及其子目录内选择（合并范围等场景用） */
  restrictTo?: string;
  /** 允许选中文件（合并范围的文件级合并） */
  allowFiles?: boolean;
  onPick: (path: string) => void;
  onClose: () => void;
}) {
  return (
    <ModalShell title={props.title} width={600} closeIcon hideFoot onClose={props.onClose}>
      <OpenBrowser
        startDir={props.startDir}
        pick={{ onPick: props.onPick, rootDir: props.restrictTo, allowFiles: props.allowFiles }}
      />
    </ModalShell>
  );
}
