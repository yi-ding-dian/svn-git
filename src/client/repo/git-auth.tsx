/** 推送认证弹窗（推送与克隆共用）：GitHub 用户名+Token / 服务器用户名+密码 / SSH 提示 */
import React, { useEffect, useState } from 'react';
import { get, post } from '../shared/api.js';
import { ResizableModal } from '../shell/modal-shell.js';
import { HelpNote } from '../ui/ui.js';

/** 推送认证弹窗：GitHub 用户名+Token / 服务器用户名+密码 / SSH 提示 */
export function GitPushAuthModal(props: {
  type: 'github' | 'server' | 'ssh';
  username?: string;
  /** 上次推送失败的认证错误（显示在窗口内提示用户检查） */
  error?: string;
  onClose: () => void;
  onSaved: () => void;
  onToast: (m: string, err?: boolean) => void;
  /** 用途（默认"推送"）：克隆等场景传"获取仓库"，否则标题/按钮/提示都会说错语境 */
  purpose?: string;
}) {
  const purpose = props.purpose ?? '推送';
  const [username, setUsername] = useState(props.username ?? '');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const isGithub = props.type === 'github';
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
      props.onToast('请填写用户名和密码', true);
      return;
    }
    setBusy(true);
    void post
      .gitAuthSave(username.trim(), password)
      .then((r) => {
        props.onToast(r.message, !r.ok);
        if (r.ok) props.onSaved();
      })
      .catch((e: Error) => props.onToast(`保存失败: ${(e as Error).message}`, true))
      .finally(() => setBusy(false));
  };

  return (
    <div className="modal-mask">
      <ResizableModal width={460} minWidth={420}>
        <h3>{isGithub ? `🔑 GitHub ${purpose}认证` : props.type === 'ssh' ? `🔑 SSH ${purpose}提示` : `🔑 Git 服务器${purpose}认证`}</h3>
        <div className="body">
          {props.error && (
            <div className="error" style={{ marginBottom: 10, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
              ⚠ 认证失败：{props.error}
            </div>
          )}
          {props.type === 'ssh' ? (
            <HelpNote>
              当前远程地址使用 <b>SSH</b>(git@…)。请确认本机已配置 SSH 密钥并已加入 ssh-agent
              （<span className="mono">ssh-keygen -t ed25519</span> 生成、<span className="mono">ssh-add</span> 加入、
              <span className="mono">ssh -T git@github.com</span> 验证）。
              如需使用用户名密码{purpose}，请改用 <b>HTTPS</b> 地址（可在「Git 信息」中修改远程地址）。
            </HelpNote>
          ) : (
            <>
              <div className="form-row">
                <label>{isGithub ? 'GitHub 用户名' : '用户名'}</label>
                <input type="text" placeholder={isGithub ? 'your-github-username' : '服务器用户名'} value={username} onChange={(e) => setUsername(e.target.value)} />
              </div>
              <div className="form-row">
                <label>{isGithub ? 'Personal Access Token' : '密码 / Token'}</label>
                <input
                  type="password"
                  placeholder={isGithub ? 'ghp_xxx（Settings → Developer settings → Tokens）' : '密码或访问令牌'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') save();
                  }}
                />
              </div>
              {isGithub && (
                <div className="dim small">
                  在 GitHub 的 Settings → Developer settings → Personal access tokens 生成，勾选
                  <b> repo </b> 权限即可{purpose}。
                </div>
              )}
            </>
          )}
        </div>
        <div className="foot">
          <button onClick={props.onClose}>取消</button>
          {props.type !== 'ssh' && (
            <button className="primary" disabled={busy} onClick={save}>
              {busy ? '保存中…' : `保存并${purpose}`}
            </button>
          )}
        </div>
      </ResizableModal>
    </div>
  );
}
