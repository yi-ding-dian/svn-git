/** 仓库浏览右键「检出到本地」弹窗（不依赖已打开项目，URL 直连检出工作副本）：
 *  表单（选所在目录/名称）→ 进度（已用秒数 + 取消）→ 成功（打开项目 / 关闭）；
 *  认证失败 → 「当前账号[X]没有获取该仓库权限」+「待输入有权限的账号密码」（**只本次用、
 *  后端不落盘**）→ 带新凭据重试。「开跑即验」：有权限的账号不弹任何框。
 *
 *  **后台任务**：检出挂在本应用的任务 store（shared/tasks）上——
 *   - `−` 最小化：弹窗收起、任务继续跑（顶栏沙漏指示器可见，完成弹顶部横幅+铃铛通知）；
 *   - `✕` 关闭：取消进行中的任务（要后台继续用 −）；
 *   - 任务状态由 store 持有 → 弹窗按任务状态渲染（进度/结果/凭据重试）。
 *  入口：repo-browse.tsx 树里右键（目录行 + 空白 = 仓库根）。 */
import React, { useEffect, useState } from 'react';
import { get, post } from '../shared/api.js';
import { startTask, cancelTask, useTasks } from '../shared/tasks.js';
import { ModalShell } from '../shell/modal-shell.js';
import { launchMagicFlight } from '../shell/magic-flight.js';
import { PickDirModal } from './pick-dir.js';
import { FormRow } from '../ui/ui.js';
import { ResultLine } from '../ui/result-line.js';
import { cmdOfRepo } from '../shared/cmd-preview.js';
import { joinPath } from '../shared/utils.js';
import { t } from '../../shared/i18n/index.js';

type CoResp = Awaited<ReturnType<typeof post.repoCheckout>>;

/** URL 末段 → 默认本地名称（仓库根 URL 时即仓库名） */
function defaultName(url: string): string {
  try {
    return decodeURIComponent(url.replace(/\/+$/, '').split('/').pop() ?? '');
  } catch {
    return url.replace(/\/+$/, '').split('/').pop() ?? '';
  }
}

export function CheckoutDialog(props: {
  /** 要检出的远程目录 URL（树行 = 行 URL；空白右键 = 仓库根） */
  url: string;
  onClose: () => void;
  /** 检出成功后「打开项目」：由外层把工作副本作为项目打开 */
  onOpenProject?: (dir: string) => void;
}) {
  const [dir, setDir] = useState('');
  const [name, setName] = useState(() => defaultName(props.url));
  const [picker, setPicker] = useState(false);
  /** 表单校验消息（任务自身的消息从任务读——都是"请填写…"级） */
  const [msg, setMsg] = useState('');
  const [msgErr, setMsgErr] = useState(false);
  const [credOpen, setCredOpen] = useState(false);
  const [credUser, setCredUser] = useState('');
  const [credPass, setCredPass] = useState('');
  /** 标题右侧「当前检出账号」：工具配置 + 系统凭据缓存（挂载时一次查全） */
  const [cfgUser, setCfgUser] = useState('');
  const [cacheUser, setCacheUser] = useState('');
  /** 上次重试用的临时凭据（标题显示"这次会用谁"用；不保存、仅本次） */
  const [usedCred, setUsedCred] = useState<{ username: string; password: string } | null>(null);
  /** 当前检出的后台任务 id（任务在 store 里活过本弹窗——最小化后继续） */
  const [taskId, setTaskId] = useState<number | null>(null);
  /** 每秒重渲（“已用 n 秒”/探测状态） */
  const [, setTick] = useState(0);
  const [slowNet, setSlowNet] = useState(false);
  /** 选择性检出：该 URL 下的一级子目录（null=加载中；[]=没有子目录，区块不显示）；dirsFail=列表拉取失败 */
  const [subDirs, setSubDirs] = useState<string[] | null>(null);
  const [dirsFail, setDirsFail] = useState(false);
  const [checkedDirs, setCheckedDirs] = useState<Set<string>>(() => new Set());

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
    // 选择性检出：拉该 URL 的一级子目录清单（失败只提示、不影响完整检出）
    get
      .repoList(props.url)
      .then((r) => {
        if (r.ok && r.entries) setSubDirs(r.entries.filter((e) => e.isDir && e.name !== '..').map((e) => e.name));
        else setDirsFail(true);
      })
      .catch(() => setDirsFail(true));
  }, [props.url]);

  const bgTasks = useTasks();
  const task = taskId === null ? null : (bgTasks.find((tk) => tk.id === taskId) ?? null);
  const running = task?.status === 'running';
  const resp = (task?.data ?? undefined) as CoResp | undefined;
  const donePath = task?.status === 'done' ? (resp?.repoDir ?? joinPath(dir, name)) : '';
  /** 认证失败（任务 error 且后端标了 authError）：回表单态显示无权限提示块 */
  const authFail = task?.status === 'error' && resp?.authError ? { user: resp.user ?? '' } : null;

  // 运行中每秒 tick（已用秒数）；顺带"网络慢"探测（目标目录文件落盘——弹窗在时才有提示，
  // 最小化后面板里已用秒数仍在涨；一旦有文件立刻撤掉提示）
  useEffect(() => {
    if (!running) return;
    const h = window.setInterval(() => setTick((n) => n + 1), 1000);
    const probeTarget = joinPath(dir, name);
    let baseline: number | null = null;
    let filesSeen = false;
    const probe = window.setInterval(() => {
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
    const slowTimer = window.setTimeout(() => {
      if (!filesSeen) setSlowNet(true);
    }, 10_000);
    return () => {
      clearInterval(h);
      clearInterval(probe);
      clearTimeout(slowTimer);
    };
    // dir/name 在运行中被禁用，闭包值即检出开始时的目标；只在 running 翻转时重建
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running]);

  const elapsed = task ? Math.max(0, Math.floor((Date.now() - task.startedAt) / 1000)) : 0;

  /** 开始检出（cred = 本次临时凭据；重试先取消上一个任务） */
  const start = (cred?: { username: string; password: string }) => {
    if (!dir.trim() || !name.trim()) {
      // 请填写目标和名称
      setMsg(t('repo.get.needTargetName'));
      setMsgErr(true);
      return;
    }
    setMsg('');
    setMsgErr(false);
    setSlowNet(false);
    setUsedCred(cred ?? null); // 标题「当前检出账号」跟随这次实际要用的凭据
    if (taskId) cancelTask(taskId); // 上一次还挂着的（重试场景）：先取消，免得两个任务打架
    const id = startTask({
      // 任务标题：检出到本地 · {name}
      title: `${t('repo.co.title')} · ${name.trim()}`,
      run: async (signal) => {
        const r = await post.repoCheckout(props.url, dir.trim(), name.trim(), cred, signal, [...checkedDirs]);
        // authError 也算"完成但失败"（ok=false）——细节（user）随 data 回给弹窗渲染凭据块
        return { ok: r.ok, message: r.message, data: r };
      },
    });
    setTaskId(id);
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

  /** ✕ 关闭 = 取消进行中的任务（要后台继续请用「−」最小化） */
  const closeDialog = () => {
    if (taskId && running) cancelTask(taskId);
    props.onClose();
  };

  /** − 最小化：弹窗收起、任务继续（顶栏沙漏指示器可见，完成弹顶部横幅+铃铛通知） */
  const minimize = () => {
    props.onClose();
  };

  // 结果行：任务被取消/失败（非认证类）如实显示；表单校验消息优先
  const cancelled = task?.status === 'cancelled';
  const taskErrMsg = task?.status === 'error' && !resp?.authError ? (task.message ?? '') : '';
  const showMsg = msg || (cancelled ? t('common.cancelled') : taskErrMsg);
  const showErr = msg ? msgErr : Boolean(taskErrMsg);

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

  // foot：运行中 → 「取消」；完成 → 「关闭/打开项目」；其余（表单/失败/取消）→ 「关闭/检出」
  const foot = running ? (
    <button onClick={() => taskId && cancelTask(taskId)} title={t('repo.co.cancelTip')}>
      {/* 取消 */}
      {t('common.cancel')}
    </button>
  ) : task?.status === 'done' ? (
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
        onClick={(e) => {
          // 先放飞行线（从本按钮飞向顶栏沙漏），再发起后台检出（disabled 保证校验已过）
          launchMagicFlight(e.currentTarget.getBoundingClientRect());
          start();
        }}
        title={cmdOfRepo('svn', 'checkout', { url: props.url, dir: joinPath(dir, name.trim() || '…') }) ?? ''}
      >
        {/* 检出 */}
        {t('repo.co.start')}
      </button>
    </>
  );

  const done = task?.status === 'done';

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
        // - 号：运行中可点 = 最小化到后台（任务继续，完成 toast）；空闲时禁用。
        // right = 14(X 的 right) + 28(X 宽) + 6(间距)，与放大的 ✕ 对齐；class 用 modal-min（非 modal-x）
        <button
          className="modal-min"
          style={{ right: 48, opacity: running ? 1 : 0.45, cursor: running ? 'pointer' : 'not-allowed' }}
          disabled={!running}
          onClick={minimize}
          title={running ? t('repo.co.minTip') : undefined}
        >
          −
        </button>
      }
    >
      {/* 远程路径：只读展示（"上方显示要获取的仓库远程路径"） */}
      <FormRow label={t('repo.co.remote')}>
        <div className="mono small" style={{ wordBreak: 'break-all', lineHeight: 1.5 }}>{props.url}</div>
      </FormRow>
      {!done && (
        <>
          {/* 所在目录（父目录路径） */}
          <FormRow label={t('repo.parentDir')}>
            <div className="row" style={{ gap: 8 }}>
              <input type="text" placeholder="/home/me/projects" value={dir} onChange={(e) => setDir(e.target.value)} style={{ flex: 1 }} disabled={running} />
              {/* 打开文件夹浏览（可新建/重命名文件夹） */}
              <button className="mini tool-btn" title={t('repo.browseTip')} onClick={() => setPicker(true)} disabled={running}>
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
              disabled={running}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !running) start();
              }}
            />
          </FormRow>
          {/* 选择性检出（SVN 深度检出）：勾选后只检出勾选的子目录，后续更新也只更新它们 */}
          {subDirs === null && !dirsFail && (
            // 正在获取目录列表…
            <div className="dim small" style={{ marginBottom: 10 }}>{t('repo.co.sparseLoading')}</div>
          )}
          {dirsFail && (
            // 目录列表获取失败——不影响完整检出
            <div className="dim small" style={{ marginBottom: 10 }}>{t('repo.co.sparseLoadFail')}</div>
          )}
          {subDirs && subDirs.length > 0 && (
            <FormRow label={t('repo.co.sparseTitle')}>
              {/* 不勾选 = 完整检出；勾选后只检出这些目录（另含根目录文件），后续更新也只更新它们 */}
              <div className="dim small" style={{ marginBottom: 6 }}>{t('repo.co.sparseHint')}</div>
              <div style={{ maxHeight: 140, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 10px' }}>
                {subDirs.map((d) => (
                  // display:flex 必须 inline：.form-row label 的 display:block 会压过 .row
                  <label key={d} className="row" style={{ display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer', marginBottom: 0, padding: '2px 0' }}>
                    <input
                      type="checkbox"
                      disabled={running}
                      checked={checkedDirs.has(d)}
                      onChange={(e) =>
                        setCheckedDirs((s) => {
                          const n = new Set(s);
                          if (e.target.checked) n.add(d);
                          else n.delete(d);
                          return n;
                        })
                      }
                    />
                    <span className="small mono">📁 {d}</span>
                  </label>
                ))}
              </div>
            </FormRow>
          )}
        </>
      )}
      {running && (
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
      {done && (
        <div className="row" style={{ gap: 8, marginTop: 4 }}>
          <span style={{ color: 'var(--ok)' }}>✓</span>
          <span className="mono small" style={{ wordBreak: 'break-all' }}>
            {/* 已检出到 {path} */}
            {t('repo.co.done', { path: donePath })}
          </span>
        </div>
      )}
      {/* 认证失败提示块：当前账号[X]没有获取该仓库权限（X 空 = 匿名） + 取消/输入有权限的账号密码 */}
      {!running && authFail && (
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
      <ResultLine msg={showMsg} err={showErr} />
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
