/** 推送认证弹窗（推送与克隆共用）：GitHub 用户名+Token / 服务器用户名+密码 / SSH 提示 */
import React, { useEffect, useState } from 'react';
import { get, post } from '../shared/api.js';
import { ResizableModal } from '../shell/modal-shell.js';
import { HelpNote } from '../ui/ui.js';
import { t } from '../../shared/i18n/index.js';

/** 推送认证弹窗：GitHub 用户名+Token / 服务器用户名+密码 / SSH 提示 */
export function GitPushAuthModal(props: {
  type: 'github' | 'server' | 'ssh';
  username?: string;
  /** 上次推送失败的认证错误（显示在窗口内提示用户检查） */
  error?: string;
  onClose: () => void;
  onSaved: () => void;
  onToast: (m: string, err?: boolean) => void;
  /** 用途（默认 'push' 推送）：'get' = 获取仓库（克隆/检出），否则标题/按钮/提示会说错语境。
   *  传语义枚举而非文案：purpose 要拼进多句句子，各语言的语序/说法由语言包决定 */
  purpose?: 'push' | 'get';
}) {
  const purpose = props.purpose ?? 'push';
  const [username, setUsername] = useState(props.username ?? '');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const isGithub = props.type === 'github';
  const isGet = purpose === 'get';
  // 打开时预填已保存的用户名（token 不回传，需重新输入）
  useEffect(() => {
    if (props.username) return;
    get
      .gitAuth()
      .then((r) => r.username && setUsername(r.username))
      .catch(() => {});
  }, [props.username]);

  const save = () => {
    if (!username.trim() || !password) {
      // 请填写用户名和密码
      props.onToast(t('repo.auth.needUserPass'), true);
      return;
    }
    setBusy(true);
    void post
      .gitAuthSave(username.trim(), password)
      .then((r) => {
        props.onToast(r.message, !r.ok);
        if (r.ok) props.onSaved();
      })
      // 保存失败: {msg}
      .catch((e: Error) => props.onToast(t('repo.auth.saveFailed', { msg: (e as Error).message }), true))
      .finally(() => setBusy(false));
  };

  return (
    <div className="modal-mask">
      <ResizableModal width={460} minWidth={420}>
        <h3>
          {isGithub
            // 🔑 GitHub 获取仓库认证 / 🔑 GitHub 推送认证
            ? isGet ? t('repo.auth.titleGetGithub') : t('repo.auth.titlePushGithub')
            : props.type === 'ssh'
              // 🔑 SSH 获取仓库提示 / 🔑 SSH 推送提示
              ? isGet ? t('repo.auth.titleGetSsh') : t('repo.auth.titlePushSsh')
              // 🔑 Git 服务器获取仓库认证 / 🔑 Git 服务器推送认证
              : isGet ? t('repo.auth.titleGetServer') : t('repo.auth.titlePushServer')}
        </h3>
        <div className="body">
          {props.error && (
            <div className="error" style={{ marginBottom: 10, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
              {/* ⚠ 认证失败：{msg} */}
              {t('repo.auth.failed', { msg: props.error })}
            </div>
          )}
          {props.type === 'ssh' ? (
            <HelpNote>
              {/* 三段命令（ssh-keygen / ssh-add / ssh -T）是真实命令，不翻；文本按段取，保住 mono 样式 */}
              {/* 当前远程地址使用 / (git@…)。请确认本机已配置 SSH 密钥并已加入 ssh-agent（ */}
              {t('repo.auth.ssh1')} <b>SSH</b>{t('repo.auth.ssh2')}
              {/*  生成、 */}
              <span className="mono">ssh-keygen -t ed25519</span>{t('repo.auth.ssh3')}
              {/*  加入、 */}
              <span className="mono">ssh-add</span>{t('repo.auth.ssh4')}
              {/*  验证）。 */}
              <span className="mono">ssh -T git@github.com</span>{t('repo.auth.ssh5')}
              {/*  如需使用用户名密码获取仓库，请改用  /  如需使用用户名密码推送，请改用  /  地址（可在「Git 信息」中修改远程地址）。 */}
              {isGet ? t('repo.auth.ssh6Get') : t('repo.auth.ssh6Push')}<b>HTTPS</b>{t('repo.auth.ssh7')}
            </HelpNote>
          ) : (
            <>
              <div className="form-row">
                {/* GitHub 用户名 / 用户名 */}
                <label>{isGithub ? t('repo.auth.githubUser') : t('repo.auth.user')}</label>
                {/* your-github-username / 服务器用户名 */}
                <input type="text" placeholder={isGithub ? t('repo.auth.githubUserPlaceholder') : t('repo.auth.serverUserPlaceholder')} value={username} onChange={(e) => setUsername(e.target.value)} />
              </div>
              <div className="form-row">
                {/* Personal Access Token / 密码 / Token */}
                <label>{isGithub ? t('repo.auth.patLabel') : t('repo.auth.passLabel')}</label>
                <input
                  type="password"
                  // ghp_xxx（Settings → Developer settings → Tokens） / 密码或访问令牌
                  placeholder={isGithub ? t('repo.auth.patPlaceholder') : t('repo.auth.passPlaceholder')}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') save();
                  }}
                />
              </div>
              {isGithub && (
                <div className="dim small">
                  {/* 在 GitHub 的 Settings → Developer settings → Personal access tokens 生成，勾选  /  权限即可获取仓库。 /  权限即可推送。 */}
                  {t('repo.auth.patHint1')}<b>repo</b>{isGet ? t('repo.auth.patHint2Get') : t('repo.auth.patHint2Push')}
                </div>
              )}
            </>
          )}
        </div>
        <div className="foot">
          {/* 取消 */}
          <button onClick={props.onClose}>{t('common.cancel')}</button>
          {props.type !== 'ssh' && (
            <button className="primary" disabled={busy} onClick={save}>
              {/* 保存中… / 保存并获取仓库 / 保存并推送 */}
              {busy ? t('repo.saving') : isGet ? t('repo.auth.saveAndGet') : t('repo.auth.saveAndPush')}
            </button>
          )}
        </div>
      </ResizableModal>
    </div>
  );
}
