/** Fork 仓库弹窗（⋯ 菜单「Fork 到自己账号」入口；推送被判定「无写权限」时也会自动弹出）：
 *  进入先查权限（permissions.push / isOwn，纯读）与本地待推送数，确认后一步走完：
 *  Fork 到本人账号 → origin 改指 fork（服务端完成，原仓库记入 upstream）→ 有提交则交给宿主
 *  走现有推送任务（含认证引导/横幅）→ 成功态给「去 GitHub 提 PR」（浏览器打开 compare 预填页）。
 *  不做应用内 PR 表单——提 PR 在 GitHub 页面上完成。只对「别人的仓库」有意义：自己的仓库直接提示无需 Fork。 */

import React, { useEffect, useState } from 'react';
import { get, post } from '../shared/api.js';
import { ResizableModal } from '../shell/modal-shell.js';
import { t } from '../../shared/i18n/index.js';

/** compare 预填页：origin 默认分支 ← 你 fork 的当前分支（GitHub 标准提 PR 入口） */
function prUrl(owner: string, repo: string, defaultBranch: string, login: string, branch: string): string {
  return `https://github.com/${owner}/${repo}/compare/${defaultBranch}...${login}:${branch}?expand=1`;
}

/** 进入时查到的仓库信息（permissions + 本地状态） */
interface ForkInfo {
  owner: string;
  repo: string;
  fullName: string;
  login: string;
  defaultBranch: string;
}

/** fork 成功结果（服务端返回） */
interface ForkResult {
  forkFullName: string;
  forkUrl: string;
  login: string;
  defaultBranch: string;
  remoteSet: boolean;
  remoteMsg: string;
}

export function GitHubForkModal(props: {
  onClose: () => void;
  /** Fork 成功且本地有提交：交给宿主走现有推送任务；弹窗随即进成功态 */
  onForked: () => void;
  /** Fork 成功且服务端已把 origin 改指 fork：宿主重拉仓库信息（顶栏远程地址随之更新） */
  onRemoteChanged: () => void;
}) {
  const [phase, setPhase] = useState<'checking' | 'confirm' | 'busy' | 'done' | 'error'>('checking');
  const [info, setInfo] = useState<ForkInfo | null>(null);
  const [unpushed, setUnpushed] = useState(0);
  const [branch, setBranch] = useState('');
  const [result, setResult] = useState<ForkResult | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        // 并行：权限（canPush/isOwn/defaultBranch）+ 待推送数 + 当前分支
        const [perm, un, gi] = await Promise.all([get.ghPermissions(), get.gitUnpushed(), get.gitInfo()]);
        if (cancelled) return;
        if (!perm.ok || !perm.isGithub) {
          setErr(perm.message ?? t('srv.ghNotGithub'));
          setPhase('error');
          return;
        }
        if (perm.isOwn) {
          // 这是你自己账号下的仓库，无需 Fork
          setErr(t('srv.ghForkIsOwn'));
          setPhase('error');
          return;
        }
        setInfo({
          owner: perm.owner ?? '',
          repo: perm.repo ?? '',
          fullName: perm.fullName ?? '',
          login: perm.login ?? '',
          defaultBranch: perm.defaultBranch ?? '',
        });
        setUnpushed(un.count);
        setBranch(gi.branch);
        setPhase('confirm');
      } catch (e) {
        if (!cancelled) {
          setErr((e as Error).message);
          setPhase('error');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const doFork = () => {
    setPhase('busy');
    setErr('');
    void post
      .ghFork()
      .then((r) => {
        if (!r.ok) {
          setErr(r.message ?? '');
          setPhase('error');
          return;
        }
        setResult({
          forkFullName: r.forkFullName ?? '',
          forkUrl: r.forkUrl ?? '',
          login: r.login ?? info?.login ?? '',
          defaultBranch: r.defaultBranch || info?.defaultBranch || '',
          remoteSet: r.remoteSet === true,
          remoteMsg: r.remoteMsg ?? '',
        });
        setPhase('done');
        // origin 已改指 fork（remoteSet=false 时仍是原仓库）：顶栏远程地址要跟着换
        if (r.remoteSet === true) props.onRemoteChanged();
        // 有提交：自动走推送任务（推送可能慢——不阻塞本弹窗，结果看任务横幅/铃铛）
        if (unpushed > 0) props.onForked();
      })
      .catch((e) => {
        setErr((e as Error).message);
        setPhase('error');
      });
  };

  return (
    <div className="modal-mask">
      <ResizableModal width={500} minWidth={420}>
        {/* Fork 到自己账号 */}
        <h3>{t('repo.ghFork.title')}</h3>
        <div className="body">
          {phase === 'checking' && (
            <div className="dim row" style={{ gap: 6, alignItems: 'center' }}>
              <span className="search-spin" />
              {/* 正在检查仓库权限… */}
              {t('repo.ghFork.checking')}
            </div>
          )}
          {phase === 'confirm' && info && (
            <>
              <div className="small" style={{ marginBottom: 8, wordBreak: 'break-all' }}>
                {/* 将把 {src} Fork 到你的账号：{dst}（origin 改指你的 Fork，原仓库记入 upstream） */}
                {t('repo.ghFork.note', { src: info.fullName, dst: `${info.login}/${info.repo}` })}
              </div>
              <div className="small dim">
                {unpushed > 0
                  // 本地有 {n} 个提交待推送——Fork 后自动推送
                  ? t('repo.ghFork.willPush', { n: unpushed })
                  // 本地暂无提交——Fork 后仅切换 origin，提交后再推送
                  : t('repo.ghFork.willPushNone')}
              </div>
            </>
          )}
          {phase === 'busy' && (
            // Fork 中…
            <div className="dim small">{t('repo.ghFork.busy')}</div>
          )}
          {phase === 'done' && result && (
            <>
              <div className="small" style={{ color: 'var(--ok)', marginBottom: 6, wordBreak: 'break-all' }}>
                {/* ✅ 已 Fork 到 {name} 并切换 origin */}
                {t('repo.ghFork.done', { name: result.forkFullName })}
              </div>
              {!result.remoteSet && (
                <div className="small" style={{ color: 'var(--warn)', marginBottom: 6, wordBreak: 'break-all' }}>
                  {/* ⚠ origin 未设置成功：{msg} */}
                  ⚠ {t('repo.ghFork.remoteFail', { msg: result.remoteMsg || result.forkUrl })}
                </div>
              )}
              {unpushed > 0 && result.remoteSet && (
                <div className="dim small" style={{ marginBottom: 8 }}>
                  {/* 正在推送——进度与结果看顶栏任务横幅 */}
                  {t('repo.ghFork.pushing')}
                </div>
              )}
              {unpushed > 0 && result.remoteSet && branch && info && (
                <button
                  className="mini"
                  onClick={() =>
                    void post.openUrl(
                      prUrl(info.owner, info.repo, result.defaultBranch || info.defaultBranch, result.login, branch)
                    )
                  }
                >
                  {/* 去 GitHub 提 PR */}
                  {t('repo.ghFork.openPR')}
                </button>
              )}
            </>
          )}
          {phase === 'error' && (
            <div className="error small" style={{ wordBreak: 'break-all' }}>
              {err}
            </div>
          )}
        </div>
        <div className="foot">
          {phase === 'confirm' && (
            <>
              {/* 取消 */}
              <button onClick={props.onClose}>{t('common.cancel')}</button>
              {/* Fork */}
              <button className="primary" onClick={doFork}>{t('repo.ghFork.fork')}</button>
            </>
          )}
          {phase === 'checking' && (
            <>
              {/* 取消 */}
              <button onClick={props.onClose}>{t('common.cancel')}</button>
            </>
          )}
          {phase === 'busy' && (
            <>
              {/* 取消 */}
              <button onClick={props.onClose} disabled>{t('common.cancel')}</button>
            </>
          )}
          {phase === 'done' && (
            // 完成
            <button className="primary" onClick={props.onClose}>{t('repo.ghFork.doneBtn')}</button>
          )}
          {phase === 'error' && (
            // 关闭
            <button onClick={props.onClose}>{t('common.close')}</button>
          )}
        </div>
      </ResizableModal>
    </div>
  );
}
