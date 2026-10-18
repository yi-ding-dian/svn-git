/** GitHub 凭据区（「GitHub 新建仓库」弹窗与「新建仓库」弹窗的 GitHub 类型共用）：
 *  优先复用已存的 Git 凭据（config.git，GitHub 用户名+Token——建仓库与推送共用一套）；
 *  没存过时内联填写（点「使用其他凭据」可切换）——提交方在真正调 GitHub 前先 gitAuthSave（复用 /api/git-auth）。
 *  useGitHubCred 管状态、GitHubCredBox 管渲染：两处弹窗字段与交互完全一致，文案也共用 repo.githubCreate.cred*。 */

import React, { useEffect, useState } from 'react';
import { get } from '../shared/api.js';
import { isImeComposing } from '../shared/utils.js';
import { t } from '../../shared/i18n/index.js';

export interface GitHubCred {
  /** checking=查已存凭据中（此时提交按钮应禁用）；saved=用已存；input=内联填写 */
  mode: 'checking' | 'saved' | 'input';
  savedUser: string;
  user: string;
  setUser: (v: string) => void;
  token: string;
  setToken: (v: string) => void;
  /** 切到内联填写（预填已存用户名，token 不回传需重新输入） */
  useOther: () => void;
}

/** GitHub 凭据状态：打开弹窗时查一次已存凭据（有 → saved；没有 → input） */
export function useGitHubCred(): GitHubCred {
  const [mode, setMode] = useState<'checking' | 'saved' | 'input'>('checking');
  const [savedUser, setSavedUser] = useState('');
  const [user, setUser] = useState('');
  const [token, setToken] = useState('');
  useEffect(() => {
    let cancelled = false;
    get
      .gitAuth()
      .then((r) => {
        if (cancelled) return;
        setSavedUser(r.username);
        setMode(r.hasPassword ? 'saved' : 'input');
      })
      .catch(() => {
        if (!cancelled) setMode('input');
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return {
    mode,
    savedUser,
    user,
    setUser,
    token,
    setToken,
    useOther: () => {
      setMode('input');
      setUser(savedUser);
      setToken('');
    },
  };
}

/** 凭据区渲染：saved 显示一行（用户名 + 换）；input 显示用户名/Token 两行 + 建仓库所需权限提示 */
export function GitHubCredBox({ cred, onEnter }: { cred: GitHubCred; onEnter?: () => void }) {
  if (cred.mode === 'checking') return null;
  if (cred.mode === 'saved') {
    return (
      <div className="row small" style={{ gap: 8, alignItems: 'center', marginBottom: 10 }}>
        {/* 使用已保存的 GitHub 凭据（{user}） */}
        <span className="dim">{t('repo.githubCreate.credSaved', { user: cred.savedUser })}</span>
        <button className="mini" onClick={cred.useOther}>
          {/* 使用其他凭据 */}
          {t('repo.githubCreate.credChange')}
        </button>
      </div>
    );
  }
  return (
    <>
      <div className="form-row">
        {/* GitHub 用户名 */}
        <label>{t('repo.githubCreate.credUser')}</label>
        <input type="text" placeholder="your-github-username" value={cred.user} onChange={(e) => cred.setUser(e.target.value)} />
      </div>
      <div className="form-row">
        {/* Personal Access Token */}
        <label>{t('repo.githubCreate.credToken')}</label>
        <input
          type="password"
          // ghp_xxx（Settings → Developer settings → Tokens）
          placeholder={t('repo.auth.patPlaceholder')}
          value={cred.token}
          onChange={(e) => cred.setToken(e.target.value)}
          onKeyDown={
            onEnter
              ? (e) => {
                  if (isImeComposing(e)) return;
                  if (e.key === 'Enter') onEnter();
                }
              : undefined
          }
        />
      </div>
      <div className="dim small" style={{ marginBottom: 8 }}>
        {/* 创建仓库需 token 勾选 <b>repo / public_repo</b> 权限（classic），或勾选 Repository creation（fine-grained） */}
        {t('repo.githubCreate.credHint1')}<b>repo / public_repo</b>{t('repo.githubCreate.credHint2')}
      </div>
    </>
  );
}
