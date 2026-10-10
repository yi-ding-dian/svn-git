/** 环境检测 / 安装弹窗：显示 svn/git 是否安装，缺失可一键安装（SSE 实时日志） */
import React, { useEffect, useRef, useState } from 'react';
import { ResizableModal } from '../shell/modal-shell.js';
import { HelpNote } from '../ui/ui.js';
import { IconOk, IconErr } from '../ui/icons.js';

/** 环境检测 / 安装弹窗：显示 svn/git 是否安装，缺失可一键安装（SSE 实时日志） */
export function EnvInstallModal(props: {
  env: { svn: { installed: boolean; version: string }; git: { installed: boolean; version: string } };
  onClose: () => void;
  onInstalled: () => void;
}) {
  const [logs, setLogs] = useState<string[]>([]);
  const [status, setStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [manual, setManual] = useState('');
  const [busyTool, setBusyTool] = useState<'svn' | 'git' | ''>('');
  const logRef = useRef<HTMLDivElement>(null);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [logs]);

  // 卸载时关闭 SSE（避免弹窗关闭后安装流还在后台跑）
  useEffect(() => () => esRef.current?.close(), []);

  const install = (tool: 'svn' | 'git') => {
    setStatus('running');
    setBusyTool(tool);
    setLogs([]);
    setManual('');
    const es = new EventSource(`/api/env-install/stream?tool=${tool}`);
    esRef.current = es;
    es.onmessage = (e) => {
      try {
        const d = JSON.parse(e.data);
        if (d.line) setLogs((l) => [...l, d.line]);
        if (d.done) {
          es.close();
          esRef.current = null;
          setBusyTool('');
          if (d.code === 0) {
            setStatus('done');
          } else {
            setStatus('error');
            if (d.manual) setManual(d.manual);
          }
        }
      } catch {
        /* ignore */
      }
    };
    es.onerror = () => {
      es.close();
      esRef.current = null;
      setBusyTool('');
      setStatus('error');
    };
  };

  /** 取消安装：关闭 SSE 流，回到可重新安装状态 */
  const cancelInstall = () => {
    esRef.current?.close();
    esRef.current = null;
    setBusyTool('');
    setStatus('idle');
    setLogs((l) => [...l, '【已取消安装】']);
  };

  const Row = (props: { name: string; info: { installed: boolean; version: string }; tool: 'svn' | 'git' }) => (
    <div className="vcs-row" style={{ cursor: 'default' }}>
      <span className={`badge ${props.tool}`} style={{ minWidth: 42, textAlign: 'center' }}>{props.name.toUpperCase()}</span>
      {props.info.installed ? (
        <span style={{ color: 'var(--ok)', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <IconOk size={12} />已安装
        </span>
      ) : (
        <span style={{ color: 'var(--err)', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <IconErr size={12} />未安装
        </span>
      )}
      <span className="dim small" style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {props.info.version || (props.info.installed ? '' : `仅影响 ${props.name.toUpperCase()} 仓库操作`)}
      </span>
      {!props.info.installed && (
        <button className="mini primary" disabled={status === 'running'} onClick={() => install(props.tool)}>
          {busyTool === props.tool && status === 'running' ? '安装中…' : '下载安装'}
        </button>
      )}
    </div>
  );

  return (
    <div className="modal-mask">
      <ResizableModal width={560} onEsc={props.onClose}>
        <h3>环境检测</h3>
        <div className="body">
          <HelpNote>
            本工具同时支持 <b>SVN</b> 和 <b>Git</b> 两种仓库。使用哪种仓库，系统需已安装对应的命令行工具；只用其中一种时，只需安装对应的一种即可，未安装的引擎仅影响该类仓库的操作。
          </HelpNote>
          <div className="vcs-list" style={{ marginTop: 12 }}>
            <Row name="svn" info={props.env.svn} tool="svn" />
            <Row name="git" info={props.env.git} tool="git" />
          </div>
          {(status === 'running' || status === 'done' || status === 'error') && (
            <>
              <div
                ref={logRef}
                className="install-log"
                style={{ marginTop: 12, height: 180, overflow: 'auto' }}
              >
                {logs.map((l, i) => (
                  <div key={i} className="small mono" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                    {l}
                  </div>
                ))}
              </div>
              {status === 'done' && (
                <div style={{ color: 'var(--ok)', marginTop: 10, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <IconOk size={13} />
                  安装完成，点击下方按钮刷新页面后即可使用
                </div>
              )}
              {status === 'error' && (
                <div className="error" style={{ marginTop: 10 }}>
                  安装失败。请在终端手动执行：<code className="mono">{manual || 'sudo apt-get install -y subversion git'}</code>
                </div>
              )}
            </>
          )}
        </div>
        <div className="foot">
          <button onClick={props.onClose} disabled={status === 'running'}>关闭</button>
          {status === 'running' && <button onClick={cancelInstall}>取消安装</button>}
          {status === 'done' && <button className="primary" onClick={props.onInstalled}>🔄 刷新页面</button>}
        </div>
      </ResizableModal>
    </div>
  );
}
