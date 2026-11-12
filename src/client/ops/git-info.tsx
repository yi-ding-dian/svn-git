/** Git 信息与配置弹窗（GitInfoModal）：分支 / 上游 / 身份 / 最近提交，可修改远程地址与 SSH 私钥。
 *  入口：工具栏 ⋯ 菜单「Git 信息与配置」（仅 Git 项目）；与 SVN 信息弹窗（repo/svn-info）对位。 */
import React, { useEffect, useState } from 'react';
import { get, post } from '../shared/api.js';
import { ResizableModal } from '../shell/modal-shell.js';
import { FormRow } from '../ui/ui.js';
import { cmdOfRepo } from '../shared/cmd-preview.js';
import { isImeComposing } from '../shared/utils.js';
import { t } from '../../shared/i18n/index.js';
import { SecureCleanModal } from './secure-clean.js';

// ==================== Git 信息与配置 ====================
export function GitInfoModal(props: {
  onClose: () => void;
  onToast: (m: string, err?: boolean) => void;
  /** 远程地址保存成功：宿主重拉仓库信息（顶栏远程地址 / ⋯ 菜单 GitHub 各项随之更新） */
  onChanged?: () => void;
  /** 点「修改」→ 打开「设置 Git 身份」窗（宿主负责弹窗链路的往返） */
  onEditIdentity: () => void;
}) {
  const [info, setInfo] = useState<{
    branch: string;
    remote: string;
    upstream: string;
    lastCommit: { hash: string; author: string; date: string; msg: string } | null;
  } | null>(null);
  /** git 身份（user.name/email + 作用域）：未配置时提交会被 git 拒绝，这里如实显示给「修改」入口兜底 */
  const [identity, setIdentity] = useState<{ name: string; email: string; scope: 'repo' | 'global' | '' } | null>(null);
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  /** SSH 私钥路径：配置后 GitHub 的 SSH 传输用它；空 = 系统默认 ~/.ssh */
  const [sshKey, setSshKey] = useState('');
  /** 同时写入 ~/.ssh/config，让终端里的 git 也能用这把私钥 */
  const [sshTerminal, setSshTerminal] = useState(false);
  const [sshBusy, setSshBusy] = useState(false);
  /** GitHub 地址自动走 SSH（全局 git 配置 url.insteadOf）：新项目不用逐个改 remote */
  const [githubSsh, setGithubSsh] = useState(false);
  const [githubSshBusy, setGithubSshBusy] = useState(false);
  /** 安全清理弹窗（离职/交接前） */
  const [cleanOpen, setCleanOpen] = useState(false);

  const load = () => {
    get
      .gitInfo()
      .then((r) => {
        setInfo(r);
        setUrl(r.remote);
      })
      .catch((e: Error) => props.onToast((e as Error).message, true));
    get
      .gitIdentity()
      .then(setIdentity)
      .catch(() => {});
    get
      .gitSshKey()
      .then((r) => {
        setSshKey(r.path);
        setSshTerminal(r.useForTerminal);
      })
      .catch(() => {});
    get
      .gitGithubSsh()
      .then((r) => setGithubSsh(r.enabled))
      .catch(() => {});
  };
  useEffect(load, []); // eslint-disable-line react-hooks/exhaustive-deps

  const save = () => {
    if (!url.trim()) {
      // 远程地址不能为空
      props.onToast(t('ops.gitInfo.err.noUrl'), true);
      return;
    }
    setBusy(true);
    void post
      .gitConfig(url.trim())
      .then((r) => {
        props.onToast(r.message, !r.ok);
        if (r.ok) {
          load();
          props.onChanged?.();
        }
      })
      // 配置失败: {msg}
      .catch((e: Error) => props.onToast(t('ops.gitInfo.err.save', { msg: (e as Error).message }), true))
      .finally(() => setBusy(false));
  };

  /** 即时保存「GitHub 自动 SSH」开关：失败时把复选框回滚到原状态 */
  const toggleGithubSsh = (checked: boolean) => {
    if (githubSshBusy) return;
    setGithubSshBusy(true);
    setGithubSsh(checked);
    void post
      .gitGithubSshSave(checked)
      .then((r) => {
        props.onToast(r.message, !r.ok);
        if (r.ok) setGithubSsh(Boolean(r.enabled));
        else setGithubSsh(!checked);
      })
      // 切换 GitHub 自动 SSH 失败: {msg}
      .catch((e: Error) => {
        props.onToast(t('ops.gitInfo.githubSshErr', { msg: (e as Error).message }), true);
        setGithubSsh(!checked);
      })
      .finally(() => setGithubSshBusy(false));
  };

  const saveSshKey = () => {    setSshBusy(true);
    void post
      .gitSshKeySave(sshKey.trim(), sshTerminal)
      .then((r) => {
        props.onToast(r.message, !r.ok);
        // 服务端会把 ~ 展开成绝对路径：保存成功后回显规范化后的值
        if (r.ok) {
          get
            .gitSshKey()
            .then((v) => {
              setSshKey(v.path);
              setSshTerminal(v.useForTerminal);
            })
            .catch(() => {});
        }
      })
      // 保存 SSH 私钥失败: {msg}
      .catch((e: Error) => props.onToast(t('ops.gitInfo.sshKeyErr', { msg: (e as Error).message }), true))
      .finally(() => setSshBusy(false));
  };

  return (
    <div className="modal-mask">
      <ResizableModal width={560} minWidth={480} onEsc={props.onClose}>
        {/* ⚙ Git 信息 */}
        <h3>{t('ops.gitInfo.title')}</h3>
        <div className="body">
          {/* ⏳ 读取 Git 信息… */}
          {!info && <div className="loading">{t('ops.gitInfo.loading')}</div>}
          {info && (
            <>
              <div className="help-note" style={{ marginBottom: 12 }}>
                <div className="small" style={{ lineHeight: 1.9 }}>
                  <div className="row" style={{ gap: 8 }}>
                    {/* 当前分支 */}
                    <span className="dim" style={{ width: 72 }}>{t('ops.gitInfo.branch')}</span>
                    {/* （分离头指针） */}
                    <span className="mono" style={{ color: 'var(--accent)', fontWeight: 600 }}>{info.branch || t('ops.gitInfo.detached')}</span>
                  </div>
                  <div className="row" style={{ gap: 8 }}>
                    {/* 上游跟踪 */}
                    <span className="dim" style={{ width: 72 }}>{t('ops.gitInfo.upstream')}</span>
                    {/* 未设置（更新时自动按 origin/分支拉取） */}
                    <span className="mono">{info.upstream || <span style={{ color: 'var(--warn)' }}>{t('ops.gitInfo.noUpstream')}</span>}</span>
                  </div>
                  <div className="row" style={{ gap: 8 }}>
                    {/* 身份 */}
                    <span className="dim" style={{ width: 72 }}>{t('ops.gitInfo.identity')}</span>
                    <span className="small" style={{ flex: 1, minWidth: 0, wordBreak: 'break-all' }}>
                      {identity && identity.name && identity.email ? (
                        <>
                          <span className="mono">{identity.name} &lt;{identity.email}&gt;</span>
                          {/* · 全局 / · 仅本仓库 */}
                          <span className="dim"> · {identity.scope === 'repo' ? t('ops.gitIdentity.scopeRepo') : t('ops.gitIdentity.scopeGlobal')}</span>
                        </>
                      ) : (
                        // 未配置（提交会被 git 拒绝）
                        <span style={{ color: 'var(--warn)' }}>{t('ops.gitInfo.identityUnset')}</span>
                      )}
                    </span>
                    {/* 修改 */}
                    <button className="mini" onClick={props.onEditIdentity}>{t('ops.gitInfo.identityEdit')}</button>
                  </div>
                  {info.lastCommit && (
                    <>
                      <div className="row" style={{ gap: 8 }}>
                        {/* 最近提交 */}
                        <span className="dim" style={{ width: 72 }}>{t('ops.gitInfo.lastCommit')}</span>
                        <span className="mono">{info.lastCommit.hash}</span>
                      </div>
                      <div className="row" style={{ gap: 8 }}>
                        {/* 提交信息 */}
                        <span className="dim" style={{ width: 72 }}>{t('ops.gitInfo.commitMsg')}</span>
                        <span className="small" style={{ flex: 1, wordBreak: 'break-all' }}>{info.lastCommit.msg}</span>
                      </div>
                      <div className="row" style={{ gap: 8 }}>
                        {/* 作者 / 时间 */}
                        <span className="dim" style={{ width: 72 }}>{t('ops.gitInfo.authorTime')}</span>
                        <span className="small">{info.lastCommit.author} · {info.lastCommit.date}</span>
                      </div>
                    </>
                  )}
                </div>
              </div>
              {/* 远程地址配置 */}
              {/* 远程地址（origin） */}
              <FormRow label={t('ops.gitInfo.remoteLabel')}>
                <div className="row" style={{ gap: 8 }}>
                  {/* git@host:user/repo.git 或 https://... */}
                  <input type="text" placeholder={t('ops.gitInfo.urlPlaceholder')} value={url} onChange={(e) => setUrl(e.target.value)} style={{ flex: 1 }} />
                  {/* 保存中… / 保存 */}
                  <button className="mini primary" disabled={busy} onClick={save} title={`${cmdOfRepo('git', 'set_remote', { url: url.trim() || '…' }) ?? ''}`}>{busy ? t('ops.gitInfo.saving') : t('common.save')}</button>
                </div>
                {/* 修改后推送/拉取将使用新地址（已有 origin 则更新，没有则添加） */}
                <div className="dim small" style={{ marginTop: 6 }}>{t('ops.gitInfo.remoteHint')}</div>
              </FormRow>
              {/* SSH 私钥配置 */}
              <FormRow label={t('ops.gitInfo.sshKeyLabel')}>
                <div className="row" style={{ gap: 8 }}>
                  {/* 留空用系统默认（~/.ssh/id_ed25519） */}
                  <input
                    type="text"
                    placeholder={t('ops.gitInfo.sshKeyPlaceholder')}
                    value={sshKey}
                    onChange={(e) => setSshKey(e.target.value)}
                    onKeyDown={(e) => {
                      if (isImeComposing(e)) return;
                      if (e.key === 'Enter') saveSshKey();
                    }}
                    style={{ flex: 1 }}
                  />
                  {/* 保存中… / 保存 */}
                  <button className="mini primary" disabled={sshBusy} onClick={saveSshKey}>{sshBusy ? t('ops.gitInfo.saving') : t('common.save')}</button>
                </div>
                {/* 仅对 github.com 的 SSH 连接生效；可在项目根运行 gen-ssh-key.sh 生成项目内私钥 */}
                <div className="dim small" style={{ marginTop: 6 }}>{t('ops.gitInfo.sshKeyHint')}</div>
                <label className="row small" style={{ gap: 6, marginTop: 8, cursor: 'pointer' }}>
                  <input type="checkbox" checked={sshTerminal} onChange={(e) => setSshTerminal(e.target.checked)} />
                  {/* 终端 git 也使用此私钥 */}
                  {t('ops.gitInfo.sshTerminal')}
                </label>
                {sshTerminal && (
                  // 保存后应用自动写入 ~/.ssh/config（仅 github.com），终端里直接 git 也能用；不会改动其他配置
                  <div className="dim small" style={{ marginTop: 4 }}>{t('ops.gitInfo.sshTerminalHint')}</div>
                )}
                <label className="row small" style={{ gap: 6, marginTop: 8, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={githubSsh}
                    disabled={githubSshBusy}
                    onChange={(e) => toggleGithubSsh(e.target.checked)}
                  />
                  {/* GitHub 地址自动走 SSH（新项目不用逐个改） */}
                  {t('ops.gitInfo.githubSsh')}
                </label>
                {githubSsh && (
                  // 写入全局 git 配置（url.insteadOf）：remote 仍显示 https，实际拉取/推送走 SSH；取消勾选只删除这一条
                  <div className="dim small" style={{ marginTop: 4 }}>{t('ops.gitInfo.githubSshHint')}</div>
                )}
              </FormRow>
            </>
          )}
        </div>
        <div className="foot">
          {/* 🧹 安全清理 */}
          <button className="mini danger" onClick={() => setCleanOpen(true)}>{t('ops.gitInfo.secureClean')}</button>
          {/* 关闭 */}
          <button onClick={props.onClose}>{t('common.close')}</button>
        </div>
      </ResizableModal>
      {cleanOpen && (
        <SecureCleanModal
          keyPath={sshKey}
          onClose={() => setCleanOpen(false)}
          onDone={load}
          onToast={props.onToast}
        />
      )}
    </div>
  );
}
