/** Git 标签检出弹窗：标签详情 + 目标目录 + 目录预览 + 克隆方式（完整 / 浅克隆）。
 *
 *  与 SVN 的 CheckoutDialog 分开：Git 没有选择性检出/稀疏目录，克隆方式也不同
 *  （`git clone --branch refs/tags/<名>`，可选 `--depth 1`）。
 *  ops 域的 TagDialog 只发 onCheckout，由 shell/modal-host 渲染本组件（业务域之间不互相引用）。
 *
 *  入口：标签管理弹窗某行「检出」（Git 仓库）。 */
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

/** 标签详情（来自 /api/tags 的 git details） */
export interface GitTagCheckoutDetail {
  name: string;
  /** 克隆来源：origin；无 origin 时本地仓库路径 */
  source: string;
  /** 标签指向的提交短哈希 */
  hash?: string;
  /** 最后提交的第一行信息 */
  subject?: string;
  author?: string;
  date?: string;
  /** 附注标签的创建者/创建时间（轻量标签为空） */
  tagAuthor?: string;
  tagDate?: string;
  /** 来源是本地路径（仓库没有 origin） */
  localSource?: boolean;
}

/** 检出参数：宿主用「获取仓库」任务发起（ref = refs/tags/<标签名>） */
export interface GitTagCheckoutParams {
  tag: string;
  source: string;
  dir: string;
  name: string;
  /** 1 = 浅克隆（仅该版本，不拉历史）；undefined = 完整克隆 */
  depth?: number;
}

/** ISO 时间 → 本地可读（解析失败原样返回） */
function formatDate(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

export function TagCheckoutDialog(props: {
  detail: GitTagCheckoutDetail;
  onClose: () => void;
  /** 点「开始克隆」：把参数交给宿主发起后台任务（本弹窗随即关闭） */
  onStart: (p: GitTagCheckoutParams) => void;
}) {
  const [dir, setDir] = useState('');
  const [name, setName] = useState(props.detail.name);
  const [picker, setPicker] = useState(false);
  const [msg, setMsg] = useState('');
  const [msgErr, setMsgErr] = useState(false);
  /** 目录预览的轻量预检（目标是否存在/非空、是否位于工作副本内）：输入防抖 400ms */
  const [precheck, setPrecheck] = useState<RepoCheck | null>(null);
  const [precheckState, setPrecheckState] = useState<'idle' | 'loading' | 'fail'>('idle');
  /** 克隆方式选择（点「检出」后弹出；默认完整克隆） */
  const [modeOpen, setModeOpen] = useState(false);
  const [shallow, setShallow] = useState(false);

  // 默认所在目录 = home（与「打开项目」「检出到本地」一致）
  useEffect(() => {
    get
      .info()
      .then((r) => setDir((d) => d || r.home || ''))
      .catch(() => {
        /* 拿不到就用空值，用户自行输入/浏览 */
      });
  }, []);

  // 目录预览预检：目标非空且不是 .git 残留时提前禁用克隆（后端同样会拒绝）
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

  /** 落地路径（所在目录 + 本地名称） */
  const target = dir.trim() && name.trim() ? joinPath(dir.trim(), name.trim()) : '';
  /** 目标非空且不是「只有 .git 残留」：克隆必然失败，提前拦 */
  const targetBlocked = Boolean(precheck?.existsNonEmpty && !precheck.onlyGit);

  /** 目录预览的状态提示（文案 + 颜色） */
  let hint = '';
  let hintTone: 'ok' | 'warn' | 'err' | 'dim' = 'dim';
  if (!target) {
    hint = t('repo.co.targetEmptyInput');
  } else if (precheckState === 'loading') {
    hint = t('repo.co.checking');
  } else if (precheckState === 'fail') {
    hint = t('repo.co.checkFailed');
    hintTone = 'warn';
  } else if (targetBlocked) {
    hint = t('repo.co.targetNotEmpty');
    hintTone = 'err';
  } else if (precheck?.existsNonEmpty && precheck.onlyGit) {
    hint = t('repo.co.targetResidue');
    hintTone = 'warn';
  } else if (precheck?.exists) {
    hint = t('repo.co.targetEmptyDir');
  } else if (precheck?.inRepo) {
    hint = t('repo.co.targetInRepo', { root: precheck.inRepo.root });
    hintTone = 'warn';
  } else if (precheck) {
    hint = t('repo.co.targetNew');
    hintTone = 'ok';
  }
  const hintColor = hintTone === 'err' ? 'var(--err)' : hintTone === 'warn' ? 'var(--warn)' : hintTone === 'ok' ? 'var(--ok)' : 'var(--dim)';

  /** 克隆方式选择里的命令预览（与实际后端执行一致：
   *  完整克隆后 checkout 标签；浅克隆只 fetch 该标签的 1 个提交。
   *  本地路径的浅克隆后端会自动转 file://，预览仍显示原路径（教学用）。 */
  const tagRef = `refs/tags/${props.detail.name}`;
  const cloneCmds = shallow
    ? [
        `git init ${target || '<target>'}`,
        `git remote add origin ${props.detail.source}`,
        `git fetch --depth 1 origin ${tagRef}:${tagRef}`,
        `git checkout --detach ${tagRef}`,
      ]
    : [`git clone ${props.detail.source} ${target || '<target>'}`, `git checkout --detach ${tagRef}`];

  const validate = (): boolean => {
    if (!dir.trim() || !name.trim()) {
      setMsg(t('repo.get.needTargetName'));
      setMsgErr(true);
      return false;
    }
    if (targetBlocked) {
      setMsg(t('repo.co.targetNotEmpty'));
      setMsgErr(true);
      return false;
    }
    setMsg('');
    setMsgErr(false);
    return true;
  };

  /** 克隆方式弹窗里点「开始克隆」：交参数给宿主发起后台任务 + 关窗 */
  const start = () => {
    props.onStart({
      tag: props.detail.name,
      source: props.detail.source,
      dir: dir.trim(),
      name: name.trim(),
      depth: shallow ? 1 : undefined,
    });
    props.onClose();
  };

  return (
    <ModalShell
      icon="🏷"
      title={t('repo.tagCo.title')}
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
            title={targetBlocked ? t('repo.co.targetNotEmpty') : t('repo.tagCo.modeHint')}
            onClick={() => {
              if (validate()) setModeOpen(true);
            }}
          >
            {/* 检出 */}
            {t('repo.co.start')}
          </button>
        </>
      }
    >
      {/* 标签详情：名称 / 短哈希 / 创建者 / 时间 + 不可变提示 */}
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
          <span style={{ color: 'var(--accent)' }}>🏷</span>
          <span className="mono" style={{ flex: 1, wordBreak: 'break-all' }}>{props.detail.name}</span>
          {props.detail.hash && <span className="mono small dim">{props.detail.hash}</span>}
        </div>
        {(props.detail.subject || props.detail.author || props.detail.date) && (
          <div style={{ marginTop: 6 }}>
            {props.detail.subject && (
              <div className="small" style={{ lineHeight: 1.5 }}>
                {/* 最后提交 */}
                {t('repo.tagCo.lastCommit')}: {props.detail.subject}
              </div>
            )}
            {(props.detail.author || props.detail.date) && (
              <div className="dim small" style={{ marginTop: 2 }}>
                {props.detail.author || '—'}
                {props.detail.date ? ` · ${formatDate(props.detail.date)}` : ''}
              </div>
            )}
          </div>
        )}
        {(props.detail.tagAuthor || props.detail.tagDate) && (
          <div className="dim small" style={{ marginTop: 4 }}>
            {/* 标签：{author} 于 {date} 创建（仅附注标签） */}
            {t('repo.tagCo.tagCreated', {
              author: props.detail.tagAuthor || '—',
              date: props.detail.tagDate ? formatDate(props.detail.tagDate) : '—',
            })}
          </div>
        )}
        <div className="small" style={{ marginTop: 6, color: 'var(--warn)' }}>
          ⓘ {/* Git 标签不可变，检出后是独立副本，可自由开发 */}
          {t('repo.tagCo.readonlyHint')}
        </div>
      </div>
      {/* 来源地址：origin 优先；无 origin 时本地仓库路径 */}
      <FormRow label={t('repo.tagCo.source')}>
        <div className="mono small" style={{ wordBreak: 'break-all', lineHeight: 1.5 }}>
          {props.detail.source}
          {props.detail.localSource && <span className="dim"> · {t('repo.tagCo.localSource')}</span>}
        </div>
      </FormRow>
      {/* 所在目录（父目录路径） */}
      <FormRow label={t('repo.parentDir')}>
        <div className="row" style={{ gap: 8 }}>
          <input type="text" placeholder="/home/me/projects" value={dir} onChange={(e) => setDir(e.target.value)} style={{ flex: 1 }} />
          <Tooltip content={t('repo.browseTip')}>
            <button className="mini tool-btn" onClick={() => setPicker(true)}>
              {/* 📂 浏览 */}
              {t('repo.browse')}
            </button>
          </Tooltip>
        </div>
      </FormRow>
      {/* 本地名称：默认标签名 */}
      <FormRow label={t('repo.co.localName')}>
        <input
          type="text"
          placeholder={props.detail.name}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (isImeComposing(e)) return;
            if (e.key === 'Enter' && validate()) setModeOpen(true);
          }}
        />
      </FormRow>
      {/* 检出目录预览（放在最后：先填目标，再看落地位置） */}
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
      {/* 克隆方式选择（二次确认）：完整克隆 / 浅克隆，默认完整 */}
      {modeOpen && (
        <ModalShell
          icon="📡"
          title={t('repo.tagCo.modeTitle')}
          width={500}
          onClose={() => setModeOpen(false)}
          closeIcon
          foot={
            <>
              <button onClick={() => setModeOpen(false)}>{t('common.cancel')}</button>
              <button className="primary" onClick={start}>
                {/* 开始克隆 */}
                {t('repo.tagCo.confirm')}
              </button>
            </>
          }
        >
          <div className="small" style={{ marginBottom: 4 }}>
            {/* 标签 */}
            {t('repo.tagCo.modeTag')}: <span className="mono">{props.detail.name}</span>
          </div>
          <div className="mono small" style={{ wordBreak: 'break-all', marginBottom: 12 }}>{target}</div>
          <label className="row" style={{ gap: 8, alignItems: 'flex-start', cursor: 'pointer' }}>
            <input type="radio" name="git-tag-clone-mode" checked={!shallow} onChange={() => setShallow(false)} style={{ marginTop: 3 }} />
            <span>
              <span>{t('repo.tagCo.full')}</span>
              <div className="dim small" style={{ marginTop: 2 }}>{t('repo.tagCo.fullHint')}</div>
            </span>
          </label>
          <label className="row" style={{ gap: 8, alignItems: 'flex-start', marginTop: 12, cursor: 'pointer' }}>
            <input type="radio" name="git-tag-clone-mode" checked={shallow} onChange={() => setShallow(true)} style={{ marginTop: 3 }} />
            <span>
              <span>{t('repo.tagCo.shallow')}</span>
              <div className="dim small" style={{ marginTop: 2 }}>{t('repo.tagCo.shallowHint')}</div>
            </span>
          </label>
          {/* 命令预览：随所选模式变化 */}
          <CommandPreview commands={cloneCmds} defaultOpen />
        </ModalShell>
      )}
      {/* 目录选择（与「打开项目」共用的目录浏览器） */}
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
