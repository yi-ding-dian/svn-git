/** SVN「检出到本地」的**后台任务**与认证引导。
 *
 *  与 get-repo-task.tsx 同一套骨架（点确认 → 弹窗立刻关 → 任务在后台跑 → 完成自动打开项目、
 *  失败进铃铛、认证失败弹框重试），差别只有两处：
 *   - 接口是 /api/repo-checkout（URL 直连检出，可带选择性检出的子目录）；
 *   - 认证框收的是 **SVN 账号密码**，且**只本次用、后端不落盘**（与推送那套 token 落盘不同）。
 *
 *  任务活在 shared/tasks 的 store 里：进度/取消归顶栏沙漏。入口：repo-browse 树里右键「检出到本地…」。 */
import React from 'react';
import { post } from '../shared/api.js';
import { startTask, pollTransferProgress } from '../shared/tasks.js';
import { joinPath, isImeComposing } from '../shared/utils.js';
import { ModalShell } from '../shell/modal-shell.js';
import { FormRow } from '../ui/ui.js';
import { t } from '../../shared/i18n/index.js';

export interface CheckoutParams {
  /** 要检出的远程目录 URL（树行 = 行 URL；空白右键 = 仓库根） */
  url: string;
  /** 所在目录（父目录） */
  dir: string;
  /** 本地名称（工作副本目录名） */
  name: string;
  /** 本次临时凭据（认证失败重试时带；不保存） */
  cred?: { username: string; password: string };
  /** 选择性检出：勾选的**相对路径**（可多级，如 branches/AnHui；空 = 完整检出） */
  dirs: string[];
}

/** 认证失败时交给调用方弹框的信息 */
export interface CheckoutAuthAsk {
  url: string;
  /** 失败时实际用的账号（空 = 匿名） */
  user: string;
  /** 带新凭据重试 */
  retry: (cred: { username: string; password: string }) => void;
}

/** 发起检出后台任务。**立刻返回**——弹窗该在此时关掉，进度由顶栏沙漏接管。 */
export function startCheckoutTask(
  p: CheckoutParams,
  hooks: {
    /** 检出成功 → 打开刚落地的工作副本 */
    onCreated: (dir: string) => void;
    /** 认证失败 → 由调用方弹认证框（状态在它那边） */
    onAuthNeeded: (a: CheckoutAuthAsk) => void;
    onToast: (m: string, err?: boolean) => void;
  },
): void {
  const target = joinPath(p.dir, p.name);
  /** 进度轮询的停止函数（startTask 返回 id 之后才挂得上，同 get-repo-task 的模式） */
  let stopPoll: (() => void) | null = null;
  const taskId = startTask({
    // 任务类型：取消检出要二次确认（半截目录会被清理）——靠它判别
    kind: 'checkout',
    // 任务标题：检出到本地 · {name}（与「我的 GitHub 仓库」克隆的"获取仓库 · name"同构）
    title: `${t('repo.co.title')} · ${p.name}`,
    // 进度通道 = 落地目录（后端检出期间周期扫盘上报"已检出 N 个文件 · X MB"）
    chan: target,
    run: async (signal) => {
      try {
        const r = await post.repoCheckout(p.url, p.dir, p.name, p.cred, signal, p.dirs);
        // 认证失败：交给调用方弹凭据框（只本次用），填完重试
        if (!r.ok && r.authError) {
          hooks.onAuthNeeded({ url: p.url, user: r.user ?? '', retry: (cred) => startCheckoutTask({ ...p, cred }, hooks) });
        }
        // 完成即打开（弹窗早就关了，与它无关）：打开服务端返回的工作副本路径，没返回时兜底拼路径
        if (r.ok) hooks.onCreated(r.repoDir ?? target);
        // 检出结果详情随任务带回（kind='checkout'）：任务详情窗据此列文件清单/警告（仿「更新结果」窗）
        return {
          ok: r.ok,
          message: r.message,
          data: { kind: 'checkout', dir: r.repoDir ?? target, files: r.files, fileTotal: r.fileTotal, warnings: r.warnings },
        };
      } finally {
        stopPoll?.(); // 任务收尾就停轮询（真在跑时才挂上，见下）
      }
    },
  });
  // 进度轮询挂在 startTask **之后**：run 是被同步调起的，在里面拿不到自己的 id
  stopPoll = pollTransferProgress(taskId, target);
  // 弹窗刚关，给一句"去哪儿找它"（顶栏沙漏 = 进度与取消入口）
  hooks.onToast(t('repo.get.started', { name: p.name }));
}

/** 取消检出的二次确认（任务面板与任务详情窗共用）：
 *  取消会**清理已下载的半截目录**（后端断开即清），误点代价高——确认后才真正取消。
 *  注意调用方的层级：任务面板（z-index 300）会压住 modal（100），从面板打开时须先关面板。 */
export function CancelCheckoutConfirm(props: { onKeep: () => void; onCancel: () => void }): React.ReactElement {
  return (
    <ModalShell
      icon="⚠️"
      // 取消检出？
      title={t('repo.co.cancelTitle')}
      onClose={props.onKeep}
      width={400}
      closeIcon
      foot={
        <>
          {/* 继续检出（关掉确认，任务照跑） */}
          <button onClick={props.onKeep}>{t('repo.co.cancelKeep')}</button>
          <button className="primary" onClick={props.onCancel}>
            {/* 确认取消 */}
            {t('repo.co.cancelConfirm')}
          </button>
        </>
      }
    >
      {/* 已下载的内容会被清理（未完成的目录会被删除），之后需要重新检出。确认取消？ */}
      <div className="small" style={{ lineHeight: 1.7 }}>{t('repo.co.cancelMsg')}</div>
    </ModalShell>
  );
}

/** 认证失败引导框：当前账号没有权限 → 输入有权限的账号密码（仅本次，不保存）→ 重试 */
export function CheckoutAuthModal(props: { auth: CheckoutAuthAsk; onClose: () => void; onToast: (m: string, err?: boolean) => void }): React.ReactElement {
  const [user, setUser] = React.useState('');
  const [pass, setPass] = React.useState('');

  const retry = () => {
    if (!user.trim() || !pass) {
      // 请填写用户名和密码
      props.onToast(t('repo.co.needCred'), true);
      return;
    }
    const cred = { username: user.trim(), password: pass };
    const go = props.auth.retry;
    props.onClose(); // 关掉再重试：新任务在后台跑，再失败会带着新账号重新弹回来
    go(cred);
  };

  return (
    <ModalShell icon="📡" title={t('repo.co.title')} width={480} onClose={props.onClose} closeIcon hideFoot>
      <div className="small" style={{ color: 'var(--warn)' }}>
        ⚠ {t('repo.co.noPerm', { user: props.auth.user || t('repo.co.anonymous') })}
      </div>
      <div style={{ marginTop: 10 }}>
        {/* 用户名 */}
        <FormRow label={t('repo.co.credUser')}>
          <input type="text" autoFocus value={user} onChange={(e) => setUser(e.target.value)} />
        </FormRow>
        {/* 密码 */}
        <FormRow label={t('repo.co.credPass')}>
          <input
            type="password"
            value={pass}
            onChange={(e) => setPass(e.target.value)}
            onKeyDown={(e) => {
              if (isImeComposing(e)) return;
              if (e.key === 'Enter') retry();
            }}
          />
        </FormRow>
        <div className="dim small">
          {/* 仅用于本次检出，不会保存 */}
          {t('repo.co.credHint')}
        </div>
        <div className="row" style={{ gap: 8, marginTop: 10, justifyContent: 'flex-end' }}>
          {/* 取消 */}
          <button onClick={props.onClose}>{t('common.cancel')}</button>
          {/* 用新账号重试 */}
          <button className="primary" onClick={retry}>{t('repo.co.retryWithCred')}</button>
        </div>
      </div>
    </ModalShell>
  );
}

/** 入口侧一行接好：拿到发起器 + 认证框状态（渲染见 CheckoutAuthModal） */
export function useCheckoutTask(opts: { onCreated: (dir: string) => void; onToast: (m: string, err?: boolean) => void }): {
  start: (p: CheckoutParams) => void;
  auth: CheckoutAuthAsk | null;
  closeAuth: () => void;
} {
  const [auth, setAuth] = React.useState<CheckoutAuthAsk | null>(null);
  const start = (p: CheckoutParams) => startCheckoutTask(p, { ...opts, onAuthNeeded: setAuth });
  return { start, auth, closeAuth: () => setAuth(null) };
}
