/** 「项目代码统计」扫描状态：流式 NDJSON 的读取、进度、取消。
 *
 *  与「行数过滤」（filesystem/line-filter.tsx 的 useLineScan）同一套写法：
 *  请求序号（seq）+ AbortController——取消或重新统计后，迟到的进度/结果一律丢弃；
 *  点「开始统计」才真正扫描（勾选目录不算扫描动作，避免用户挑目录时反复读盘）。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { get, type CodeStatsNode, type CodeStatsTick } from '../shared/api.js';

export type CodeStatsStatus = 'idle' | 'scanning' | 'done' | 'error';

/** 一次统计的完整结果（done 帧） */
export interface CodeStatsResult {
  tree: CodeStatsNode[];
  /** 总行数 / 命中文件数 */
  lines: number;
  files: number;
  /** 服务端实际统计的目录（祖先已选时子目录已收敛；'' = 仓库根） */
  dirs: string[];
  scanned: number;
  total: number;
  skippedEmpty: number;
  skippedBinary: number;
  skippedLarge: number;
  skippedError: number;
  capped: boolean;
  truncated?: 'time';
  elapsedMs: number;
}

export interface CodeStatsState {
  status: CodeStatsStatus;
  result: CodeStatsResult | null;
  /** 扫描中的进度（已处理 / 候选总数） */
  progress: { scanned: number; total: number } | null;
  /** 本次扫描的范围（整个项目 / 具体目录 + 文件范围）：用于结果头部，切换勾选不会改它 */
  scope: { dirs: string[]; whole: boolean; codeOnly: boolean } | null;
  error: string;
  /** 开始统计：whole=true 统计整个项目（含根目录文件）；否则统计 dirs 里的仓库相对路径 */
  scan: (dirs: string[], whole: boolean, codeOnly: boolean) => void;
  cancel: () => void;
  reset: () => void;
}

export function useCodeStats(): CodeStatsState {
  const [status, setStatus] = useState<CodeStatsStatus>('idle');
  const [result, setResult] = useState<CodeStatsResult | null>(null);
  const [progress, setProgress] = useState<{ scanned: number; total: number } | null>(null);
  const [scope, setScope] = useState<{ dirs: string[]; whole: boolean; codeOnly: boolean } | null>(null);
  const [error, setError] = useState('');
  const abortRef = useRef<AbortController | null>(null);
  /** 请求序号：取消/重扫后，迟到的进度与结果一律丢弃 */
  const seqRef = useRef(0);

  const scan = useCallback((dirs: string[], whole: boolean, codeOnly: boolean) => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    const seq = ++seqRef.current;
    setStatus('scanning');
    setError('');
    setProgress(null);
    setScope({ dirs: [...dirs], whole, codeOnly });
    void get
      .codeStats(
        dirs,
        whole,
        codeOnly,
        (tick: CodeStatsTick) => {
          if (seq !== seqRef.current) return;
          if (tick.error) {
            setError(tick.error);
            setStatus('error');
            setProgress(null);
            return;
          }
          if (tick.done) {
            setResult({
              tree: tick.tree ?? [],
              lines: tick.lines ?? 0,
              files: tick.files ?? 0,
              dirs: tick.dirs ?? [],
              scanned: tick.scanned ?? 0,
              total: tick.total ?? 0,
              skippedEmpty: tick.skippedEmpty ?? 0,
              skippedBinary: tick.skippedBinary ?? 0,
              skippedLarge: tick.skippedLarge ?? 0,
              skippedError: tick.skippedError ?? 0,
              capped: !!tick.capped,
              truncated: tick.truncated,
              elapsedMs: tick.elapsedMs ?? 0,
            });
            setStatus('done');
            setProgress(null);
            return;
          }
          setProgress({ scanned: tick.scanned ?? 0, total: tick.total ?? 0 });
        },
        ac.signal
      )
      .catch((e: Error) => {
        if (seq !== seqRef.current) return;
        if (e.name === 'AbortError') return; // 用户取消：状态由 cancel() 落
        setError(e.message);
        setStatus('error');
        setProgress(null);
      })
      .finally(() => {
        if (seq === seqRef.current) abortRef.current = null;
      });
  }, []);

  const cancel = useCallback(() => {
    seqRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    setProgress(null);
    setStatus('idle');
  }, []);

  const reset = useCallback(() => {
    seqRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    setStatus('idle');
    setResult(null);
    setProgress(null);
    setScope(null);
    setError('');
  }, []);

  // 卸载（关闭弹窗/切项目）：杀掉在途扫描与服务端读取
  useEffect(() => () => abortRef.current?.abort(), []);

  return { status, result, progress, scope, error, scan, cancel, reset };
}
