/** 仓库状态角标 + 远程更新监控：从 App 抽出（原 app.tsx:91-139 + 187-222）。
 *
 *  - 角标计数：未推送提交数（推送按钮）/ stash 条数（Stash 按钮）/ 冲突数 / 是否可 stash
 *  - 远程监控：每 2 分钟 preflight 一次，重点提示"你正在改的文件是否被他人先提交"（冲突风险预警）
 *
 *  注意：App 的 `refresh()`（tick+1 并刷新计数）**不在这里**——tick 是全局刷新信号（还驱动文件视图重拉），
 *  不属于仓库状态域；本 hook 只暴露 refreshUnpushed / refreshStash 供它组合。
 */
import { useCallback, useEffect, useState } from 'react';
import { get, type LogEntry } from '../api.js';

export interface RemoteHint {
  behind: number;
  locked: number;
  risk: number;
  files?: string[];
  remoteLogs?: LogEntry[];
}

export function useRepoStatus(opts: { repoType?: string | null; repoRoot?: string | null; tick: number }) {
  const { repoType, repoRoot, tick } = opts;
  /** 未推送提交数（推送按钮角标；git 有效，svn 保持 null 不显示） */
  const [unpushedCount, setUnpushedCount] = useState<number | null>(null);
  /** stash 条数（Stash 按钮角标；svn 无 items → null 不显示） */
  const [stashCount, setStashCount] = useState<number | null>(null);
  /** 冲突计数：有 C 状态文件时显示"解决冲突"入口 */
  const [conflictCount, setConflictCount] = useState(0);
  /** 工作区是否有可 stash 的改动（未跟踪也算，与 stash -u 语义一致） */
  const [canStash, setCanStash] = useState<boolean | null>(null);
  const [remoteHint, setRemoteHint] = useState<RemoteHint | null>(null);
  /** 有行冲突的文件 + 冲突行号（BASE 坐标）：弹窗据此高亮"撞在哪几行"——
   *  只传 path 的话，用户还得自己肉眼比对两侧 diff 找冲突处（用户实报过） */
  const [riskFiles, setRiskFiles] = useState<{ path: string; lines: number[] }[]>([]);
  /** 新建仓库成功后的引导条（一次性，可关闭；session 级） */
  const [onboard, setOnboard] = useState<string | null>(null);

  const refreshUnpushed = useCallback(() => {
    get
      .gitUnpushedCount()
      .then((r) => setUnpushedCount(r.count))
      .catch(() => setUnpushedCount(null));
  }, []);
  const refreshStash = useCallback(() => {
    get
      .stash()
      .then((r) => setStashCount(r.items?.length ?? null))
      .catch(() => setStashCount(null));
  }, []);

  // 仓库变化（打开/切换）时自动刷新角标
  useEffect(() => {
    void refreshUnpushed();
  }, [repoType]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    void refreshStash();
  }, [repoType]); // eslint-disable-line react-hooks/exhaustive-deps

  // 冲突数 / 是否可 stash：随 tick（全局刷新信号）重算
  useEffect(() => {
    if (!repoType) {
      setConflictCount(0);
      setCanStash(null);
      return;
    }
    get
      .status()
      .then((r) => {
        setConflictCount(r.items.filter((i) => i.code === 'C').length);
        setCanStash(r.items.some((i) => i.code && i.code !== 'I' && i.code !== 'X' && i.code !== 'C'));
      })
      .catch(() => {});
  }, [repoType, tick]);

  /** 检查远程状态并刷新提示条；更新完成后立即调用，避免提示条残留旧状态 */
  const checkRemote = useCallback(() => {
    get
      .preflight()
      .then((r) => {
        const risk = r.conflictRisk?.length ?? 0;
        if (r.behind > 0 || (r.lockedByOthers?.length ?? 0) > 0 || risk > 0) {
          setRemoteHint({ behind: r.behind, locked: r.lockedByOthers?.length ?? 0, risk, files: r.updatedFiles ?? [], remoteLogs: r.remoteLogs ?? [] });
          setRiskFiles(r.conflictRisk ?? []); // 带 lines（冲突行号）一起给弹窗，别再 map 成纯路径
        } else {
          setRemoteHint(null);
          setRiskFiles([]);
        }
      })
      .catch(() => {});
  }, []);

  // 切换仓库：立即清掉上一个仓库的远程提示（remoteHint 是上一个仓库的检查结果）。
  // 必须显式清：下面的监控 effect 虽然依赖 repoRoot，但首次检查有 6s 延迟，这期间提示会
  // 挂着上一个仓库的内容；若新仓库那次检查失败（无远程/网络不通）catch 静默，旧提示更会
  // 永久残留——用户会以为新仓库有远程新提交。
  useEffect(() => {
    setRemoteHint(null);
    setRiskFiles([]);
  }, [repoRoot]);

  useEffect(() => {
    // 首次延迟 6s 再检查远程：网络不通时 fetch 慢，立即并发会占住浏览器连接槽、阻塞目录加载
    const first = setTimeout(checkRemote, 6_000);
    const t = setInterval(checkRemote, 120_000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [repoRoot, checkRemote]);

  /** 远程新提交涉及的文件总数（remoteLogs 去重；无 logs 时用 updatedFiles 数） */
  const remoteFileCount = remoteHint?.remoteLogs?.length
    ? new Set(remoteHint.remoteLogs.flatMap((l) => l.changed.map((c) => c.path))).size
    : (remoteHint?.files?.length ?? 0);

  return {
    unpushedCount,
    stashCount,
    conflictCount,
    canStash,
    remoteHint,
    riskFiles,
    onboard,
    setOnboard,
    checkRemote,
    remoteFileCount,
    refreshUnpushed,
    refreshStash,
  };
}
