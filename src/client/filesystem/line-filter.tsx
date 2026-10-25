/** 行数过滤（搜索框第三模式）：扫描状态 hook + 树扁平化 + 结果头部。
 *
 *  与「仅修改/仅新文件/仅删除」的区别：那是 status 缓存里的状态过滤（秒出），
 *  这里必须把候选文件逐个读完才能知道行数——首次扫描走流式进度，之后靠服务端
 *  「路径 + 大小 + mtime」缓存，改阈值基本秒出。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { t } from '../../shared/i18n/index.js';
import type { LineCondition } from '../../shared/types.js';
import { get, type FilterTreeNode } from '../shared/api.js';
import { lineConditionText, sameLineCondition, type VisibleRow } from './utils.js';

export type LineScanStatus = 'idle' | 'scanning' | 'done' | 'error';

export interface LineScanStats {
  matched: number;
  shown: number;
  scanned: number;
  total: number;
  skippedEmpty: number;
  skippedBinary: number;
  skippedLarge: number;
  skippedError: number;
  capped: boolean;
  truncated?: 'time' | 'limit';
  elapsedMs: number;
}

export interface LineScanState {
  status: LineScanStatus;
  /** 本次行数模式是否已经开始过扫描（决定主区是否显示行数结果 / 头部） */
  started: boolean;
  /** 上一次成功扫描的树；新扫描进行中时旧结果保留，避免整块闪空 */
  tree: FilterTreeNode[] | null;
  /** 上一次成功扫描的条件（头部「当前显示」） */
  condition: LineCondition | null;
  /** 正在扫描的条件 */
  target: LineCondition | null;
  stats: LineScanStats | null;
  progress: { scanned: number; total: number } | null;
  error: string;
  scan: (condition: LineCondition) => void;
  cancel: () => void;
  reset: () => void;
}

/** 行数扫描：点「确定」才调用 scan；不自动扫（输入中间态会白白读一遍全目录） */
export function useLineScan(dir: string): LineScanState {
  const [status, setStatus] = useState<LineScanStatus>('idle');
  const [started, setStarted] = useState(false);
  const [tree, setTree] = useState<FilterTreeNode[] | null>(null);
  const [condition, setCondition] = useState<LineCondition | null>(null);
  const [target, setTarget] = useState<LineCondition | null>(null);
  const [stats, setStats] = useState<LineScanStats | null>(null);
  const [progress, setProgress] = useState<{ scanned: number; total: number } | null>(null);
  const [error, setError] = useState('');
  const abortRef = useRef<AbortController | null>(null);
  /** 请求序号：取消/新扫描后，迟到的进度与结果一律丢弃 */
  const seqRef = useRef(0);
  /** 取消时判断「有没有旧结果可回退」——事件闭包拿不到最新 state，走 ref */
  const treeRef = useRef<FilterTreeNode[] | null>(null);
  treeRef.current = tree;

  const scan = useCallback(
    (next: LineCondition) => {
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      const seq = ++seqRef.current;
      setStarted(true);
      setStatus('scanning');
      setTarget(next);
      setError('');
      setProgress(null);
      void get
        .lineScan(
          dir,
          next,
          (tick) => {
            if (seq !== seqRef.current) return;
            if (tick.error) {
              setError(tick.error);
              setStatus('error');
              setProgress(null);
              return;
            }
            if (tick.done) {
              setTree(tick.tree ?? []);
              setCondition(next);
              setStats({
                matched: tick.matched ?? 0,
                shown: tick.shown ?? 0,
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
    },
    [dir]
  );

  const cancel = useCallback(() => {
    seqRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    setProgress(null);
    // 有旧结果就保留（头部继续显示上一次的条件）；没有就回到 idle，显示「已取消」
    setStatus(treeRef.current ? 'done' : 'idle');
  }, []);

  const reset = useCallback(() => {
    seqRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    setStatus('idle');
    setStarted(false);
    setTree(null);
    setCondition(null);
    setTarget(null);
    setStats(null);
    setProgress(null);
    setError('');
  }, []);

  // 切目录：行数条件的范围是「当前目录（含子目录）」，旧结果不能留着
  useEffect(() => {
    reset();
  }, [dir, reset]);
  // 卸载（切项目/离开视图）：杀掉在途扫描与服务端读取
  useEffect(() => () => abortRef.current?.abort(), []);

  return { status, started, tree, condition, target, stats, progress, error, scan, cancel, reset };
}

/** 行数树扁平化：目录可折叠；目录行带命中文件数，文件行带行数 */
export function useLineRows(tree: FilterTreeNode[] | null, showHidden: boolean) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggleCollapsed = useCallback((rel: string) => {
    setCollapsed((s) => {
      const next = new Set(s);
      if (next.has(rel)) next.delete(rel);
      else next.add(rel);
      return next;
    });
  }, []);

  const rows = useMemo<VisibleRow[]>(() => {
    const out: VisibleRow[] = [];
    const countFiles = (node: FilterTreeNode): number => {
      let n = 0;
      const walk = (x: FilterTreeNode) => {
        if (x.isDir) x.children.forEach(walk);
        else n++;
      };
      walk(node);
      return n;
    };
    const walk = (nodes: FilterTreeNode[], depth: number) => {
      for (const node of nodes) {
        // 与服务端口径一致（服务端已跳过隐藏项）；这里兜底，防止外部构造的树漏过滤
        if (!showHidden && node.name.startsWith('.')) continue;
        const open = node.isDir && !collapsed.has(node.path);
        out.push({
          rel: node.path,
          name: node.name,
          code: node.code,
          isDir: node.isDir,
          size: node.size ?? 0,
          mtime: node.mtime ?? '',
          lines: node.lines,
          count: node.isDir ? countFiles(node) : undefined,
          codes: node.isDir && node.code ? [node.code] : undefined,
          depth,
          open,
          locked: false,
          miss: false,
        });
        if (node.isDir && open) walk(node.children, depth + 1);
      }
    };
    walk(tree ?? [], 0);
    return out;
  }, [tree, collapsed, showHidden]);

  return { rows, collapsed, toggleCollapsed };
}

/** 行数模式结果头部：进度 / 统计 / 截断提示 / 退出 */
export function LineScanHeader(props: {
  lineScan: LineScanState;
  /** 输入框里当前的条件（与已扫描条件不同时提示重新扫描） */
  inputCondition: LineCondition | null;
  onExit: () => void;
}) {
  const { lineScan } = props;
  const { status, condition, target, stats, progress, error } = lineScan;
  const shownCondition = status === 'scanning' ? target : condition;
  const elapsed = stats ? `${(stats.elapsedMs / 1000).toFixed(1)}s` : '';
  const skipped = stats
    ? stats.skippedEmpty + stats.skippedBinary + stats.skippedLarge + stats.skippedError
    : 0;
  const stale =
    status === 'done' &&
    props.inputCondition &&
    condition &&
    !sameLineCondition(props.inputCondition, condition);

  return (
    <div className="fs-line-header">
      {status === 'scanning' && (
        <>
          <span className="search-spin" />
          <span className="dim small">
            {shownCondition ? `${lineConditionText(shownCondition)} · ` : ''}
            {progress && progress.total > 0
              ? t('fs.line.scanning', {
                  done: progress.scanned.toLocaleString(),
                  total: progress.total.toLocaleString(),
                })
              : t('fs.line.collecting')}
          </span>
        </>
      )}
      {status === 'done' && stats && condition && (
        <>
          <span className="dim small">
            {t('fs.line.header', {
              condition: lineConditionText(condition),
              matched: stats.matched.toLocaleString(),
              scanned: stats.scanned.toLocaleString(),
              elapsed,
            })}
          </span>
          {skipped > 0 && (
            <span
              className="dim small"
              title={t('fs.line.skippedTitle', {
                empty: stats.skippedEmpty,
                binary: stats.skippedBinary,
                large: stats.skippedLarge,
                error: stats.skippedError,
              })}
            >
              · {t('fs.line.skipped', { n: skipped })}
            </span>
          )}
          {stats.truncated === 'time' && <span className="warn small">· {t('fs.line.truncatedTime')}</span>}
          {stats.truncated === 'limit' && (
            <span className="warn small">· {t('fs.line.truncatedLimit', { n: stats.shown.toLocaleString() })}</span>
          )}
          {stats.capped && (
            <span className="warn small">· {t('fs.line.capped', { n: stats.total.toLocaleString() })}</span>
          )}
          {stale && <span className="warn small">· {t('fs.line.stale', { condition: lineConditionText(props.inputCondition!) })}</span>}
        </>
      )}
      {status === 'error' && <span className="err small">{t('fs.line.error', { msg: error })}</span>}
      {status === 'idle' && (
        <span className="dim small">
          {t('fs.line.cancelled')} · {t('fs.line.cancelledHint')}
        </span>
      )}
      <span style={{ flex: 1 }} />
      <button className="mini" onClick={props.onExit}>
        {t('fs.filter.all')}
      </button>
    </div>
  );
}
