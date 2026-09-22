/** 全部模态出口：把 app.tsx JSX 里平铺的 21 个弹窗分支（原 928-1267 行，约 320 行）
 *  与「推送中 / 更新中」两个遮罩集中到这里，根组件只剩一行 <ModalHost />。
 *
 *  纯搬迁，交互逻辑一行未改。依赖按类别分组传入（而非平铺 30+ 个 props）：
 *  - state / set：弹窗状态与 setter（含进行中的 pushing/updating）
 *  - ctx：当前仓库与只读上下文
 *  - appearance / theme：外观与主题
 *  - actions：提交、推送、刷新、diff 跳转等动作
 */
import React from 'react';
import { get, post, type RepoInfo, type HistoryItem } from '../api.js';
import {
  CommitModal,
  LoginModal,
  ConfirmModal,
  CommitSelectModal,
  UpdateResultModal,
  EnvInstallModal,
  RevertModal,
  RenameModal,
  type Modal,
} from './modals.js';
import { BranchDialog, TagDialog, StashDialog, CreateRepoDialog, GetRepoDialog, CleanDialog, GitInfoModal, GitPushAuthModal } from './vcs-dialogs.js';
import { PushConfirmModal } from './push-confirm.js';
import { ConflictResolverModal } from './conflicts.js';
import { RemoteConflictModal } from './remote-conflicts.js';
import { ThemePopover, type MyTheme } from './theme-popover.js';
import { RecentMorePopover } from './recent-more.js';
import { FontModal } from './font-modal.js';
import { OpenModal } from '../views/open.js';
import { IconOk } from '../ui/icons.js';
import { pathAutoWidth, translateVcsError } from '../utils.js';
import { RECENT_LIMIT, type View } from '../sidebar.js';

/** 文件操作类型（App 的 runOp 参数；定义在此供双方引用，避免 app ↔ modal-host 循环依赖） */
export type Op = 'add' | 'commit' | 'update' | 'revert' | 'delete' | 'fs-delete' | 'push' | 'move' | 'fs-move';

/** 新建仓库成功后的引导条文案（说明产物与下一步） */
export function onboardText(r: RepoInfo): string {
  const root = r.root ?? '';
  if (r.type === 'svn') {
    return `✅ 已创建并打开 SVN 仓库：版本库 ${root.replace(/-wc$/, '')}（存储），工作副本 ${root}（已打开，日常操作都在这里）。下一步：在文件列表右键「添加到版本库」→「提交」。`;
  }
  return `✅ 已创建 Git 仓库并打开：${root}。下一步：添加文件到版本库 → 提交 → 推送。`;
}

export interface UpdateResult {
  dir: string;
  ok: boolean;
  message: string;
  files?: { path: string; status: string; code?: string }[];
  warnings?: string[];
}

export interface ModalHostProps {
  /** 弹窗状态（含进行中的遮罩） */
  state: {
    modal: Modal;
    pushAuth: { type: 'github' | 'server' | 'ssh'; error?: string } | null;
    updateResult: UpdateResult | null;
    themePop: { x: number; y: number } | null;
    /** 侧边栏最近项目「…」面板的锚点（null = 未打开） */
    recentMore: { x: number; y: number } | null;
    /** 最近项目全量：面板里显示主列表折叠掉的那批 */
    history: HistoryItem[];
    /** 点开过但打不开的项目：路径 → 错误消息（列表项上常驻 ×，悬浮时显示同一条） */
    invalidPaths: Record<string, string>;
    /** 打开某个最近项目（面板里点击时用） */
    openHistoryItem: (h: { path: string }) => void;
    pushing: boolean;
    updating: boolean;
    updateElapsed: number;
    configUser: string;
  };
  /** 对应 setter */
  set: {
    setModal: (m: Modal) => void;
    setPushAuth: (v: ModalHostProps['state']['pushAuth']) => void;
    setUpdateResult: (v: UpdateResult | null) => void;
    setThemePop: (v: { x: number; y: number } | null) => void;
    setRecentMore: (v: { x: number; y: number } | null) => void;
    setConfigUser: (v: string) => void;
    setInfo: (r: RepoInfo) => void;
    setOnboard: (v: string | null) => void;
    setView: (v: View) => void;
    setToast: (m: string) => void;
    setToastErr: (v: boolean) => void;
    setDiffReturnModal: (m: Modal) => void;
  };
  /** 当前仓库与只读上下文 */
  ctx: {
    repo: RepoInfo | null;
    env: { svn: { installed: boolean; version: string }; git: { installed: boolean; version: string } } | null;
    info: RepoInfo | null;
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
    pushNow: () => Promise<void>;
    cancelPush: () => void;
    cancelUpdate: () => void;
  };
}

export function ModalHost(props: ModalHostProps) {
  const { state, set, ctx, appearance, theme, actions } = props;
  const { modal, pushAuth, updateResult, themePop, recentMore, history, invalidPaths, openHistoryItem, pushing, updating, updateElapsed, configUser } = state;
  const { repo, env, info } = ctx;
  const { setModal, setPushAuth, setUpdateResult, setThemePop, setRecentMore, setConfigUser, setInfo, setOnboard, setView, setToast, setToastErr, setDiffReturnModal } = set;
  const { doCommit, doCommitSelected, runOp, refresh, loadHistory, gotoDiff, pushNow, cancelPush, cancelUpdate } = actions;

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
          onClose={() => setModal(null)}
          onSaved={() => {
            setConfigUser('');
            get
              .config()
              .then((c) => setConfigUser(c.username))
              .catch(() => {});
            refresh();
          }}
          onToast={setToast}
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
          onToast={setToast}
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
      {/* 推送中：转圈提示，可取消 */}
      {pushing && (
        <div className="modal-mask">
          <div className="modal" style={{ width: 380 }}>
            <div className="body" style={{ textAlign: 'center', padding: '26px 18px' }}>
              <div className="spinner" />
              <div style={{ marginTop: 14, fontWeight: 600 }}>正在推送…</div>
              {repo?.url && (
                <div className="mono small dim" style={{ marginTop: 6 }} title="推送目标仓库">
                  📤 {repo.url}
                </div>
              )}
              <div className="dim small" style={{ marginTop: 6 }}>视网络情况可能需要一些时间，可随时取消</div>
              <div className="small" style={{ marginTop: 8, color: 'var(--accent)' }}>已耗时 {updateElapsed}s</div>
              <button className="mini danger" style={{ marginTop: 18 }} onClick={cancelPush}>
                取消推送
              </button>
            </div>
          </div>
        </div>
      )}
      {/* 更新中：转圈提示，可取消 */}
      {updating && (
        <div className="modal-mask">
          <div className="modal" style={{ width: 380 }}>
            <div className="body" style={{ textAlign: 'center', padding: '26px 18px' }}>
              <div className="spinner" />
              <div style={{ marginTop: 14, fontWeight: 600 }}>正在更新…</div>
              <div className="dim small" style={{ marginTop: 6 }}>视仓库大小和网络情况可能需要一些时间，可随时取消</div>
              <div className="small" style={{ marginTop: 8, color: 'var(--accent)' }}>已耗时 {updateElapsed}s</div>
              <button className="mini danger" style={{ marginTop: 18 }} onClick={cancelUpdate}>
                取消更新
              </button>
            </div>
          </div>
        </div>
      )}
      {updateResult && (
        <UpdateResultModal
          dir={updateResult.dir}
          ok={updateResult.ok}
          message={updateResult.message}
          files={updateResult.files}
          warnings={updateResult.warnings}
          onClose={() => setUpdateResult(null)}
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
            setToast(m);
            setToastErr(Boolean(err));
          }}
          onChanged={() => {
            refresh();
            get
              .info()
              .then((r) => setInfo(r))
              .catch(() => {});
          }}
        />
      )}
      {modal?.type === 'tags' && repo?.type && (
        <TagDialog
          repoType={repo.type}
          onClose={() => setModal(null)}
          onChanged={() => {
            refresh();
            get
              .info()
              .then((r) => setInfo(r))
              .catch(() => {});
          }}
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
      {/* 侧边栏最近项目「…」：其余项目贴按钮右侧展开（仿主题气泡） */}
      {recentMore && (
        <RecentMorePopover
          x={recentMore.x}
          y={recentMore.y}
          items={history.slice(RECENT_LIMIT)}
          currentRoot={repo?.root}
          onOpen={(p) => {
            setRecentMore(null);
            openHistoryItem({ path: p });
          }}
          onClose={() => setRecentMore(null)}
        />
      )}
      {modal?.type === 'git-info' && <GitInfoModal onClose={() => setModal(null)} onToast={setToast} />}
      {pushAuth && (
        <GitPushAuthModal
          type={pushAuth.type}
          error={translateVcsError(pushAuth.error ?? '')}
          onClose={() => setPushAuth(null)}
          onToast={setToast}
          onSaved={() => {
            setPushAuth(null);
            void pushNow(); // 保存凭据后自动重试推送（已过确认窗，直接执行；后端用 GIT_ASKPASS 携带凭据）
          }}
        />
      )}
      {modal?.type === 'push-confirm' && (
        <PushConfirmModal
          onCancel={() => setModal(null)}
          onConfirm={() => {
            setModal(null);
            void pushNow();
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
          onCreated={(dir) => {
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
                  setToastErr(false);
                  setToast(`已打开仓库: ${r.root}`);
                }
              })
              .catch((e: Error) => setToast(`创建完成，但打开失败: ${(e as Error).message}`));
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
                  setToastErr(false);
                  setToast(`已打开仓库: ${r.root}`);
                }
              })
              .catch((e: Error) => setToast(`获取完成，但打开失败: ${(e as Error).message}`));
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
          onClose={() => setModal(null)}
          onDiff={(path, checked, stagedOnly) => {
            // 双击文件 → 打开差异视图；返回时恢复本弹窗（含勾选状态与已部分暂存列表）
            setDiffReturnModal({ type: 'commit-select', dir: modal.dir, dirLabel: modal.dirLabel, items: modal.items, checked, stagedOnly });
            setModal(null);
            gotoDiff(path);
          }}
          onConfirm={(paths, msg, stagedOnly) =>
            setModal({
              type: 'confirm',
              title: (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                  <IconOk size={16} />
                  提交确认
                </span>
              ),
              // 宽度自适应最长文件名（与提交弹窗同规则）
              width: pathAutoWidth(paths.reduce((m, p) => Math.max(m, p.length), 0), 520, 1200),
              message: (
                <>
                  <div className="small" style={{ marginBottom: 8 }}>
                    确认提交以下 <b>{paths.length}</b> 个文件？
                    {stagedOnly.filter((p) => paths.includes(p)).length > 0 && (
                      <span style={{ color: 'var(--accent)' }}>
                        {' '}
                        其中 {stagedOnly.filter((p) => paths.includes(p)).length} 个只提交选中的部分改动
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
                      注释：{msg}
                    </div>
                  )}
                </>
              ),
              confirmLabel: '确认提交',
              secondaryLabel: '返回修改',
              // 返回修改：回到「提交修改的文件」弹窗（保留原目录、列表与勾选）
              secondaryAction: () => setModal({ type: 'commit-select', dir: modal.dir, dirLabel: modal.dirLabel, items: modal.items, checked: paths, stagedOnly }),
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
