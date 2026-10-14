/** Git 身份弹窗（user.name / user.email）：提交被 git 以「Author identity unknown」拒绝时弹出，
 *  保存后由宿主自动重试这次提交；从「Git 信息与配置」点「修改」进来时只保存不重试。
 *  作用域二选一：全局（--global，所有仓库生效，默认——git 自己的建议）/ 仅本仓库（只写 .git/config）。 */

import React, { useEffect, useState } from 'react';
import { get, post } from '../shared/api.js';
import { ResizableModal } from '../shell/modal-shell.js';
import { t } from '../../shared/i18n/index.js';

export function GitIdentityModal(props: {
  /** true = 提交失败进来的：主按钮显示「保存并重试提交」，保存成功后宿主会重放那次提交 */
  retry?: boolean;
  onClose: () => void;
  /** 保存成功（宿主决定后续：重试提交 / 提示并回退）；message 是服务端成功文案（含姓名邮箱） */
  onSaved: (message: string) => void;
}) {
  /** 当前有效值（打开时回显；未配置为空） */
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  /** 保存作用域：默认全局（git 自己的建议「to set your account's default identity」） */
  const [scope, setScope] = useState<'global' | 'repo'>('global');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    let cancelled = false;
    get
      .gitIdentity()
      .then((r) => {
        if (cancelled) return;
        setName(r.name);
        setEmail(r.email);
        // 已配置过就沿用它在的那一级（本仓库单独配过 = 用户有这个意图，别默认改回全局）
        if (r.scope) setScope(r.scope);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const submit = () => {
    if (busy) return;
    const n = name.trim();
    const e = email.trim();
    // 请填写姓名 / 请填写邮箱
    if (!n) { setErr(t('ops.gitIdentity.needName')); return; }
    if (!e) { setErr(t('ops.gitIdentity.needEmail')); return; }
    // 轻校验：git 不挑邮箱格式，但 GitHub 归属需要真实邮箱，明显不对就在本地拦下
    if (!/^\S+@\S+\.\S+$/.test(e)) { setErr(t('ops.gitIdentity.emailInvalid')); return; }
    setBusy(true);
    setErr('');
    void post
      .gitIdentitySave(n, e, scope)
      .then((r) => {
        if (!r.ok) {
          // 失败原因来自服务端（写配置失败等），原样展示
          setErr(r.message ?? '');
          return;
        }
        props.onSaved(r.message);
      })
      .catch((e2: Error) => setErr(e2.message))
      .finally(() => setBusy(false));
  };

  return (
    <div className="modal-mask">
      <ResizableModal width={480} minWidth={420}>
        {/* 设置 Git 身份 */}
        <h3>{t('ops.gitIdentity.title')}</h3>
        <div className="body">
          {/* 提交需要作者姓名和邮箱（Git 未配置时会被拒绝）。填一次，之后所有提交都用它 */}
          <div className="dim small" style={{ marginBottom: 10 }}>{t('ops.gitIdentity.lead')}</div>
          <div className="form-row">
            {/* 姓名 */}
            <label>{t('ops.gitIdentity.name')}</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submit();
              }}
              autoFocus
            />
          </div>
          <div className="form-row">
            {/* 邮箱 */}
            <label>{t('ops.gitIdentity.email')}</label>
            <input
              type="text"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submit();
              }}
            />
            {/* 建议用 GitHub 账号的邮箱，提交才能归属到你名下 */}
            <div className="dim small" style={{ marginTop: 6 }}>{t('ops.gitIdentity.emailHint')}</div>
          </div>
          <div className="form-row">
            {/* 保存到 */}
            <label>{t('ops.gitIdentity.scope')}</label>
            <div className="row" style={{ gap: 18, alignItems: 'center', flexWrap: 'wrap' }}>
              {/* display:flex 必须 inline：.form-row label 的 display:block (0,1,1) 会压过 .row (0,1,0)，否则 gap 不生效 */}
              <label className="row" style={{ display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer', marginBottom: 0 }}>
                <input type="radio" checked={scope === 'global'} onChange={() => setScope('global')} />
                {/* 全局 */}
                <span>{t('ops.gitIdentity.scopeGlobal')}</span>
                {/* 所有仓库通用 */}
                <span className="dim small">{t('ops.gitIdentity.scopeGlobalHint')}</span>
              </label>
              <label className="row" style={{ display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer', marginBottom: 0 }}>
                <input type="radio" checked={scope === 'repo'} onChange={() => setScope('repo')} />
                {/* 仅本仓库 */}
                <span>{t('ops.gitIdentity.scopeRepo')}</span>
                {/* 只写进本仓库的 .git/config */}
                <span className="dim small">{t('ops.gitIdentity.scopeRepoHint')}</span>
              </label>
            </div>
          </div>
          {err && (
            <div className="error small" style={{ marginTop: 4, wordBreak: 'break-all' }}>
              {err}
            </div>
          )}
        </div>
        <div className="foot">
          {/* 取消 */}
          <button onClick={props.onClose} disabled={busy}>{t('common.cancel')}</button>
          <button className="primary" disabled={busy || !name.trim() || !email.trim()} onClick={submit}>
            {/* 保存中… / 保存并重试提交 / 保存 */}
            {busy ? t('ops.gitIdentity.saving') : props.retry ? t('ops.gitIdentity.saveAndRetry') : t('common.save')}
          </button>
        </div>
      </ResizableModal>
    </div>
  );
}
