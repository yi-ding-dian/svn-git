/** 「获取仓库」后台任务的发起与认证引导。
 *
 *  **为什么单独一个文件**：GetRepoDialog 点确认后立刻关窗（用户定稿：获取天然是后台任务，
 *  不再用「弹窗里等 / − 最小化」两套语义），于是任务状态和认证重试都没地方挂了——
 *  抽到这里，给三个入口共用：⋯菜单的「获取仓库」、启动页的「获取仓库…」、「我的 GitHub 仓库」列表的克隆。
 *
 *  任务本身活在 shared/tasks 的 store 里：进度/取消归顶栏沙漏，完成自动打开项目，
 *  完成/失败进铃铛（App 统一通知），认证失败由本文件末尾的 GetRepoAuthModal 引导、保存后自动重试。 */
import React from 'react';
import { post } from '../shared/api.js';
import { startTask, pollTransferProgress } from '../shared/tasks.js';
import { translateVcsError, joinPath } from '../shared/utils.js';
import { GitPushAuthModal } from './git-auth.js';
import type { GetRepoParams } from './repo-create.js';
import { t } from '../../shared/i18n/index.js';

/** 认证失败时交给调用方弹框的信息（retry = 存好凭据后重跑这次获取） */
export interface GetAuthAsk {
  type: 'github' | 'server' | 'ssh';
  error: string;
  retry: () => void;
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
  /** 进度轮询的停止函数（startTask 返回 id 之后才挂得上，见下） */
  let stopPoll: (() => void) | null = null;
  const taskId = startTask({
    kind: 'get',
    // 任务标题：获取仓库 · {name}（标签检出时由调用方覆盖为「检出标签 · 标签名」）
    title: `${p.title ?? t('repo.get.title')} · ${p.name}`,
    // 进度通道 = 落地目录（任务详情弹窗据此展示实时进度）
    chan: target,
    run: async (signal) => {
      try {
        const r = await post.repoCreate(p.type, p.dir, p.name, p.url, true, signal, p.ref, p.depth);
        // 认证失败：不在这里报错了事——弹认证框（存的是 git 账号/Token），保存后自动重试
        if (!r.ok && r.authError && r.authType) {
          hooks.onAuthNeeded({ type: r.authType, error: r.message, retry: () => startGetRepoTask(p, hooks) });
          return { ok: false, message: r.message };
        }
        // 完成即打开（弹窗早就关了，与它无关）：打开服务端返回的仓库路径（git/svn 均为目标目录），
        // 没返回时兜底拼路径
        if (r.ok) hooks.onCreated(r.repoDir ?? target);
        return { ok: r.ok, message: r.message };
      } finally {
        stopPoll?.(); // 任务收尾就停轮询（真在跑时才挂上，见下）
      }
    },
  });
  // 进度轮询挂在 startTask **之后**：run 是被同步调起的，在里面拿不到自己的 id。
  // 通道 = 目标目录（同时可能有多个获取在跑，各论各的）
  stopPoll = pollTransferProgress(taskId, target);
  // 弹窗刚关，给一句"去哪儿找它"（顶栏沙漏 = 进度与取消入口）
  hooks.onToast(t('repo.get.started', { name: p.name }));
}

/** 认证失败引导框（`purpose='get'` 让文案说"获取"而不是"推送"）：
 *  调用方拿 useGetRepoTask 的 auth 渲染它即可，保存后自动重试。 */
export function GetRepoAuthModal(props: { auth: GetAuthAsk; onClose: () => void; onToast: (m: string, err?: boolean) => void }): React.ReactElement {
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
