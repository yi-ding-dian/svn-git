/** 仓库浏览右键「检出到本地」弹窗（不依赖已打开项目，URL 直连检出工作副本）：
 *  状态机 form（选所在目录/名称）→ run（进度 + 取消）→ done（打开项目 / 关闭）；
 *  认证失败 → 显示「当前账号[X]没有获取该仓库权限」+「待输入有权限的账号密码」（**只本次用、
 *  后端不落盘**）→ 带新凭据重试。「开跑即验」：有权限的账号不弹任何框，直接检出成功。
 *  右上角 - 号 = 第二步「后台任务机制」的占位（第一步禁用，见 record.md 设计稿）。
 *  入口：repo-browse.tsx 树里右键（目录行 + 空白 = 仓库根）。 */
import React, { useEffect, useRef, useState } from 'react';
import { get, post, ApiError } from '../shared/api.js';
import { ModalShell } from '../shell/modal-shell.js';
import { DirPicker } from './dir-picker.js';
import { FormRow } from '../ui/ui.js';
import { ResultLine } from '../ui/result-line.js';
import { cmdOfRepo } from '../shared/cmd-preview.js';
import { joinPath } from '../shared/utils.js';
import { t } from '../../shared/i18n/index.js';

/** URL 末段 → 默认本地名称（仓库根 URL 时即仓库名） */
function defaultName(url: string): string {
  try {
    return decodeURIComponent(url.replace(/\/+$/, '').split('/').pop() ?? '');
  } catch {
    return url.replace(/\/+$/, '').split('/').pop() ?? '';
  }
}

type Phase = 'form' | 'run' | 'done';

export function CheckoutDialog(props: {
  /** 要检出的远程目录 URL（树行 = 行 URL；空白右键 = 仓库根） */
  url: string;
  onClose: () => void;
  /** 检出成功后「打开项目」：由外层把工作副本作为项目打开 */
  onOpenProject?: (dir: string) => void;
}) {
  const [phase, setPhase] = useState<Phase>('form');
  const [dir, setDir] = useState('');
  const [name, setName] = useState(() => defaultName(props.url));
  const [picker, setPicker] = useState(false);
  const [msg, setMsg] = useState('');
  const [msgErr, setMsgErr] = useState(false);
  const [donePath, setDonePath] = useState('');
  // 认证失败信息：{user} = 本次后端实际使用的账号（空串 = 匿名）；显示「当前账号[X]没有获取该仓库权限」
  const [authFail, setAuthFail] = useState<{ user: string } | null>(null);
  const [credOpen, setCredOpen] = useState(false);
  const [credUser, setCredUser] = useState('');
  const [credPass, setCredPass] = useState('');
  const [elapsed, setElapsed] = useState(0);
  const [slowNet, setSlowNet] = useState(false);
  /** 标题右侧「当前检出账号」：已保存配置的用户名 + 系统凭据缓存身份（挂载时一次查全） */
  const [cfgUser, setCfgUser] = useState('');
  const [cacheUser, setCacheUser] = useState('');
  /** 上次重试用的临时凭据（标题显示"这次会用谁"用；不保存、仅本次） */
  const [usedCred, setUsedCred] = useState<{ username: string; password: string } | null>(null);
  /** 本次检出的取消句柄：取消 / 关弹窗都靠它把请求连同后端 svn 子进程一起停掉（并清半截目录） */
  const abortRef = useRef<AbortController | null>(null);
  /** 检出上限：与后端一致（10 分钟） */
  const CO_TIMEOUT_S = 600;
  /** 多久还没有文件落盘就给"网络慢"提示（秒），同「获取仓库」 */
  const SLOW_HINT_S = 10;

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

  /** 开始检出（cred = 本次临时凭据；缺省用后端已存配置/匿名） */
  const start = (cred?: { username: string; password: string }) => {
    if (!dir.trim() || !name.trim()) {
      // 请填写目标和名称
      setMsg(t('repo.get.needTargetName'));
      setMsgErr(true);
      return;
    }
    setPhase('run');
    setMsg('');
    setMsgErr(false);
    setAuthFail(null);
    setElapsed(0);
    setSlowNet(false);
    setUsedCred(cred ?? null); // 标题「当前检出账号」跟随这次实际要用的凭据
    abortRef.current?.abort(); // 上一次还挂着的（重试场景）：先取消，免得两个请求打架
    const ac = new AbortController();
    abortRef.current = ac;
    const tick = setInterval(() => setElapsed((n) => n + 1), 1000);
    // 到点自动停：断开请求 → 后端 abort 掉 svn 子进程（两边都是 600s，这里先动）
    const deadline = setTimeout(() => ac.abort(), CO_TIMEOUT_S * 1000);
    // 进度探测：目标目录里有没有真文件落盘（/api/browse 天然过滤隐藏项，.svn 不算）。
    // 到 SLOW_HINT_S 还没有文件 → 提示网络慢；一旦有文件 → 立刻撤掉。取首次读数为基线。
    const probeTarget = joinPath(dir.trim(), name.trim());
    let baseline: number | null = null;
    let filesSeen = false;
    const probe = setInterval(() => {
      if (filesSeen) return;
      void (async () => {
        let n = 0;
        try {
          n = (await get.browse(probeTarget)).entries.filter((e) => e.name !== '..').length;
        } catch {
          n = 0; // 目录还没建出来：当 0 处理（首个文件一落盘就会 > 0）
        }
        if (baseline === null) {
          baseline = n;
          return;
        }
        if (n > baseline) {
          filesSeen = true;
          setSlowNet(false);
        }
      })();
    }, 2000);
    const slowTimer = setTimeout(() => {
      if (!filesSeen) setSlowNet(true);
    }, SLOW_HINT_S * 1000);
    const done = () => {
      clearInterval(tick);
      clearInterval(probe);
      clearTimeout(slowTimer);
      clearTimeout(deadline);
      if (abortRef.current === ac) abortRef.current = null;
    };
    post
      .repoCheckout(props.url, dir.trim(), name.trim(), cred, ac.signal)
      .then((r) => {
        if (r.ok) {
          setDonePath(r.repoDir ?? joinPath(dir.trim(), name.trim()));
          setPhase('done');
          return;
        }
        // 认证/授权失败：回表单态显示无权限提示块（可展开输入账号密码重试）
        if (r.authError) {
          setAuthFail({ user: r.user ?? '' });
          setCredOpen(false);
          setPhase('form');
          return;
        }
        setMsg(r.message);
        setMsgErr(true);
        setPhase('form');
      })
      .catch((e: Error) => {
        // 用户取消（ApiError.cancelled，消息即「已取消」）不算错误；其他异常如实报，回表单可重试
        setMsg(e.message);
        setPhase('form');
        setMsgErr(!(e instanceof ApiError && e.cancelled));
      })
      .finally(done);
  };

  /** 用输入的账号密码重试（临时凭据只本次用；后端不落盘） */
  const retryWithCred = () => {
    if (!credUser.trim() || !credPass) {
      // 请填写用户名和密码
      setMsg(t('repo.co.needCred'));
      setMsgErr(true);
      return;
    }
    start({ username: credUser.trim(), password: credPass });
  };

  /** 关闭弹窗（含中止在飞的检出）：X / Esc / 取消都走它——直接关掉不等于停了，
   *  必须 abort 让后端把 svn 子进程收掉、半截目录清掉 */
  const closeDialog = () => {
    abortRef.current?.abort();
    props.onClose();
  };

  // foot：按阶段换按钮组
  const foot =
    phase === 'run' ? (
      <button onClick={() => abortRef.current?.abort()} title={t('repo.co.cancelTip')}>
        {/* 取消 */}
        {t('common.cancel')}
      </button>
    ) : phase === 'done' ? (
      <>
        {/* 关闭 */}
        <button onClick={props.onClose}>{t('common.close')}</button>
        {/* 打开项目 */}
        <button className="primary" onClick={() => props.onOpenProject?.(donePath)}>{t('repo.co.open')}</button>
      </>
    ) : (
      <>
        {/* 关闭 */}
        <button onClick={closeDialog}>{t('common.close')}</button>
        <button
          className="primary"
          disabled={!dir.trim() || !name.trim()}
          onClick={() => start()}
          title={cmdOfRepo('svn', 'checkout', { url: props.url, dir: joinPath(dir, name.trim() || '…') }) ?? ''}
        >
          {/* 检出 */}
          {t('repo.co.start')}
        </button>
      </>
    );

  // 标题右侧「当前检出账号」：本次输入 > 上次重试的临时凭据 > 工具配置 > 系统凭据缓存 > 匿名
  const typedUser = credUser.trim();
  const who = typedUser || usedCred?.username || cfgUser || cacheUser;
  const whoTip =
    typedUser || usedCred
      ? t('repo.co.whoTipTyped')
      : cfgUser
        ? t('repo.co.whoTipSaved')
        : cacheUser
          ? t('repo.co.whoTipCache')
          : t('repo.co.whoTipAnon');

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
      onClose={closeDialog}
      width={560}
      foot={foot}
      closeIcon
      titleExtra={
        // - 号（第二步「后台任务」的位置）：第一步禁用，悬浮说明。
        // right = 14(X 的 right) + 28(X 宽) + 6(间距)，与放大的 ✕ 对齐
        <button className="modal-x" style={{ right: 48, opacity: 0.45, cursor: 'not-allowed' }} disabled title={t('repo.co.minTip')}>
          −
        </button>
      }
    >
      {/* 远程路径：只读展示（"上方显示要获取的仓库远程路径"） */}
      <FormRow label={t('repo.co.remote')}>
        <div className="mono small" style={{ wordBreak: 'break-all', lineHeight: 1.5 }}>{props.url}</div>
      </FormRow>
      {phase !== 'done' && (
        <>
          {/* 所在目录（父目录路径） */}
          <FormRow label={t('repo.parentDir')}>
            <div className="row" style={{ gap: 8 }}>
              <input type="text" placeholder="/home/me/projects" value={dir} onChange={(e) => setDir(e.target.value)} style={{ flex: 1 }} disabled={phase === 'run'} />
              {/* 打开文件夹浏览（可新建/重命名文件夹） */}
              <button className="mini tool-btn" title={t('repo.browseTip')} onClick={() => setPicker(true)} disabled={phase === 'run'}>
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
              disabled={phase === 'run'}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && phase === 'form') start();
              }}
            />
          </FormRow>
        </>
      )}
      {phase === 'run' && (
        <>
          <div className="dim small" style={{ marginTop: 6 }}>
            {/* 正在检出…已用 {n} 秒 */}
            {t('repo.co.busy', { n: elapsed })}
          </div>
          {slowNet && (
            <div className="small" style={{ marginTop: 6, color: 'var(--warn)' }}>
              {/* 远程网络较慢或不稳定，获取仍在继续，请耐心等待；确认网络不通可点「取消」后换网络或地址重试 */}
              {t('repo.get.slowNet')}
            </div>
          )}
        </>
      )}
      {phase === 'done' && (
        <div className="row" style={{ gap: 8, marginTop: 4 }}>
          <span style={{ color: 'var(--ok)' }}>✓</span>
          <span className="mono small" style={{ wordBreak: 'break-all' }}>
            {/* 已检出到 {path} */}
            {t('repo.co.done', { path: donePath })}
          </span>
        </div>
      )}
      {/* 认证失败提示块：当前账号[X]没有获取该仓库权限（X 空 = 匿名） + 取消/输入有权限的账号密码 */}
      {phase === 'form' && authFail && (
        <div style={{ marginTop: 10, padding: '10px 12px', border: '1px solid var(--warn)', borderRadius: 6 }}>
          <div className="small" style={{ color: 'var(--warn)' }}>
            ⚠ {t('repo.co.noPerm', { user: authFail.user || t('repo.co.anonymous') })}
          </div>
          {!credOpen ? (
            <div className="row" style={{ gap: 8, marginTop: 10, justifyContent: 'flex-end' }}>
              {/* 取消 */}
              <button onClick={props.onClose}>{t('common.cancel')}</button>
              {/* 输入有权限的账号密码 */}
              <button className="primary" onClick={() => setCredOpen(true)}>{t('repo.co.enterCred')}</button>
            </div>
          ) : (
            <div style={{ marginTop: 8 }}>
              {/* 用户名 */}
              <FormRow label={t('repo.co.credUser')}>
                <input type="text" autoFocus value={credUser} onChange={(e) => setCredUser(e.target.value)} />
              </FormRow>
              {/* 密码 */}
              <FormRow label={t('repo.co.credPass')}>
                <input
                  type="password"
                  value={credPass}
                  onChange={(e) => setCredPass(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') retryWithCred();
                  }}
                />
              </FormRow>
              <div className="dim small">
                {/* 仅用于本次检出，不会保存 */}
                {t('repo.co.credHint')}
              </div>
              <div className="row" style={{ gap: 8, marginTop: 10, justifyContent: 'flex-end' }}>
                {/* 用新账号重试 */}
                <button className="primary" onClick={retryWithCred}>{t('repo.co.retryWithCred')}</button>
              </div>
            </div>
          )}
        </div>
      )}
      <ResultLine msg={msg} err={msgErr} />
      {/* 文件夹浏览选择器：选择所在目录 */}
      {picker && (
        <div className="modal-mask">
          <ModalShell
            // 📂 选择所在目录
            title={t('repo.pickDirTitle')}
            onClose={() => setPicker(false)}
            width={640}
          >
            <DirPicker
              startDir={dir}
              onPick={(p) => {
                setDir(p);
                setPicker(false);
              }}
              onClose={() => setPicker(false)}
            />
          </ModalShell>
        </div>
      )}
    </ModalShell>
  );
}
