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
import { t } from '../../shared/i18n/index.js';
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
  useEffect(load, []);

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
    // 标签管理
    <ModalShell icon={<IconTag size={16} />} title={`${t('ops.tag.title')} (${props.repoType.toUpperCase()})`} onClose={props.onClose} width={560}>
      <HelpNote>
        {/* 标签是给当前提交打的固定名字，常用于标记发布版本（v1.0、v2.0 等）。用法：输入名称回车 = 给当前代码打标签；列表中的标签可「删除」。 / SVN 标签是版本库中的目录快照（tags/），只读性质，用于标记发布版本。用法：输入名称回车 = 复制 trunk（或当前目录）创建标签；列表中的标签可「删除」（危险操作会确认）。 */}
        {props.repoType === 'git' ? t('ops.tag.helpGit') : t('ops.tag.helpSvn')}
      </HelpNote>
      {/* 仓库布局提示（svn 非标准布局时提醒） */}
      {props.repoType === 'svn' && data?.layout && <LayoutNote layout={data.layout} />}
      <div className="row" style={{ margin: '12px 0' }}>
        <input
          type="text"
          // 新标签名称…（回车创建）
          placeholder={t('ops.tag.namePlaceholder')}
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
          {/* 🏷 创建标签 */}
          {t('ops.tag.create')}
        </button>
      </div>
      <div className="vcs-list" style={{ maxHeight: 260 }}>
        {/* 加载中… */}
        {!data && <div className="dim" style={{ padding: '10px 6px' }}>{t('ops.loading')}</div>}
        {/* 暂无标签 */}
        {data && data.tags.length === 0 && <div className="dim" style={{ padding: '10px 6px' }}>{t('ops.tag.none')}</div>}
        {data?.tags.map((tag) => (
          <div key={tag} className="changed-row">
            <span style={{ color: 'var(--accent)' }}>🏷</span>
            <span className="mono" style={{ flex: 1 }}>{tag}</span>
            <button
              className="mini danger"
              disabled={busy}
              onClick={() =>
                setCfm({
                  // 删除标签
                  title: t('ops.tag.delTitle'),
                  // 确认删除标签 {name}？
                  msg: t('ops.tag.delMsg', { name: tag }),
                  action: () => act('delete', tag),
                })
              }
              title={cmdOfRepo(props.repoType, 'tag_delete', { name: tag })}
            >
              {/* 删除 */}
              {t('common.delete')}
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
          // 确认
          confirmLabel={t('ui.modal.confirm')}
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
      {/* 远程仓库： */}
      <div className="dim small" style={{ marginBottom: 4 }}>{t('ops.tag.remotes')}</div>
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
      // 远程地址不能为空
      props.onToast(t('ops.gitInfo.err.noUrl'), true);
      return;
    }
    setBusy(true);
    void post
      .gitConfig(url.trim())
      .then((r) => {
        props.onToast(r.message, !r.ok);
        if (r.ok) load();
      })
      // 配置失败: {msg}
      .catch((e: Error) => props.onToast(t('ops.gitInfo.err.save', { msg: (e as Error).message }), true))
      .finally(() => setBusy(false));
  };

  return (
    <div className="modal-mask">
      <ResizableModal width={560} minWidth={480}>
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
            </>
          )}
        </div>
        <div className="foot">
          {/* 关闭 */}
          <button onClick={props.onClose}>{t('common.close')}</button>
        </div>
      </ResizableModal>
    </div>
  );
}
