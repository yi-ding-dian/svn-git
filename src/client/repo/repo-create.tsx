/** 新建 / 获取仓库弹窗：新建仓库（CreateRepoDialog，git init / svnadmin create）+ 获取仓库（GetRepoDialog，git clone / svn checkout） */
import React, { useState } from 'react';
import { post, type RepoCheck } from '../shared/api.js';
import { launchMagicFlight } from '../animations/index.js';
import { ModalShell } from '../shell/modal-shell.js';
import { IconDownload, IconPlus } from '../ui/icons.js';
import { PickDirModal } from './pick-dir.js';
import { HelpNote, FormRow } from '../ui/ui.js';
import { ConfirmModal } from '../ui/prompt.js';
import { cmdOfRepo } from '../shared/cmd-preview.js';
import { runAction } from '../shared/vcs-action.js';
import { ResultLine } from '../ui/result-line.js';
import { joinPath, isImeComposing } from '../shared/utils.js';
import { t } from '../../shared/i18n/index.js';
import { useGitHubCred, GitHubCredBox } from './github-cred.js';
// ==================== 创建 / 克隆仓库 ====================

/** 「GitHub 仓库」类型创建后交给宿主继续的 GitHub 步骤参数（本地仓库已建好并打开后执行：
 *  宿主保存内联凭据 → 调 /api/github-create-repo 建远程仓库并设 origin） */
export interface GitHubSetupOpts {
  name: string;
  desc: string;
  isPrivate: boolean;
  /** 内联凭据（未存过/切换了凭据）：宿主先 gitAuthSave 再建远程；null = 用已存凭据 */
  cred: { user: string; token: string } | null;
}

export function CreateRepoDialog(props: {
  home?: string;
  onClose: () => void;
  /** 创建完成（本地仓库已建好）；github 有值 = 选的是「GitHub 仓库」类型，由宿主继续 GitHub 步骤 */
  onCreated: (dir: string, github?: GitHubSetupOpts) => void;
  /** 打开「创建练习仓库」弹窗（放在新建仓库流程里，避免分支弹窗出现无关入口） */
  onOpenPractice?: () => void;
}) {
  const [type, setType] = useState<'git' | 'svn' | 'github'>('git');
  const [dir, setDir] = useState(props.home ?? '');
  const [name, setName] = useState('');
  const [standard, setStandard] = useState(true); // svn 标准布局（trunk/branches/tags），默认勾选
  const [desc, setDesc] = useState(''); // GitHub 类型：仓库描述（可选）
  const [isPrivate, setIsPrivate] = useState(true); // GitHub 类型：默认私有（安全默认，防误公开）
  const cred = useGitHubCred(); // GitHub 类型：凭据（已存/内联填写，与「GitHub 新建仓库」弹窗共用）
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
    // GitHub 类型：内联凭据必填（没填就不去建远程；用已存凭据时不用填）
    if (type === 'github' && cred.mode === 'input' && (!cred.user.trim() || !cred.token)) {
      // 请填写用户名和 Token
      setMsg(t('repo.githubCreate.needCred'));
      setMsgErr(true);
      return;
    }
    setBusy(true);
    // 前置风险检测（目标已存在 / 位于仓库内），成功后弹二次确认。本地部分 github 与 git 同款（git init）
    void post
      .repoCheck(type === 'svn' ? 'svn' : 'git', dir.trim(), name.trim())
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
      // GitHub 类型的本地部分与 git 相同（git init）；远程仓库由宿主在项目打开后继续创建
      () => post.repoCreate(type === 'svn' ? 'svn' : 'git', dir.trim(), name.trim(), '', standard),
      (m, err) => {
        setMsg(m);
        setMsgErr(Boolean(err));
      },
      // 打开服务端返回的仓库路径（git=目标目录；svn=xxx-wc 工作副本），没返回时兜底拼路径；
      // GitHub 类型带上后续步骤参数（宿主建远程并设 origin）
      (r) =>
        props.onCreated(
          r.repoDir ?? `${dir.trim().replace(/\/$/, '')}/${name.trim()}`,
          type === 'github'
            ? {
                name: name.trim(),
                desc: desc.trim(),
                isPrivate,
                cred: cred.mode === 'input' ? { user: cred.user.trim(), token: cred.token } : null,
              }
            : undefined
        )
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
                type === 'svn'
                  ? (cmdOfRepo('svn', 'create', { dir: `${dir.trim()}/${name.trim() || '…'}` }) ?? '')
                  : (cmdOfRepo('git', 'init', { dir: `${dir.trim()}/${name.trim() || '…'}` }) ?? '')
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
      {/* 不想从空仓库开始：直接生成一个预置分支/远程/冲突场景的练习仓库 */}
      {props.onOpenPractice && (
        <div className="row" style={{ marginTop: 10, gap: 8 }}>
          <span className="dim small">{t('repo.practice.createHint')}</span>
          <button className="mini" onClick={props.onOpenPractice} title={t('repo.practice.createEntryTip')}>
            {/* 🧪 练习仓库… */}
            {t('repo.practice.createEntry')}
          </button>
        </div>
      )}
      <div style={{ marginTop: 12 }} />
      <div className="row" style={{ marginBottom: 12, gap: 6 }}>
        {(
          [
            // Git 仓库 (init)
            ['git', t('repo.create.typeGit')],
            // GitHub 仓库（本地 git init + GitHub 建远程仓库）
            ['github', t('repo.create.typeGithub')],
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
            if (isImeComposing(e)) return;
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
          // 将创建：GitHub 仓库 {name}（本地目录 {path}）\n本地 git init 后自动在 GitHub 创建同名远程仓库并设为 origin，创建后自动打开
          if (type === 'github') return t('repo.create.previewGithub', { path: base, name: name.trim() || '…' });
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
      {/* GitHub 类型专用：描述 / 公开私有 / 凭据（建远程仓库用；本地部分与 git 相同） */}
      {type === 'github' && (
        <>
          <FormRow label={t('repo.githubCreate.desc')}>
            <input type="text" value={desc} onChange={(e) => setDesc(e.target.value)} />
          </FormRow>
          <FormRow label={t('repo.githubCreate.visibility')}>
            <div className="row" style={{ gap: 18, alignItems: 'center', flexWrap: 'wrap' }}>
              {/* display:flex 必须 inline：.form-row label 的 display:block 会压过 .row，否则 gap 不生效 */}
              <label className="row" style={{ display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer', marginBottom: 0 }}>
                <input type="radio" checked={isPrivate} onChange={() => setIsPrivate(true)} />
                {/* 私有 */}
                <span>{t('repo.githubCreate.private')}</span>
                {/* 仅自己可见 */}
                <span className="dim small">{t('repo.githubCreate.privateHint')}</span>
              </label>
              <label className="row" style={{ display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer', marginBottom: 0 }}>
                <input type="radio" checked={!isPrivate} onChange={() => setIsPrivate(false)} />
                {/* 公开 */}
                <span>{t('repo.githubCreate.public')}</span>
                {/* 所有人可见 */}
                <span className="dim small">{t('repo.githubCreate.publicHint')}</span>
              </label>
            </div>
          </FormRow>
          <GitHubCredBox cred={cred} onEnter={submit} />
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
              <div>{type === 'svn' ? t('repo.create.willRunSvn') : t('repo.create.willRunGit')}</div>
              {type === 'github' && (
                <div style={{ marginTop: 4 }}>
                  {/* 同时将在 GitHub 上创建同名远程仓库 {name} 并设为 origin */}
                  {t('repo.create.willRunGithub', { name: name.trim() })}
                </div>
              )}
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
            type === 'svn'
              ? (cmdOfRepo('svn', 'create', { dir: pending.target }) ?? '')
              : (cmdOfRepo('git', 'init', { dir: pending.target }) ?? '')
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
/** 获取参数（过了二次确认后交给调用方发起后台任务） */
export interface GetRepoParams {
  type: 'git' | 'svn';
  dir: string;
  name: string;
  url: string;
  /** 标签检出（git）：完整引用（如 refs/tags/v1），避免与同名分支混淆 */
  ref?: string;
  /** 浅克隆深度（1 = 仅该标签版本，不拉历史） */
  depth?: number;
  /** ref 的检出方式：tag 用 detach，分支用 branch（默认按 ref 判断） */
  checkout?: 'detach' | 'branch';
  /** 检出模式：clone（默认）/ worktree（Git 共享当前仓库 .git） */
  mode?: 'clone' | 'worktree';
  /** worktree 模式：在哪个工作副本里执行（当前仓库根） */
  repoRoot?: string;
  /** 任务标题覆盖（标签检出显示「检出标签 · v1」） */
  title?: string;
}

export function GetRepoDialog(props: {
  home?: string;
  /** 预填地址 / 本地名称（「我的 GitHub 仓库」列表选中一个仓库时传入，省得手输） */
  initialUrl?: string;
  initialName?: string;
  onClose: () => void;
  /** 点「获取」并通过二次确认：把参数交给调用方发起**后台任务**，本弹窗随即关闭。
   *  任务活在 shared/tasks 的 store 里（顶栏沙漏看进度/取消、完成自动打开、失败进铃铛），
   *  认证失败也由调用方弹认证框并重试——所以这里不再持有任何任务状态。 */
  onStart: (p: GetRepoParams) => void;
}) {
  const [type, setType] = useState<'git' | 'svn'>('git');
  const [url, setUrl] = useState(props.initialUrl ?? '');
  const [dir, setDir] = useState(props.home ?? '');
  const [name, setName] = useState(props.initialName ?? '');
  const [msg, setMsg] = useState('');
  const [msgErr, setMsgErr] = useState(false);
  /** 前置检测中（repoCheck——几百毫秒）：按钮禁用 +「获取中…」文案 */
  const [checkBusy, setCheckBusy] = useState(false);
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
    setCheckBusy(true);
    // 前置风险检测（目标已存在 / 位于仓库内），成功后弹二次确认
    void post
      .repoCheck(type, dir.trim(), name.trim(), url.trim())
      .then((r) => setPending(r))
      .catch((e) => {
        setMsg((e as Error).message);
        setMsgErr(true);
      })
      .finally(() => setCheckBusy(false));
  };

  /** 二次确认通过 → 把参数交给调用方发起后台任务，本弹窗立刻关闭。
   *  **不再在弹窗里等**：进度/取消归顶栏沙漏，结果归顶部横幅 + 铃铛，认证失败由调用方引导重试
   *  （弹窗一关，任务状态就没地方显示了——留在弹窗里等，用户关窗时又会以为"关了就该停"）。 */
  const startGet = () => {
    setPending(null);
    setMsg('');
    setMsgErr(false);
    props.onStart({ type, dir: dir.trim(), name: name.trim(), url: url.trim() });
    props.onClose();
  };

  // 结果行只承载表单校验消息（任务的结果不在这儿显示——弹窗已经关了）
  const showMsg = msg;
  const showErr = msgErr;

  return (
    <ModalShell
      icon={<IconDownload size={16} />}
      // 获取仓库
      title={t('repo.get.title')}
      onClose={props.onClose}
      width={540}
      closeIcon
      foot={
        <>
          {/* 关闭：表单还没提交，关掉就是放弃填写（没有任务需要处理——任务归顶栏） */}
          <button onClick={props.onClose}>{t('common.close')}</button>
          <button
            className="primary"
            disabled={checkBusy}
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
            {checkBusy ? t('repo.get.getting') : t('repo.get.get')}
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
            if (isImeComposing(e)) return;
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
      <ResultLine msg={showMsg} err={showErr} />
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
          // 确认获取：先放飞行线（从本按钮飞向顶栏沙漏），再发起后台获取任务（弹窗随即关闭）
          onConfirm={(e) => {
            launchMagicFlight(e.currentTarget.getBoundingClientRect());
            startGet();
          }}
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
    </ModalShell>
  );
}
