/** 新建 / 获取仓库弹窗：新建仓库（CreateRepoDialog，git init / svnadmin create）+ 获取仓库（GetRepoDialog，git clone / svn checkout） */
import React, { useRef, useState } from 'react';
import { get, post, type RepoCheck } from '../shared/api.js';
import { ModalShell } from '../shell/modal-shell.js';
import { IconDownload, IconPlus } from '../ui/icons.js';
import { PickDirModal } from './pick-dir.js';
import { HelpNote, FormRow } from '../ui/ui.js';
import { ConfirmModal } from '../ui/prompt.js';
import { cmdOfRepo } from '../shared/cmd-preview.js';
import { runAction } from '../shared/vcs-action.js';
import { ResultLine } from '../ui/result-line.js';
import { joinPath } from '../shared/utils.js';
import { t } from '../../shared/i18n/index.js';
import { GitPushAuthModal } from './git-auth.js';
// ==================== 创建 / 克隆仓库 ====================

export function CreateRepoDialog(props: { home?: string; onClose: () => void; onCreated: (dir: string) => void }) {
  const [type, setType] = useState<'git' | 'svn'>('git');
  const [dir, setDir] = useState(props.home ?? '');
  const [name, setName] = useState('');
  const [standard, setStandard] = useState(true); // svn 标准布局（trunk/branches/tags），默认勾选
  const [msg, setMsg] = useState('');
  const [msgErr, setMsgErr] = useState(false);
  const [busy, setBusy] = useState(false);
  const [picker, setPicker] = useState(false); // 文件夹浏览选择器
  const [pending, setPending] = useState<RepoCheck | null>(null); // 二次确认数据（打开确认框）

  const submit = () => {
    if (!dir.trim() || !name.trim()) {
      // 请填写目录和名称
      setMsg(t('repo.create.needDirName'));
      setMsgErr(true);
      return;
    }
    setBusy(true);
    // 前置风险检测（目标已存在 / 位于仓库内），成功后弹二次确认
    void post
      .repoCheck(type, dir.trim(), name.trim())
      .then((r) => setPending(r))
      .catch((e) => {
        setMsg((e as Error).message);
        setMsgErr(true);
      })
      .finally(() => setBusy(false));
  };

  // 二次确认后执行创建
  const doCreate = () => {
    setPending(null);
    setBusy(true);
    void runAction(
      () => post.repoCreate(type, dir.trim(), name.trim(), '', standard),
      (m, err) => {
        setMsg(m);
        setMsgErr(Boolean(err));
      },
      // 打开服务端返回的仓库路径（git=目标目录；svn=xxx-wc 工作副本），没返回时兜底拼路径
      (r) => props.onCreated(r.repoDir ?? `${dir.trim().replace(/\/$/, '')}/${name.trim()}`)
    ).finally(() => setBusy(false));
  };

  return (
    <ModalShell
      icon={<IconPlus size={16} />}
      // 新建仓库
      title={t('repo.create.title')}
      onClose={props.onClose}
      width={540}
      foot={
        <>
          {/* 关闭 */}
          <button onClick={props.onClose}>{t('common.close')}</button>
          <button
            className="primary"
            disabled={busy}
            onClick={submit}
            title={
              `${
                type === 'git'
                  ? (cmdOfRepo('git', 'init', { dir: `${dir.trim()}/${name.trim() || '…'}` }) ?? '')
                  : (cmdOfRepo('svn', 'create', { dir: `${dir.trim()}/${name.trim() || '…'}` }) ?? '')
              }`
            }
          >
            {/* 创建中… / 创建 */}
            {busy ? t('repo.create.creating') : t('repo.create.create')}
          </button>
        </>
      }
    >
      <HelpNote>
        {/* 两种方式：Git 仓库 = 在本地目录初始化新仓库（git init）；SVN 仓库 = 用 svnadmin 创建本地仓库，默认创建标准布局（trunk / branches / tags）并检出 trunk 作为工作副本（目录名 + "-wc"）。 */}
        {t('repo.create.help')}
      </HelpNote>
      <div style={{ marginTop: 12 }} />
      <div className="row" style={{ marginBottom: 12, gap: 6 }}>
        {(
          [
            // Git 仓库 (init)
            ['git', t('repo.create.typeGit')],
            // SVN 仓库（svnadmin）
            ['svn', t('repo.create.typeSvn')],
          ] as const
        ).map(([k, label]) => (
          <button key={k} className={`mini ${type === k ? 'primary' : ''}`} onClick={() => setType(k)}>
            {label}
          </button>
        ))}
      </div>
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
      {/* 仓库名称 */}
      <FormRow label={t('repo.create.name')}>
        <input
          type="text"
          placeholder="my-project"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
          }}
        />
      </FormRow>
      <div className="dim small" style={{ whiteSpace: 'pre-line' }}>
        {(() => {
          // 同获取仓库弹窗：分隔符按「所在目录」的形态统一（避免 `D:\x/new-repo` 这种混用）
          const base = joinPath(dir, name.trim() || '…');
          // 将创建：Git 仓库 {path}\ngit init 创建，创建后自动打开
          if (type === 'git') return t('repo.create.previewGit', { path: base });
          // 将创建：SVN 版本库 {path}（服务器存储，不能直接编辑）\n并检出工作副本 {wc}（创建后自动打开；日常编辑、添加、提交都在工作副本进行）
          return t('repo.create.previewSvn', { path: base, wc: `${base}-wc` });
        })()}
      </div>
      {/* SVN 标准布局选项（默认勾选，非标准布局仓库分支管理受限） */}
      {type === 'svn' && (
        <>
          <label className="row" style={{ gap: 6, marginTop: 8, cursor: 'pointer' }}>
            <input type="checkbox" checked={standard} onChange={(e) => setStandard(e.target.checked)} />
            {/* 创建标准布局（trunk / branches / tags），工作副本检出 trunk */}
            <span className="small">{t('repo.create.standard')}</span>
          </label>
          {!standard && (
            <div className="small" style={{ color: 'var(--warn)', marginTop: 4 }}>
              {/* ⚠ 不创建标准布局：分支 / 标签管理将不可用（后续无法自动创建分支和标签） */}
              {t('repo.create.standardWarn')}
            </div>
          )}
        </>
      )}
      <ResultLine msg={msg} err={msgErr} />
      {/* 二次确认：目标路径 + 命令 + 风险检测 */}
      {pending && (
        <ConfirmModal
          // 确认创建仓库？
          title={t('repo.create.confirmTitle')}
          message={
            <>
              {/* 目标路径：{path} */}
              <div>{t('repo.confirm.target', { path: pending.target })}</div>
              {/* 将执行：git init 初始化仓库（命令预览见按钮） / 将执行：svnadmin create 创建版本库 + 检出工作副本（命令预览见按钮） */}
              <div>{type === 'git' ? t('repo.create.willRunGit') : t('repo.create.willRunSvn')}</div>
              {pending.inRepo && (
                <div style={{ color: 'var(--warn)', marginTop: 6 }}>
                  {/* ⚠ 目标位于 {type} 仓库内（{root}）——在其内部创建会成为外层仓库的未版本化内容，状态/数据可能错乱 */}
                  {t('repo.create.inRepoTip', { type: pending.inRepo.type.toUpperCase(), root: pending.inRepo.root })}
                </div>
              )}
              {pending.existsNonEmpty && (
                <div style={{ color: 'var(--warn)', marginTop: 6 }}>
                  {/* ⚠ 目标目录已存在且非空（{target}）——可能已有仓库/文件，继续创建可能失败或产生嵌套 */}
                  {t('repo.create.existsTip', { target: pending.target })}
                </div>
              )}
            </>
          }
          // 确认创建
          confirmLabel={t('repo.create.confirm')}
          confirmCmd={
            type === 'git'
              ? (cmdOfRepo('git', 'init', { dir: pending.target }) ?? '')
              : (cmdOfRepo('svn', 'create', { dir: pending.target }) ?? '')
          }
          onConfirm={doCreate}
          onCancel={() => setPending(null)}
        />
      )}
      {/* 目录选择（与「打开项目」共用的目录浏览器）：新建/重命名，确定填充所在目录 */}
      {picker && (
        <PickDirModal
          // 📂 选择所在目录
          title={t('repo.pickDirTitle')}
          startDir={props.home ?? ''}
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

/** 获取仓库：Git 克隆 / SVN 检出（成员从服务器/远程获取工作副本，不是新建） */
export function GetRepoDialog(props: { home?: string; onClose: () => void; onCreated: (dir: string) => void }) {
  const [type, setType] = useState<'git' | 'svn'>('git');
  const [url, setUrl] = useState('');
  const [dir, setDir] = useState(props.home ?? '');
  const [name, setName] = useState('');
  const [msg, setMsg] = useState('');
  const [msgErr, setMsgErr] = useState(false);
  const [busy, setBusy] = useState(false);
  const [picker, setPicker] = useState(false);
  const [pending, setPending] = useState<RepoCheck | null>(null); // 二次确认数据

  const submit = () => {
    if (!url.trim()) {
      // 请填写地址（URL）
      setMsg(t('repo.get.needUrl'));
      setMsgErr(true);
      return;
    }
    if (!dir.trim() || !name.trim()) {
      // 请填写目标和名称
      setMsg(t('repo.get.needTargetName'));
      setMsgErr(true);
      return;
    }
    setBusy(true);
    // 前置风险检测（目标已存在 / 位于仓库内），成功后弹二次确认
    void post
      .repoCheck(type, dir.trim(), name.trim(), url.trim())
      .then((r) => setPending(r))
      .catch((e) => {
        setMsg((e as Error).message);
        setMsgErr(true);
      })
      .finally(() => setBusy(false));
  };

  /** 认证失败（私有仓库/凭据不对）：弹认证框引导填写，保存后自动重试克隆 */
  const [authAsk, setAuthAsk] = useState<{ type: 'github' | 'server' | 'ssh'; error: string } | null>(null);
  /** 正在获取时显示已用秒数（网络卡住时用户知道它在动，而不是卡死了） */
  const [elapsed, setElapsed] = useState(0);
  /** 长时间没有文件落盘 → 提示"网络慢/不稳定"（慢网络下别让用户以为卡死，也别急着取消） */
  const [slowNet, setSlowNet] = useState(false);
  /** 当前这次获取的取消句柄：关弹窗/超时都靠它把请求连同后端的 git 子进程一起停掉 */
  const abortRef = useRef<AbortController | null>(null);
  /** 获取上限：与后端一致（两边都是 10 分钟；大仓库首次克隆常常要几分钟） */
  const GET_TIMEOUT_S = 600;
  /** 多久还没有文件落盘就给"网络慢"提示（秒） */
  const SLOW_HINT_S = 10;

  // 二次确认后执行获取
  const doGet = () => {
    setPending(null);
    setBusy(true);
    setElapsed(0);
    setSlowNet(false);
    abortRef.current?.abort(); // 上一次还挂着的（重试场景）：先取消，免得两个请求打架
    const ac = new AbortController();
    abortRef.current = ac;
    const tick = setInterval(() => setElapsed((n) => n + 1), 1000);
    // 到点自动停：断开请求 → 后端 abort 掉 git 子进程（两边都是 600s，这里先动）
    const deadline = setTimeout(() => ac.abort(), GET_TIMEOUT_S * 1000);
    // ---------- 进度探测：目标目录里有没有真文件落盘 ----------
    // `/api/browse` 本来就过滤隐藏项（`.git` 天然不算），且目标目录此时不在任何仓库里，
    // 复用它最省事——不为此新增端点。取第一次读到的条目数当基线（目录还没建出来时是 0），
    // 之后**多出来**的才算"开始下载文件"（克隆进用户已有的空目录时，基线不为 0）。
    // 到 SLOW_HINT_S 还没有文件 → 提示网络慢；一旦有文件 → 立刻撤掉提示。
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
    void runAction(
      () => post.repoCreate(type, dir.trim(), name.trim(), url.trim(), true, ac.signal),
      (m, err) => {
        setMsg(m);
        setMsgErr(Boolean(err));
      },
      (r) => {
        // 认证失败：不在这里报错了事，弹认证框（存的是 git 账号/Token），保存后自动重试
        if (!r.ok) {
          if (r.authError && r.authType) setAuthAsk({ type: r.authType, error: r.message });
          return;
        }
        // 打开服务端返回的仓库路径（git/svn 均为目标目录），没返回时兜底拼路径
        props.onCreated(r.repoDir ?? joinPath(dir, name.trim()));
      },
      true // onFailOk：失败时也要拿到 r 才能判断是不是认证问题
    )
      .catch(() => {
        /* abort/网络异常已在 runAction 里转过消息，这里只保证计时器收尾 */
      })
      .finally(() => {
        done();
        setBusy(false);
      });
  };

  /** 关闭弹窗（含中止在飞的获取）：X / 遮罩 / 底部「关闭」都走它——
   *  获取中直接关掉不等于停了，必须 abort 让后端把 git / svn 子进程一起收掉 */
  const closeDialog = () => {
    abortRef.current?.abort();
    props.onClose();
  };

  return (
    <ModalShell
      icon={<IconDownload size={16} />}
      // 获取仓库
      title={t('repo.get.title')}
      onClose={closeDialog}
      width={540}
      foot={
        <>
          {busy ? (
            // 获取中 → 「取消」出口：断开请求，后端会连带杀掉在跑的 git / svn 进程并清掉半截目录。
            // （原先只有「关闭」，且它没接 abort——点掉之后进程还在后台跑到超时上限）
            <button onClick={() => abortRef.current?.abort()} title={t('repo.get.cancelTip')}>
              {/* 取消 */}
              {t('common.cancel')}
            </button>
          ) : (
            // 关闭
            <button onClick={closeDialog}>{t('common.close')}</button>
          )}
          <button
            className="primary"
            disabled={busy}
            onClick={submit}
            title={
              `${
                type === 'git'
                  ? (cmdOfRepo('git', 'clone', { url: url.trim() || '…', dir: joinPath(dir, name.trim() || '…') }) ?? '')
                  : (cmdOfRepo('svn', 'checkout', { url: url.trim() || '…', dir: joinPath(dir, name.trim() || '…') }) ?? '')
              }`
            }
          >
            {/* 获取中… / 获取 */}
            {busy ? t('repo.get.getting') : t('repo.get.get')}
          </button>
        </>
      }
    >
      <HelpNote>
        {/* 两种方式：Git 克隆 = git clone（从地址复制一份到本地）；SVN 检出 = svn checkout（从服务器获取工作副本，目标目录即本地名称）。 */}
        {t('repo.get.help')}
      </HelpNote>
      <div style={{ marginTop: 12 }} />
      <div className="row" style={{ marginBottom: 12, gap: 6 }}>
        {(
          [
            // Git 克隆
            ['git', t('repo.get.typeGit')],
            // SVN 检出
            ['svn', t('repo.get.typeSvn')],
          ] as const
        ).map(([k, label]) => (
          <button key={k} className={`mini ${type === k ? 'primary' : ''}`} onClick={() => setType(k)}>
            {label}
          </button>
        ))}
      </div>
      {/* 地址（URL） */}
      <FormRow label={t('repo.get.url')}>
        <input
          type="text"
          placeholder={type === 'git' ? 'https://github.com/xxx/repo.git' : 'http://192.168.0.30:8080/software2/projects/xxx/trunk'}
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
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
      {/* 本地名称（工作副本名） */}
      <FormRow label={t('repo.get.localName')}>
        <input
          type="text"
          placeholder="my-project"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
          }}
        />
      </FormRow>
      <div className="dim small" style={{ whiteSpace: 'pre-line' }}>
        {(() => {
          // 分隔符按「所在目录」的形态统一（joinPath）：Windows 上父目录是反斜杠、这里又按 `/` 拼，
          // 会预览成 `D:\gitProjects/snow-apps`（用户实报的混用分隔符）
          const base = joinPath(dir, name.trim() || '…');
          const u = url.trim() || '…';
          // 将克隆：{url} → {path}\ngit clone 后自动打开
          if (type === 'git') return t('repo.get.previewGit', { url: u, path: base });
          // 将检出：{url} → {path}\nsvn checkout 后自动打开（SVN 建议检出 trunk 或目标分支/标签）
          return t('repo.get.previewSvn', { url: u, path: base });
        })()}
      </div>
      <ResultLine msg={msg} err={msgErr} />
      {busy && (
        <div className="dim small" style={{ marginTop: 6 }}>
          {/* ⏳ 正在获取…已用 {n} 秒（最多 {max} 秒，超时会自动停止） */}
          {t('repo.get.elapsed', { n: elapsed, max: GET_TIMEOUT_S })}
        </div>
      )}
      {busy && slowNet && (
        <div className="small" style={{ marginTop: 6, color: 'var(--warn)' }}>
          {/* 远程网络较慢或不稳定，获取仍在继续，请耐心等待；确认网络不通可点「取消」后换网络/地址重试 */}
          {t('repo.get.slowNet')}
        </div>
      )}
      {/* 二次确认：目标路径 + 命令 + 风险检测 */}
      {pending && (
        <ConfirmModal
          // 确认获取仓库？
          title={t('repo.get.confirmTitle')}
          message={
            <>
              {/* 目标路径：{path} */}
              <div>{t('repo.confirm.target', { path: pending.target })}</div>
              {/* 将执行：git clone {url}（命令预览见按钮） / 将执行：svn checkout {url}（命令预览见按钮） */}
              <div>{type === 'git' ? t('repo.get.willRunGit', { url: url.trim() }) : t('repo.get.willRunSvn', { url: url.trim() })}</div>
              {pending.inRepo && (
                <div style={{ color: 'var(--warn)', marginTop: 6 }}>
                  {/* ⚠ 目标位于 {type} 仓库内（{root}）——检出的文件会成为外层仓库的未版本化内容，状态/数据可能错乱 */}
                  {t('repo.get.inRepoTip', { type: pending.inRepo.type.toUpperCase(), root: pending.inRepo.root })}
                </div>
              )}
              {pending.existsNonEmpty && (
                <div style={{ color: 'var(--warn)', marginTop: 6 }}>
                  {/* ⚠ 目标目录已存在且非空（{target}）——克隆/检出到非空目录会失败，可能已有仓库/文件 */}
                  {t('repo.get.existsTip', { target: pending.target })}
                </div>
              )}
            </>
          }
          // 确认获取
          confirmLabel={t('repo.get.confirm')}
          confirmCmd={
            type === 'git'
              ? (cmdOfRepo('git', 'clone', { url: url.trim(), dir: pending.target }) ?? '')
              : (cmdOfRepo('svn', 'checkout', { url: url.trim(), dir: pending.target }) ?? '')
          }
          onConfirm={doGet}
          onCancel={() => setPending(null)}
        />
      )}
      {/* 目录选择（与「打开项目」共用的目录浏览器）：选择所在目录 */}
      {picker && (
        <PickDirModal
          // 📂 选择所在目录
          title={t('repo.pickDirTitle')}
          startDir={props.home ?? ''}
          onPick={(p) => {
            setDir(p);
            setPicker(false);
          }}
          onClose={() => setPicker(false)}
        />
      )}
      {/* 认证失败（私有仓库 / 凭据不对）：复用推送那套认证弹窗，保存后自动重试克隆 */}
      {authAsk && (
        <GitPushAuthModal
          type={authAsk.type}
          error={authAsk.error}
          purpose="get"
          onClose={() => setAuthAsk(null)}
          onToast={(m) => setMsg(m)} // 这个弹窗组件没有全局 toast 通道，反馈落在自身结果行
          onSaved={() => {
            setAuthAsk(null);
            doGet(); // 存好凭据直接重试（后端会带 GIT_ASKPASS）
          }}
        />
      )}
    </ModalShell>
  );
}
