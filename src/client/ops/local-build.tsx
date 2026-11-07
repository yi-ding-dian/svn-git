/** 本地打包面板（发布弹窗「本地打包」tab）：
 *  检测项目里的打包脚本 → 执行 → 实时日志 → 本次新增产物。
 *
 *  与「发布新版本」的区别：这里不升版本、不打 tag、不推 GitHub，只在本地执行打包脚本。
 *  日志/产物跟面板生命周期绑定：关闭弹窗（卸载）会 abort 请求，服务端据此杀掉打包进程。
 *  面板由外层保持常驻（display:none 切换），切 tab 不会中断正在跑的构建。 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { get, post, type LocalBuildArtifact, type LocalBuildDetect } from '../shared/api.js';
import { ResultLine } from '../ui/result-line.js';
import { IconPackage, IconFolder, IconOk, IconErr } from '../ui/icons.js';
import { formatSize } from '../shared/format-size.js';
import type { PickDirRequest } from './branch/branch-shared.js';
import { t } from '../../shared/i18n/index.js';

type Phase = 'detecting' | 'ready' | 'running' | 'cancelling' | 'done' | 'failed' | 'timeout' | 'cancelled' | 'error';

interface BuildResult {
  code: number;
  durationMs: number;
  timedOut?: boolean;
  aborted?: boolean;
  truncated?: boolean;
  artifactsTruncated?: boolean;
}

/** 日志文本上限（字符）：超长构建只保留尾部，避免撑爆内存 */
const MAX_LOG_CHARS = 400_000;

export function LocalBuildPanel(props: {
  /** 当前 tab 是否激活（面板被 display:none 隐藏时 scrollHeight 为 0，切回时补一次滚底） */
  active?: boolean;
  /** 运行状态上报：外层据此决定关闭弹窗是否二次确认 */
  onRunningChange?: (running: boolean) => void;
  /** 打开应用内目录浏览器选脚本（ops 不能直接引用 repo，由 shell 统一渲染） */
  onPickDir?: (req: PickDirRequest) => void;
}) {
  const [detect, setDetect] = useState<LocalBuildDetect | null>(null);
  const [detectError, setDetectError] = useState('');
  const [phase, setPhase] = useState<Phase>('detecting');
  const [logText, setLogText] = useState('');
  const [logOpen, setLogOpen] = useState(true);
  const [artifacts, setArtifacts] = useState<LocalBuildArtifact[]>([]);
  const [result, setResult] = useState<BuildResult | null>(null);
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');
  const [elapsedMs, setElapsedMs] = useState(0);
  const [atBottom, setAtBottom] = useState(true);
  /** 用户手动指定的脚本（绝对路径或仓库相对路径）；'' = 自动检测 */
  const [customScript, setCustomScript] = useState('');
  const [inputPath, setInputPath] = useState('');

  const acRef = useRef<AbortController | null>(null);
  const startedAtRef = useRef(0);
  const preRef = useRef<HTMLPreElement>(null);
  const logBufRef = useRef('');
  const flushTimerRef = useRef<number | null>(null);

  const load = useCallback((script?: string) => {
    if (acRef.current) return; // 运行中不允许重新检测
    setDetect(null);
    setDetectError('');
    setError('');
    setLogText('');
    setLogOpen(true);
    setArtifacts([]);
    setResult(null);
    setPhase('detecting');
    get
      .localBuildDetect(script)
      .then((r) => {
        setDetect(r);
        if (!r.found && r.reason) setDetectError(r.reason);
        setPhase('ready');
      })
      .catch((e: Error) => {
        setDetectError(e.message);
        setPhase('error');
      });
  }, []);

  const refresh = useCallback(() => {
    setCustomScript('');
    setInputPath('');
    load();
  }, [load]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // 手动指定脚本：文件浏览弹窗选中或输入路径后校验。
  // **失败时保留当前界面**（旧脚本/更换按钮都还在），只弹错误——不能把状态清空，
  // 否则用户选错一个文件后面板就整个空了（实报）。
  const applyScript = useCallback((p: string) => {
    const path = p.trim();
    if (!path) return;
    setActionError('');
    get
      .localBuildDetect(path)
      .then((r) => {
        if (!r.found) {
          setDetectError(r.reason || t('ops.localBuild.notFound'));
          return;
        }
        setDetect(r);
        setDetectError('');
        setCustomScript(path);
        setInputPath(path);
        // 换脚本后旧的构建结果不再对应，清掉（但保留脚本行与按钮）
        setLogText('');
        setLogOpen(true);
        setArtifacts([]);
        setResult(null);
        setPhase('ready');
      })
      .catch((e: Error) => setDetectError(e.message));
  }, []);

  /** 打开应用内文件浏览弹窗（默认 deploy 目录，没有则项目根） */
  const openPicker = useCallback(() => {
    if (!props.onPickDir || !detect?.startDir) return;
    props.onPickDir({
      title: t('ops.localBuild.pickTitle'),
      startDir: detect.startDir,
      restrictTo: detect.root,
      allowFiles: true,
      onPick: applyScript,
    });
  }, [props, detect, applyScript]);

  // 运行状态上报（关闭弹窗确认用）
  const running = phase === 'running' || phase === 'cancelling';
  const onRunningChange = props.onRunningChange;
  useEffect(() => {
    onRunningChange?.(running);
  }, [running, onRunningChange]);

  // 日志批处理：构建输出可能每秒上千行，逐行 setState 会卡；100ms 合并一次
  const flushLog = useCallback(() => {
    flushTimerRef.current = null;
    const add = logBufRef.current;
    if (!add) return;
    logBufRef.current = '';
    setLogText((prev) => {
      const next = prev + add;
      return next.length > MAX_LOG_CHARS ? next.slice(next.length - MAX_LOG_CHARS) : next;
    });
  }, []);

  const appendLog = useCallback(
    (line: string) => {
      logBufRef.current += line + '\n';
      if (flushTimerRef.current == null) flushTimerRef.current = window.setTimeout(flushLog, 100);
    },
    [flushLog]
  );

  // 自动滚底（用户向上翻看后不强制）
  useEffect(() => {
    if (atBottom && preRef.current) preRef.current.scrollTop = preRef.current.scrollHeight;
  }, [logText, atBottom]);
  useEffect(() => {
    if (props.active && atBottom && preRef.current) preRef.current.scrollTop = preRef.current.scrollHeight;
  }, [props.active, atBottom]);

  // 已用时
  useEffect(() => {
    if (phase !== 'running') return;
    const timer = window.setInterval(() => setElapsedMs(Date.now() - startedAtRef.current), 1000);
    return () => window.clearInterval(timer);
  }, [phase]);

  // 卸载中止
  useEffect(
    () => () => {
      acRef.current?.abort();
      if (flushTimerRef.current != null) window.clearTimeout(flushTimerRef.current);
    },
    []
  );

  const start = useCallback(() => {
    if (acRef.current) return; // 防双击
    if (!detect?.found) return;
    const ac = new AbortController();
    acRef.current = ac;
    setPhase('running');
    setLogText('');
    setLogOpen(true);
    setArtifacts([]);
    setResult(null);
    setError('');
    setActionError('');
    setElapsedMs(0);
    setAtBottom(true);
    startedAtRef.current = Date.now();
    logBufRef.current = '';
    let sawTerminal = false;

    post
      .localBuildRun(
        (ev) => {
          if (ev.type === 'start') {
            startedAtRef.current = ev.startedAt;
          } else if (ev.type === 'log') {
            appendLog(ev.line);
          } else if (ev.type === 'done') {
            sawTerminal = true;
            setArtifacts(ev.artifacts ?? []);
            setResult(ev);
            setPhase(ev.aborted ? 'cancelled' : ev.timedOut ? 'timeout' : ev.ok ? 'done' : 'failed');
          } else if (ev.type === 'error') {
            sawTerminal = true;
            setError(ev.message);
            setPhase('error');
          }
        },
        ac.signal,
        customScript || undefined
      )
      .catch((e: Error) => {
        if (ac.signal.aborted) {
          sawTerminal = true;
          setPhase('cancelled');
        } else {
          sawTerminal = true;
          setError(e.message);
          setPhase('error');
        }
      })
      .finally(() => {
        flushLog();
        if (acRef.current === ac) acRef.current = null;
        if (!sawTerminal && !ac.signal.aborted) {
          setError(t('ops.localBuild.streamEnded'));
          setPhase('error');
        }
      });
  }, [detect, customScript, appendLog, flushLog]);

  // 构建成功 → 日志自动收起（失败/超时/取消保持展开，便于排查）
  useEffect(() => {
    if (phase === 'done') setLogOpen(false);
  }, [phase]);

  const cancel = useCallback(() => {
    if (!acRef.current) return;
    setPhase('cancelling');
    acRef.current.abort();
  }, []);

  const reveal = (p: string) => {
    setActionError('');
    void post.reveal(p).catch((e: Error) => setActionError(e.message));
  };

  const canRun = detect?.found === true && !running;
  const ran = phase !== 'detecting' && phase !== 'ready' && phase !== 'running' && phase !== 'cancelling';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1, minHeight: 0 }}>
      {phase === 'detecting' && <div className="loading">{t('ops.localBuild.detecting')}</div>}
      {detectError && <ResultLine msg={detectError} err />}

      {detect && !detect.found && (
        <div style={{ marginTop: 2 }}>
          <div style={{ color: 'var(--warn)', fontWeight: 600 }}>{t('ops.localBuild.notFound')}</div>
          <div className="dim small" style={{ marginTop: 6, lineHeight: 1.8 }}>
            {t('ops.localBuild.notFoundTip', { scripts: (detect.searched ?? []).join(' / ') })}
          </div>
          <div className="row" style={{ gap: 8, marginTop: 8 }}>
            <button className="mini" disabled={!props.onPickDir} onClick={openPicker}>
              {t('ops.localBuild.chooseScript')}
            </button>
            <button className="mini" onClick={refresh}>
              {t('ops.localBuild.retryDetect')}
            </button>
          </div>
          {/* 手动输入路径（浏览器模式没有系统文件对话框） */}
          <div className="row" style={{ gap: 8, marginTop: 8 }}>
            <input
              type="text"
              value={inputPath}
              placeholder={t('ops.localBuild.manualPath')}
              onChange={(e) => setInputPath(e.target.value)}
              style={{ flex: 1, minWidth: 0 }}
            />
            <button className="mini" disabled={!inputPath.trim()} onClick={() => applyScript(inputPath)}>
              {t('ops.localBuild.applyPath')}
            </button>
          </div>
        </div>
      )}

      {detect?.found && (
        <>
          <div className="row" style={{ gap: 8, alignItems: 'center' }}>
            <span className="dim small">{t('ops.localBuild.script')}</span>
            <span
              className="mono small"
              style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
              title={detect.script}
            >
              {detect.script}
            </span>
            {detect.mtime && <span className="dim small nowrap">{detect.mtime}</span>}
            {!running && (
              <button className="mini" disabled={!props.onPickDir} onClick={openPicker}>
                {t('ops.localBuild.changeScript')}
              </button>
            )}
            {running ? (
              <button className="mini danger" onClick={cancel} disabled={phase === 'cancelling'}>
                {phase === 'cancelling' ? t('ops.localBuild.cancelling') : t('ops.localBuild.cancel')}
              </button>
            ) : (
              <button className="primary" disabled={!canRun} onClick={start}>
                {ran ? t('ops.localBuild.rebuild') : t('ops.localBuild.start')}
              </button>
            )}
          </div>
          {phase === 'running' && (
            <div className="dim small">
              {t('ops.localBuild.running')} · {t('ops.localBuild.elapsed', { s: Math.floor(elapsedMs / 1000) })} ·
              {' '}{t('ops.localBuild.closeRunningTip')}
            </div>
          )}
          {phase === 'cancelling' && <div className="dim small">{t('ops.localBuild.cancelling')}</div>}
        </>
      )}

      {error && <ResultLine msg={error} err />}
      {actionError && <ResultLine msg={actionError} err />}

      {/* 构建日志：成功后自动折叠成一行，可手动展开；失败/超时/取消保持展开 */}
      <div className="row" style={{ gap: 8, alignItems: 'center' }}>
        <button className="mini" onClick={() => setLogOpen((v) => !v)} title={t('ops.localBuild.logTitle')}>
          {logOpen ? '▾' : '▸'} {t('ops.localBuild.logTitle')}
        </button>
        {!logOpen && logText && <span className="dim small">{t('ops.localBuild.logCollapsed')}</span>}
      </div>
      {logOpen && (
        <pre
          ref={preRef}
          className="mono small"
          onScroll={() => {
            const el = preRef.current;
            if (!el) return;
            setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 24);
          }}
          style={{
            width: '100%',
            flex: 1,
            minHeight: 140,
            margin: 0,
            overflow: 'auto',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
            background: 'var(--panel2)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            padding: '8px 10px',
          }}
        >
          {logText ||
            (phase === 'running' ? t('ops.localBuild.logWaiting') : t('ops.localBuild.logEmpty'))}
        </pre>
      )}

      {result?.truncated && <div className="dim small">{t('ops.localBuild.logTruncated')}</div>}

      {(ran || phase === 'running') && (
        // 日志折叠后让产物区占满剩余高度（否则弹窗底部留一大块空白，且产物多时只能看 4 条）
        <div style={{ ...(logOpen ? { maxHeight: 190 } : { flex: 1, minHeight: 0 }), overflow: 'auto' }}>
          {phase === 'done' && (
            <div className="small" style={{ color: 'var(--ok)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
              <IconOk size={13} /> {t('ops.localBuild.done', { s: Math.round((result?.durationMs ?? 0) / 1000), code: result?.code ?? 0 })}
            </div>
          )}
          {phase === 'failed' && (
            <div className="small" style={{ color: 'var(--err)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
              <IconErr size={13} /> {t('ops.localBuild.failed', { code: result?.code ?? -1, s: Math.round((result?.durationMs ?? 0) / 1000) })}
            </div>
          )}
          {phase === 'timeout' && (
            <div className="small" style={{ color: 'var(--err)' }}>{t('ops.localBuild.timedOut', { min: 60 })}</div>
          )}
          {phase === 'cancelled' && (
            <div className="small" style={{ color: 'var(--warn)' }}>{t('ops.localBuild.cancelled')}</div>
          )}
          {ran && (
            <>
              <div className="dim small" style={{ marginTop: 8, marginBottom: 4 }}>
                {artifacts.length > 0
                  ? t('ops.localBuild.artifacts', { n: artifacts.length })
                  : t('ops.localBuild.artifactsEmpty')}
              </div>
              {artifacts.length > 0 ? (
                artifacts.map((a) => {
                  const dir = a.path.includes('/') ? a.path.slice(0, a.path.lastIndexOf('/')) : '';
                  const name = a.path.slice(a.path.lastIndexOf('/') + 1);
                  return (
                    <div
                      key={a.path}
                      className="row"
                      style={{ gap: 8, alignItems: 'center', padding: '6px 0', borderTop: '1px solid var(--border)' }}
                    >
                      <IconPackage size={14} />
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <div className="mono small" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={a.path}>
                          {name}
                        </div>
                        <div className="dim small" style={{ marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.path}</div>
                      </span>
                      <span className="dim small nowrap">{formatSize(a.size)}</span>
                      <span className="dim small nowrap">{a.mtime}</span>
                      <button className="mini" onClick={() => reveal(dir)} title={t('ops.localBuild.revealTip')}>
                        <IconFolder size={14} /> {t('ops.localBuild.reveal')}
                      </button>
                    </div>
                  );
                })
              ) : (
                <div className="dim small">{t('ops.localBuild.artifactsHint')}</div>
              )}
              {result?.artifactsTruncated && (
                <div className="dim small" style={{ marginTop: 4 }}>{t('ops.localBuild.artifactsTruncated', { n: 200 })}</div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
