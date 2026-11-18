/** 版本库操作 / 终端 / 应用级配置相关的 API。 */
import { api, json, type BranchDeleteCheck, type MainlinePlan, type StashItem, type VcsResult } from './core.js';
import type { Lang } from '../../../shared/i18n/index.js';
import type { AppUpdateStatus } from '../../../shared/app-update.js';
import type { TransferPhase, UpdateManifest } from '../../../transfer-progress.js';

export const getOps = {
  config: () => api<{ username: string; trustServerCert: boolean }>('/api/config'),
  /** 界面语言（主进程现值）：本地无偏好时用它对齐 */
  lang: () => api<{ lang: string }>('/api/lang'),
  envCheck: () => api<{ svn: { installed: boolean; version: string }; git: { installed: boolean; version: string } }>('/api/env-check'),
  /** 远程连通性检测（网络灯）：ok=网络通;reason=认证失败/连接错误说明 */
  netCheck: () => api<{ ok: boolean; reason: string }>('/api/net-check'),
  /** 系统可用字体 family 列表（字体设置：不存在的字体不给选） */
  fonts: () => api<{ families: string[] }>('/api/fonts'),
  /** 系统可用打开方式（按扩展名匹配 .desktop 程序）；chooseOpen(仅 win32) 为「选择其他应用…」哨兵命令 */
  appsFor: (ext: string) =>
    api<{
      apps: { name: string; exec: string; icon: string; isDefaultBrowser?: boolean }[];
      chooseOpen?: string | null;
    }>(`/api/apps-for?ext=${encodeURIComponent(ext)}`),
  /** 系统应用菜单集成状态（AppImage 运行方式；installed=已安装到应用菜单） */
  appMenu: () => api<{ appImage: boolean; installed: boolean }>('/api/app-menu'),
  /** 应用自身在线升级状态（纯 Node / 源码运行返回 supported=false） */
  appUpdateStatus: () => api<AppUpdateStatus>('/api/app-update/status'),
  /** 应用自身升级的 GitHub 下载加速设置 */
  appUpdateProxy: () => api<{ enabled: boolean; prefix: string }>('/api/app-update/proxy'),
  conflicts: () =>
    api<{
      conflicts: {
        path: string;
        ours: string;
        theirs: string;
        base: string;
        work: string;
        binary?: boolean;
        encoding?: string;
        /** 该侧没有这个文件（一侧删除/未添加的冲突）：采用这一侧 = 删除文件 */
        oursExists?: boolean;
        theirsExists?: boolean;
      }[];
    }>('/api/conflicts'),
  conflictDetail: (path: string) =>
    api<{ path: string; theirsDiff: string; myDiff: string }>(`/api/conflict-detail?path=${encodeURIComponent(path)}`),
  stash: () => api<{ items: StashItem[] }>('/api/stash'),
  stashFiles: (index: number) => api<{ files: { path: string; code: string }[] }>(`/api/stash?index=${index}`),
  gitClean: () => api<{ files: string[] }>('/api/git-clean'),
  remotes: () => api<{ remotes: { name: string; url: string }[] }>('/api/remotes'),
  gitInfo: () =>
    api<{ branch: string; remote: string; upstream: string; lastCommit: { hash: string; author: string; date: string; msg: string } | null }>(
      '/api/git-info',
    ),
  gitAuth: () => api<{ username: string; hasPassword: boolean }>('/api/git-auth'),
  /** SSH 私钥路径 + 是否同时用于终端 git（Git 信息弹窗回显用）：空串 = 用系统默认 ~/.ssh */
  gitSshKey: () => api<{ path: string; useForTerminal: boolean }>('/api/git-ssh-key'),
  /** GitHub 地址自动走 SSH 的开关状态（全局 git 配置 url.insteadOf） */
  gitGithubSsh: () => api<{ enabled: boolean }>('/api/git-github-ssh'),
  /** git 身份（user.name / user.email 的有效值 + 作用域）：提交失败弹「设置身份」窗与 Git 信息弹窗回显用 */
  gitIdentity: () => api<{ name: string; email: string; scope: 'repo' | 'global' | '' }>('/api/git-identity'),
  /** 已在暂存区里的文件（提交弹窗恢复「部分暂存」标记用） */
  stagedFiles: () => api<{ files: string[] }>('/api/staged-files'),
  /** SVN 身份（只读）：工具配置账号 + svn 官方凭据缓存账号（cache 按 url 的 host 匹配 realm）。 */
  svnIdentity: (url: string) =>
    api<{ ok: boolean; config: { username: string } | null; cache: { username: string; realms: string[] } | null }>(
      `/api/svn-identity?url=${encodeURIComponent(url)}`,
    ),
};

export const postOps = {
  /** 安装到系统应用菜单（POST）；卸载走 DELETE */
  appMenuInstall: () => api<{ ok: boolean; message: string }>('/api/app-menu', json({})),
  appMenuUninstall: () => api<{ ok: boolean; message: string }>('/api/app-menu', { method: 'DELETE' }),
  /** 用系统默认浏览器打开外链（仅 http/https） */
  openUrl: (url: string) => api<{ ok: boolean }>('/api/open-url', json({ url })),
  /** 检查应用自身新版本（Electron 打包版） */
  appUpdateCheck: () => api<AppUpdateStatus>('/api/app-update/check', json({})),
  /** 开始下载新版本（进度靠轮询 appUpdateStatus） */
  appUpdateDownload: () => api<AppUpdateStatus>('/api/app-update/download', json({})),
  /** 安装已下载的新版本并重启 */
  appUpdateInstall: () => api<{ ok: boolean; error?: string }>('/api/app-update/install', json({})),
  /** 保存应用升级的下载加速设置（prefix 空 = 默认 gh-proxy.com） */
  appUpdateProxySave: (enabled: boolean, prefix: string) =>
    api<{ ok: boolean; enabled: boolean; prefix: string }>('/api/app-update/proxy', json({ enabled, prefix })),
  commit: (paths: string[], message: string, stagedOnly: string[] = []) =>
    api<VcsResult>('/api/commit', json({ paths, message, stagedOnly })),
  update: (path?: string, signal?: AbortSignal) =>
    api<VcsResult & { path?: string; files?: { path: string; status: string; code?: string }[] }>('/api/update', json({ path }, signal)),
  push: (signal?: AbortSignal) => api<VcsResult>('/api/push', json({}, signal)),
  branch: (
    action: 'create' | 'switch' | 'delete' | 'merge' | 'merge-abort' | 'push' | 'remote-delete' | 'fetch' | 'update',
    name: string,
    force = false,
    signal?: AbortSignal,
    base?: string,
    pathRel?: string,
    ahead = 0,
    behind = 0,
  ) => api<VcsResult>('/api/branch', json({ action, name, force, base, path: pathRel, ahead, behind }, signal)),
  /** 删除分支前置检查：最后提交 + 未合并版本数（svn；git 返回 null）；带账号密码时顺带验证 */
  branchDeleteCheck: (name: string, password?: string, username?: string) =>
    api<BranchDeleteCheck | null>('/api/branch', json({ action: 'delete-check', name, password, username })),
  /** 创建分支：message 仅 svn（svn copy 立即提交，需要 log message；空则后端用模板） */
  branchCreate: (name: string, base?: string, message?: string, signal?: AbortSignal) =>
    api<VcsResult>('/api/branch', json({ action: 'create', name, base, message }, signal)),
  /** 删除分支：必须带确认用的分支名（服务端二次校验）；password/username 仅 svn（验证后即用即丢）；
   *  message 仅 svn（svn delete 立即提交，空则后端用模板） */
  branchDelete: (
    name: string,
    confirmName: string,
    password?: string,
    username?: string,
    message?: string,
    signal?: AbortSignal,
  ) => api<VcsResult>('/api/branch', json({ action: 'delete', name, confirmName, password, username, message }, signal)),
  /** 切换分支：chan 为进度通道（svn switch 上报已处理文件数；git 忽略） */
  branchSwitch: (name: string, chan?: string, signal?: AbortSignal) =>
    api<VcsResult>('/api/branch', json({ action: 'switch', name, chan }, signal)),
  /** SVN 项目迁移：当前工作副本独立成长期开发线（devline）或独立项目（project）。
   *  switchAfter=迁移完成后把当前工作副本切到新路径；
   *  trunkSubPath=project 模式下内容放到 trunk 的子目录（空=trunk 根）；extraDirs=trunk 下额外建的空目录。 */
  projectMigrate: (
    mode: 'devline' | 'project',
    name: string,
    switchAfter: boolean,
    signal?: AbortSignal,
    trunkSubPath?: string,
    extraDirs?: string[],
    /** 阶段进度通道（/api/transfer-progress 轮询） */
    chan?: string,
  ) =>
    api<VcsResult & { targetUrl?: string }>('/api/project-migrate', json({ mode, name, switchAfter, trunkSubPath, extraDirs, chan }, signal)),
  /** 合回主干（仅 svn）：precheck 目标工作副本状态 / 在目标 WC 上执行 svn merge（可选自动提交） */
  mergeMainlineCheck: (targetDir: string, pathRel?: string) =>
    api<MainlinePlan>('/api/merge-mainline', json({ action: 'check', targetDir, path: pathRel })),
  mergeMainline: (targetDir: string, autoCommit: boolean, pathRel?: string, signal?: AbortSignal) =>
    api<VcsResult & { targetDir?: string; conflicts?: string[]; committed?: boolean }>(
      '/api/merge-mainline',
      json({ action: 'run', targetDir, autoCommit, path: pathRel }, signal),
    ),
  /** 终端：执行 git / svn 命令（护栏见 routes/terminal.ts）。
   *  confirm=true 表示用户已在确认框里点过"仍要执行"（危险命令第二次调用）。 */
  terminalRun: (cmd: string, dir = '', confirm = false, signal?: AbortSignal) =>
    api<{
      ok: boolean;
      code: number;
      stdout: string;
      stderr: string;
      /** 被 Ctrl+C 中断 */
      aborted?: boolean;
      /** 超过 30 秒被终止 */
      timedOut?: boolean;
      /** 危险命令：后端**没有执行**，等前端确认后带 confirm 重发 */
      needConfirm?: boolean;
      reason?: string;
      error?: string;
    }>('/api/terminal/run', json({ cmd, confirm, dir }, signal)),
  tag: (action: 'create' | 'delete', name: string) => api<VcsResult>('/api/tag', json({ action, name })),
  stash: (action: 'push' | 'pop' | 'drop', message = '', index = 0, paths?: string[]) =>
    api<VcsResult>('/api/stash', json({ action, message, index, paths })),
  svnExtra: (action: 'cleanup' | 'resolve' | 'propset-ignore', path = '', accept = 'working', pattern = '', signal?: AbortSignal) =>
    api<VcsResult>('/api/svn-extra', json({ action, path, accept, pattern }, signal)),
  gitClean: (paths?: string[]) => api<VcsResult>('/api/git-clean', json({ paths })),
  /** 保存 SVN 凭据前验证（工作副本根 URL 上跑 svn log -l 1）：
   *  code=认证/权限/代理时前端阻止保存，NET（网络类）由用户确认后仍可保存 */
  svnVerify: (cred: { username: string; password: string; trustServerCert: boolean }) =>
    api<{ ok: boolean; skipped?: boolean; code?: 'AUTH' | 'AUTHZ' | 'PROXY' | 'NET'; message?: string }>(
      '/api/svn-verify',
      json(cred),
    ),
  /** 清除系统凭据缓存中匹配该 URL 的条目（退出登录/切换账号用；**前端必须二次确认**——影响其他 svn 客户端） */
  svnForgetCache: (url: string) => api<{ ok: boolean; cleared: string[] }>('/api/svn-forget-cache', json({ url })),
  config: (cfg: { username: string; password: string; trustServerCert: boolean }) => api<{ ok: boolean }>('/api/config', json(cfg)),
  /** 切换界面语言：主进程随即 setLang，server / vcs / main 的消息语言一并跟上 */
  lang: (lang: Lang) => api<{ ok: boolean }>('/api/lang', json({ lang })),
  gitConfig: (remoteUrl: string) => api<VcsResult>('/api/git-config', json({ remoteUrl })),
  /** 保存 git 身份（scope=global 写全局配置，repo 只写本仓库）——提交被拒后的「设置身份」窗用 */
  gitIdentitySave: (name: string, email: string, scope: 'repo' | 'global') =>
    api<VcsResult>('/api/git-identity', json({ name, email, scope })),
  gitAuthSave: (username: string, password: string) => api<VcsResult>('/api/git-auth', json({ username, password })),
  /** 保存 SSH 私钥路径（空串 = 恢复系统默认）；useForTerminal = 同时写入 ~/.ssh/config */
  gitSshKeySave: (path: string, useForTerminal: boolean) =>
    api<VcsResult>('/api/git-ssh-key', json({ path, useForTerminal })),
  /** 开启/关闭「GitHub 地址自动走 SSH」（写全局 git 配置 url.insteadOf） */
  gitGithubSshSave: (enabled: boolean) => api<VcsResult & { enabled?: boolean }>('/api/git-github-ssh', json({ enabled })),
  /** 安全清理（离职/交接前）：按选项删除本机凭据与私钥配置 */
  secureClean: (opts: {
    removeKey: boolean;
    removeSshConfig: boolean;
    removeInsteadOf: boolean;
    clearGithubToken: boolean;
    clearSvnPassword: boolean;
    clearHistory: boolean;
  }) =>
    api<{
      ok: boolean;
      removed: string[];
      failed: { item: string; error: string }[];
      publicKey: string;
    }>('/api/secure-clean', json(opts)),
  gitAmend: (message: string) => api<VcsResult>('/api/git-amend', json({ message })),
  /** 把选中的块应用到暂存区（hunk 级部分提交） */
  stageHunks: (path: string, hunks: number[], expectBlob?: string) => api<VcsResult>('/api/stage-hunks', json({ path, hunks, expectBlob })),
  gitReword: (hash: string, message: string) => api<VcsResult>('/api/git-reword', json({ hash, message })),
  gitReset: () => api<VcsResult>('/api/git-reset', json({})),
  shutdown: () => api<{ ok: boolean }>('/api/shutdown', json({})),
};
