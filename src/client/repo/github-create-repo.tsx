/** GitHub 新建仓库弹窗（顶栏 ⋯ 菜单入口；git 项目且 origin 尚未指向 github.com 时可见）：
 *  填 仓库名（默认取当前目录名并规范化）/ 描述 / 公开私有 → 服务端建**空仓库**（不带 README，
 *  避免与本地已有提交冲突）并自动把 origin 指向它；成功后由 modal-host 决定要不要立即推送。
 *  凭据：优先复用已存的 Git 凭据（config.git，GitHub 用户名+Token——建仓库与推送共用一套）；
 *  没存过时弹窗内联填写，点「创建仓库」先保存（复用 /api/git-auth，推送也一并配好）再建。 */

import React, { useEffect, useState } from 'react';
import { get, post, type GitHubCreateResult } from '../shared/api.js';
import { ResizableModal } from '../shell/modal-shell.js';
import { t } from '../../shared/i18n/index.js';
import { normalizeGhRepoName, sanitizeGhRepoName } from '../../shared/github.js';
import { useGitHubCred, GitHubCredBox } from './github-cred.js';

/** 目录名 → 合法 GitHub 仓库名（默认值）：非法字符（含中文）换成 -，去首尾 - / .；结果为空回退 'repo' */
function defaultRepoName(root: string | null): string {
  const base = (root ?? '').replace(/[/\\]+$/, '').split(/[/\\]/).pop() ?? '';
  return normalizeGhRepoName(base) || 'repo';
}

export function GitHubCreateModal(props: {
  /** 当前仓库根目录（默认仓库名 = 目录名） */
  root: string | null;
  onClose: () => void;
  /** 创建成功（origin 已指向新仓库）；hasCommit / remoteSet 语义见 GitHubCreateResult */
  onCreated: (r: GitHubCreateResult) => void;
}) {
  const [name, setName] = useState(() => defaultRepoName(props.root));
  const [desc, setDesc] = useState('');
  const [isPrivate, setIsPrivate] = useState(true); // 默认私有（安全默认，防误公开）
  /** 凭据（已存/内联填写，共享模块管理；mode=checking 时创建按钮禁用） */
  const cred = useGitHubCred();
  /** 当前 origin（非空才显示警告——创建后会被改指到新仓库） */
  const [originUrl, setOriginUrl] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // 已有 origin：创建后会被 setRemote 覆盖，提前如实告知
    get
      .gitInfo()
      .then((r) => {
        if (!cancelled && r.remote) setOriginUrl(r.remote);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const submit = () => {
    const n = normalizeGhRepoName(name);
    if (busy) return;
    if (!n) {
      // 仓库名不合法：不能只由 - / . 组成
      setErr(t('repo.githubCreate.nameInvalid'));
      return;
    }
    if (cred.mode === 'input' && (!cred.user.trim() || !cred.token)) {
      // 请填写用户名和 Token
      setErr(t('repo.githubCreate.needCred'));
      return;
    }
    setBusy(true);
    setErr('');
    void (async () => {
      try {
        // 内联凭据先保存（与推送认证同一份存储；保存失败就停，不拿无效凭据去建仓库）
        if (cred.mode === 'input') {
          const sr = await post.gitAuthSave(cred.user.trim(), cred.token);
          if (!sr.ok) {
            // 凭据保存失败：{msg}
            setErr(t('repo.githubCreate.saveFailed', { msg: sr.message }));
            return;
          }
        }
        const r = await post.githubCreateRepo(n, desc.trim(), isPrivate);
        if (!r.ok) {
          // 失败原因来自服务端（重名 / 权限不足 / 网络不通等）
          setErr(r.message ?? '');
          return;
        }
        props.onCreated(r);
      } catch (e) {
        setErr((e as Error).message);
      } finally {
        setBusy(false);
      }
    })();
  };

  return (
    <div className="modal-mask">
      <ResizableModal width={480} minWidth={420}>
        {/* GitHub 新建仓库 */}
        <h3>{t('repo.githubCreate.title')}</h3>
        <div className="body">
          {/* 将在 GitHub 上创建空仓库（不带 README），并把 origin 指向它 */}
          <div className="dim small" style={{ marginBottom: 10 }}>{t('repo.githubCreate.note')}</div>
          <div className="form-row">
            {/* 仓库名 */}
            <label>{t('repo.githubCreate.name')}</label>
            <input
              type="text"
              value={name}
              // 实时过滤非法字符（中文/空格等 → '-'，与 GitHub 网页行为一致）；提交时再做完整规范化
              onChange={(e) => setName(sanitizeGhRepoName(e.target.value))}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submit();
              }}
              autoFocus
            />
          </div>
          <div className="form-row">
            {/* 描述（可选） */}
            <label>{t('repo.githubCreate.desc')}</label>
            <input type="text" value={desc} onChange={(e) => setDesc(e.target.value)} />
          </div>
          <div className="form-row">
            {/* 可见性 */}
            <label>{t('repo.githubCreate.visibility')}</label>
            <div className="row" style={{ gap: 18, alignItems: 'center', flexWrap: 'wrap' }}>
              {/* display:flex 必须 inline：.form-row label 的 display:block (0,1,1) 会压过 .row (0,1,0)，否则 gap 不生效 */}
              <label
                className="row"
                style={{ display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer', marginBottom: 0 }}
              >
                <input type="radio" checked={isPrivate} onChange={() => setIsPrivate(true)} />
                {/* 私有 */}
                <span>{t('repo.githubCreate.private')}</span>
                {/* 仅自己可见 */}
                <span className="dim small">{t('repo.githubCreate.privateHint')}</span>
              </label>
              <label
                className="row"
                style={{ display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer', marginBottom: 0 }}
              >
                <input type="radio" checked={!isPrivate} onChange={() => setIsPrivate(false)} />
                {/* 公开 */}
                <span>{t('repo.githubCreate.public')}</span>
                {/* 所有人可见 */}
                <span className="dim small">{t('repo.githubCreate.publicHint')}</span>
              </label>
            </div>
          </div>
          {/* 凭据区（已存显示用户名+可换 / 未存内联填写；与「新建仓库」弹窗共用 github-cred） */}
          <GitHubCredBox cred={cred} onEnter={submit} />
          {originUrl && (
            <div className="small" style={{ color: 'var(--warn)', marginBottom: 8, wordBreak: 'break-all' }}>
              {/* ⚠ 当前 origin 指向 {url}，创建后 origin 将改为新仓库 */}
              ⚠ {t('repo.githubCreate.originWarn', { url: originUrl })}
            </div>
          )}
          {err && (
            <div className="error small" style={{ marginTop: 4, wordBreak: 'break-all' }}>
              {err}
            </div>
          )}
        </div>
        <div className="foot">
          {/* 取消 */}
          <button onClick={props.onClose} disabled={busy}>{t('common.cancel')}</button>
          <button className="primary" disabled={busy || !name.trim() || cred.mode === 'checking'} onClick={submit}>
            {/* 创建中… / 创建仓库 */}
            {busy ? t('repo.githubCreate.busy') : t('repo.githubCreate.create')}
          </button>
        </div>
      </ResizableModal>
    </div>
  );
}
