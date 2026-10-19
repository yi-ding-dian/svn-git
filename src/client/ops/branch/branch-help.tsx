/** 分支管理·使用说明折叠块（纯展示，展开状态自管理） */
import React, { useState } from 'react';
import { HelpNote } from '../../ui/ui.js';
import { t } from '../../../shared/i18n/index.js';

export function BranchHelp(props: { repoType: 'svn' | 'git' }) {
  // 科普折叠块展开状态（新手教学，默认收起不打扰）
  const [showHelp, setShowHelp] = useState(false);
  return (
    <>
      <div
        className="row small dim nowrap"
        style={{ gap: 6, cursor: 'pointer', userSelect: 'none', padding: '2px 0', marginBottom: showHelp ? 6 : 0 }}
        onClick={() => setShowHelp((s) => !s)}
        title={t(showHelp ? 'ops.branch.collapse' : 'ops.branch.expand')}
      >
        <span style={{ display: 'inline-block', transition: 'transform .15s', transform: showHelp ? 'rotate(90deg)' : '', fontSize: 10 }}>▶</span>
        <span>{t(showHelp ? 'ops.branch.helpCollapse' : 'ops.branch.helpExpand')}</span>
      </div>
      {showHelp && (
        <HelpNote>
          {props.repoType === 'git' ? (
            <>
              {/* 分支 = 同一份代码的平行工作空间，互不干扰。在分支上改代码不会影响主干。 */}
              {t('ops.branch.helpGit.intro')}
              {/* ➕ 新建 / ：输入名称回车 = 从当前代码状态开一条新线 */}
              <br />· <strong className="help-k ok">{t('ops.branch.help.new')}</strong>{t('ops.branch.helpGit.newText')}
              {/* ⇄ 切换 / ：换到另一个分支工作。未提交的修改能否带过去，取决于目标分支有没有动过那些文件——目标分支没动 → 改动跟着你走；目标分支也改过 → 切换会被拒绝，需先提交或储藏（未跟踪的新文件永远能带过去） */}
              <br />· <strong className="help-k primary">{t('ops.branch.help.switch')}</strong>{t('ops.branch.helpGit.switchText')}
              {/* 🔀 合并 / ：把别的分支的改动搬进当前分支。先切到目的地分支，再点来源分支的「合并」（站在哪，哪就是目的地） */}
              <br />· <strong className="help-k accent">{t('ops.branch.help.merge')}</strong>{t('ops.branch.helpGit.mergeText')}
              {/* ✕ 删除 / ：已合并的分支可删除（内容已进目标分支，不丢失）。主干（main/master）是团队稳定版本，不能删除 */}
              <br />· <strong className="help-k err">{t('ops.branch.help.delete')}</strong>{t('ops.branch.helpGit.deleteText')}
              {/* 灰色的远程行（origin/xxx）= 服务器上那个分支的镜像，不是你本地的分支。本地还没有它时，点「切换」= 新建同名本地分支并自动跟踪它（拉同事的分支就靠这一步）；本地已有同名分支时，按钮会变成「切到本地 xxx」 */}
              <br />· {t('ops.branch.helpGit.remoteText')}
              <br />
              {/* 绿色 ● = 当前所在分支 */}
              {t('ops.branch.helpGit.currentMark')}
            </>
          ) : (
            <>
              {/* SVN 分支是版本库里的目录复制（branches/）。默认在 trunk 上开发，需要独立改动时复制一份到 branches/ 再继续。 */}
              {t('ops.branch.helpSvn.intro')}
              {/* ➕ 新建 / ：输入名称回车 = 复制 trunk（或当前目录）创建分支 */}
              <br />· <strong className="help-k ok">{t('ops.branch.help.new')}</strong>{t('ops.branch.helpSvn.newText')}
              {/* ⇄ 切换 / ：工作副本指向该分支（本地改动会尽量保留，可能冲突） */}
              <br />· <strong className="help-k primary">{t('ops.branch.help.switch')}</strong>{t('ops.branch.helpSvn.switchText')}
              {/* 🔀 合并 / ：把该分支的改动并入当前工作副本（合并前请先更新） */}
              <br />· <strong className="help-k accent">{t('ops.branch.help.merge')}</strong>{t('ops.branch.helpSvn.mergeText')}
              {/* ✕ 删除 / ：已合并分支可删除。主干（trunk）是团队稳定版本，不能删除 */}
              <br />· <strong className="help-k err">{t('ops.branch.help.delete')}</strong>{t('ops.branch.helpSvn.deleteText')}
              <br />
              {/* 绿色 ● = 当前分支 */}
              {t('ops.branch.helpSvn.currentMark')}
            </>
          )}
        </HelpNote>
      )}
    </>
  );
}
