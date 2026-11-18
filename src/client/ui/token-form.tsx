/** 通用凭据输入（用户名 + Token）：Git 信息弹窗与发布历史 401 处共用。
 *
 *  Token 存在服务端配置里（AES-256-GCM 加密），**不回显**：只显示「已设置/未设置」，
 *  输入新值保存后清空输入框。保存走 /api/git-auth（会清掉 GitHub 身份缓存）。
 *
 *  放在 ui/：只依赖 props + shared，ops 与 release 两个业务域都可直接复用，避免跨域引用。
 *  文案沿用既有 ops.gitInfo.* 键（键名中立化会牵动语言包，无必要）。
 */
import React, { useEffect, useState } from 'react';
import { get, post } from '../shared/api.js';
import { isImeComposing } from '../shared/utils.js';
import { t } from '../../shared/i18n/index.js';

export function TokenForm(props: {
  onToast: (m: string, err?: boolean) => void;
  /** 保存成功（调用方据此刷新数据 / 收起表单） */
  onSaved?: () => void;
}) {
  const [user, setUser] = useState('');
  const [token, setToken] = useState('');
  /** 服务端是否已有 Token（不区分是哪个账号的） */
  const [hasToken, setHasToken] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    get
      .gitAuth()
      .then((r) => {
        setUser(r.username);
        setHasToken(r.hasPassword);
      })
      .catch(() => {});
  }, []);

  const save = () => {
    if (!user.trim() || !token) {
      // 请填写 GitHub 用户名和 Token
      props.onToast(t('ops.gitInfo.authNeed'), true);
      return;
    }
    setBusy(true);
    void post
      .gitAuthSave(user.trim(), token)
      .then((r) => {
        props.onToast(r.message, !r.ok);
        if (r.ok) {
          setToken(''); // 不回显：保存后清空
          setHasToken(true);
          props.onSaved?.();
        }
      })
      // 保存凭据失败: {msg}
      .catch((e: Error) => props.onToast(t('ops.gitInfo.authErr', { msg: (e as Error).message }), true))
      .finally(() => setBusy(false));
  };

  return (
    <div>
      <div className="row" style={{ gap: 8 }}>
        {/* GitHub 用户名 */}
        <input
          type="text"
          placeholder={t('ops.gitInfo.authUserPlaceholder')}
          value={user}
          onChange={(e) => setUser(e.target.value)}
          style={{ width: 160 }}
        />
        <input
          type="password"
          placeholder={hasToken ? t('ops.gitInfo.authTokenSetPlaceholder') : t('ops.gitInfo.authTokenUnsetPlaceholder')}
          value={token}
          onChange={(e) => setToken(e.target.value)}
          onKeyDown={(e) => {
            if (isImeComposing(e)) return;
            if (e.key === 'Enter') save();
          }}
          style={{ flex: 1 }}
        />
        {/* 保存中… / 保存 */}
        <button className="mini primary" disabled={busy} onClick={save}>
          {busy ? t('ops.gitInfo.saving') : t('common.save')}
        </button>
      </div>
      <div className="dim small" style={{ marginTop: 6 }}>
        {/* Token：已设置 / 未设置 · 用于 HTTPS 推送与 GitHub API… */}
        {hasToken ? t('ops.gitInfo.authTokenSet') : t('ops.gitInfo.authTokenUnset')}
        {' · '}
        {t('ops.gitInfo.authHint')}
      </div>
    </div>
  );
}
