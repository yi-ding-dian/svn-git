/** 「获取仓库」后台任务的发起与认证引导。
 *
 *  **为什么单独一个文件**：GetRepoDialog 点确认后立刻关窗（用户定稿：获取天然是后台任务，
 *  不再用「弹窗里等 / − 最小化」两套语义），于是任务状态和认证重试都没地方挂了——
 *  抽到这里，给三个入口共用：⋯菜单的「获取仓库」、启动页的「获取仓库…」、「我的 GitHub 仓库」列表的克隆。
 *
 *  任务本身活在 shared/tasks 的 store 里：进度/取消归顶栏沙漏，完成自动打开项目，
 *  完成/失败进铃铛（App 统一通知），认证失败由本文件末尾的 GetRepoAuthModal 引导、保存后自动重试。 */
import React from 'react';
import { post, get } from '../shared/api.js';
import { startTask, pollTransferProgress, setTaskProgress } from '../shared/tasks.js';
import { joinPath } from '../shared/utils.js';
import { translateVcsError } from '../shared/vcs/errors.js';
import { GitPushAuthModal } from './git-auth.js';
import { SvnCredModal } from './svn-cred.js';
import type { GetRepoParams } from './repo-create.js';
import { t } from '../../shared/i18n/index.js';

/** 认证失败时交给调用方弹框的信息（retry = 用好凭据重跑这次获取） */
export interface GetAuthAsk {
  type: 'github' | 'server' | 'ssh' | 'svn';
  error: string;
  /** SVN：失败时实际使用的账号（空 = 匿名），弹框提示用 */
  user?: string;
  /** 重试；SVN 可带本次填的临时账号密码（仅本次用；勾选「保存为默认」的在获取成功后才写入） */
  retry: (cred?: { username: string; password: string }, save?: boolean) => void;
}

/** 预检失败时弹哪个 git 认证框：按 URL 判断（与后端 authTypeOf 同口径） */
function gitAuthTypeOf(url: string): 'github' | 'ssh' | 'server' {
  const u = url.trim();
  if (/^ssh:\/\//i.test(u) || /^[^@\s/]+@[^:\s/]+:/.test(u)) return 'ssh';
  return /github\.com/i.test(u) ? 'github' : 'server';
}

/** 发起获取（克隆/检出）后台任务。**立刻返回**——弹窗该在此时关掉，进度由顶栏沙漏接管。 */
export function startGetRepoTask(
  p: GetRepoParams,
  hooks: {
    /** 获取成功 → 打开落地的目录（各入口的打开方式不同：切仓库 / 打开项目） */
    onCreated: (dir: string) => void;
    /** 认证失败 → 由调用方弹认证框（状态在它那边） */
    onAuthNeeded: (a: GetAuthAsk) => void;
    onToast: (m: string, err?: boolean) => void;
  },
): void {
  const target = joinPath(p.dir, p.name);
  /** 进度轮询的停止函数（预检通过、真正开始获取时才挂上） */
  let stopPoll: (() => void) | null = null;
  /** 预检阶段的步骤：预检期间目标目录还不存在，传输进度扫不到任何东西，面板会只剩一个
   *  「总耗时」看着像卡死（用户实报）。这里用阶段文案补上"在验证账号与权限 · 12s"；
   *  预检通过后 clone/checkout 自己的文件/字节进度会接管（服务端 progressStart 覆盖） */
  const steps = [t('repo.get.stepVerify'), t('repo.get.stepFetch')];
  const stepStartedAt = [Date.now()];
  let taskId = 0;
  const setStep = (n: number) => {
    while (stepStartedAt.length <= n) stepStartedAt.push(Date.now());
    setTaskProgress(taskId, {
      phase: 'waiting',
      bytes: 0,
      speed: 0,
      total: 0,
      steps,
      currentStep: n,
      stepStartedAt: [...stepStartedAt],
    });
  };
  /** 任务结束时清掉阶段进度（成功/失败都撤），面板只留结果与耗时 */
  taskId = startTask({
    kind: 'get',
    // 任务标题：获取仓库 · {name}（标签检出时由调用方覆盖为「检出标签 · 标签名」）
    title: `${p.title ?? t('repo.get.title')} · ${p.name}`,
    // 进度通道 = 落地目录（任务详情弹窗据此展示实时进度）
    chan: target,
    // 失败后可在铃铛里重试：同一组参数再拉一次（后端失败/超时会先清掉半截目录）
    retry: () => startGetRepoTask(p, hooks),
    run: async (signal) => {
      try {
        // 获取前预检：只探测「地址可达 + 账号有读权限」（svn info / git ls-remote，不取数据），
        // 通过才真正克隆/检出。密码错/无权限时直接引导认证框，不再"先跑一半检出才报错"（用户实报）。
        // worktree 模式在当前仓库内建共享工作树，不访问远程，跳过。
        if (p.mode !== 'worktree') {
          const v = await post.verifyRemote(p.type, p.url, p.svnCred, signal);
          if (!v.ok) {
            const message = v.message ?? t('srv.verifyConnectFailed');
            // 只有认证/权限类才弹账号框；地址不可达/服务器错误弹了也没用，交给铃铛展示原因
            if (v.code === 'AUTH') {
              if (p.type === 'svn') {
                hooks.onAuthNeeded({
                  type: 'svn',
                  error: message,
                  user: p.svnCred?.username ?? '',
                  retry: (cred, save) => startGetRepoTask({ ...p, svnCred: cred, saveSvnCred: save }, hooks),
                });
              } else {
                hooks.onAuthNeeded({
                  type: gitAuthTypeOf(p.url),
                  error: message,
                  retry: () => startGetRepoTask(p, hooks),
                });
              }
            }
            return { ok: false, message, data: { kind: 'get', target, errorDetail: message } };
          }
          setStep(1); // 预检通过 → 进入获取（clone/checkout 的文件进度一上来就会取代它）
        }
        // 真正开始获取后才轮询传输进度：预检期间目录不存在，轮询拿不到数据只会把阶段文案清掉
        stopPoll = pollTransferProgress(taskId, target);
        const r = await post.repoCreate(p.type, p.dir, p.name, p.url, true, signal, p.ref, p.depth, {
          checkout: p.checkout,
          mode: p.mode,
          repoRoot: p.repoRoot,
          username: p.svnCred?.username,
          password: p.svnCred?.password,
        });
        // 认证失败：不在这里报错了事——弹认证框，保存后自动重试
        // （git = 存账号/Token；svn = 只本次用，勾选保存的在获取成功后才写入配置）
        if (!r.ok && r.authError && r.authType) {
          if (r.authType === 'svn') {
            hooks.onAuthNeeded({
              type: 'svn',
              error: r.message,
              user: r.user ?? '',
              retry: (cred, save) => startGetRepoTask({ ...p, svnCred: cred, saveSvnCred: save }, hooks),
            });
          } else {
            hooks.onAuthNeeded({ type: r.authType, error: r.message, retry: () => startGetRepoTask(p, hooks) });
          }
          // 原始输出随任务走（任务详情窗展示失败原因；认证框只关心 message）
          return { ok: false, message: r.message, data: { kind: 'get', target, errorDetail: r.errorDetail } };
        }
        // 完成即打开（弹窗早就关了，与它无关）：打开服务端返回的仓库路径（git/svn 均为目标目录），
        // 没返回时兜底拼路径
        if (r.ok) {
          // 勾选「保存为默认 SVN 账号」：**获取成功才写入**——账号密码错时不污染已保存的配置
          if (p.svnCred && p.saveSvnCred) {
            try {
              const cur = await get.config();
              await post.config({
                username: p.svnCred.username,
                password: p.svnCred.password,
                trustServerCert: cur.trustServerCert,
              });
            } catch {
              /* 保存失败不打扰（工作副本已经检出成功） */
            }
          }
          hooks.onCreated(r.repoDir ?? target);
        }
        // warnings：外部引用（svn:externals）同步失败等"主体成功但有问题"的明细（详情窗黄框）
        return { ok: r.ok, message: r.message, data: { kind: 'get', target, errorDetail: r.errorDetail, warnings: r.warnings } };
      } finally {
        stopPoll?.(); // 任务收尾就停轮询（真在跑时才挂上）
        setTaskProgress(taskId, null); // 进度/阶段都撤掉：结束的面板只留结果与耗时
      }
    },
  });
  // 阶段进度从"验证账号与权限"开始（发布任务同款：startTask 返回 id 后才能写）
  setStep(0);
  // 弹窗刚关，给一句"去哪儿找它"（顶栏沙漏 = 进度与取消入口）
  hooks.onToast(t('repo.get.started', { name: p.name }));
}

/** 认证失败引导框（`purpose='get'` 让文案说"获取"而不是"推送"）：
 *  调用方拿 useGetRepoTask 的 auth 渲染它即可，保存后自动重试。 */
export function GetRepoAuthModal(props: { auth: GetAuthAsk; onClose: () => void; onToast: (m: string, err?: boolean) => void }): React.ReactElement {
  // SVN：填账号密码（可勾选保存为默认）后重试——与 git 的 Token 弹框分开（字段与保存语义都不同）
  if (props.auth.type === 'svn') {
    return (
      <SvnCredModal
        username={props.auth.user}
        error={props.auth.error}
        onSubmit={(cred, save) => {
          const retry = props.auth.retry;
          props.onClose();
          retry(cred, save);
        }}
        onClose={props.onClose}
      />
    );
  }
  return (
    <GitPushAuthModal
      type={props.auth.type}
      error={translateVcsError(props.auth.error)}
      purpose="get"
      onClose={props.onClose}
      onToast={props.onToast}
      onSaved={() => {
        const retry = props.auth.retry;
        props.onClose();
        retry(); // 存好凭据直接重试（后端会带 GIT_ASKPASS）
      }}
    />
  );
}

/** 入口侧一行接好：拿到发起器 + 认证框状态（渲染见 GetRepoAuthModal） */
export function useGetRepoTask(opts: { onCreated: (dir: string) => void; onToast: (m: string, err?: boolean) => void }): {
  start: (p: GetRepoParams) => void;
  auth: GetAuthAsk | null;
  closeAuth: () => void;
} {
  const [auth, setAuth] = React.useState<GetAuthAsk | null>(null);
  const start = (p: GetRepoParams) => startGetRepoTask(p, { ...opts, onAuthNeeded: setAuth });
  return { start, auth, closeAuth: () => setAuth(null) };
}
