/** GitHub 删除仓库弹窗（顶栏 ⋯ 菜单入口；与「GitHub 仓库信息」同条件：origin 指向 github.com 才可见）：
 *  危险操作——必须**输入完整仓库名**（owner/repo，与 GitHub 网页同款流程）才解锁「永久删除」按钮；
 *  服务端会再校验一次确认名（防绕过）。删除只作用于 origin 指向的仓库；**本地 origin 不做改动**
 *  （删完顶栏如实显示仓库已不存在，用户按需自行调整远程）。
 *  凭据用已存的 Git 凭据（classic Token 需 delete_repo 权限，服务端的错误文案会明确提示）。 */

import React, { useEffect, useState } from 'react';
import { get, post } from '../shared/api.js';
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

  /** 输入与完整名一致才解锁删除（GitHub 网页同款防手滑） */
  const matched = fullName !== '' && confirm.trim() === fullName;

  const submit = () => {
    if (busy || !matched) return;
    setBusy(true);
    setErr('');
    void post
      .githubDeleteRepo(confirm.trim())
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
      <ResizableModal width={480} minWidth={420}>
        {/* GitHub 删除仓库 */}
        <h3>{t('repo.ghDelete.title')}</h3>
        <div className="body">
          {/* 此操作不可撤销：将永久删除 GitHub 上的 {name} 及其全部提交、Issue 等数据（本地项目不受影响，origin 保留不动） */}
          <div className="error small" style={{ marginBottom: 10, wordBreak: 'break-all' }}>
            ⚠ {t('repo.ghDelete.warn', { name: fullName })}
          </div>
          <div className="form-row" style={{ marginBottom: 0 }}>
            {/* 输入 {name} 以确认删除 */}
            <label>{t('repo.ghDelete.inputLabel', { name: fullName })}</label>
            <input
              type="text"
              className="mono"
              placeholder={fullName}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submit();
              }}
              autoFocus
            />
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
            {busy ? t('repo.ghDelete.deleting') : t('repo.ghDelete.delete')}
          </button>
        </div>
      </ResizableModal>
    </div>
  );
}
