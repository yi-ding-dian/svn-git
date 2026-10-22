/** 分支管理·分支列表（行渲染 + 行内操作；数据/操作由容器提供） */
import React from 'react';
import type { BranchInfo } from '../../shared/api.js';
import { cmdOfRepo } from '../../shared/cmd-preview.js';
import { t } from '../../../shared/i18n/index.js';
import { isCurrentBranchOf, isTrunkName, mergeTargetOf } from './branch-shared.js';

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
  /** 点击本地分支的 ↑N/↓N 徽标（dialog 据 ahead/behind 决定更新/推送/分叉说明） */
  onTrackClick: (b: { name: string; ahead: number; behind: number }) => void;
  /** 检出为独立工作副本（本地 / 远程 / 当前分支都可用） */
  onCheckout?: (b: { name: string; remote: boolean }) => void;
}) {
  const { repoType, data, sel, busy, hasRemote } = props;
  // SVN 主干：不在 branches/ 下，单独合成一行（像 Git 列表里的 main/master）。
  // Git 仓库 trunkUrl 恒为 undefined，列表行为完全不变。
  const trunkUrl = repoType === 'svn' ? data?.mainlineUrl : undefined;
  const trunkName = data?.mainlineRelative ?? 'trunk';
  const trunkIsCurrent = data?.currentKind === 'trunk';
  // 合并按钮的悬浮提示：代具体名字（谁合到谁），避免「该分支/当前分支」看不出指向
  const mergeTarget = mergeTargetOf(repoType, data);
  const mergeTipOf = (source: string) =>
    t(mergeTarget.isWorkCopy ? 'ops.branch.mergeTipWorkCopy' : 'ops.branch.mergeTip', { source, target: mergeTarget.name });
  // 徽标宽度：SVN 显示「版本库」（3 字）要宽一点；Git 沿用 38，保持原布局
  const badgeWidth = repoType === 'svn' ? 44 : 38;
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
          <span className="badge" style={{ background: trunkIsCurrent ? 'var(--ok)' : 'var(--accent)', fontSize: 9, minWidth: badgeWidth, textAlign: 'center' }}>
            {/* 当前 / 主干（和 Git 列表一致：当前项显示「当前」+ 绿点） */}
            {t(trunkIsCurrent ? 'ops.branch.badgeCurrent' : 'ops.branch.trunkBadge')}
          </span>
          <span className="mono" style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{trunkName}</span>
          {(!trunkIsCurrent || props.onCheckout) && (
            <span className="row" style={{ gap: 4 }}>
              {!trunkIsCurrent && (
                <button
                  className="mini primary"
                  disabled={busy}
                  onClick={() => props.onSwitch('trunk')}
                  title={cmdOfRepo(repoType, 'branch_switch_target', { target: trunkName })}
                >
                  {/* 切换 */}
                  {t('ops.branch.switchBtn')}
                </button>
              )}
              {props.onCheckout && (
                <button
                  className="mini"
                  disabled={busy}
                  onClick={() => props.onCheckout?.({ name: 'trunk', remote: false })}
                  title={t(trunkIsCurrent ? 'ops.branch.checkoutCopyTip' : 'ops.branch.checkoutTip', { name: trunkName })}
                >
                  {/* 检出 / 检出副本 */}
                  {t(trunkIsCurrent ? 'ops.branch.checkoutCopyBtn' : 'ops.branch.checkoutBtn')}
                </button>
              )}
              {!trunkIsCurrent && (
                <button
                  className="mini btn-accent"
                  disabled={busy}
                  onClick={() => props.onMerge('trunk')}
                  title={`${cmdOfRepo(repoType, 'branch_merge_from', { source: trunkUrl })}\n\n${mergeTipOf(trunkName)}`}
                >
                  {/* 🔀 合并 */}
                  {t('ops.branch.mergeBtn')}
                </button>
              )}
            </span>
          )}
        </div>
      )}
      {/* 当前位置行（SVN，当前在 tags/独立目录）：像 Git 的当前分支一样带绿点和「当前」，
          否则列表里全是「本地」，看不出当前工作副本在哪 */}
      {repoType === 'svn' && data && (data.currentKind === 'tag' || data.currentKind === 'other') && (
        <div className="vcs-row" title={t('ops.branch.isCurrent')}>
          <span className="vcs-current" style={{ visibility: 'visible' }}>●</span>
          <span className="badge" style={{ background: 'var(--ok)', fontSize: 9, minWidth: badgeWidth, textAlign: 'center' }}>
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
        // 本地分支的远程同步状态（仅 git 有 upstream 时）：↑领先 / ↓落后 / ✓同步
        const tr = repoType === 'git' && !b.remote && b.upstream
          ? { ahead: b.ahead ?? 0, behind: b.behind ?? 0, upstream: b.upstream }
          : null;
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
            {/* SVN 分支全部在版本库 branches/ 下（后端沿用 Git 的 remote:false，不能据此显示「本地」） */}
            <span
              className="badge"
              style={{
                background: isCur || (repoType === 'git' && !b.remote) ? 'var(--ok)' : 'var(--dim)',
                fontSize: 9,
                minWidth: badgeWidth,
                textAlign: 'center',
              }}
            >
              {t(
                isCur
                  ? 'ops.branch.badgeCurrent'
                  : repoType === 'svn'
                    ? 'ops.branch.badgeRepo'
                    : b.remote
                      ? 'ops.branch.badgeRemote'
                      : 'ops.branch.badgeLocal',
              )}
            </span>
            <span className="mono" style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.name}</span>
            {/* 远程同步徽标：状态即入口——↓ 点击更新、↑ 点击推送、分叉点击看说明、✓ 不可点 */}
            {tr && (() => {
              const { ahead, behind, upstream } = tr;
              const clickable = ahead > 0 || behind > 0;
              const tip =
                ahead > 0 && behind > 0
                  ? t('ops.branch.trackDivergedTip', { name: b.name, upstream, ahead, behind })
                  : ahead > 0
                    ? t('ops.branch.trackAheadTip', { name: b.name, upstream, ahead })
                    : behind > 0
                      ? t('ops.branch.trackBehindTip', { name: b.name, upstream, behind })
                      : t('ops.branch.trackSyncedTip', { name: b.name, upstream });
              return (
                <span
                  className={`branch-track${clickable ? ' clickable' : ''}`}
                  title={tip}
                  onClick={(e) => {
                    // ✓（已同步）不响应；其余点击交给 dialog 决定动作
                    if (!clickable) return;
                    e.stopPropagation(); // 不触发行选中
                    props.onTrackClick({ name: b.name, ahead, behind });
                  }}
                >
                  {ahead > 0 && <span className="ahead">↑{ahead}</span>}
                  {behind > 0 && <span className="behind">↓{behind}</span>}
                  {!clickable && <span className="synced">✓</span>}
                </span>
              );
            })()}
            {/* 非当前分支的常规操作；当前分支若未推送也显示「推送到远程」（仅仓库配了远程时）。
                当前分支没有任何操作按钮时补一组同宽的隐藏占位：否则名字列会把同步徽标顶到行尾，
                与其它行的 ✓/↑N 列错开（用户实报）。 */}
            {(isCur === false || (repoType === 'git' && hasRemote && !b.remote && !isPushed) || Boolean(props.onCheckout)) ? (
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
                {props.onCheckout && (
                  <button
                    className="mini"
                    disabled={busy}
                    onClick={() => props.onCheckout?.({ name: b.name, remote: b.remote })}
                    title={t(isCur ? 'ops.branch.checkoutCopyTip' : 'ops.branch.checkoutTip', { name: b.name })}
                  >
                    {/* 检出 / 检出副本 */}
                    {t(isCur ? 'ops.branch.checkoutCopyBtn' : 'ops.branch.checkoutBtn')}
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
                    <button className="mini btn-accent" disabled={busy} onClick={() => props.onMerge(b.name)} title={`${cmdOfRepo(repoType, 'branch_merge', { name: b.name })}\n\n${mergeTipOf(b.name)}`}>{t('ops.branch.mergeBtn')}</button>
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
            ) : tr ? (
              // 当前分支（已同步到远程）：隐藏的占位按钮组，宽度与其它本地行的操作按钮一致
              <span className="row" style={{ gap: 4, visibility: 'hidden' }} aria-hidden="true">
                <button className="mini primary">{t('ops.branch.switchBtn')}</button>
                <button className="mini btn-accent">{t('ops.branch.mergeBtn')}</button>
                <button className="mini danger">{t('common.delete')}</button>
              </span>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
