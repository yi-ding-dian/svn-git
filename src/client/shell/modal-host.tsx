/** 全部模态出口：把 app.tsx JSX 里平铺的 21 个弹窗分支（原 928-1267 行，约 320 行）
 *  与「推送中 / 更新中」两个遮罩集中到这里，根组件只剩一行 <ModalHost />。
 *
 *  纯搬迁，交互逻辑一行未改。依赖按类别分组传入（而非平铺 30+ 个 props）：
 *  - state / set：弹窗状态与 setter（推送/更新已后台任务化——无进度遮罩；结果窗保留）
 *  - ctx：当前仓库与只读上下文
 *  - appearance / theme：外观与主题
 *  - actions：提交、推送、刷新、diff 跳转等动作
 */
import React from 'react';
import { get, post, type RepoInfo } from '../shared/api.js';
import { CommitModal } from '../ops/commit.js';
import { CommitSelectModal } from '../ops/commit-select.js';
import { BranchDialog } from '../ops/branch.js';
import { CleanDialog, StashDialog } from '../ops/clean-stash.js';
import { TagDialog, GitInfoModal } from '../ops/tag-git-info.js';
import { GitHubCreateModal } from '../repo/gh-create-repo.js';
import { GitHubDeleteModal } from '../repo/gh-delete-repo.js';
import { GitHubForkModal } from '../repo/gh-fork.js';
import { GitHubRepoModal } from '../repo/github-repo.js';
import { GitPushAuthModal } from '../repo/git-auth.js';
import { LoginModal } from '../repo/login.js';
import { EnvInstallModal } from '../repo/env-install.js';
import { RepoBrowseModal } from '../repo/repo-browse.js';
import { CreateRepoDialog, GetRepoDialog, type GhSetupOpts } from '../repo/repo-create.js';
import { RevertModal } from '../filesystem/revert.js';
import { RenameModal } from '../filesystem/rename.js';
import { ConfirmModal } from '../ui/prompt.js';
import type { Modal } from './modal-types.js';
import { PushConfirmModal } from '../ops/push-confirm.js';
import { ConflictResolverModal } from '../conflicts/conflicts.js';
import { RemoteConflictModal } from '../conflicts/remote-conflicts.js';
import { ThemePopover } from '../appearance/theme-popover.js';
import type { MyTheme } from '../shared/theme.js';
import { FontModal } from '../appearance/font-modal.js';
import { TerminalModal } from '../terminal/terminal.js';
import { OpenModal } from '../repo/open.js';
import { IconOk } from '../ui/icons.js';
import { pathAutoWidth, translateVcsError } from '../shared/utils.js';
import type { View } from './sidebar.js';
import { t } from '../../shared/i18n/index.js';

/** 文件操作类型（App 的 runOp 参数；定义在此供双方引用，避免 app ↔ modal-host 循环依赖） */
export type Op = 'add' | 'commit' | 'update' | 'revert' | 'delete' | 'fs-delete' | 'push' | 'move' | 'fs-move';

/** 新建仓库成功后的引导条文案（说明产物与下一步） */
export function onboardText(r: RepoInfo): string {
  const root = r.root ?? '';
  if (r.type === 'svn') {
    // ✅ 已创建并打开 SVN 仓库：版本库 {repo}（存储），工作副本 {wc}（已打开，日常操作都在这里）。下一步：在文件列表右键「添加到版本库」→「提交」。
    return t('shell.onboard.svn', { repo: root.replace(/-wc$/, ''), wc: root });
  }
  // ✅ 已创建 Git 仓库并打开：{root}。下一步：添加文件到版本库 → 提交 → 推送。
  return t('shell.onboard.git', { root });
}

export interface ModalHostProps {
  /** 弹窗状态（含进行中的遮罩） */
  state: {
    modal: Modal;
    pushAuth: { type: 'github' | 'server' | 'ssh'; error?: string } | null;
    themePop: { x: number; y: number } | null;
    /** 点开过但打不开的项目：路径 → 错误消息（列表项上常驻 ×，悬浮时显示同一条） */
    invalidPaths: Record<string, string>;
    /** 打开某个最近项目（面板里点击时用） */
    openHistoryItem: (h: { path: string }) => void;
    configUser: string;
  };
  /** 对应 setter */
  set: {
    setModal: (m: Modal) => void;
    setPushAuth: (v: ModalHostProps['state']['pushAuth']) => void;
    setThemePop: (v: { x: number; y: number } | null) => void;
    setConfigUser: (v: string) => void;
    setInfo: (r: RepoInfo) => void;
    setOnboard: (v: string | null) => void;
    setView: (v: View) => void;
    /** 统一提示入口：默认成功样式，失败显式传 true（见 app.tsx showToast） */
    showToast: (m: string, err?: boolean) => void;
    setDiffReturnModal: (m: Modal) => void;
  };
  /** 当前仓库与只读上下文 */
  ctx: {
    repo: RepoInfo | null;
    env: { svn: { installed: boolean; version: string }; git: { installed: boolean; version: string } } | null;
    info: RepoInfo | null;
    /** 文件浏览器当前停在哪个目录（相对仓库根）：终端打开时以此作为执行目录（fs 视图的 onDirChange 上报） */
    browseDir?: string;
  };
  /** 外观（字号 / 界面字体 / 代码字体） */
  appearance: {
    fontSize: number;
    setFontSize: (n: number) => void;
    uiFont: string;
    setUiFont: (v: string) => void;
    codeFont: string;
    setCodeFont: (v: string) => void;
  };
  /** 主题与「我的主题」 */
  theme: {
    /** 当前主题 key */
    current: string;
    myThemes: MyTheme[];
    setTheme: (k: string) => void;
    previewTheme: (t: Omit<MyTheme, 'key' | 'name'> | null) => void;
    saveMyTheme: (t: MyTheme) => void;
    deleteMyTheme: (k: string) => void;
  };
  /** 动作 */
  actions: {
    doCommit: (paths: string[], msg: string) => Promise<unknown>;
    doCommitSelected: (paths: string[], msg: string, stagedOnly?: string[]) => Promise<unknown>;
    runOp: (op: Op, paths: string[]) => void;
    refresh: () => void;
    loadHistory: () => void;
    gotoDiff: (path: string, a?: string, b?: string) => void;
    /** 发起推送（后台任务；认证失败重试也走它——每次重试是新任务） */
    pushNow: () => void;
  };
}

export function ModalHost(props: ModalHostProps) {
  const { state, set, ctx, appearance, theme, actions } = props;
  const { modal, pushAuth, themePop, invalidPaths, configUser } = state;
  const { repo, env, info, browseDir } = ctx;
  const { setModal, setPushAuth, setThemePop, setConfigUser, setInfo, setOnboard, setView, showToast, setDiffReturnModal } = set;
  const { doCommit, doCommitSelected, runOp, refresh, loadHistory, gotoDiff, pushNow } = actions;

  /** 会改动分支/远程地址的操作完成后调它：refresh() 的 tick 链只带文件列表与推送角标，
   *  顶栏的远程地址 / [分支名]（以及 ⋯ 菜单里按远程地址显隐的 GitHub 各项）读的是 info，
   *  不显式重拉就停留在旧值（用户实报：`git branch -m` 后顶栏挂着旧分支名；
   *  GitHub 新建仓库成功后顶栏不显示仓库地址） */
  const refreshInfo = () => {
    refresh();
    get.info().then((r) => setInfo(r)).catch(() => {});
  };

  /** 「新建仓库」弹窗选「GitHub 仓库」类型：本地建好并打开后，继续建远程仓库并设 origin（服务端自动 setRemote）。
   *  失败不回滚本地仓库——如实提示原因并指引去 ⋯ 菜单「GitHub 新建仓库」重试；新仓库必无提交，成功提示"提交后可推送"。 */
  const ghSetup = async (gh: GhSetupOpts) => {
    // 内联凭据先保存（不拿无效凭据去建仓库）
    if (gh.cred) {
      const sr = await post.gitAuthSave(gh.cred.user, gh.cred.token);
      if (!sr.ok) {
        showToast(t('repo.ghCreate.saveFailed', { msg: sr.message }), true);
        return;
      }
    }
    const gr = await post.ghCreateRepo(gh.name, gh.desc, gh.isPrivate);
    if (!gr.ok) {
      showToast(t('repo.create.ghRemoteFail', { msg: gr.message ?? '' }), true);
      return;
    }
    if (!gr.remoteSet) {
      showToast(t('repo.ghCreate.remoteFail', { msg: gr.remoteMsg || gr.cloneUrl || '' }), true);
      return;
    }
    showToast(t('repo.ghCreate.doneNoCommit', { name: gr.fullName ?? gh.name }));
    // origin 已指向新仓库：顶栏补上远程地址（本地 open 时拉的 info 还没有 origin）
    refreshInfo();
  };

  return (
    <>
      {modal?.type === 'commit' && (
        <CommitModal
          repoType={repo?.type ?? ''}
          paths={modal.paths}
          onClose={() => setModal(null)}
          onDone={async (msg, paths) => doCommit(paths, msg)}
        />
      )}
      {modal?.type === 'login' && (
        <LoginModal
          username={configUser}
          repoUrl={info?.url ?? ''}
          onClose={() => setModal(null)}
          onSaved={() => {
            setConfigUser('');
            get
              .config()
              .then((c) => setConfigUser(c.username))
              .catch(() => {});
            refresh();
          }}
          onToast={showToast}
        />
      )}
      {modal?.type === 'open' && (
        <OpenModal
          startDir={info?.home ?? info?.startDir ?? ''}
          invalidPaths={invalidPaths}
          onOpened={(r) => {
            setInfo(r);
            setOnboard(null);
            refresh();
            setModal(null);
            loadHistory();
          }}
          onToast={showToast}
          onClose={() => setModal(null)}
        />
      )}
      {modal?.type === 'font' && (
        <FontModal
          fontSize={appearance.fontSize}
          setFontSize={appearance.setFontSize}
          uiFont={appearance.uiFont}
          setUiFont={appearance.setUiFont}
          codeFont={appearance.codeFont}
          setCodeFont={appearance.setCodeFont}
          onClose={() => setModal(null)}
        />
      )}
      {modal?.type === 'terminal' && (
        <TerminalModal
          initialDir={browseDir}
          repoRoot={repo?.root ?? ''}
          repoType={repo?.type ?? ''}
          // 命令跑完就刷新（与 branches/tags 弹窗同一套）：终端能改的东西最宽 ——
          // 分支名 / 工作区 / 索引 / 标签都可能被一条命令改掉
          onChanged={refreshInfo}
          onClose={() => setModal(null)}
        />
      )}

      {/* 版本管理对话框：操作后刷新数据 + 重新拉取仓库信息（分支/版本变化） */}
      {modal?.type === 'branches' && repo?.type && (
        <BranchDialog
          repoType={repo.type}
          onClose={() => setModal(null)}
          onToast={(m, err) => {
            // 鼠标附近弹的全局提示：分支操作的结果原本只在弹窗底部一行小绿字，点完视线不往那儿去
            // 就完全看不到（用户实报"点了没反应"）——两处都保留
            showToast(m, Boolean(err));
          }}
          onChanged={refreshInfo}
        />
      )}
      {modal?.type === 'tags' && repo?.type && (
        <TagDialog
          repoType={repo.type}
          onClose={() => setModal(null)}
          onChanged={refreshInfo}
        />
      )}
      {modal?.type === 'stash' && <StashDialog onClose={() => setModal(null)} onChanged={() => refresh()} />}
      {modal?.type === 'clean' && (
        <CleanDialog
          onClose={() => setModal(null)}
          onDone={() => {
            refresh();
            setModal(null);
          }}
        />
      )}
      {modal?.type === 'env' && env && (
        <EnvInstallModal env={env} onClose={() => setModal(null)} onInstalled={() => location.reload()} />
      )}
      {/* SVN 仓库浏览（最近项目右键「浏览仓库」）：不检出直接看远程；wcRel 供"定位到该项目" */}
      {modal?.type === 'repo-browse' && (
        <RepoBrowseModal
          url={modal.url}
          wcRel={modal.wcRel}
          onClose={() => setModal(null)}
          // 右键检出的工作副本「打开项目」：先关本弹窗，再走最近项目同款打开逻辑
          onOpenProject={(dir) => {
            setModal(null);
            state.openHistoryItem({ path: dir });
          }}
        />
      )}
      {modal?.type === 'conflicts' && (
        <ConflictResolverModal
          onClose={() => setModal(null)}
          onResolved={() => {
            setModal(null);
            refresh();
          }}
        />
      )}
      {modal?.type === 'revert-confirm' && (
        <RevertModal
          repoType={repo?.type ?? 'git'}
          dirLabel={modal.dirLabel}
          items={modal.items}
          onClose={() => setModal(null)}
          onConfirm={(sel) => {
            setModal(null);
            void runOp('revert', sel);
          }}
        />
      )}
      {modal?.type === 'remote-conflicts' && <RemoteConflictModal riskFiles={modal.files} onClose={() => setModal(null)} />}
      {/* 主题气泡：点侧边栏「…」按钮在按钮下方展开（全部主题 / 自定义配色 / 我的主题） */}
      {themePop && (
        <ThemePopover
          x={themePop.x}
          y={themePop.y}
          theme={theme.current}
          onPick={theme.setTheme}
          onClose={() => setThemePop(null)}
          myThemes={theme.myThemes}
          onSave={theme.saveMyTheme}
          onDelete={theme.deleteMyTheme}
          onPreview={theme.previewTheme}
        />
      )}
      {/* onChanged：这里能改 origin 地址，保存成功后顶栏（远程地址 / ⋯ 菜单 GitHub 各项）要跟着换 */}
      {modal?.type === 'git-info' && (
        <GitInfoModal onClose={() => setModal(null)} onToast={showToast} onChanged={refreshInfo} />
      )}
      {modal?.type === 'gh-create-repo' && (
        <GitHubCreateModal
          root={repo?.root ?? null}
          onClose={() => setModal(null)}
          onCreated={(r) => {
            setModal(null);
            const name = r.fullName ?? '';
            // origin 没设上：如实提示（带原因；没有原因就带克隆地址，方便手动 remote add），不假装成功
            if (!r.remoteSet) {
              showToast(t('repo.ghCreate.remoteFail', { msg: r.remoteMsg || r.cloneUrl || '' }), true);
              return;
            }
            refreshInfo(); // origin 已变：刷新顶栏（远程地址、菜单显隐、推送角标）
            // 有提交 → 立即推送（pushNow 是后台任务；认证失败会自动弹认证引导）；没提交 → 提示提交后再推
            if (r.hasCommit) {
              showToast(t('repo.ghCreate.donePush', { name }));
              pushNow();
            } else {
              showToast(t('repo.ghCreate.doneNoCommit', { name }));
            }
          }}
        />
      )}
      {modal?.type === 'gh-delete-repo' && (
        <GitHubDeleteModal
          onClose={() => setModal(null)}
          onDeleted={(name) => {
            setModal(null);
            showToast(t('repo.ghDelete.done', { name }));
            refresh(); // 仓库已不存在：刷新顶栏/状态（origin 未动，如实显示）
          }}
        />
      )}
      {modal?.type === 'gh-fork' && (
        <GitHubForkModal
          onClose={() => setModal(null)}
          // Fork 成功且有提交：自动走现有推送任务（含认证引导/横幅；结果不阻塞弹窗）
          onForked={() => pushNow()}
          // Fork 成功且 origin 已改指 fork：顶栏远程地址跟着换
          onRemoteChanged={refreshInfo}
        />
      )}
      {modal?.type === 'gh-repo' && <GitHubRepoModal onClose={() => setModal(null)} />}
      {pushAuth && (
        <GitPushAuthModal
          type={pushAuth.type}
          error={translateVcsError(pushAuth.error ?? '')}
          onClose={() => setPushAuth(null)}
          onToast={showToast}
          onSaved={() => {
            setPushAuth(null);
            pushNow(); // 保存凭据后自动重试推送（已过确认窗，直接执行；后端用 GIT_ASKPASS 携带凭据；重试 = 新的后台任务）
          }}
        />
      )}
      {modal?.type === 'push-confirm' && (
        <PushConfirmModal
          onCancel={() => setModal(null)}
          onConfirm={() => {
            setModal(null);
            pushNow();
          }}
          onReset={() => refresh()}
          onDiff={(path, rev) => {
            // 双击变更文件 → 查看该提交中的差异（左=提交前，右=提交）；返回时恢复本弹窗
            setDiffReturnModal({ type: 'push-confirm' });
            setModal(null);
            gotoDiff(path, `${rev}^`, rev);
          }}
        />
      )}
      {modal?.type === 'create-repo' && (
        <CreateRepoDialog
          home={info?.home}
          onClose={() => setModal(null)}
          onCreated={(dir, gh) => {
            setModal(null);
            // 打开新创建的仓库
            void post
              .open(dir)
              .then(async () => {
                const r = await get.info();
                if (r.type) {
                  setInfo(r);
                  refresh();
                  loadHistory();
                  setView('browse'); // 新仓库直接进入文件浏览视图（创建时可能停在历史/差异视图）
                  setOnboard(onboardText(r));
                  // 已打开仓库: {root}
                  showToast(t('shell.repo.opened', { root: r.root ?? '' }));
                }
                // 「GitHub 仓库」类型：本地已打开，继续建远程仓库并设 origin
                if (gh) await ghSetup(gh);
              })
              // 创建完成，但打开失败: {msg}
              .catch((e: Error) => showToast(t('shell.repo.createOpenFailed', { msg: (e as Error).message }), true));
          }}
        />
      )}

      {modal?.type === 'get-repo' && (
        <GetRepoDialog
          home={info?.home}
          onClose={() => setModal(null)}
          onCreated={(dir) => {
            setModal(null);
            // 打开克隆/检出的仓库
            void post
              .open(dir)
              .then(async () => {
                const r = await get.info();
                if (r.type) {
                  setInfo(r);
                  refresh();
                  loadHistory();
                  setView('browse'); // 获取仓库后直接进入文件浏览视图
                  // 已打开仓库: {root}
                  showToast(t('shell.repo.opened', { root: r.root ?? '' }));
                }
              })
              // 获取完成，但打开失败: {msg}
              .catch((e: Error) => showToast(t('shell.repo.fetchOpenFailed', { msg: (e as Error).message }), true));
          }}
        />
      )}

      {modal?.type === 'commit-select' && (
        <CommitSelectModal
          repoType={repo?.type ?? ''}
          dirLabel={modal.dirLabel}
          items={modal.items}
          checked={modal.checked}
          stagedOnly={modal.stagedOnly}
          msg={modal.msg}
          onClose={() => setModal(null)}
          onDiff={(path, checked, stagedOnly, msg) => {
            // 双击文件 → 打开差异视图；返回时恢复本弹窗（含勾选、已部分暂存，**以及已写好的提交注释**）
            setDiffReturnModal({ type: 'commit-select', dir: modal.dir, dirLabel: modal.dirLabel, items: modal.items, checked, stagedOnly, msg });
            setModal(null);
            gotoDiff(path);
          }}
          onConfirm={(paths, msg, stagedOnly) =>
            setModal({
              type: 'confirm',
              title: (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                  <IconOk size={16} />
                  {/* 提交确认 */}
                  {t('shell.commit.confirmTitle')}
                </span>
              ),
              // 宽度自适应最长文件名（与提交弹窗同规则）
              width: pathAutoWidth(paths.reduce((m, p) => Math.max(m, p.length), 0), 520, 1200),
              message: (
                <>
                  <div className="small" style={{ marginBottom: 8 }}>
                    {/* 确认提交以下  /  个文件？ */}
                    {t('shell.commit.confirmMsgA')}<b>{paths.length}</b>{t('shell.commit.confirmMsgB', { n: paths.length })}
                    {stagedOnly.filter((p) => paths.includes(p)).length > 0 && (
                      <span style={{ color: 'var(--accent)' }}>
                        {' '}
                        {/* 其中 {n} 个只提交选中的部分改动 */}
                        {t('shell.commit.confirmStaged', { n: stagedOnly.filter((p) => paths.includes(p)).length })}
                      </span>
                    )}
                  </div>
                  {/* 文件列表：容器 + mono + 滚动 + 省略号，超长路径可读 */}
                  <div className="vcs-list" style={{ minHeight: 120 }}>
                    {paths.map((p) => (
                      <div key={p} className="vcs-row" style={{ cursor: 'default' }}>
                        <span className="mono small" style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={p}>
                          {p}
                        </span>
                      </div>
                    ))}
                  </div>
                  {msg && (
                    <div className="dim small mt8" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                      {/* 注释：{msg} */}
                      {t('shell.commit.note', { msg })}
                    </div>
                  )}
                </>
              ),
              // 确认提交
              confirmLabel: t('shell.commit.confirmBtn'),
              // 返回修改
              secondaryLabel: t('shell.commit.backBtn'),
              // 返回修改：回到「提交修改的文件」弹窗（保留原目录、列表、勾选与注释）
              secondaryAction: () => setModal({ type: 'commit-select', dir: modal.dir, dirLabel: modal.dirLabel, items: modal.items, checked: paths, stagedOnly, msg }),
              action: () => void doCommitSelected(paths, msg, stagedOnly),
            })
          }
        />
      )}
      {modal?.type === 'rename' && (
        <RenameModal
          repoType={repo?.type ?? 'git'}
          from={modal.from}
          fsMode={modal.fsMode}
          onCancel={() => setModal(null)}
          onConfirm={(to) => {
            const mode = modal.fsMode ? 'fs-move' : 'move';
            const from = modal.from;
            setModal(null);
            void runOp(mode, [from, to]);
          }}
        />
      )}
      {modal?.type === 'confirm' && (
        <ConfirmModal
          title={modal.title}
          message={modal.message}
          danger={modal.danger}
          confirmLabel={modal.confirmLabel}
          secondaryLabel={modal.secondaryLabel}
          confirmCmd={modal.confirmCmd}
          secondaryCmd={modal.secondaryCmd}
          width={modal.width}
          onConfirm={() => {
            const a = modal.action;
            setModal(null);
            a();
          }}
          onCancel={() => setModal(null)}
          onSecondary={
            modal.secondaryAction
              ? () => {
                  const a = modal.secondaryAction!;
                  setModal(null);
                  a();
                }
              : undefined
          }
        />
      )}
    </>
  );
}
