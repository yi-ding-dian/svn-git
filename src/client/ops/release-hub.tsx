/** 「发布」弹窗（⋯ 菜单）：一个入口整合发布历史与发布新版本。
 *  - 发布历史：origin 是 github.com 时可用；
 *  - 发布新版本：项目根有 deploy/release.mjs 时可用；
 *  两个 tab 按能力显示，默认落在发布历史（发布是危险操作，不默认展示）。
 *  历史 tab 的「刷新 / 在 GitHub 打开」放在弹窗底部的 foot，不覆盖内容。 */
import React, { useRef, useState } from 'react';
import { ModalShell } from '../shell/modal-shell.js';
import { IconRelease, IconRefresh, IconExternal } from '../ui/icons.js';
import { GitHubReleasesPanel, type ReleasesPanelHandle } from '../repo/github-releases.js';
import { ReleaseFormPanel, type ReleaseFormHandle } from './release-modal.js';
import { post } from '../shared/api.js';
import { t } from '../../shared/i18n/index.js';

export function ReleaseHubModal(props: { canRelease: boolean; isGithub: boolean; onClose: () => void }) {
  const [tab, setTab] = useState<'history' | 'form'>(props.isGithub ? 'history' : 'form');
  const releasesRef = useRef<ReleasesPanelHandle>(null);
  const formRef = useRef<ReleaseFormHandle>(null);
  const [releasesUrl, setReleasesUrl] = useState('');
  /** 发布表单上报的 foot 按钮状态（是否禁用 / 按钮文字） */
  const [formState, setFormState] = useState<{ disabled: boolean; label: string }>({ disabled: true, label: '' });

  const openReleases = () => {
    if (releasesUrl) void post.openUrl(releasesUrl).catch(() => {});
  };

  return (
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
      onClose={props.onClose}
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
        ) : (
          // 发布 {tag}
          <button className="primary" disabled={formState.disabled} onClick={() => formRef.current?.run()}>
            {formState.label}
          </button>
        )
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
        {props.isGithub && (
          <button className={tab === 'history' ? 'mini primary' : 'mini'} onClick={() => setTab('history')}>
            {t('ops.releaseHub.history')}
          </button>
        )}
        {props.canRelease && (
          <button className={tab === 'form' ? 'mini primary' : 'mini'} onClick={() => setTab('form')}>
            {t('ops.releaseHub.form')}
          </button>
        )}
      </div>

      {tab === 'history' && props.isGithub && (
        <GitHubReleasesPanel ref={releasesRef} onUrlChange={setReleasesUrl} />
      )}
      {tab === 'form' && props.canRelease && (
        <ReleaseFormPanel ref={formRef} onStateChange={setFormState} />
      )}
    </ModalShell>
  );
}
