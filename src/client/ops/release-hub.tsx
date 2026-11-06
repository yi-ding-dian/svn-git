/** 「发布」弹窗（⋯ 菜单）：一个入口整合发布历史与发布新版本。
 *  - 发布历史：origin 是 github.com 时可用；
 *  - 发布新版本：项目根有 deploy/release.mjs 时可用；
 *  两个 tab 按能力显示，默认落在发布历史（发布是危险操作，不默认展示）。
 *  历史 tab 的「刷新 / 在 GitHub 打开」放在弹窗底部的 foot，不覆盖内容。 */
import React, { useRef, useState } from 'react';
import { ModalShell } from '../shell/modal-shell.js';
import { IconRelease, IconRefresh, IconExternal } from '../ui/icons.js';
import { GitHubReleasesPanel, type ReleasesPanelHandle } from './github-releases.js';
import { ReleaseFormPanel, type ReleaseFormHandle } from './release-modal.js';
import { LocalBuildPanel } from './local-build.js';
import { ReleaseCleanupModal } from './release-cleanup.js';
import { ConfirmModal } from '../ui/prompt.js';
import { post } from '../shared/api.js';
import type { PickDirRequest } from './branch/branch-shared.js';
import { t } from '../../shared/i18n/index.js';

export function ReleaseHubModal(props: {
  canRelease: boolean;
  isGithub: boolean;
  /** 有远程仓库：非 GitHub 项目也能发版（只是没有发布历史 tab） */
  hasRemote: boolean;
  /** 目录/文件选择弹窗（本地打包选脚本）：ops 不能直接引用 repo 的目录浏览器，由 shell 统一渲染 */
  onPickDir?: (req: PickDirRequest) => void;
  onClose: () => void;
}) {
  const showHistory = props.isGithub;
  const showForm = props.canRelease || props.hasRemote;
  const [tab, setTab] = useState<'history' | 'form' | 'local'>(
    showHistory ? 'history' : showForm ? 'form' : 'local'
  );
  const releasesRef = useRef<ReleasesPanelHandle>(null);
  const formRef = useRef<ReleaseFormHandle>(null);
  const [releasesUrl, setReleasesUrl] = useState('');
  /** 发布表单上报的 foot 按钮状态（是否禁用 / 按钮文字） */
  const [formState, setFormState] = useState<{ disabled: boolean; label: string }>({ disabled: true, label: '' });
  /** 本地打包是否在运行：运行中关闭弹窗要二次确认 */
  const [localRunning, setLocalRunning] = useState(false);
  const [closeConfirm, setCloseConfirm] = useState(false);
  /** 批量清理弹窗（保留最近 N 个版本，删除更早的产物） */
  const [cleanupOpen, setCleanupOpen] = useState(false);

  const requestClose = () => {
    if (localRunning) {
      setCloseConfirm(true);
      return;
    }
    props.onClose();
  };

  const openReleases = () => {
    if (releasesUrl) void post.openUrl(releasesUrl).catch(() => {});
  };

  return (
    <>
    <ModalShell
      title={t('ops.releaseHub.title')}
      icon={<IconRelease size={18} />}
      width={680}
      minWidth={560}
      // 固定高度 = 发布历史 tab 的自然高度（实测 604px）：两个 tab 内容长短不同，
      // 自适应会让弹窗切换时跳来跳去；固定后内容多的那个内部滚动
      height={604}
      closeIcon
      // body 上内边距挪到 tab 行里：sticky 才能贴住顶部，不露出滚动内容；
      // 底部内边距和 foot 一起压缩，减少按钮周围的空白
      bodyStyle={{ paddingTop: 0, paddingBottom: 8 }}
      footStyle={{ paddingTop: 6, paddingBottom: 6 }}
      onClose={requestClose}
      foot={
        tab === 'history' ? (
          <>
            {/* 刷新 */}
            <button
              className="mini"
              onClick={() => releasesRef.current?.refresh()}
              title={t('repo.githubReleases.refresh')}
            >
              <IconRefresh size={14} /> {t('repo.githubReleases.refresh')}
            </button>
            {releasesUrl && (
              <button className="mini" onClick={openReleases} title={releasesUrl}>
                <IconExternal size={14} /> {t('repo.githubReleases.openGithub')}
              </button>
            )}
          </>
        ) : tab === 'form' && formState.label ? (
          // 发布 {tag}；引导态 label 为空，foot 不显示发布按钮。本地打包在跑时禁用发布，避免并发改版本
          <button className="primary" disabled={formState.disabled || localRunning} onClick={() => formRef.current?.run()}>
            {formState.label}
          </button>
        ) : null
      }
    >
      <div
        className="row"
        style={{
          gap: 8,
          marginBottom: 8,
          // 两个 tab 固定在上方：内容再长也只滚动下面的区域
          position: 'sticky',
          top: 0,
          zIndex: 2,
          background: 'var(--panel)',
          paddingTop: 8,
          paddingBottom: 6,
        }}
      >
        {showHistory && (
          <button className={tab === 'history' ? 'mini primary' : 'mini'} onClick={() => setTab('history')}>
            {t('ops.releaseHub.history')}
          </button>
        )}
        {showForm && (
          <button className={tab === 'form' ? 'mini primary' : 'mini'} onClick={() => setTab('form')}>
            {t('ops.releaseHub.form')}
          </button>
        )}
        {/* 本地打包：始终显示；没有脚本时面板内提示 */}
        <button className={tab === 'local' ? 'mini primary' : 'mini'} onClick={() => setTab('local')}>
          {t('ops.releaseHub.local')}
        </button>
      </div>

      {tab === 'history' && showHistory && (
        <GitHubReleasesPanel
          ref={releasesRef}
          onUrlChange={setReleasesUrl}
          onCleanup={() => setCleanupOpen(true)}
        />
      )}
      {tab === 'form' && showForm && (
        <ReleaseFormPanel ref={formRef} onStateChange={setFormState} onClose={requestClose} />
      )}
      {/* 本地打包面板常驻（切 tab 只隐藏）：条件渲染会卸载组件、abort 正在跑的构建 */}
      <div style={{ display: tab === 'local' ? 'flex' : 'none', flexDirection: 'column', flex: 1, minHeight: 0 }}>
        <LocalBuildPanel active={tab === 'local'} onRunningChange={setLocalRunning} onPickDir={props.onPickDir} />
      </div>
    </ModalShell>
      {cleanupOpen && (
        <ReleaseCleanupModal
          onClose={() => setCleanupOpen(false)}
          onDone={() => releasesRef.current?.refresh()}
        />
      )}
      {closeConfirm && (
        <ConfirmModal
          danger
          title={t('ops.localBuild.closeWhileRunningTitle')}
          message={t('ops.localBuild.closeWhileRunningMsg')}
          confirmLabel={t('ops.localBuild.closeWhileRunningConfirm')}
          onConfirm={() => {
            setCloseConfirm(false);
            props.onClose();
          }}
          onCancel={() => setCloseConfirm(false)}
        />
      )}
    </>
  );
}
