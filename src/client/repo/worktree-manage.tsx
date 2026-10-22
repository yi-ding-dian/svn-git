/** Git 工作树管理：列出主工作树与各副本，支持打开、定位、移除、清理失效记录。
 *
 *  worktree 与当前仓库共享 .git：不能像普通目录那样直接删除，否则会留下 prunable 记录；
 *  本弹窗统一走 `git worktree remove` / `git worktree prune`。
 *
 *  入口：分支管理弹窗「工作树…」、最近项目右键「工作树管理…」。 */
import React, { useEffect, useState } from 'react';
import { get, post, type WorktreeEntry } from '../shared/api.js';
import { ModalShell } from '../shell/modal-shell.js';
import { ConfirmModal } from '../ui/prompt.js';
import { ResultLine } from '../ui/result-line.js';
import { t } from '../../shared/i18n/index.js';

/** 徽标配色：全局 .badge 默认是白字（依赖背景色），工作树管理里统一用浅底深字 */
function badgeTone(kind: 'main' | 'current' | 'prunable' | 'locked' | 'branch'): React.CSSProperties {
  if (kind === 'current') {
    return { background: 'rgba(26,127,55,0.12)', color: 'var(--ok)', border: '1px solid var(--border)' };
  }
  if (kind === 'prunable' || kind === 'locked') {
    return { background: 'rgba(154,103,0,0.12)', color: 'var(--warn)', border: '1px solid var(--border)' };
  }
  return { background: 'var(--panel2)', color: 'var(--text)', border: '1px solid var(--border)' };
}

export function WorktreeManageDialog(props: {
  onClose: () => void;
  /** 打开某个工作树（切换当前项目） */
  onOpen: (dir: string) => void;
  /** 新建工作树：交给宿主打开分支管理（选分支 → 检出 → worktree） */
  onNew: () => void;
}) {
  const [list, setList] = useState<WorktreeEntry[] | null>(null);
  const [msg, setMsg] = useState('');
  const [msgErr, setMsgErr] = useState(false);
  const [busy, setBusy] = useState(false);
  /** 待移除的副本（二次确认） */
  const [removeFor, setRemoveFor] = useState<WorktreeEntry | null>(null);
  /** 清理失效记录确认 */
  const [pruneCfm, setPruneCfm] = useState(false);

  const load = () => {
    get
      .worktrees()
      .then((r) => setList(r.worktrees))
      .catch((e: Error) => {
        setMsg(e.message);
        setMsgErr(true);
      });
  };
  useEffect(load, []);

  /** 执行移除 / 清理：完成后刷新列表 */
  const act = (fn: () => Promise<{ ok: boolean; message: string }>) => {
    setBusy(true);
    fn()
      .then((r) => {
        setMsg(r.message);
        setMsgErr(!r.ok);
        if (r.ok) load();
      })
      .catch((e: Error) => {
        setMsg(e.message);
        setMsgErr(true);
      })
      .finally(() => setBusy(false));
  };

  const repoPath = list?.find((w) => w.main)?.path ?? '';

  /** 在系统文件管理器中显示：worktree 可能在当前仓库之外，传绝对路径 */
  const reveal = (p: string) => {
    post
      .reveal(p)
      .then((r) => {
        if (!r.ok) {
          setMsg(t('repo.worktree.revealFailed'));
          setMsgErr(true);
        }
      })
      .catch((e: Error) => {
        setMsg(e.message);
        setMsgErr(true);
      });
  };

  return (
    <ModalShell
      icon="🌿"
      title={t('repo.worktree.title')}
      onClose={props.onClose}
      width={720}
      closeIcon
      foot={
        <>
          <button onClick={props.onClose}>{t('common.close')}</button>
          <button onClick={load} disabled={busy}>{t('repo.worktree.refresh')}</button>
          <button className="primary" onClick={props.onNew} disabled={busy} title={t('repo.worktree.newTip')}>{t('repo.worktree.new')}</button>
        </>
      }
    >
      <div className="small dim" style={{ marginBottom: 8 }}>
        {t('repo.worktree.repo')}: <span className="mono">{repoPath}</span>
      </div>
      <div className="vcs-list" style={{ maxHeight: 360 }}>
        {!list && <div className="dim" style={{ padding: '10px 6px' }}>{t('repo.worktree.loading')}</div>}
        {list && list.length === 0 && (
          <div className="dim" style={{ padding: '10px 6px' }}>{t('repo.worktree.empty')}</div>
        )}
        {list?.map((wt) => (
          <div key={wt.path} className="changed-row" style={{ alignItems: 'flex-start', gap: 8 }}>
            <span style={{ color: wt.prunable ? 'var(--warn)' : 'var(--accent)', marginTop: 2 }}>🌿</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                <span className="badge" style={badgeTone(wt.main ? 'main' : wt.prunable ? 'prunable' : 'branch')}>
                  {wt.main
                    ? t('repo.worktree.main')
                    : wt.prunable
                      ? t('repo.worktree.prunable')
                      : wt.detached
                        ? t('repo.worktree.detached')
                        : (wt.branch ?? '?')}
                </span>
                {wt.locked && <span className="badge" style={badgeTone('locked')} title={wt.locked}>{t('repo.worktree.locked')}</span>}
                {/* 主工作树已隐含"当前"；只有从副本打开时才单独标「当前」，避免两个徽标并排 */}
                {wt.current && !wt.main && <span className="badge" style={badgeTone('current')}>{t('repo.worktree.current')}</span>}
                <span
                  className="mono small"
                  style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                  title={wt.path}
                >
                  {wt.path}
                </span>
              </div>
              <div className="dim small mono">{wt.head ? wt.head.slice(0, 7) : '—'}</div>
            </div>
            <div className="row" style={{ gap: 4, flexShrink: 0 }}>
              {!wt.main && !wt.prunable && (
                <button className="mini" disabled={busy} onClick={() => props.onOpen(wt.path)}>
                  {t('repo.worktree.open')}
                </button>
              )}
              {!wt.prunable && (
                <button
                  className="mini"
                  disabled={busy}
                  onClick={() => reveal(wt.path)}
                >
                  {t('repo.worktree.reveal')}
                </button>
              )}
              {!wt.main && !wt.prunable && (
                <button
                  className="mini danger"
                  disabled={busy || Boolean(wt.locked) || wt.current}
                  // 禁用态原因：disabled 按钮收不到悬浮事件，保持原生 title
                  title={wt.current ? t('repo.worktree.currentHint') : wt.locked ? t('repo.worktree.lockedHint') : undefined}
                  onClick={() => setRemoveFor(wt)}
                >
                  {t('repo.worktree.remove')}
                </button>
              )}
              {wt.prunable && (
                <button className="mini" disabled={busy} onClick={() => setPruneCfm(true)}>
                  {t('repo.worktree.prune')}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
      <ResultLine msg={msg} err={msgErr} />
      {removeFor && (
        <ConfirmModal
          danger
          title={t('repo.worktree.removeTitle')}
          message={t('repo.worktree.removeMsg', { path: removeFor.path })}
          confirmLabel={t('repo.worktree.remove')}
          commands={[`git worktree remove ${removeFor.path}`]}
          onConfirm={() => {
            const target = removeFor;
            setRemoveFor(null);
            act(() => post.worktreeAction('remove', target.path));
          }}
          onCancel={() => setRemoveFor(null)}
        />
      )}
      {pruneCfm && (
        <ConfirmModal
          title={t('repo.worktree.pruneTitle')}
          message={t('repo.worktree.pruneMsg')}
          confirmLabel={t('repo.worktree.prune')}
          commands={['git worktree prune']}
          onConfirm={() => {
            setPruneCfm(false);
            act(() => post.worktreeAction('prune'));
          }}
          onCancel={() => setPruneCfm(false)}
        />
      )}
    </ModalShell>
  );
}
