/** 标签与 Git 配置弹窗：标签管理（TagDialog，含 RemoteList 辅助）/ Git 信息（GitInfoModal）/ 推送认证（GitPushAuthModal） */
import React, { useEffect, useState } from 'react';
import { get, post, type SvnLayout } from '../api.js';
import { ModalShell, ResizableModal } from '../modal-shell.js';
import { IconTag } from '../icons.js';
import { HelpNote, FormRow } from '../ui.js';
import { ConfirmModal } from '../modals.js';
import { cmdOfRepo } from '../cmd-preview.js';
import { LayoutNote, ResultLine, runAction } from './common.js';
// ==================== 标签管理 ====================

export function TagDialog(props: { repoType: 'svn' | 'git'; onClose: () => void; onChanged: () => void }) {
  const [data, setData] = useState<{ tags: string[]; layout?: SvnLayout } | null>(null);
  const [newName, setNewName] = useState('');
  const [msg, setMsg] = useState('');
  const [msgErr, setMsgErr] = useState(false);
  const [busy, setBusy] = useState(false);
  // 工具风格二次确认
  const [cfm, setCfm] = useState<{ title: string; msg: string; action: () => void } | null>(null);

  const load = () => {
    get
      .tags()
      .then((r) => setData(r))
      .catch((e: Error) => {
        setMsg(e.message);
        setMsgErr(true);
      });
  };
  useEffect(load, []); // eslint-disable-line react-hooks/exhaustive-deps

  const act = (action: 'create' | 'delete', name: string) => {
    setBusy(true);
    void runAction(
      () => post.tag(action, name),
      (m, err) => {
        setMsg(m);
        setMsgErr(Boolean(err));
      },
      () => {
        load();
        props.onChanged();
      }
    ).finally(() => setBusy(false));
  };

  return (
    <ModalShell icon={<IconTag size={16} />} title={`标签管理 (${props.repoType.toUpperCase()})`} onClose={props.onClose} width={560}>
      <HelpNote>
        {props.repoType === 'git'
          ? '标签是给当前提交打的固定名字，常用于标记发布版本（v1.0、v2.0 等）。用法：输入名称回车 = 给当前代码打标签；列表中的标签可「删除」。'
          : 'SVN 标签是版本库中的目录快照（tags/），只读性质，用于标记发布版本。用法：输入名称回车 = 复制 trunk（或当前目录）创建标签；列表中的标签可「删除」（危险操作会确认）。'}
      </HelpNote>
      {/* 仓库布局提示（svn 非标准布局时提醒） */}
      {props.repoType === 'svn' && data?.layout && <LayoutNote layout={data.layout} />}
      <div className="row" style={{ margin: '12px 0' }}>
        <input
          type="text"
          placeholder="新标签名称…（回车创建）"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && newName.trim()) act('create', newName.trim());
          }}
          style={{ flex: 1 }}
        />
        <button
          className="primary"
          disabled={busy || !newName.trim()}
          onClick={() => act('create', newName.trim())}
          title={cmdOfRepo(props.repoType, 'tag_create', { name: newName.trim() || '…', msg: '…' })}
        >
          🏷 创建标签
        </button>
      </div>
      <div className="vcs-list" style={{ maxHeight: 260 }}>
        {!data && <div className="dim" style={{ padding: '10px 6px' }}>加载中…</div>}
        {data && data.tags.length === 0 && <div className="dim" style={{ padding: '10px 6px' }}>暂无标签</div>}
        {data?.tags.map((t) => (
          <div key={t} className="changed-row">
            <span style={{ color: 'var(--accent)' }}>🏷</span>
            <span className="mono" style={{ flex: 1 }}>{t}</span>
            <button
              className="mini danger"
              disabled={busy}
              onClick={() =>
                setCfm({
                  title: '删除标签',
                  msg: `确认删除标签 ${t}？`,
                  action: () => act('delete', t),
                })
              }
              title={cmdOfRepo(props.repoType, 'tag_delete', { name: t })}
            >
              删除
            </button>
          </div>
        ))}
      </div>
      <ResultLine msg={msg} err={msgErr} />
      {/* 远程仓库（git） */}
      {props.repoType === 'git' && <RemoteList />}
      {/* 二次确认（工具风格） */}
      {cfm && (
        <ConfirmModal
          title={cfm.title}
          message={cfm.msg}
          confirmLabel="确认"
          onConfirm={() => {
            const a = cfm.action;
            setCfm(null);
            a();
          }}
          onCancel={() => setCfm(null)}
        />
      )}
    </ModalShell>
  );
}

/** git 远程列表展示 */
function RemoteList() {
  const [remotes, setRemotes] = useState<{ name: string; url: string }[]>([]);
  useEffect(() => {
    get
      .remotes()
      .then((r) => setRemotes(r.remotes))
      .catch(() => {});
  }, []);
  if (remotes.length === 0) return null;
  return (
    <div style={{ marginTop: 12 }}>
      <div className="dim small" style={{ marginBottom: 4 }}>远程仓库：</div>
      {remotes.map((r) => (
        <div key={r.name} className="changed-row">
          <span className="badge git" style={{ background: 'var(--accent)', fontSize: 9 }}>{r.name}</span>
          <span className="mono small dim" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.url}</span>
        </div>
      ))}
    </div>
  );
}

// ==================== Git 信息与配置 ====================

/** Git 信息弹窗：分支 / 远程 / 上游 / 最近提交，可修改远程地址 */
export function GitInfoModal(props: { onClose: () => void; onToast: (m: string) => void }) {
  const [info, setInfo] = useState<{
    branch: string;
    remote: string;
    upstream: string;
    lastCommit: { hash: string; author: string; date: string; msg: string } | null;
  } | null>(null);
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => {
    get
      .gitInfo()
      .then((r) => {
        setInfo(r);
        setUrl(r.remote);
      })
      .catch((e: Error) => props.onToast((e as Error).message));
  };
  useEffect(load, []); // eslint-disable-line react-hooks/exhaustive-deps

  const save = () => {
    if (!url.trim()) {
      props.onToast('远程地址不能为空');
      return;
    }
    setBusy(true);
    void post
      .gitConfig(url.trim())
      .then((r) => {
        props.onToast(r.message);
        if (r.ok) load();
      })
      .catch((e: Error) => props.onToast(`配置失败: ${(e as Error).message}`))
      .finally(() => setBusy(false));
  };

  return (
    <div className="modal-mask">
      <ResizableModal width={560} minWidth={480}>
        <h3>⚙ Git 信息</h3>
        <div className="body">
          {!info && <div className="loading">⏳ 读取 Git 信息…</div>}
          {info && (
            <>
              <div className="help-note" style={{ marginBottom: 12 }}>
                <div className="small" style={{ lineHeight: 1.9 }}>
                  <div className="row" style={{ gap: 8 }}>
                    <span className="dim" style={{ width: 72 }}>当前分支</span>
                    <span className="mono" style={{ color: 'var(--accent)', fontWeight: 600 }}>{info.branch || '（分离头指针）'}</span>
                  </div>
                  <div className="row" style={{ gap: 8 }}>
                    <span className="dim" style={{ width: 72 }}>上游跟踪</span>
                    <span className="mono">{info.upstream || <span style={{ color: 'var(--warn)' }}>未设置（更新时自动按 origin/分支拉取）</span>}</span>
                  </div>
                  {info.lastCommit && (
                    <>
                      <div className="row" style={{ gap: 8 }}>
                        <span className="dim" style={{ width: 72 }}>最近提交</span>
                        <span className="mono">{info.lastCommit.hash}</span>
                      </div>
                      <div className="row" style={{ gap: 8 }}>
                        <span className="dim" style={{ width: 72 }}>提交信息</span>
                        <span className="small" style={{ flex: 1, wordBreak: 'break-all' }}>{info.lastCommit.msg}</span>
                      </div>
                      <div className="row" style={{ gap: 8 }}>
                        <span className="dim" style={{ width: 72 }}>作者 / 时间</span>
                        <span className="small">{info.lastCommit.author} · {info.lastCommit.date}</span>
                      </div>
                    </>
                  )}
                </div>
              </div>
              {/* 远程地址配置 */}
              <FormRow label="远程地址（origin）">
                <div className="row" style={{ gap: 8 }}>
                  <input type="text" placeholder="git@host:user/repo.git 或 https://..." value={url} onChange={(e) => setUrl(e.target.value)} style={{ flex: 1 }} />
                  <button className="mini primary" disabled={busy} onClick={save} title={`${cmdOfRepo('git', 'set_remote', { url: url.trim() || '…' }) ?? ''}`}>{busy ? '保存中…' : '保存'}</button>
                </div>
                <div className="dim small" style={{ marginTop: 6 }}>修改后推送/拉取将使用新地址（已有 origin 则更新，没有则添加）</div>
              </FormRow>
            </>
          )}
        </div>
        <div className="foot">
          <button onClick={props.onClose}>关闭</button>
        </div>
      </ResizableModal>
    </div>
  );
}

// ==================== Git 推送认证 ====================

/** 推送认证弹窗：GitHub 用户名+Token / 服务器用户名+密码 / SSH 提示 */
export function GitPushAuthModal(props: {
  type: 'github' | 'server' | 'ssh';
  username?: string;
  /** 上次推送失败的认证错误（显示在窗口内提示用户检查） */
  error?: string;
  onClose: () => void;
  onSaved: () => void;
  onToast: (m: string) => void;
}) {
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
      props.onToast('请填写用户名和密码');
      return;
    }
    setBusy(true);
    void post
      .gitAuthSave(username.trim(), password)
      .then((r) => {
        props.onToast(r.message);
        if (r.ok) props.onSaved();
      })
      .catch((e: Error) => props.onToast(`保存失败: ${(e as Error).message}`))
      .finally(() => setBusy(false));
  };

  return (
    <div className="modal-mask">
      <ResizableModal width={460} minWidth={420}>
        <h3>{isGithub ? '🔑 GitHub 推送认证' : props.type === 'ssh' ? '🔑 SSH 推送提示' : '🔑 Git 服务器推送认证'}</h3>
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
              如需使用用户名密码推送，请改用 <b>HTTPS</b> 地址（可在「Git 信息」中修改远程地址）。
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
                  <b> repo </b> 权限即可推送。
                </div>
              )}
            </>
          )}
        </div>
        <div className="foot">
          <button onClick={props.onClose}>取消</button>
          {props.type !== 'ssh' && (
            <button className="primary" disabled={busy} onClick={save}>
              {busy ? '保存中…' : '保存并推送'}
            </button>
          )}
        </div>
      </ResizableModal>
    </div>
  );
}
