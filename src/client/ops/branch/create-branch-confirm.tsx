/** 新建分支确认：git 带基点选择（主干/当前分支），svn 带来源选择（trunk/当前目录） */
import React, { useState } from 'react';
import type { BranchInfo } from '../../shared/api.js';
import { ConfirmModal } from '../../ui/prompt.js';
import { cmdOfRepo } from '../../shared/cmd-preview.js';
import { t } from '../../../shared/i18n/index.js';
import { currentLabelOf } from './branch-shared.js';

export function CreateBranchConfirm(props: {
  repoType: 'svn' | 'git';
  data: BranchInfo;
  name: string;
  /** git：找到的主干基点（main/master） */
  trunkBase?: string;
  onCancel: () => void;
  /** base：svn 的 'current' 或 git 的基点分支名；from=确认按钮位置（转后台时的飞线起点） */
  onConfirm: (base: string | undefined, from: DOMRect) => void;
}) {
  const { repoType, data, name, trunkBase } = props;
  const currentLabel = currentLabelOf(data);

  // git：当前在非主干时可选基点；默认保持现状（基于当前分支），弹窗内推荐主干
  const [createBase, setCreateBase] = useState<'trunk' | 'current'>('current');
  // svn：在 trunk/普通分支上用 trunk；在标签或独立目录里默认从当前目录复制（给子项目再开分支）
  const canTrunk = Boolean(data.layout?.trunk);
  const kind = data.currentKind;
  const canCurrent = kind === 'trunk' || kind === 'branch' || kind === 'tag';
  const defaultSvnBase: 'trunk' | 'current' = canCurrent && kind !== 'trunk' && kind !== 'branch' ? 'current' : canTrunk ? 'trunk' : 'current';
  const [svnBase, setSvnBase] = useState<'trunk' | 'current'>(defaultSvnBase);

  /** SVN 预览：源 URL（trunk / 当前目录）→ 目标 URL（branches/新分支名）；显示 `^/` 简写 */
  const projectRoot = (data.projectRoot ?? '').replace(/\/+$/, '');
  const svnSourceUrl =
    svnBase === 'current' ? (data.currentUrl ?? '') : projectRoot ? `${projectRoot}/trunk` : '';
  const svnTargetUrl = projectRoot ? `${projectRoot}/branches/${name}` : '';
  const shortUrl = (url: string) => {
    if (!projectRoot || !url.startsWith(projectRoot)) return url;
    const rel = url.slice(projectRoot.length);
    return rel ? `^${rel}` : url;
  };
  const svnPreview = svnSourceUrl || svnTargetUrl ? (
    <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '2px 10px' }}>
      <span className="dim">{t('ops.branch.createSource')}</span>
      <span className="mono" style={{ minWidth: 0, wordBreak: 'break-all' }} title={svnSourceUrl}>{shortUrl(svnSourceUrl)}</span>
      <span className="dim">{t('ops.branch.createTarget')}</span>
      <span className="mono" style={{ minWidth: 0, wordBreak: 'break-all' }} title={svnTargetUrl}>{shortUrl(svnTargetUrl)}</span>
    </div>
  ) : null;

  return (
    <ConfirmModal
      // 新建分支
      title={t('ops.branch.createTitle')}
      width={480}
      message={
        repoType === 'git' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, whiteSpace: 'normal' }}>
            {/* 确认创建新分支 {name}？ */}
            <div>{t('ops.branch.confirmCreate', { name })}</div>
            {/* 将创建分支 {name}（基于 {base}） */}
            <div className="dim small">{t('ops.branch.gitCreatePreview', { name, base: createBase === 'trunk' ? trunkBase! : data.current })}</div>
            <label className="row" style={{ alignItems: 'center', gap: 6, cursor: 'pointer' }}>
              <input type="radio" checked={createBase === 'trunk'} onChange={() => setCreateBase('trunk')} />
              {/* 基于主干 {base}（推荐） */}
              <span>{t('ops.branch.baseTrunk', { base: trunkBase! })}</span>
            </label>
            <label className="row" style={{ alignItems: 'center', gap: 6, cursor: 'pointer', flexWrap: 'wrap' }}>
              <input type="radio" checked={createBase === 'current'} onChange={() => setCreateBase('current')} />
              {/* 基于当前分支 {current} */}
              <span>{t('ops.branch.baseCurrent', { current: data.current })}</span>
              {createBase === 'current' && (
                <span className="small" style={{ color: 'var(--warn)' }}>
                  {/* ⚠ 包含 {current} 已提交的改动，合并回主干时一并进入 */}
                  {t('ops.branch.baseCurrentWarn', { current: data.current })}
                </span>
              )}
            </label>
            {/* 创建后不自动切换，仍停留在当前分支 {current}。 */}
            <div className="dim small">{t('ops.branch.noAutoSwitch', { current: data.current })}</div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, whiteSpace: 'normal' }}>
            {/* 确认创建新分支 {name}？ */}
            <div>{t('ops.branch.confirmCreate', { name })}</div>
            {data.layout?.trunk && (
              <label className="row" style={{ alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                <input type="radio" checked={svnBase === 'trunk'} onChange={() => setSvnBase('trunk')} />
                {/* 从 trunk 复制（标准主干开发） */}
                <span>{t('ops.branch.baseSvnTrunk')}</span>
              </label>
            )}
            <label className="row" style={{ alignItems: 'center', gap: 6, cursor: 'pointer', flexWrap: 'wrap' }}>
              <input type="radio" checked={svnBase === 'current'} onChange={() => setSvnBase('current')} />
              {/* 从当前目录 {current} 复制 */}
              <span>{t('ops.branch.baseSvnCurrent', { current: currentLabel })}</span>
              {svnBase === 'current' && (
                <span className="small" style={{ color: 'var(--warn)' }}>
                  {/* ⚠ 包含当前目录已提交的全部改动；若它不在 trunk 层级，合回主干时要指定对应子目录 */}
                  {t('ops.branch.baseSvnCurrentWarn')}
                </span>
              )}
            </label>
            {/* 源（trunk/当前目录）→ 目标（branches/新分支名）预览 */}
            {svnPreview}
            {/* 创建后不自动切换，仍停留在 {current}。 */}
            <div className="dim small">{t('ops.branch.noAutoSwitch', { current: currentLabel })}</div>
          </div>
        )
      }
      // 创建
      confirmLabel={t('ops.branch.create')}
      confirmCmd={
        repoType === 'git'
          ? cmdOfRepo('git', 'branch_create', createBase === 'trunk' ? { name, base: trunkBase! } : { name })
          : svnBase === 'current'
            ? cmdOfRepo('svn', 'branch_create_from', { name, from: data.currentUrl ?? currentLabel, target: `${data.projectRoot}/branches/${name}` })
            : cmdOfRepo('svn', 'branch_create', { name })
      }
      onConfirm={(e) => {
        const base = repoType === 'git' ? (createBase === 'trunk' ? trunkBase : undefined) : svnBase === 'current' ? 'current' : undefined;
        props.onConfirm(base, e.currentTarget.getBoundingClientRect());
      }}
      onCancel={props.onCancel}
    />
  );
}
