/** 分支管理·分支列表（行渲染 + 行内操作；数据/操作由容器提供） */
import React from 'react';
import type { BranchInfo } from '../../shared/api.js';
import { cmdOfRepo } from '../../shared/cmd-preview.js';
import { t } from '../../../shared/i18n/index.js';
import { isCurrentBranchOf, isTrunkName } from './branch-shared.js';

export function BranchList(props: {
  repoType: 'svn' | 'git';
  data: BranchInfo | null;
  /** 当前选中行（视觉选中态，不等于仓库当前分支） */
  sel: string;
  busy: boolean;
  hasRemote: boolean;
  onSelect: (name: string) => void;
  onSwitch: (name: string) => void;
  onMerge: (name: string) => void;
  onDelete: (name: string) => void;
  onPush: (name: string) => void;
  onRemoteDelete: (name: string) => void;
}) {
  const { repoType, data, sel, busy, hasRemote } = props;
  // SVN 主干：不在 branches/ 下，单独合成一行（像 Git 列表里的 main/master）。
  // Git 仓库 trunkUrl 恒为 undefined，列表行为完全不变。
  const trunkUrl = repoType === 'svn' ? data?.mainlineUrl : undefined;
  const trunkName = data?.mainlineRelative ?? 'trunk';
  const trunkIsCurrent = data?.currentKind === 'trunk';
  return (
    <div className="vcs-list" style={{ flex: 1, minHeight: 60 }}>
      {/* 加载中… */}
      {!data && <div className="dim" style={{ padding: '10px 6px' }}>{t('ops.loading')}</div>}
      {/* 暂无分支 / （项目根下没有 branches/ 目录） */}
      {data && data.branches.length === 0 && (
        <div className="dim" style={{ padding: '10px 6px' }}>
          {t('ops.branch.none')}
          {repoType === 'svn' ? t('ops.branch.noneSvn') : ''}
        </div>
      )}
      {/* 主干行（SVN）：主干不在 branches/ 里，单独列在最上面，提供切换/合并；不提供删除 */}
      {trunkUrl && (
        <div
          className="vcs-row"
          // 当前分支
          title={trunkIsCurrent ? t('ops.branch.isCurrent') : undefined}
        >
          <span className="vcs-current" style={{ visibility: trunkIsCurrent ? 'visible' : 'hidden' }}>●</span>
          <span className="badge" style={{ background: trunkIsCurrent ? 'var(--ok)' : 'var(--accent)', fontSize: 9, minWidth: 38, textAlign: 'center' }}>
            {/* 当前 / 主干（和 Git 列表一致：当前项显示「当前」+ 绿点） */}
            {t(trunkIsCurrent ? 'ops.branch.badgeCurrent' : 'ops.branch.trunkBadge')}
          </span>
          <span className="mono" style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{trunkName}</span>
          {!trunkIsCurrent && (
            <span className="row" style={{ gap: 4 }}>
              <button
                className="mini primary"
                disabled={busy}
                onClick={() => props.onSwitch('trunk')}
                title={cmdOfRepo(repoType, 'branch_switch_target', { target: trunkName })}
              >
                {/* 切换 */}
                {t('ops.branch.switchBtn')}
              </button>
              <button
                className="mini btn-accent"
                disabled={busy}
                onClick={() => props.onMerge('trunk')}
                title={`${cmdOfRepo(repoType, 'branch_merge_from', { source: trunkUrl })}\n\n${t('ops.branch.mergeTip')}`}
              >
                {/* 🔀 合并 */}
                {t('ops.branch.mergeBtn')}
              </button>
            </span>
          )}
        </div>
      )}
      {/* 当前位置行（SVN，当前在 tags/独立目录）：像 Git 的当前分支一样带绿点和「当前」，
          否则列表里全是「本地」，看不出当前工作副本在哪 */}
      {repoType === 'svn' && data && (data.currentKind === 'tag' || data.currentKind === 'other') && (
        <div className="vcs-row" title={t('ops.branch.isCurrent')}>
          <span className="vcs-current" style={{ visibility: 'visible' }}>●</span>
          <span className="badge" style={{ background: 'var(--ok)', fontSize: 9, minWidth: 38, textAlign: 'center' }}>
            {/* 当前 */}
            {t('ops.branch.badgeCurrent')}
          </span>
          <span className="mono" style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {data.currentKind === 'tag' ? `tags/${data.current}` : data.current}
          </span>
        </div>
      )}
      {data?.branches.map((b) => {
        // 当前项（tag/独立目录不在 branches 列表里，不能高亮同名分支）
        const isCur = isCurrentBranchOf(data, b.name);
        // 是否已推送：本地分支能否找到对应的 origin/<名字> 远程项
        const isPushed = data.branches.some((r) => r.remote && r.name === 'origin/' + b.name);
        // 远程行（origin/xxx；只有 git 有，svn 的 branchList 全是 remote:false）的「切换」实际语义
        // 取决于本地有没有同名分支（见 vcs/git.ts branchSwitch）：
        //   本地没有 → 新建本地跟踪分支并切过去（**这才是它的价值**：远程有、本地没有）
        //   本地已有 → 就是切到那个本地分支，名字是去掉 origin/ 前缀的那部分
        // 所以本地已有同名分支时按钮要说实情（「切到本地 xxx」）；而本地那个**正是当前分支**时
        // 点了等于没点——用户实报的困惑场景（点了 origin/main 的切换，只回一句"已切换到 main"），直接不显示
        const remoteLocal = b.remote ? b.name.split('/').slice(1).join('/') : '';
        const remoteHasLocal = b.remote ? data.branches.some((r) => !r.remote && r.name === remoteLocal) : false;
        const remoteIsCurrent = b.remote && remoteLocal === data.current;
        // SVN 分支的完整位置提示（列表里只显示名字，悬浮能看到它属于 branches/）
        const branchTip = repoType === 'svn' ? `branches/${b.name}` : '';
        const rowTitle = isCur
          ? branchTip
            ? `${branchTip}\n${t('ops.branch.isCurrent')}`
            : t('ops.branch.isCurrent')
          : branchTip || undefined;
        return (
          <div
            key={b.name}
            className={`vcs-row ${sel === b.name ? 'selected' : ''}`}
            onClick={() => props.onSelect(b.name)}
            title={rowTitle}
          >
            <span className="vcs-current" style={{ visibility: isCur ? 'visible' : 'hidden' }}>●</span>
            <span className="badge" style={{ background: b.remote ? 'var(--dim)' : 'var(--ok)', fontSize: 9, minWidth: 38, textAlign: 'center' }}>
              {t(isCur ? 'ops.branch.badgeCurrent' : b.remote ? 'ops.branch.badgeRemote' : 'ops.branch.badgeLocal')}
            </span>
            <span className="mono" style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.name}</span>
            {/* 非当前分支的常规操作；当前分支若未推送也显示「推送到远程」（仅仓库配了远程时） */}
            {(isCur === false || (repoType === 'git' && hasRemote && !b.remote && !isPushed)) && (
              <span className="row" style={{ gap: 4 }} onClick={(e) => e.stopPropagation()}>
                {!isCur && !remoteIsCurrent && (
                  <button
                    className="mini primary"
                    disabled={busy}
                    onClick={() => props.onSwitch(b.name)}
                    title={
                      b.remote
                        ? remoteHasLocal
                          // 本地已有分支 {local} —— {name} 对应的就是它\n点此切换到 {local}
                          ? `${t('ops.branch.remoteHasLocalTip', { local: remoteLocal, name: b.name })}\n\n${cmdOfRepo(repoType, 'branch_switch', { name: remoteLocal })}`
                          // 本地还没有这个分支\n点此新建本地跟踪分支 {local} 并切换过去
                          : `${t('ops.branch.remoteNoLocalTip', { local: remoteLocal })}\n\n${cmdOfRepo(repoType, 'branch_switch_remote', { name: remoteLocal, remote: b.name })}`
                        : cmdOfRepo(repoType, 'branch_switch', { name: b.name })
                    }
                  >
                    {/* 切到本地 {local} / 切换 */}
                    {b.remote && remoteHasLocal ? t('ops.branch.switchToLocal', { local: remoteLocal }) : t('ops.branch.switchBtn')}
                  </button>
                )}
                {repoType === 'git' && hasRemote && !b.remote && !isPushed && (
                  // 该分支尚未推送到远程\n点此将 {name} 推送到远程服务器（origin） / ⬆ 推送到远程
                  <button className="mini btn-accent" disabled={busy} onClick={() => props.onPush(b.name)} title={t('ops.branch.pushTip', { name: b.name })}>{t('ops.branch.pushBtn')}</button>
                )}
                {b.remote && (() => {
                  // 远程主干（origin/main|master）同本地主干一起保护：稳定分支不提供删除入口
                  const bare = b.name.split('/').slice(1).join('/');
                  return (
                    <button
                      className="mini danger"
                      disabled={busy || isTrunkName(bare)}
                      onClick={() => props.onRemoteDelete(b.name)}
                      title={isTrunkName(bare)
                        // 主干分支不能删除（团队稳定版本，防止误删）
                        ? t('ops.branch.trunkNoDelete')
                        // 删除远程分支：远程将不再存在（本地分支不受影响）
                        : `${cmdOfRepo(repoType, 'branch_remote_delete', { name: bare }) ?? ''}\n\n${t('ops.branch.remoteDeleteTip')}`}
                    >
                      {/* 删除远程 */}
                      {t('ops.branch.remoteDeleteBtn')}
                    </button>
                  );
                })()}
                {!b.remote && !isCur && (
                  <>
                    {/* 把该分支的改动合并到当前分支（先确保已切到目标分支） / 🔀 合并 */}
                    <button className="mini btn-accent" disabled={busy} onClick={() => props.onMerge(b.name)} title={`${cmdOfRepo(repoType, 'branch_merge', { name: b.name })}\n\n${t('ops.branch.mergeTip')}`}>{t('ops.branch.mergeBtn')}</button>
                    <button
                      className="mini danger"
                      disabled={busy || isTrunkName(b.name)}
                      title={isTrunkName(b.name)
                        // 主干分支不能删除（团队稳定版本，防止误删）
                        ? t('ops.branch.trunkNoDelete')
                        // 删除分支（已合并的分支才能删）
                        : `${cmdOfRepo(repoType, 'branch_delete', { name: b.name })}\n\n${t('ops.branch.deleteTip')}`}
                      onClick={() => props.onDelete(b.name)}
                    >
                      {/* 删除 */}
                      {t('common.delete')}
                    </button>
                  </>
                )}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
