/** 共享访问门禁：远程页面先加入会话，成功后才挂载主界面。
 *
 *  - checking：什么都不渲染（避免主界面发起会被 403 的请求）
 *  - full：人数已满，显示等待页并自动重试
 *  - denied：IP 不在白名单 / 服务重启中，显示无法访问并自动重试
 *  - ok：注入访问状态，挂载主界面
 */
import React from 'react';
import { t } from '../../shared/i18n/index.js';
import type { ShareAccess } from '../../shared/share.js';
import { ShareProvider } from './share-context.js';
import { useViewerSession, type ViewerState } from './use-viewer-session.js';

function GateFrame(props: { icon: string; title: string; message: string; note?: string; extra?: string }) {
  return (
    <div className="share-gate">
      <div className="share-gate-card">
        <div className="share-gate-icon" aria-hidden>{props.icon}</div>
        <h2 className="share-gate-title">{props.title}</h2>
        <p className="share-gate-msg">{props.message}</p>
        {props.note && <p className="dim small">{props.note}</p>}
        {props.extra && <p className="dim small">{props.extra}</p>}
      </div>
    </div>
  );
}

export function ShareGate(props: { state: ViewerState; info: ShareAccess | null }) {
  if (props.state === 'full') {
    const info = props.info;
    const online = info
      ? info.max > 0
        ? t('share.online', { n: info.viewers, max: info.max })
        : t('share.unlimited')
      : undefined;
    return (
      <GateFrame
        icon="👥"
        title={t('share.fullTitle')}
        message={t('share.fullMsg')}
        note={t('share.fullRetry')}
        extra={online}
      />
    );
  }
  if (props.state === 'denied') {
    return (
      <GateFrame
        icon="⛔"
        title={t('share.deniedTitle')}
        message={t('share.deniedMsg')}
        note={t('share.deniedRetry')}
      />
    );
  }
  // checking：静默等待，不挂载主界面
  return <div className="share-gate" />;
}

/** 挂载点：先过共享门禁，成功后把访问状态注入整棵树 */
export function ShareGuard(props: { children: React.ReactNode }) {
  const { state, info } = useViewerSession();
  if (state === 'ok' && info) return <ShareProvider value={info}>{props.children}</ShareProvider>;
  return <ShareGate state={state} info={info} />;
}
