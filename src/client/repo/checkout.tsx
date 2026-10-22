/** 仓库浏览右键「检出到本地」弹窗（不依赖已打开项目，URL 直连检出工作副本）：
 *  只收集参数（所在目录 / 本地名称 / 选择性检出）——点「检出」后交给调用方发起**后台任务**、
 *  本弹窗立刻关闭（与「获取仓库」同一套语义，不再有"弹窗里等 / − 最小化"两套）。
 *  进度与取消看顶栏沙漏，完成自动打开工作副本，失败进铃铛；
 *  认证失败由 checkout-task 的 CheckoutAuthModal 引导（账号密码**只本次用**、后端不落盘）。
 *
 *  入口：repo-browse.tsx 树里右键（目录行 + 空白 = 仓库根）。 */
import React, { useEffect, useRef, useState } from 'react';
import { get, post, type RepoCheck } from '../shared/api.js';
import { ModalShell } from '../shell/modal-shell.js';
import { launchMagicFlight } from '../animations/index.js';
import { PickDirModal } from './pick-dir.js';
import { CheckoutTree } from './checkout-tree.js';
import { CheckoutSizeDialog } from './checkout-size.js';
import { CheckoutConfirmDialog } from './checkout-confirm.js';
import { FormRow } from '../ui/ui.js';
import { ResultLine } from '../ui/result-line.js';
import { cmdOfRepo } from '../shared/cmd-preview.js';
import { joinPath, isImeComposing } from '../shared/utils.js';
import type { CheckoutParams } from './checkout-task.js';
import { t } from '../../shared/i18n/index.js';

/** URL 末段 → 默认本地名称（仓库根 URL 时即仓库名） */
function defaultName(url: string): string {
  try {
    return decodeURIComponent(url.replace(/\/+$/, '').split('/').pop() ?? '');
  } catch {
    return url.replace(/\/+$/, '').split('/').pop() ?? '';
  }
}

/** 标签检出时展示的附加详情（来自标签列表；rev/author/date 为标签目录自身的最后修改） */
export interface CheckoutDetail {
  name: string;
  url: string;
  rev?: string;
  author?: string;
  date?: string;
}

/** ISO 时间 → 本地可读（解析失败原样返回） */
function formatDate(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

export function CheckoutDialog(props: {
  /** 要检出的远程目录 URL（树行 = 行 URL；空白右键 = 仓库根） */
  url: string;
  /** 标签检出：顶部附加标签详情卡（名称/版本/作者/时间 + 只读提示） */
  detail?: CheckoutDetail;
  onClose: () => void;
  /** 点「检出」：把参数交给调用方发起后台任务（本弹窗随即关闭） */
  onStart: (p: CheckoutParams) => void;
}) {
  const [dir, setDir] = useState('');
  const [name, setName] = useState(() => defaultName(props.url));
  const [picker, setPicker] = useState(false);
  /** 表单校验消息（任务自身的消息不在这里显示——弹窗已经关了） */
  const [msg, setMsg] = useState('');
  const [msgErr, setMsgErr] = useState(false);
  /** 标题右侧「当前检出账号」：工具配置 + 系统凭据缓存（挂载时一次查全） */
  const [cfgUser, setCfgUser] = useState('');
  const [cacheUser, setCacheUser] = useState('');
  /** 选择性检出：树勾选的相对路径（可多级，如 branches/AnHui） */
  const [checkedDirs, setCheckedDirs] = useState<Set<string>>(() => new Set());
  /** 根级一级目录（树汇报；「全选」按钮与默认全选用） */
  const [rootDirs, setRootDirs] = useState<string[]>([]);
  /** 默认全选已初始化的 URL（同一弹出实例只自动勾一次；用户取消过就不再打扰） */
  const initedUrlRef = useRef('');
  /** 树汇报一级目录：首次（每个 URL）自动全选——打开弹窗默认即为完整检出 */
  const onRootDirs = (dirs: string[]) => {
    setRootDirs(dirs);
    if (initedUrlRef.current !== props.url) {
      initedUrlRef.current = props.url;
      setCheckedDirs(new Set(dirs));
    }
  };
  /** 全选态判断：全部一级目录都显式在勾选集合里（深层拆开会把一级从集合里拆出 → 自然回到"全选"态） */
  const allRootChecked = rootDirs.length > 0 && rootDirs.every((d) => checkedDirs.has(d));
  /** 检出大小检测弹窗（按需触发） */
  const [sizeOpen, setSizeOpen] = useState(false);
  /** 检出二次确认弹窗（列范围树与落地信息，确认后才真正发起） */
  const [confirmOpen, setConfirmOpen] = useState(false);
  /** 检出目录预览的轻量预检（目标是否存在/非空、是否位于工作副本内）：输入防抖 400ms */
  const [precheck, setPrecheck] = useState<RepoCheck | null>(null);
  const [precheckState, setPrecheckState] = useState<'idle' | 'loading' | 'fail'>('idle');
  /** SVN 标签的最后一次提交（补提交信息第一行；失败保持已有版本/作者/时间） */
  const [commit, setCommit] = useState<{ rev?: string; subject?: string; author?: string; date?: string } | null>(null);

  // 默认所在目录 = home（与「打开项目」默认一致）；顺带查 SVN 身份（标题显示用：
  // 工具配置 + 系统凭据缓存——裸跑时 svn 实际用的就是缓存身份）
  useEffect(() => {
    get
      .info()
      .then((r) => setDir((d) => d || r.home || ''))
      .catch(() => {
        /* 拿不到就用空值，用户自行输入/浏览 */
      });
    get
      .svnIdentity(props.url)
      .then((r) => {
        setCfgUser(r.config?.username ?? '');
        setCacheUser(r.cache?.username ?? '');
      })
      .catch(() => {
        /* 拿不到身份按匿名显示 */
      });
  }, [props.url]);

  // 目录预览预检：目录/名称变化后防抖查询（后端只读检查，不创建任何东西）。
  // 目标非空且不是 .svn 残留时提前禁用检出——否则用户要等到二次确认后才被后端拒绝。
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
        .repoCheck('svn', d, n, props.url)
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
  }, [dir, name, props.url]);

  // 标签的最后一次提交：异步补提交信息第一行（失败静默——详情卡仍显示版本/作者/时间）
  useEffect(() => {
    if (!props.detail) return;
    let alive = true;
    get
      .tagLog(props.url)
      .then((r) => {
        if (alive && r.ok) setCommit(r);
      })
      .catch(() => {
        /* 失败静默 */
      });
    return () => {
      alive = false;
    };
  }, [props.url, props.detail]);

  /** 落地路径（所在目录 + 本地名称）：目录预览用 */
  const target = dir.trim() && name.trim() ? joinPath(dir.trim(), name.trim()) : '';
  /** 目标非空且不是「只有 .svn 残留」：检出必然失败，提前拦（后端同样会拒绝） */
  const targetBlocked = Boolean(precheck?.existsNonEmpty && !precheck.onlySvn);

  /** 表单校验（「检出」按钮与回车都先过这里）：通过则进入二次确认 */
  const validate = (): boolean => {
    if (checkedDirs.size === 0) {
      // 请先勾选要检出的目录（可点「全选」）
      setMsg(t('repo.co.needPick'));
      setMsgErr(true);
      return false;
    }
    if (!dir.trim() || !name.trim()) {
      // 请填写目标和名称
      setMsg(t('repo.get.needTargetName'));
      setMsgErr(true);
      return false;
    }
    if (targetBlocked) {
      // 目标已存在且非空：检出必然失败，提前拦
      setMsg(t('repo.co.targetNotEmpty'));
      setMsgErr(true);
      return false;
    }
    setMsg('');
    setMsgErr(false);
    return true;
  };
  /** 二次确认里点「确认检出」：交参数给调用方发起后台任务 + 关窗 */
  const startCheckout = () => {
    props.onStart({ url: props.url, dir: dir.trim(), name: name.trim(), dirs: [...checkedDirs] });
    props.onClose();
  };

  // 标题右侧「当前检出账号」：工具配置 > 系统凭据缓存 > 匿名（本次临时凭据在失败后才输入）
  const who = cfgUser || cacheUser;
  const whoTip = cfgUser ? t('repo.co.whoTipSaved') : cacheUser ? t('repo.co.whoTipCache') : t('repo.co.whoTipAnon');

  /** 目录预览的状态提示（文案 + 颜色）：预检结果决定，检测失败不阻断检出 */
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
  } else if (precheck?.existsNonEmpty && precheck.onlySvn) {
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

  return (
    <ModalShell
      icon="📡"
      title={
        <>
          {/* 检出到本地 */}
          {t('repo.co.title')}
          {/* 当前检出账号（标题右侧；悬浮说明账号来源） */}
          <span className="dim small mono" style={{ marginLeft: 8 }} title={whoTip}>
            👤 {who || t('repo.co.anonymous')}
          </span>
        </>
      }
      onClose={props.onClose}
      width={560}
      closeIcon
      foot={
        <>
          {/* 关闭：表单还没提交，关掉就是放弃填写（没有任务需要处理——任务归顶栏） */}
          <button onClick={props.onClose}>{t('common.close')}</button>
          <button
            className="primary"
            disabled={!dir.trim() || !name.trim() || checkedDirs.size === 0 || targetBlocked}
            onClick={() => {
              // 先过校验，再进二次确认（核对范围树与落地信息后才真正发起——防误操作）
              if (validate()) setConfirmOpen(true);
            }}
            // 一个都没勾：提示先勾选（默认全选后"全取消"= 明确什么都不检出——别走旧"空=完整检出"兜底）
            title={
              targetBlocked
                ? t('repo.co.targetNotEmpty')
                : checkedDirs.size === 0
                  ? t('repo.co.needPick')
                  : (cmdOfRepo('svn', 'checkout', { url: props.url, dir: joinPath(dir, name.trim() || '…') }) ?? '')
            }
          >
            {/* 检出 */}
            {t('repo.co.start')}
          </button>
        </>
      }
    >
      {/* 标签详情（仅标签检出）：最后提交 + 版本/作者/时间 + 只读提示 */}
      {props.detail && (
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
            {(commit?.rev || props.detail.rev) && (
              <span className="mono small dim">r{commit?.rev || props.detail.rev}</span>
            )}
          </div>
          {(commit?.subject || commit?.author || commit?.date || props.detail.author || props.detail.date) && (
            <div style={{ marginTop: 6 }}>
              {commit?.subject && (
                <div className="small" style={{ lineHeight: 1.5 }}>
                  {/* 最后提交 */}
                  {t('repo.tagCo.lastCommit')}: {commit.subject}
                </div>
              )}
              <div className="dim small" style={{ marginTop: 2 }}>
                {commit?.author || props.detail.author || '—'}
                {commit?.date || props.detail.date ? ` · ${formatDate(commit?.date || props.detail.date)}` : ''}
              </div>
            </div>
          )}
          <div className="small" style={{ marginTop: 6, color: 'var(--warn)' }}>
            ⓘ {/* SVN 标签是只读快照，请勿在检出副本中直接提交（会修改标签内容） */}
            {t('repo.co.tagReadonlyHint')}
          </div>
        </div>
      )}
      {/* 远程路径：只读展示（"上方显示要获取的仓库远程路径"） */}
      <FormRow label={t('repo.co.remote')}>
        <div className="mono small" style={{ wordBreak: 'break-all', lineHeight: 1.5 }}>{props.url}</div>
      </FormRow>
      {/* 所在目录（父目录路径） */}
      <FormRow label={t('repo.parentDir')}>
        <div className="row" style={{ gap: 8 }}>
          <input type="text" placeholder="/home/me/projects" value={dir} onChange={(e) => setDir(e.target.value)} style={{ flex: 1 }} />
          {/* 打开文件夹浏览（可新建/重命名文件夹） */}
          <button className="mini tool-btn" title={t('repo.browseTip')} onClick={() => setPicker(true)}>
            {/* 📂 浏览 */}
            {t('repo.browse')}
          </button>
        </div>
      </FormRow>
      {/* 本地名称 */}
      <FormRow label={t('repo.co.localName')}>
        <input
          type="text"
          placeholder="my-project"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (isImeComposing(e)) return;
            if (e.key === 'Enter' && validate()) setConfirmOpen(true);
          }}
        />
      </FormRow>
      {/* 选择性检出（SVN 深度检出）：树勾选后只检出勾选项（可到任意层级），后续更新也只更新它们；
          FormRow 常弹性：窗口/弹窗拉大时树跟着长高（不再是固定高度、下面留一片空） */}
      <FormRow label={t('repo.co.sparseTitle')} style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          {/* 不勾选 = 完整检出；勾选后只检出这些目录（另含根目录文件），后续更新也只更新它们 */}
          <div className="dim small" style={{ flex: 1 }}>{t('repo.co.sparseHint')}</div>
          {/* 全选/全不选（开关式）：全选态（全部一级都在）再点 = 清空；否则 = 全选（并重置深层取消） */}
          <button
            className="mini tool-btn"
            disabled={rootDirs.length === 0}
            onClick={() => setCheckedDirs(allRootChecked ? new Set() : new Set(rootDirs))}
            title={allRootChecked ? t('repo.co.unselectAllTip') : t('repo.co.selectAllTip')}
          >
            {allRootChecked ? t('repo.co.unselectAll') : t('repo.co.selectAll')}
          </button>
          {/* 检出大小检测（按需点；只读，不下载文件）；一个都没勾时不可点（与检出按钮同一门槛） */}
          <button
            className="mini tool-btn"
            disabled={checkedDirs.size === 0}
            onClick={() => setSizeOpen(true)}
            title={checkedDirs.size === 0 ? t('repo.co.needPick') : t('repo.co.sizeTip')}
          >
            {t('repo.co.sizeBtn')}
          </button>
        </div>
        <CheckoutTree rootUrl={props.url} value={checkedDirs} onChange={setCheckedDirs} onRootDirs={onRootDirs} />
      </FormRow>
      {/* 检出目录预览：完整落地路径 + 轻量预检（放在选择性检出之后：先定范围，再看落地位置） */}
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
      {/* 检出二次确认（范围树 + 远程/落地路径；确认后才真正发起） */}
      {confirmOpen && (
        <CheckoutConfirmDialog
          url={props.url}
          target={joinPath(dir.trim(), name.trim())}
          dirs={[...checkedDirs]}
          onConfirm={(e) => {
            // 先放飞行线（从本按钮飞向顶栏沙漏），再发起后台检出
            launchMagicFlight(e.currentTarget.getBoundingClientRect());
            startCheckout();
          }}
          onBack={() => setConfirmOpen(false)}
        />
      )}
      {/* 检出大小检测（按需；范围 = 打开时的勾选） */}
      {sizeOpen && <CheckoutSizeDialog url={props.url} include={[...checkedDirs]} onClose={() => setSizeOpen(false)} />}
      {/* 目录选择（与「打开项目」共用的目录浏览器）：选择所在目录 */}
      {picker && (
        <PickDirModal
          // 📂 选择所在目录
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
