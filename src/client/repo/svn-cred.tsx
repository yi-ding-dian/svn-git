/** SVN 账号密码弹窗（「获取仓库 → SVN 检出」专用）：
 *  两个时机共用——
 *   1) 获取前：工具配置和系统凭据缓存都没有账号时主动弹出（可「匿名获取」，服务器允许匿名读取时用）；
 *   2) 认证失败后：当前账号没有权限时弹出重试。
 *  与「浏览仓库 → 检出到本地」的 CheckoutAuthModal 区别：这里多一个「保存为默认 SVN 账号」勾选
 *  （获取仓库是长期行为，用户通常希望记住）；真正写入配置在**获取成功之后**（由 get-repo-task 做），
 *  密码错误不会污染已保存的账号。 */
import React, { useEffect, useState } from 'react';
import { ModalShell } from '../ui/modal-shell.js';
import { FormRow } from '../ui/ui.js';
import { isImeComposing } from '../shared/utils.js';
import { t } from '../../shared/i18n/index.js';

export interface SvnCredSubmit {
  username: string;
  password: string;
}

export function SvnCredModal(props: {
  /** 认证失败原因（获取前预弹为空——只是"还没有账号"；预检/任务失败时带具体原因） */
  error?: string;
  /** 正在验证账号（获取前预检）：按钮显示「验证中…」并禁用，避免重复提交 */
  verifying?: boolean;
  /** 预填用户名（系统凭据缓存里的账号 / 失败时实际使用的账号） */
  username?: string;
  /** 提供「匿名获取」（仅获取前预弹：服务器可能允许匿名读取） */
  allowAnonymous?: boolean;
  onAnonymous?: () => void;
  /** save = 勾选「保存为默认 SVN 账号」（获取成功后才会真正写入配置） */
  onSubmit: (cred: SvnCredSubmit, save: boolean) => void;
  onClose: () => void;
}): React.ReactElement {
  const [user, setUser] = useState(props.username ?? '');
  const [pass, setPass] = useState('');
  const [save, setSave] = useState(true);
  const [err, setErr] = useState('');
  /** 外部错误（验证失败）被手动关闭或用户开始修改后隐藏；父组件传新错误（又验证失败）时重新显示 */
  const [hideExternal, setHideExternal] = useState(false);
  useEffect(() => setHideExternal(false), [props.error]);
  const externalError = props.error && !hideExternal ? props.error : '';

  /** 用户开始输入：旧错误（校验/验证失败）立即消失，别一直挂在那儿 */
  const touched = () => {
    if (err) setErr('');
    if (props.error && !hideExternal) setHideExternal(true);
  };

  const submit = () => {
    if (!user.trim() || !pass) {
      // 请填写用户名和密码
      setErr(t('repo.co.needCred'));
      return;
    }
    props.onSubmit({ username: user.trim(), password: pass }, save);
  };

  /** 错误提示上的 ✕：手动关闭（与"输入即消失"互补） */
  const closeBtnStyle: React.CSSProperties = {
    border: 'none',
    background: 'transparent',
    cursor: 'pointer',
    color: 'inherit',
    padding: '0 2px',
    fontSize: 12,
    lineHeight: 1,
    flex: 'none',
  };

  return (
    <ModalShell icon="🔑" title={t('repo.get.svnCredTitle')} width={480} onClose={props.onClose} closeIcon hideFoot>
      {externalError ? (
        <div className="row small" style={{ color: 'var(--warn)', gap: 8, alignItems: 'flex-start' }}>
          <span style={{ flex: 1, whiteSpace: 'pre-line', wordBreak: 'break-all' }}>
            ⚠ {t('repo.get.svnCredFailHint')}
            {/* 具体原因（验证接口给的文案：账号密码错 / 没有该仓库权限） */}
            {externalError !== t('repo.get.svnCredFailHint') && (
              <div className="dim" style={{ marginTop: 4, fontSize: 11 }}>{externalError}</div>
            )}
          </span>
          <button style={closeBtnStyle} onClick={() => setHideExternal(true)} title={t('common.close')} aria-label={t('common.close')}>
            ✕
          </button>
        </div>
      ) : (
        <div className="small">{t('repo.get.svnCredHint')}</div>
      )}
      <div style={{ marginTop: 10 }}>
        {/* 用户名 */}
        <FormRow label={t('repo.co.credUser')}>
          <input
            type="text"
            autoFocus
            value={user}
            onChange={(e) => {
              setUser(e.target.value);
              touched();
            }}
          />
        </FormRow>
        {/* 密码 */}
        <FormRow label={t('repo.co.credPass')}>
          <input
            type="password"
            value={pass}
            onChange={(e) => {
              setPass(e.target.value);
              touched();
            }}
            onKeyDown={(e) => {
              if (isImeComposing(e)) return;
              if (e.key === 'Enter') submit();
            }}
          />
        </FormRow>
        {/* 保存为默认 SVN 账号（获取成功后写入；之后打开其他 SVN 项目也用它） */}
        <label className="row small" style={{ gap: 6, marginTop: 4 }}>
          <input type="checkbox" checked={save} onChange={(e) => setSave(e.target.checked)} />
          {t('repo.get.svnCredSave')}
        </label>
        {err && (
          <div className="row error small" style={{ marginTop: 6, gap: 8, alignItems: 'flex-start' }}>
            <span style={{ flex: 1 }}>{err}</span>
            <button style={closeBtnStyle} onClick={() => setErr('')} title={t('common.close')} aria-label={t('common.close')}>
              ✕
            </button>
          </div>
        )}
        <div className="row" style={{ gap: 8, marginTop: 12, justifyContent: 'flex-end' }}>
          {/* 取消 */}
          <button onClick={props.onClose}>{t('common.cancel')}</button>
          {props.allowAnonymous && (
            // 匿名获取（服务器允许匿名读取时才可用）
            <button onClick={props.onAnonymous} title={t('repo.get.svnCredAnonTip')}>
              {t('repo.get.svnCredAnon')}
            </button>
          )}
          {/* 获取 */}
          <button className="primary" onClick={submit} disabled={props.verifying}>
            {props.verifying ? t('repo.get.verifying') : t('repo.get.get')}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}
