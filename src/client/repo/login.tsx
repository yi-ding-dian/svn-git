/** SVN 账号设置弹窗 */
import React, { useState } from 'react';
import { post } from '../shared/api.js';
import { ResizableModal } from '../shell/modal-shell.js';
import { FormRow } from '../ui/ui.js';
import { t } from '../../shared/i18n/index.js';

export function LoginModal(props: {
  username: string;
  onClose: () => void;
  onSaved: () => void;
  onToast: (msg: string) => void;
}) {
  const [username, setUsername] = useState(props.username);
  const [password, setPassword] = useState('');
  const [trust, setTrust] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  // 已有账号时先显示状态面板（切换账号/退出登录），无账号直接显示表单
  const [editing, setEditing] = useState(!props.username);

  const submit = async () => {
    setBusy(true);
    try {
      await post.config({ username, password, trustServerCert: trust });
      props.onSaved();
      // SVN 账号已保存 / SVN 账号已清除
      props.onToast(username ? t('repo.login.saved') : t('repo.login.cleared'));
      props.onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  /** 退出登录：清除保存的账号密码，改用 svn 官方凭据缓存 */
  const logout = async () => {
    setBusy(true);
    try {
      await post.config({ username: '', password: '', trustServerCert: false });
      props.onSaved();
      // 已退出 SVN 登录（改用官方凭据缓存）
      props.onToast(t('repo.login.loggedOut'));
      props.onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-mask">
      <ResizableModal width={440} minWidth={420} onEsc={props.onClose}>
        {/* SVN 账号设置 */}
        <h3>{t('repo.login.title')}</h3>
        <div className="body">
          {!editing && props.username ? (
            <>
              <div className="form-row">
                {/* 当前已登录账号 */}
                <label>{t('repo.login.currentAccount')}</label>
                <div className="help-note" style={{ alignItems: 'center' }}>
                  <span className="badge svn" style={{ fontSize: 11 }}>SVN</span>
                  <b>{props.username}</b>
                  {/* （SVN 仓库操作使用此账号） */}
                  <span className="dim small">{t('repo.login.accountHint')}</span>
                </div>
              </div>
              <div className="row" style={{ gap: 8 }}>
                {/* 🔄 切换账号 */}
                <button className="primary" disabled={busy} onClick={() => setEditing(true)}>{t('repo.login.switch')}</button>
                {/* 🚪 退出登录 */}
                <button className="danger" disabled={busy} onClick={() => void logout()}>{t('repo.login.logout')}</button>
              </div>
            </>
          ) : (
            <>
              {/* 用户名（留空表示使用 svn 官方凭据缓存） */}
              <FormRow label={t('repo.login.usernameLabel')}>
                <input type="text" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus />
              </FormRow>
              {/* 密码 */}
              <FormRow label={t('repo.login.password')}>
                <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
              </FormRow>
              {/* 信任 HTTPS 自签名证书 */}
              <FormRow label={<><input type="checkbox" checked={trust} onChange={(e) => setTrust(e.target.checked)} /> {t('repo.login.trustCert')}</>} />
            </>
          )}
          {err && <div className="error">{err}</div>}
        </div>
        <div className="foot">
          {/* 取消 */}
          <button onClick={props.onClose} disabled={busy}>{t('common.cancel')}</button>
          {editing && (
            <button className="primary" onClick={() => void submit()} disabled={busy}>
              {/* 保存中… / 保存 */}
              {busy ? t('repo.saving') : t('common.save')}
            </button>
          )}
        </div>
      </ResizableModal>
    </div>
  );
}
