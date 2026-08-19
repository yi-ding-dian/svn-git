/** 历史视图：提交列表 + 变更文件详情，点击查看 diff */
import React, { useEffect, useState } from 'react';
import { get, type LogEntry } from './api.js';
import { DiffRender } from './diff-render.js';

interface Props {
  path?: string;
  tick: number;
  onClearPath: () => void;
}

export function LogView(props: Props) {
  const [logs, setLogs] = useState<LogEntry[] | null>(null);
  const [error, setError] = useState('');
  const [sel, setSel] = useState<LogEntry | null>(null);
  const [diffOf, setDiffOf] = useState<{ rev: string; prev?: string; path?: string } | null>(null);
  const [diffText, setDiffText] = useState('');
  const [diffLoading, setDiffLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLogs(null);
    setError('');
    setSel(null);
    setDiffOf(null);
    get
      .log(props.path)
      .then((r) => {
        if (!cancelled) {
          setLogs(r.logs);
          if (r.logs.length > 0) setSel(r.logs[0]!);
        }
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [props.path, props.tick]);

  const showDiff = async (rev: string, prev: string | undefined, path?: string) => {
    setDiffOf({ rev, prev, path });
    setDiffLoading(true);
    try {
      const r = await get.show(rev, path);
      setDiffText(r.output || '(无差异)');
    } catch (e) {
      setDiffText(`读取失败: ${(e as Error).message}`);
    } finally {
      setDiffLoading(false);
    }
  };

  return (
    <div style={{ display: 'flex', gap: 14, height: '100%', minHeight: 0 }}>
      <div style={{ width: '38%', display: 'flex', flexDirection: 'column', minWidth: 300 }}>
        <div className="dim" style={{ marginBottom: 8 }}>
          历史: {props.path ? <span>{props.path} <a href="#" onClick={(e) => { e.preventDefault(); props.onClearPath(); }}>清除路径过滤</a></span> : '全部提交'}
        </div>
        {error && <div className="error">{error}</div>}
        {!logs && !error && <div className="loading">⏳ 读取提交记录…</div>}
        {logs && logs.length === 0 && !error && <div className="empty">暂无提交记录</div>}
        {logs && logs.length > 0 && (
          <div className="list" style={{ overflow: 'auto', flex: 1 }}>
            {logs.map((l) => (
              <div
                key={l.rev}
                className="list-item"
                style={{ background: sel === l ? 'var(--panel2)' : undefined }}
                onClick={() => {
                  setSel(l);
                  setDiffOf(null);
                }}
              >
                <span className="rev">{l.rev}</span>
                <span className="date">{l.date.slice(0, 16)}</span>
                <span className="author">{l.author}</span>
                <span className="msg">{l.msg}</span>
                <span className="stat">{l.changed.length}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {!sel && <div className="empty">选择提交查看详情</div>}
        {sel && !diffOf && (
          <>
            <div className="row" style={{ marginBottom: 10 }}>
              <span className="rev" style={{ fontSize: 15 }}>{sel.rev}</span>
              <span className="dim">{sel.author} · {sel.date}</span>
              <span className="grow" />
            </div>
            <div className="dim" style={{ marginBottom: 10, whiteSpace: 'pre-wrap' }}>{sel.msg}</div>
            <div className="small dim" style={{ marginBottom: 6 }}>变更文件（点击查看 diff）：</div>
            <div className="changed">
              {sel.changed.map((c) => (
                <div key={c.path} className="changed-row" onClick={() => void showDiff(sel.rev, undefined, c.path)}>
                  <span className={`act ${c.action}`}>{c.action}</span>
                  <span className="mono" style={{ cursor: 'pointer' }}>{c.path}</span>
                </div>
              ))}
              {sel.changed.length === 0 && <div className="dim">无文件变更</div>}
              <div className="changed-row" onClick={() => void showDiff(sel.rev, undefined)}>
                <span className="act" style={{ color: 'var(--accent)' }}>▸</span>
                <span style={{ color: 'var(--accent)' }}>查看本次提交完整 diff</span>
              </div>
            </div>
          </>
        )}
        {diffOf && (
          <>
            <div className="row" style={{ marginBottom: 8 }}>
              <span className="dim">
                差异: {diffOf.rev}{diffOf.path ? ` — ${diffOf.path}` : ''}
              </span>
              <span className="grow" />
              <button className="mini" onClick={() => setDiffOf(null)}>← 返回</button>
            </div>
            {diffLoading ? <div className="loading">⏳ 计算差异…</div> : <DiffRender text={diffText} />}
          </>
        )}
      </div>
    </div>
  );
}
