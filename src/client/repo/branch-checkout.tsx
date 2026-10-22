/** Git 分支检出弹窗：分支详情 + 目标目录 + 检出方式（独立克隆 / worktree）。
 *
 *  与标签检出分开：分支检出默认完整 clone 后 checkout 分支；worktree 共享当前仓库 .git。
 *  ops 域的分支弹窗只发 onCheckoutBranch，由 shell/modal-host 渲染本组件（避免跨域引用）。
 *
 *  入口：分支管理弹窗每行「📥 检出」（Git 仓库）。 */
import React, { useEffect, useState } from 'react';
import { get, post, type RepoCheck } from '../shared/api.js';
import { ModalShell } from '../shell/modal-shell.js';
import { PickDirModal } from './pick-dir.js';
import { FormRow } from '../ui/ui.js';
import { CommandPreview } from '../ui/command-preview.js';
import { ResultLine } from '../ui/result-line.js';
import { Tooltip } from '../ui/tooltip.js';
import { joinPath, isImeComposing } from '../shared/utils.js';
import { t } from '../../shared/i18n/index.js';

/** 分支检出目标（由 shell 组装：source/repoRoot 来自当前仓库信息） */
export interface BranchCheckoutRequest {
  /** 显示名（远程分支形如 origin/feature） */
  name: string;
  /** 本地分支名（远程分支去掉 origin/ 前缀） */
  localName: string;
  /** 是否按远程分支检出（本地已有同名分支时为 false） */
  remote: boolean;
  /** 克隆来源：origin；无 origin 时为本地仓库路径 */
  source: string;
  /** worktree 模式在哪个工作副本里执行（当前仓库根） */
  repoRoot: string;
}

/** 检出参数：宿主用「获取仓库」任务发起（ref 为本地分支名或 origin/xxx） */
export interface BranchCheckoutParams {
  dir: string;
  name: string;
  mode: 'clone' | 'worktree';
  ref: string;
  /** 克隆来源（worktree 模式不使用） */
  source: string;
  /** worktree 模式：当前仓库根 */
  repoRoot: string;
}

/** ISO 时间 → 本地可读（解析失败原样返回） */
function formatDate(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

export function BranchCheckoutDialog(props: {
  request: BranchCheckoutRequest;
  onClose: () => void;
  onStart: (p: BranchCheckoutParams) => void;
}) {
  const [dir, setDir] = useState('');
  const [name, setName] = useState(props.request.localName);
  const [picker, setPicker] = useState(false);
  const [msg, setMsg] = useState('');
  const [msgErr, setMsgErr] = useState(false);
  /** 检出方式：独立克隆（默认）/ worktree（共享 .git） */
  const [mode, setMode] = useState<'clone' | 'worktree'>('clone');
  /** 分支最后一次提交（异步补；失败静默） */
  const [commit, setCommit] = useState<{ rev?: string; subject?: string; author?: string; date?: string } | null>(null);
  /** 目标目录预检 */
  const [precheck, setPrecheck] = useState<RepoCheck | null>(null);
  const [precheckState, setPrecheckState] = useState<'idle' | 'loading' | 'fail'>('idle');

  useEffect(() => {
    get
      .info()
      .then((r) => setDir((d) => d || r.home || ''))
      .catch(() => {
        /* 拿不到就用空值，用户自行输入/浏览 */
      });
  }, []);

  // 分支详情：最后提交（Git log -1；远程分支用 origin/xxx）
  useEffect(() => {
    let alive = true;
    const ref = props.request.remote ? `origin/${props.request.localName}` : props.request.localName;
    get
      .branchLog(ref)
      .then((r) => {
        if (alive && r.ok) setCommit(r);
      })
      .catch(() => {
        /* 失败静默：详情卡只显示分支名 */
      });
    return () => {
      alive = false;
    };
  }, [props.request.remote, props.request.localName]);

  // 目标预检：clone 不能到非空目录；worktree 要求目标不存在
  useEffect(() => {
    const d = dir.trim();
    const n = name.trim();
    if (!d || !n) {
      setPrecheck(null);
      setPrecheckState('idle');
      return;
    }
    let alive = true;
    setPrecheckState('loading');
    const timer = setTimeout(() => {
      post
        .repoCheck('git', d, n)
        .then((r) => {
          if (!alive) return;
          setPrecheck(r);
          setPrecheckState('idle');
        })
        .catch(() => {
          if (!alive) return;
          setPrecheck(null);
          setPrecheckState('fail');
        });
    }, 400);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [dir, name]);

  const target = dir.trim() && name.trim() ? joinPath(dir.trim(), name.trim()) : '';
  const ref = props.request.remote ? `origin/${props.request.localName}` : props.request.localName;
  /** worktree 目标是必须不存在；clone 允许空目录和 .git 残骸 */
  const targetBlocked =
    mode === 'worktree' ? Boolean(precheck?.exists) : Boolean(precheck?.existsNonEmpty && !precheck.onlyGit);

  let hint = '';
  let hintTone: 'ok' | 'warn' | 'err' | 'dim' = 'dim';
  if (!target) {
    hint = t('repo.co.targetEmptyInput');
  } else if (precheckState === 'loading') {
    hint = t('repo.co.checking');
  } else if (precheckState === 'fail') {
    hint = t('repo.co.checkFailed');
    hintTone = 'warn';
  } else if (mode === 'worktree' && precheck?.exists) {
    hint = t('repo.branchCo.worktreeTarget');
    hintTone = 'err';
  } else if (mode === 'clone' && targetBlocked) {
    hint = t('repo.co.targetNotEmpty');
    hintTone = 'err';
  } else if (mode === 'clone' && precheck?.existsNonEmpty && precheck.onlyGit) {
    hint = t('repo.co.targetResidue');
    hintTone = 'warn';
  } else if (mode === 'clone' && precheck?.exists) {
    hint = t('repo.co.targetEmptyDir');
  } else if (precheck?.inRepo) {
    hint = t('repo.co.targetInRepo', { root: precheck.inRepo.root });
    hintTone = 'warn';
  } else if (precheck) {
    hint = t('repo.co.targetNew');
    hintTone = 'ok';
  }
  const hintColor = hintTone === 'err' ? 'var(--err)' : hintTone === 'warn' ? 'var(--warn)' : hintTone === 'ok' ? 'var(--ok)' : 'var(--dim)';

  // 命令预览：与实际后端执行一致（clone 后 checkout 分支 / worktree add）
  const cmds =
    mode === 'clone'
      ? [
          `git clone ${props.request.source} ${target || '<target>'}`,
          props.request.remote ? `git checkout -b ${props.request.localName} ${ref}` : `git checkout ${props.request.localName}`,
        ]
      : [
          props.request.remote
            ? `git worktree add -b ${props.request.localName} ${target || '<target>'} ${ref}`
            : `git worktree add ${target || '<target>'} ${props.request.localName}`,
        ];

  const validate = (): boolean => {
    if (!dir.trim() || !name.trim()) {
      setMsg(t('repo.get.needTargetName'));
      setMsgErr(true);
      return false;
    }
    if (targetBlocked) {
      setMsg(mode === 'worktree' ? t('repo.branchCo.worktreeTarget') : t('repo.co.targetNotEmpty'));
      setMsgErr(true);
      return false;
    }
    setMsg('');
    setMsgErr(false);
    return true;
  };

  const start = () => {
    props.onStart({
      dir: dir.trim(),
      name: name.trim(),
      mode,
      ref,
      source: props.request.source,
      repoRoot: props.request.repoRoot,
    });
    props.onClose();
  };

  return (
    <ModalShell
      icon="🌿"
      title={t('repo.branchCo.title')}
      onClose={props.onClose}
      width={560}
      closeIcon
      foot={
        <>
          <button onClick={props.onClose}>{t('common.close')}</button>
          <button
            className="primary"
            disabled={!dir.trim() || !name.trim() || targetBlocked}
            // 禁用态原因：disabled 按钮收不到悬浮事件，保持原生 title
            title={targetBlocked ? t('repo.co.targetNotEmpty') : undefined}
            onClick={() => {
              if (validate()) start();
            }}
          >
            {/* 检出 */}
            {t('repo.co.start')}
          </button>
        </>
      }
    >
      {/* 分支详情：名称 / 短哈希 / 最后提交 */}
      <div
        style={{
          border: '1px solid var(--border)',
          borderRadius: 6,
          padding: '8px 10px',
          marginBottom: 12,
          background: 'var(--panel)',
        }}
      >
        <div className="row" style={{ alignItems: 'baseline', gap: 8 }}>
          <span style={{ color: 'var(--accent)' }}>🌿</span>
          <span className="mono" style={{ flex: 1, wordBreak: 'break-all' }}>{props.request.name}</span>
          {props.request.remote && <span className="badge">{t('repo.branchCo.remoteBranch')}</span>}
          {commit?.rev && <span className="mono small dim">{commit.rev}</span>}
        </div>
        {(commit?.subject || commit?.author || commit?.date) && (
          <div style={{ marginTop: 6 }}>
            {commit?.subject && (
              <div className="small" style={{ lineHeight: 1.5 }}>
                {t('repo.tagCo.lastCommit')}: {commit.subject}
              </div>
            )}
            {(commit?.author || commit?.date) && (
              <div className="dim small" style={{ marginTop: 2 }}>
                {commit.author || '—'}
                {commit.date ? ` · ${formatDate(commit.date)}` : ''}
              </div>
            )}
          </div>
        )}
      </div>
      {/* 来源地址 */}
      <FormRow label={t('repo.tagCo.source')}>
        <div className="mono small" style={{ wordBreak: 'break-all', lineHeight: 1.5 }}>{props.request.source}</div>
      </FormRow>
      {/* 所在目录 */}
      <FormRow label={t('repo.parentDir')}>
        <div className="row" style={{ gap: 8 }}>
          <input type="text" placeholder="/home/me/projects" value={dir} onChange={(e) => setDir(e.target.value)} style={{ flex: 1 }} />
          <Tooltip content={t('repo.browseTip')}>
            <button className="mini tool-btn" onClick={() => setPicker(true)}>
              {t('repo.browse')}
            </button>
          </Tooltip>
        </div>
      </FormRow>
      {/* 本地名称 */}
      <FormRow label={t('repo.co.localName')}>
        <input
          type="text"
          placeholder={props.request.localName}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (isImeComposing(e)) return;
            if (e.key === 'Enter' && validate()) start();
          }}
        />
      </FormRow>
      {/* 检出方式：独立克隆 / worktree */}
      <FormRow label={t('repo.branchCo.mode')}>
        <div>
          <label className="row" style={{ gap: 8, alignItems: 'flex-start', cursor: 'pointer' }}>
            <input type="radio" name="branch-checkout-mode" checked={mode === 'clone'} onChange={() => setMode('clone')} style={{ marginTop: 3 }} />
            <span>
              <span>{t('repo.branchCo.clone')}</span>
              <div className="dim small" style={{ marginTop: 2 }}>{t('repo.branchCo.cloneHint')}</div>
            </span>
          </label>
          <label className="row" style={{ gap: 8, alignItems: 'flex-start', marginTop: 10, cursor: 'pointer' }}>
            <input type="radio" name="branch-checkout-mode" checked={mode === 'worktree'} onChange={() => setMode('worktree')} style={{ marginTop: 3 }} />
            <span>
              <span>{t('repo.branchCo.worktree')}</span>
              <div className="dim small" style={{ marginTop: 2 }}>{t('repo.branchCo.worktreeHint')}</div>
            </span>
          </label>
        </div>
      </FormRow>
      {/* 检出目录预览 */}
      <FormRow label={t('repo.co.targetPreview')}>
        <div>
          <div className="mono small" style={{ wordBreak: 'break-all', lineHeight: 1.5 }} title={target || undefined}>
            {target || '—'}
          </div>
          {hint && (
            <div className="small" style={{ marginTop: 4, color: hintColor }}>
              {hint}
            </div>
          )}
        </div>
      </FormRow>
      <ResultLine msg={msg} err={msgErr} />
      <CommandPreview commands={cmds} />
      {picker && (
        <PickDirModal
          title={t('repo.pickDirTitle')}
          startDir={dir}
          onPick={(p) => {
            setDir(p);
            setPicker(false);
          }}
          onClose={() => setPicker(false)}
        />
      )}
    </ModalShell>
  );
}
