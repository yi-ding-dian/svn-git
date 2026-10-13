/** SVN 信息弹窗（原「SVN 账号设置」）：显示**当前实际生效的身份**（工具配置 / svn 官方凭据缓存）
 *  + 切换账号 / 退出登录。
 *
 *  为什么显示缓存身份：svn 命令行的凭据有两个来源——工具 config.json 为空时会**静默使用**
 *  官方凭据缓存（~/.subversion/auth，历史上在别的 svn 客户端登录时存的）——界面以前只显示
 *  工具配置，导致「没登录却一直能提交」的困惑（用户实报）。
 *  「退出」会把工具配置和**系统缓存**里该服务器的条目一起清（二次确认）——否则退出后 svn
 *  仍会静默用缓存身份，等于没退；「切换」保存新账号时同样清掉旧缓存条目，避免新账号认证
 *  失败时回落到旧身份（"以为切了其实没切"）。 */
import React, { useEffect, useState } from 'react';
import { get, post } from '../shared/api.js';
import { ModalShell } from '../shell/modal-shell.js';
import { FormRow } from '../ui/ui.js';
import { IconLogout } from '../ui/icons.js';
import { ConfirmModal } from '../ui/prompt.js';
import { t } from '../../shared/i18n/index.js';

export function LoginModal(props: {
  /** 工具配置账号（App 的 configUser；弹窗打开后会自行查一次最新身份） */
  username: string;
  /** 当前仓库 URL（查身份 + 清缓存匹配用） */
  repoUrl: string;
  onClose: () => void;
  onSaved: () => void;
  onToast: (msg: string) => void;
}) {
  const [username, setUsername] = useState(props.username);
  const [password, setPassword] = useState('');
  const [trust, setTrust] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  // 系统凭据缓存身份（打开时查一次；realm 原文供确认框展示）
  const [cacheUser, setCacheUser] = useState('');
  const [cacheRealm, setCacheRealm] = useState('');
  // 已有任何身份时先显示信息面板（切换/退出），都没有直接显示表单
  const [editing, setEditing] = useState(!props.username);
  const [confirmLogout, setConfirmLogout] = useState(false);

  // 打开时查一次最新身份（缓存 + 配置；配置以查询结果为准——App 的 props 可能陈旧）
  useEffect(() => {
    if (!props.repoUrl) return;
    let alive = true;
    void get
      .svnIdentity(props.repoUrl)
      .then((r) => {
        if (!alive) return;
        if (r.config) {
          setUsername(r.config.username);
          setEditing(false); // 查到工具配置账号 → 有身份，显示信息面板
        }
        if (r.cache) {
          setCacheUser(r.cache.username);
          setCacheRealm(r.cache.realms[0] ?? '');
          setEditing(false);
        }
      })
      .catch(() => {
        /* 查不到按只有 props 的信息处理 */
      });
    return () => {
      alive = false;
    };
  }, [props.repoUrl]);

  /** 表单保存（= 添加 / 切换账号）：写入工具配置；系统缓存里有旧账号（且与新账号不同）一并清除 */
  const submit = async () => {
    setBusy(true);
    try {
      await post.config({ username, password, trustServerCert: trust });
      let clearedUser = '';
      if (props.repoUrl && cacheUser && cacheUser !== username) {
        try {
          await post.svnForgetCache(props.repoUrl);
          clearedUser = cacheUser;
        } catch {
          /* 清缓存失败不拦保存（可再点退出重试） */
        }
      }
      props.onSaved();
      props.onToast(
        username
          ? // SVN 账号已保存 / SVN 账号已保存，并清除系统缓存中的旧账号 {user}
            clearedUser
            ? t('repo.login.savedCacheCleared', { user: clearedUser })
            : t('repo.login.saved')
          : // SVN 账号已清除
            t('repo.login.cleared')
      );
      props.onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  /** 退出登录（确认后）：清工具配置 + 清系统缓存条目（有哪个清哪个，两个都没有时此入口不显示） */
  const logout = async () => {
    setConfirmLogout(false);
    setBusy(true);
    try {
      if (username) await post.config({ username: '', password: '', trustServerCert: false });
      if (props.repoUrl && cacheUser) await post.svnForgetCache(props.repoUrl);
      props.onSaved();
      // 已退出 SVN 登录
      props.onToast(t('repo.login.loggedOut'));
      props.onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // 主身份：工具配置优先（命令行的实际优先顺序），否则系统缓存
  const mainUser = username || cacheUser;
  const srcLabel = t(username ? 'repo.login.srcConfig' : 'repo.login.srcCache');
  /** 编辑中且有身份可回：右上角 ✕（及 Esc）= 返回身份面板（两级视图），而不是关闭整个弹窗 */
  const backMode = editing && Boolean(username || cacheUser);

  return (
    <>
      <ModalShell
        // SVN 信息
        title={t('repo.login.title')}
        onClose={backMode ? () => setEditing(false) : props.onClose}
        width={460}
        minWidth={420}
        closeIcon
        // 返回（回身份面板）/ 关闭（关整个弹窗）
        closeIconTitle={backMode ? t('common.back') : t('common.close')}
        foot={
          editing ? (
            <button className="primary" onClick={() => void submit()} disabled={busy}>
              {/* 保存中… / 保存 */}
              {busy ? t('repo.saving') : t('common.save')}
            </button>
          ) : (
            <>
              {/* 🔄 切换账号 */}
              <button className="primary" disabled={busy} onClick={() => setEditing(true)}>{t('repo.login.switch')}</button>
              {/* 退出登录（IconLogout：门框 + 向外箭头，跟随按钮红色） */}
              <button className="danger" disabled={busy} onClick={() => setConfirmLogout(true)}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                  <IconLogout />
                  {t('repo.login.logout')}
                </span>
              </button>
            </>
          )
        }
      >
          {!editing ? (
            <div className="form-row">
              {/* 当前 SVN 身份 */}
              <label>{t('repo.login.currentAccount')}</label>
              <div className="help-note" style={{ alignItems: 'center' }}>
                <span className="badge svn" style={{ fontSize: 11 }}>SVN</span>
                <b>{mainUser}</b>
                {/* （本工具配置） / （svn 官方凭据缓存） */}
                <span className="dim small">{srcLabel}</span>
              </div>
              {/* 两个来源都有且不同：提示后端回落关系（认证失败时会用缓存那份） */}
              {username && cacheUser && username !== cacheUser && (
                <div className="dim small" style={{ marginTop: 4 }}>
                  {t('repo.login.cacheBackup', { user: cacheUser })}
                </div>
              )}
            </div>
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
              {/* 保存会清掉系统缓存里该服务器的旧账号（防"以为切了其实没切"）：提前说明 */}
              {cacheUser && (
                <div className="small" style={{ color: 'var(--warn)', marginTop: 6 }}>
                  {t('repo.login.switchCacheWarn', { user: cacheUser })}
                </div>
              )}
            </>
          )}
          {err && <div className="error">{err}</div>}
      </ModalShell>
      {/* 退出二次确认：列出将清除的凭据（包括系统缓存——会影响本机其他 svn 客户端） */}
      {confirmLogout && (
        <ConfirmModal
          // 退出 SVN 登录？
          title={t('repo.login.logoutConfirmTitle')}
          message={
            <>
              {/* 将清除： */}
              <div>{t('repo.login.logoutWillClear')}</div>
              {username && (
                // · 工具配置的账号 {user}
                <div>{t('repo.login.logoutCfgItem', { user: username })}</div>
              )}
              {cacheUser && (
                // · 系统凭据缓存账号 {user}（{realm}）
                <div>{t('repo.login.logoutCacheItem', { user: cacheUser, realm: cacheRealm })}</div>
              )}
              <div className="dim small" style={{ marginTop: 6 }}>
                {/* 清除后该服务器的 svn 操作需要重新登录；本机其他 svn 客户端也会受影响 */}
                {t('repo.login.logoutHint')}
              </div>
            </>
          }
          danger
          // 🚪 退出登录
          confirmLabel={t('repo.login.logout')}
          onConfirm={() => void logout()}
          onCancel={() => setConfirmLogout(false)}
        />
      )}
    </>
  );
}
