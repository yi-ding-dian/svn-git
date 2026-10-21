/** 合并范围输入：文本框 + 「浏览…」（两处共用：合并到主干面板 / SVN 合并范围弹窗）。
 *  目录浏览器由 shell 注入（ops 不能直接引用 repo 的 OpenBrowser），选中的绝对路径
 *  按工作副本根换算成合并用的相对路径（pathRel）后回填。 */
import React from 'react';
import { t } from '../../../shared/i18n/index.js';
import type { PickDirRequest } from './branch-shared.js';

/** 选中的绝对路径 → 相对工作副本根的合并范围路径。
 *  不在工作副本内返回 null（防止把范围指到分支外）。Windows 的 `\` 与 `/` 都接受。 */
export function relUnder(baseDir: string, picked: string): string | null {
  const trimSep = (p: string) => p.replace(/[\\/]+$/, '');
  const base = trimSep(baseDir);
  const p = trimSep(picked);
  if (!base) return p;
  if (p === base) return ''; // 选中工作副本根 = 整个分支
  const prefixes = new Set([base + '/', base + '\\', base.replace(/\\/g, '/') + '/']);
  for (const prefix of prefixes) {
    if (p.startsWith(prefix)) return p.slice(prefix.length).split(/[\\/]/).filter(Boolean).join('/');
  }
  return null;
}

export function MergeScopeField(props: {
  value: string;
  onChange: (v: string) => void;
  /** 当前工作副本本地根：浏览起点，也是相对路径的换算基准 */
  workDir: string;
  /** 目录/文件选择弹窗注入（shell 提供） */
  onPickDir?: (req: PickDirRequest) => void;
  /** 选中工作副本之外的目录：由调用方提示（范围保持不变） */
  onOutside: () => void;
  /** 选中后回填完成的回调（合并到主干用它立即预检） */
  onPicked?: (rel: string) => void;
  autoFocus?: boolean;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  onBlur?: () => void;
}) {
  const browse = () => {
    if (!props.onPickDir || !props.workDir) return;
    // 下界=工作副本根；允许点选文件（文件级合并）
    props.onPickDir({
      title: t('ops.branch.mergeScopeBrowseTitle'),
      startDir: props.workDir,
      restrictTo: props.workDir,
      allowFiles: true,
      onPick: (picked) => {
        const rel = relUnder(props.workDir, picked);
        if (rel === null) {
          props.onOutside();
          return;
        }
        props.onChange(rel);
        props.onPicked?.(rel);
      },
    });
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div className="row" style={{ gap: 6 }}>
        <input
          type="text"
          autoFocus={props.autoFocus}
          value={props.value}
          onChange={(e) => props.onChange(e.target.value)}
          onBlur={props.onBlur}
          onKeyDown={props.onKeyDown}
          placeholder={t('ops.mergeScope.placeholder')}
          style={{ flex: 1, minWidth: 0 }}
        />
        <button
          className="mini"
          disabled={!props.workDir || !props.onPickDir}
          title={t('ops.branch.mergeScopeBrowseTitle')}
          onClick={browse}
        >
          {/* 选择目录…（单选；整分支合并留空即可） */}
          {t('ops.branch.mergeScopeBrowse')}
        </button>
      </div>
      {/* 默认语义直接写出来：留空 = 整个分支（不再只靠占位文字暗示） */}
      {!props.value.trim() && <div className="small dim">{t('ops.branch.mergeScopeDefault')}</div>}
    </div>
  );
}
