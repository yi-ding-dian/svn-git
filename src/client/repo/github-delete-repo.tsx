/** GitHub 删除仓库弹窗（顶栏 ⋯ 菜单入口；与「GitHub 仓库信息」同条件：origin 指向 github.com 才可见）：
 *  危险操作——必须**输入完整仓库名**（owner/repo，与 GitHub 网页同款流程）**且当场提供 Token**
 *  （不复用已保存凭据、不会保存——防"随便就删"，用户定稿）才解锁「永久删除」按钮；
 *  服务端会再校验（确认名 + Token 必填，防绕过）。删除只作用于 origin 指向的仓库；
 *  **本地 origin 不做改动**（删完顶栏如实显示仓库已不存在，用户按需自行调整远程）。
 *  Token 需 delete_repo 权限（classic）；无权限时服务端的错误文案会明确提示。 */

import React, { useEffect, useState } from 'react';
import { get, post } from '../shared/api.js';
import { isImeComposing } from '../shared/utils.js';
import { ResizableModal } from '../shell/modal-shell.js';
import { t } from '../../shared/i18n/index.js';
import { parseGithub } from '../../shared/github.js';

export function GitHubDeleteModal(props: {
  onClose: () => void;
  /** 删除成功（远程仓库已不存在；本地 origin 未改动） */
  onDeleted: (fullName: string) => void;
}) {
  const [fullName, setFullName] = useState('');
  const [confirm, setConfirm] = useState('');
  /** 当场提供的 Token（必填；仅本次使用、不保存） */
  const [token, setToken] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // 完整仓库名从 origin 解析；菜单可见性已保证是 github 远程，解析失败极罕见（恰逢切项目），留空则按钮禁用
    get
      .gitInfo()
      .then((r) => {
        if (cancelled) return;
        const github = parseGithub(r.remote ?? '');
        setFullName(github ? `${github.owner}/${github.repo}` : '');
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  /** 输入与完整名一致 + Token 已填，才解锁删除（GitHub 网页同款防手滑 + 当场凭证双门槛） */
  const matched = fullName !== '' && confirm.trim() === fullName && token.trim() !== '';

  const submit = () => {
    if (busy || !matched) return;
    setBusy(true);
    setErr('');
    void post
      .githubDeleteRepo(confirm.trim(), token.trim())
      .then((r) => {
        if (!r.ok) {
          // 失败原因来自服务端（权限不足 / 仓库不存在 / 网络不通等）
          setErr(r.message ?? '');
          return;
        }
        props.onDeleted(r.fullName ?? fullName);
      })
      .catch((e) => setErr((e as Error).message))
      .finally(() => setBusy(false));
  };

  return (
    <div className="modal-mask">
      <ResizableModal width={480} minWidth={420} onEsc={props.onClose}>
        {/* GitHub 删除仓库 */}
        <h3>{t('repo.githubDelete.title')}</h3>
        <div className="body">
          {/* 此操作不可撤销：将永久删除 GitHub 上的 {name} 及其全部提交、Issue 等数据（本地项目不受影响，origin 保留不动） */}
          <div className="error small" style={{ marginBottom: 10, wordBreak: 'break-all' }}>
            ⚠ {t('repo.githubDelete.warn', { name: fullName })}
          </div>
          <div className="form-row" style={{ marginBottom: 0 }}>
            {/* 输入 {name} 以确认删除 */}
            <label>{t('repo.githubDelete.inputLabel', { name: fullName })}</label>
            <input
              type="text"
              className="mono"
              placeholder={fullName}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              onKeyDown={(e) => {
                if (isImeComposing(e)) return;
                if (e.key === 'Enter') submit();
              }}
              autoFocus
            />
          </div>
          <div className="form-row" style={{ marginBottom: 0, marginTop: 12 }}>
            {/* GitHub Token（必填） */}
            <label>{t('repo.githubDelete.tokenLabel')}</label>
            <input
              type="password"
              className="mono"
              placeholder="ghp_… / github_pat_…"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              onKeyDown={(e) => {
                if (isImeComposing(e)) return;
                if (e.key === 'Enter') submit();
              }}
            />
            {/* 为防误删，需当场提供有 delete_repo 权限的 Token：不复用已保存凭据、不会保存，仅用于本次删除 */}
            <div className="dim small" style={{ marginTop: 4 }}>{t('repo.githubDelete.tokenHint')}</div>
          </div>
          {err && (
            <div className="error small" style={{ marginTop: 8, wordBreak: 'break-all' }}>
              {err}
            </div>
          )}
        </div>
        <div className="foot">
          {/* 取消 */}
          <button onClick={props.onClose} disabled={busy}>{t('common.cancel')}</button>
          <button className="danger" disabled={busy || !matched} onClick={submit}>
            {/* 删除中… / 永久删除 */}
            {busy ? t('repo.githubDelete.deleting') : t('repo.githubDelete.delete')}
          </button>
        </div>
      </ResizableModal>
    </div>
  );
}
