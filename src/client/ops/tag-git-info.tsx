/** 标签与 Git 配置弹窗：标签管理（TagDialog，含 RemoteList 辅助）/ Git 信息（GitInfoModal） */
import React, { useEffect, useState } from 'react';
import { get, post, type SvnLayout } from '../shared/api.js';
import { ModalShell, ResizableModal } from '../shell/modal-shell.js';
import { IconTag } from '../ui/icons.js';
import { HelpNote, FormRow } from '../ui/ui.js';
import { ConfirmModal } from '../ui/prompt.js';
import { cmdOfRepo } from '../shared/cmd-preview.js';
import { runAction } from '../shared/vcs-action.js';
import { ResultLine } from '../ui/result-line.js';
import { LayoutNote } from './layout-note.js';
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
export function GitInfoModal(props: { onClose: () => void; onToast: (m: string, err?: boolean) => void }) {
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
      .catch((e: Error) => props.onToast((e as Error).message, true));
  };
  useEffect(load, []); // eslint-disable-line react-hooks/exhaustive-deps

  const save = () => {
    if (!url.trim()) {
      props.onToast('远程地址不能为空', true);
      return;
    }
    setBusy(true);
    void post
      .gitConfig(url.trim())
      .then((r) => {
        props.onToast(r.message, !r.ok);
        if (r.ok) load();
      })
      .catch((e: Error) => props.onToast(`配置失败: ${(e as Error).message}`, true))
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
