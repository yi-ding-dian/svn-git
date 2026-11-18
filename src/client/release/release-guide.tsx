/** 未接入一键发版时的引导页：告诉用户缺什么、推荐哪种发布方式，
 *  提供「复制完整 AI 提示词」和重新检测。提示词里包含指南全文、项目根和确认要求。 */
import React, { useState } from 'react';
import { IconCopy, IconRefresh } from '../ui/icons.js';
import { get, type ReleaseInfo } from '../shared/api.js';
import { t } from '../../shared/i18n/index.js';

type CopyState = 'idle' | 'busy' | 'done' | 'error';

export function ReleaseGuidePanel(props: { info: ReleaseInfo; onRefresh: () => void }) {
  const [copyState, setCopyState] = useState<CopyState>('idle');
  const info = props.info;
  const source = info.kindSource ?? 'none';
  const isDocker = info.kind === 'docker';

  const kindLabel =
    source === 'none'
      ? t('ops.release.guideKindUnknown')
      : isDocker
        ? t('ops.release.guideKindDocker')
        : t('ops.release.guideKindPackage');

  const evidence = info.kindEvidence ?? [];
  const missing = info.missing ?? [];

  /** 拉取「项目根 + 完整指南 + 确认要求」并写入剪贴板 */
  const copyPrompt = () => {
    if (copyState === 'busy') return;
    setCopyState('busy');
    void get
      .releaseGuidePrompt()
      .then((r) => {
        if (!r.ok || !r.text) {
          setCopyState('error');
          return;
        }
        return navigator.clipboard?.writeText(r.text).then(() => {
          setCopyState('done');
          window.setTimeout(() => setCopyState('idle'), 2500);
        });
      })
      .catch(() => setCopyState('error'));
  };

  const copyLabel =
    copyState === 'busy'
      ? t('ops.release.guideCopying')
      : copyState === 'done'
        ? t('ops.release.guideCopied')
        : copyState === 'error'
          ? t('ops.release.guideCopyFailed')
          : t('ops.release.guideCopyPrompt');

  return (
    <div>
      <div style={{ fontWeight: 700 }}>{t('ops.release.guideTitle')}</div>
      <div className="dim small" style={{ marginTop: 6, lineHeight: 1.7 }}>
        {t('ops.release.guideIntro')}
      </div>

      {/* 用户接下来要做什么：复制提示词，让 AI 判断并等确认 */}
      <div style={{ marginTop: 12 }}>
        <div className="dim small">{t('ops.release.guideStepsTitle')}</div>
        <ol className="small" style={{ margin: '4px 0 0', paddingLeft: 20, lineHeight: 1.9 }}>
          <li>{t('ops.release.guideStep1')}</li>
          <li>{t('ops.release.guideStep2')}</li>
          <li>{t('ops.release.guideStep3')}</li>
          <li>{t('ops.release.guideStep4')}</li>
        </ol>
      </div>

      <div style={{ marginTop: 12, background: 'var(--panel2)', borderRadius: 8, padding: '10px 12px' }}>
        <div className="small">
          {kindLabel}
          {source === 'config' && (
            <span className="dim"> · {t('ops.release.guideFromConfig')}</span>
          )}
        </div>
        {source !== 'config' && evidence.length > 0 && (
          <div className="dim small" style={{ marginTop: 4 }}>
            {t('ops.release.guideEvidence', { items: evidence.join('、') })}
          </div>
        )}
        {source === 'none' && (
          <div className="small" style={{ color: 'var(--warn)', marginTop: 4 }}>
            {t('ops.release.guideOther')}
          </div>
        )}
      </div>

      {missing.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div className="dim small">{t('ops.release.guideMissing')}</div>
          <div className="mono small" style={{ marginTop: 4, lineHeight: 1.7 }}>
            {missing.slice(0, 8).map((f) => (
              <div key={f}>· {f}</div>
            ))}
          </div>
        </div>
      )}

      <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
        <button
          className="mini primary"
          onClick={copyPrompt}
          disabled={copyState === 'busy'}
          title={t('ops.release.guideCopyTip')}
        >
          <IconCopy size={14} /> {copyLabel}
        </button>
        <button className="mini" onClick={props.onRefresh}>
          <IconRefresh size={14} /> {t('ops.release.guideRecheck')}
        </button>
      </div>

      <div className="dim small" style={{ marginTop: 8, lineHeight: 1.6 }}>
        {t('ops.release.guideCommitHint')}
      </div>
    </div>
  );
}
