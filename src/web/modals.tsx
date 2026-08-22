/** 模态框：提交信息 / SVN 登录 / 危险操作确认 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { post } from './api.js';
import { ResizableModal } from './modal-shell.js';
import { HelpNote, FormRow } from './ui.js';
import { pathAutoWidth, useCheckedSet } from './utils.js';
import { cmdOfRepo } from './cmd-preview.js';

/** 全局弹窗状态（App 根组件 / 顶部工具栏共用） */
export type Modal =
  | { type: 'commit'; paths: string[] }
  | { type: 'commit-select'; dir: string; dirLabel: string; items: { path: string; code: string; isDir: boolean }[]; checked?: string[] }
  | { type: 'login' }
  | { type: 'open' }
  | { type: 'branches' }
  | { type: 'tags' }
  | { type: 'stash' }
  | { type: 'create-repo' }
  | { type: 'git-info' }
  | { type: 'git-push-auth'; authType: 'github' | 'server' | 'ssh' }
  | { type: 'push-confirm' }
  | { type: 'clean' }
  | { type: 'env' }
  | { type: 'font' }
  | { type: 'conflicts' }
  | { type: 'remote-conflicts'; files: string[] }
  | {
      type: 'confirm';
      title: string;
      message: React.ReactNode;
      danger?: boolean;
      confirmLabel?: string;
      secondaryLabel?: string;
      action: () => void;
      secondaryAction?: () => void;
      /** 命令预览：悬浮确认/副确认按钮时显示将执行的命令 */
      confirmCmd?: string;
      secondaryCmd?: string;
      /** 弹窗宽度（默认 440；文件列表类确认框按内容自适应传入） */
      width?: number;
    }
  | null;

/** 提交注释输入块（多个提交弹窗共用）：标签 + 多行输入 + Ctrl+Enter 提交 */
function CommitCommentBox(props: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  rows?: number;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  return (
    <>
      <div className="cmt-label">
        📝 提交注释 <span className="dim" style={{ fontWeight: 400 }}>（必填）</span>
      </div>
      <textarea
        className="cmt-text"
        rows={props.rows ?? 3}
        placeholder={props.placeholder}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') props.onSubmit();
        }}
        autoFocus={props.autoFocus}
        style={{ flexShrink: 0 }}
      />
    </>
  );
}

export function CommitModal(props: {
  repoType: string;
  paths: string[];
  onClose: () => void;
  onDone: (msg: string, paths: string[]) => void;
}) {
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  // 待提交文件勾选：默认全部勾选；"全选/全不选"按钮二次点击反向
  const { checked, setChecked, toggle } = useCheckedSet(props.paths);
  const allChecked = props.paths.length > 0 && checked.size === props.paths.length;

  const submit = async () => {
    if (!msg.trim()) {
      setErr('提交信息不能为空');
      return;
    }
    if (checked.size === 0) {
      setErr('请至少勾选一个文件');
      return;
    }
    setBusy(true);
    try {
      await props.onDone(msg, props.paths.filter((p) => checked.has(p)));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // 弹窗宽度自适应最长文件名（公式见 utils.pathAutoWidth）
  const maxPathLen = props.paths.reduce((m, p) => Math.max(m, p.length), 0);
  const autoWidth = pathAutoWidth(maxPathLen, 660, 1400);

  return (
    <div className="modal-mask">
      <ResizableModal width={autoWidth} onEsc={props.onClose}>
        <h3>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>📝 提交</span>
            <span className="dim small" style={{ fontWeight: 400 }}>({props.repoType.toUpperCase()})</span>
          </span>
        </h3>
        <div className="body" style={{ display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
          {/* 待提交文件列表：可勾选，默认全选；弹窗高度变化时跟随伸缩，全部显示得下则不滚动 */}
          {props.paths.length > 0 && (
            <div className="row" style={{ marginBottom: 8, gap: 10, flexShrink: 0 }}>
              <span className="small dim" style={{ flex: 1 }}>
                📁 待提交 <b>{checked.size}</b>/{props.paths.length} 个文件
              </span>
              <button className="mini" onClick={() => setChecked(allChecked ? new Set() : new Set(props.paths))}>
                {allChecked ? '全不选' : '全选'}
              </button>
            </div>
          )}
          {props.paths.length > 0 && (
            <div className="vcs-list" style={{ flex: 1, minHeight: 80, overflow: 'auto', marginBottom: 12 }}>
              {props.paths.map((p) => (
                <label key={p} className="vcs-row" style={{ cursor: 'pointer' }}>
                  <input type="checkbox" checked={checked.has(p)} onChange={() => toggle(p)} style={{ flexShrink: 0 }} />
                  {/* minWidth:0 让超长路径省略号生效，勾选框不会被挤出 */}
                  <span className="mono small" style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={p}>
                    {p}
                  </span>
                </label>
              ))}
            </div>
          )}
          {/* 提交注释：清晰标签 + 美化输入框 */}
          <CommitCommentBox
            value={msg}
            onChange={setMsg}
            onSubmit={() => void submit()}
            rows={5}
            placeholder="简要说明本次提交内容，如：修复xxx问题、新增xxx功能、重构xxx模块…"
            autoFocus
          />
          {err && <div className="error mt8">{err}</div>}
        </div>
        <div className="foot">
          <button onClick={props.onClose} disabled={busy}>取消</button>
          <button
            className="primary"
            onClick={() => void submit()}
            disabled={busy || !msg.trim() || checked.size === 0}
            title={`命令行: ${cmdOfRepo(props.repoType as 'git' | 'svn', 'commit', { msg: msg.trim() || '…' }) ?? ''}`}
          >
            {busy ? '⏳ 提交中…' : '✅ 确认提交'}
          </button>
        </div>
      </ResizableModal>
    </div>
  );
}

/** 更新结果弹窗：显示更新目录/文件详情（不自动消失，用户可仔细查看） */
export function UpdateResultModal(props: {
  dir: string;
  ok: boolean;
  message: string;
  files?: { path: string; status: string; code?: string }[];
  warnings?: string[];
  onClose: () => void;
}) {
  const STATUS_CN: Record<string, string> = {
    updated: '已更新',
    added: '已添加',
    deleted: '已删除',
    conflicted: '冲突',
    merged: '已合并',
    skipped: '已跳过',
  };
  const STATUS_COLOR: Record<string, string> = {
    updated: 'var(--ok)',
    added: 'var(--ok)',
    deleted: 'var(--err)',
    conflicted: 'var(--err)',
    merged: 'var(--accent)',
    skipped: 'var(--dim)',
  };

  // 按状态统计
  const stats = useMemo(() => {
    const m = new Map<string, number>();
    for (const f of props.files ?? []) {
      m.set(f.status, (m.get(f.status) ?? 0) + 1);
    }
    return [...m.entries()].map(([k, n]) => ({ status: k, label: STATUS_CN[k] ?? k, count: n }));
  }, [props.files]);

  return (
    <div className="modal-mask">
      <ResizableModal width={720} onEsc={props.onClose}>
        <h3 style={{ color: props.ok ? 'var(--ok)' : 'var(--err)' }}>
          {props.ok ? '✅ 更新完成' : '❌ 更新失败'}
        </h3>
        <div className="body">
          <div className="help-note" style={{ alignItems: 'center', marginBottom: 10 }}>
            <span style={{ flexShrink: 0 }}>📁</span>
            <span style={{ flex: 1, wordBreak: 'break-all' }}>{props.dir || '（仓库根）'}</span>
            {stats.length > 0 && (
              <span className="row" style={{ gap: 8, flexShrink: 0 }}>
                {stats.map((s) => (
                  <span key={s.status} className="small nowrap" style={{ color: STATUS_COLOR[s.status] }}>
                    {s.label} <b>{s.count}</b>
                  </span>
                ))}
              </span>
            )}
          </div>
          {props.files && props.files.length > 0 ? (
            // 终端式文件列表：状态字母 + 路径；文件多时滚动
            <div className="vcs-list" style={{ minHeight: 120 }}>
              {props.files.map((f, i) => (
                <div key={i} className="vcs-row" style={{ cursor: 'default' }}>
                  <span className="mono small nowrap" style={{ width: 30, textAlign: 'center', fontWeight: 700, color: STATUS_COLOR[f.status] }}>
                    {f.code ?? STATUS_CN[f.status] ?? f.status}
                  </span>
                  <span className="mono small" style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={f.path}>
                    {f.path}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="mt8" style={{ whiteSpace: 'pre-wrap', maxHeight: 220, overflow: 'auto', fontSize: '1.08em', color: props.ok ? 'var(--ok)' : 'var(--err)' }}>
              {props.message}
            </div>
          )}
          {/* svn 警告（如外部定义失败 W205011/W175013…）：有什么提示什么 */}
          {props.warnings && props.warnings.length > 0 && (
            <div
              style={{
                marginTop: 10,
                background: 'rgba(212,167,50,.10)',
                border: '1px solid var(--warn)',
                borderRadius: 8,
                padding: '8px 12px',
              }}
            >
              <div className="small" style={{ color: 'var(--warn)', fontWeight: 600, marginBottom: 6 }}>
                ⚠ svn 警告（{props.warnings.length} 条）
              </div>
              <div className="mono small" style={{ whiteSpace: 'pre-wrap', maxHeight: 200, overflow: 'auto', color: 'var(--warn)', lineHeight: 1.6 }}>
                {props.warnings.join('\n')}
              </div>
            </div>
          )}
        </div>
        <div className="foot">
          <button className="primary" onClick={props.onClose}>知道了</button>
        </div>
      </ResizableModal>
    </div>
  );
}

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
        <span style={{ color: 'var(--ok)', fontWeight: 600 }}>✓ 已安装</span>
      ) : (
        <span style={{ color: 'var(--err)', fontWeight: 600 }}>✗ 未安装</span>
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
                <div style={{ color: 'var(--ok)', marginTop: 10, fontWeight: 600 }}>
                  ✅ 安装完成，点击下方按钮刷新页面后即可使用
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

/** 勾选式提交弹窗：列举变更文件可勾选 + 提交信息注释 */
export function CommitSelectModal(props: {
  repoType: string;
  dirLabel: string;
  items: { path: string; code: string; isDir: boolean }[];
  /** 恢复勾选（从差异视图/提交确认返回时保留）；缺省全选 */
  checked?: string[];
  /** 双击文件查看差异（path, 当前勾选快照） */
  onDiff?: (path: string, checked: string[]) => void;
  onClose: () => void;
  onConfirm: (paths: string[], message: string) => void;
}) {
  const { checked, setChecked, toggle } = useCheckedSet(props.checked ?? props.items.map((i) => i.path));
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  // 状态过滤：仅当列表存在 A(添加)/D(删除) 文件时才显示对应过滤开关
  const hasA = props.items.some((i) => i.code === 'A');
  const hasD = props.items.some((i) => i.code === 'D');
  const [filterA, setFilterA] = useState(false);
  const [filterD, setFilterD] = useState(false);
  // 过滤后的可见列表（勾 A 只显示 A，勾 D 只显示 D，都勾显示 A 或 D，都不勾显示全部）
  const visibleItems = props.items.filter((i) => {
    if (filterA || filterD) return (filterA && i.code === 'A') || (filterD && i.code === 'D');
    return true;
  });
  // 切换过滤时勾选跟随可见列表：看到勾几个就提交几个，不会把隐藏的 M/D 一起传上去
  const applyFilter = (fa: boolean, fd: boolean) => {
    setFilterA(fa);
    setFilterD(fd);
    const vis = props.items.filter((i) => {
      if (fa || fd) return (fa && i.code === 'A') || (fd && i.code === 'D');
      return true;
    });
    setChecked(new Set(vis.map((v) => v.path)));
  };
  // 全选状态基于当前可见列表；全选/全不选只作用于可见列表
  const allOn = visibleItems.length > 0 && visibleItems.every((i) => checked.has(i.path));
  const toggleAllVisible = () => {
    setChecked((prev) => {
      const n = new Set(prev);
      if (allOn) for (const v of visibleItems) n.delete(v.path);
      else for (const v of visibleItems) n.add(v.path);
      return n;
    });
  };
  // 窗口最大化（右上角按钮）；点击遮罩不关闭，只能点 ✕
  const [maxed, setMaxed] = useState(false);

  const submit = () => {
    if (checked.size === 0) {
      setErr('请至少勾选一个文件');
      return;
    }
    if (!msg.trim()) {
      setErr('请填写提交信息');
      return;
    }
    props.onConfirm([...checked], msg.trim());
  };

  // 弹窗宽度自适应最长文件名（公式见 utils.pathAutoWidth）
  const maxPathLen = props.items.reduce((m, i) => Math.max(m, i.path.length), 0);
  const autoWidth = pathAutoWidth(maxPathLen, 620, 1400);

  return (
    <div className="modal-mask">
      <ResizableModal width={autoWidth} maxed={maxed} onToggleMax={() => setMaxed((m) => !m)}>
        <h3 style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ flex: 1 }}>📝 提交修改的文件 ({props.repoType.toUpperCase()})</span>
          <button className="mini" title={maxed ? '还原窗口' : '最大化'} onClick={() => setMaxed((m) => !m)}>
            {maxed ? '🗗' : '⛶'}
          </button>
          <button className="mini danger" title="关闭" onClick={props.onClose}>✕</button>
        </h3>
        <div className="body" style={{ display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
          <div className="dim small" style={{ marginBottom: 8, flexShrink: 0 }}>
            ℹ️ 未版本化文件（?）不在列表中——需先在文件夹视图右键「添加到版本库」，再提交
          </div>
          {/* 目录信息条：清晰展示提交范围与勾选进度 */}
          <div className="help-note" style={{ alignItems: 'center', marginBottom: 10, padding: '8px 12px', flexShrink: 0 }}>
            <span style={{ flexShrink: 0 }}>📁</span>
            <span className="small" style={{ flex: 1, wordBreak: 'break-all' }}>{props.dirLabel || '（仓库根）'}</span>
            <span className="small dim nowrap" style={{ flexShrink: 0 }}>
              已勾选 <b>{checked.size}</b>/{props.items.length}
              {filterA || filterD ? ` · 过滤显示 ${visibleItems.length} 个（${[filterA ? 'A' : '', filterD ? 'D' : ''].filter(Boolean).join('+')}）` : ''}
            </span>
          </div>
          {/* 文件列表：弹窗高度变化时跟随伸缩，全部显示得下则不滚动 */}
          <div className="changed" style={{ flex: 1, minHeight: 80, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 8, padding: 6, marginBottom: 12 }}>
            {/* 全选/全不选 + 状态过滤开关（仅列表存在该状态时显示） */}
            <div className="row" style={{ gap: 12, borderBottom: '1px solid var(--border2)', paddingBottom: 6, marginBottom: 4 }}>
              <label className="row" style={{ cursor: 'pointer', gap: 6, flexShrink: 0 }}>
                <input type="checkbox" checked={allOn} onChange={toggleAllVisible} />
                <span className="dim small">{allOn ? '取消全选' : '全选'}</span>
              </label>
              {hasA && (
                <label className="row" style={{ cursor: 'pointer', gap: 6, flexShrink: 0 }} title="只显示已添加的文件（勾选自动限定为可见项）">
                  <input type="checkbox" checked={filterA} onChange={() => applyFilter(!filterA, filterD)} />
                  <span className="act A small">A</span>
                  <span className="dim small">添加</span>
                </label>
              )}
              {hasD && (
                <label className="row" style={{ cursor: 'pointer', gap: 6, flexShrink: 0 }} title="只显示已删除的文件（勾选自动限定为可见项）">
                  <input type="checkbox" checked={filterD} onChange={() => applyFilter(filterA, !filterD)} />
                  <span className="act D small">D</span>
                  <span className="dim small">删除</span>
                </label>
              )}
            </div>
            {visibleItems.map((it) => (
              <label
                key={it.path}
                className="changed-row"
                style={{ cursor: 'pointer' }}
                title={props.onDiff && !it.isDir ? `${it.path}\n双击查看差异` : it.path}
                onDoubleClick={(ev) => {
                  ev.preventDefault();
                  if (props.onDiff && !it.isDir) props.onDiff(it.path, [...checked]);
                }}
              >
                <input type="checkbox" checked={checked.has(it.path)} onChange={() => toggle(it.path)} style={{ flexShrink: 0 }} />
                <span className={`act ${it.code}`}>{it.code}</span>
                {/* minWidth:0 让超长路径省略号生效，勾选框不会被挤出 */}
                <span className="mono" style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {it.path}{it.isDir ? '/' : ''}
                </span>
              </label>
            ))}
            {props.items.length === 0 && <div className="dim" style={{ padding: '8px 4px' }}>当前目录下没有变更文件</div>}
            {props.items.length > 0 && visibleItems.length === 0 && <div className="dim" style={{ padding: '8px 4px' }}>没有匹配当前过滤的文件</div>}
          </div>
          <div style={{ marginTop: 2 }}>
            <CommitCommentBox
              value={msg}
              onChange={setMsg}
              onSubmit={submit}
              rows={3}
              placeholder="简要说明本次提交内容，如：修复xxx问题、新增xxx功能…"
            />
          </div>
          {err && <div className="error mt8">{err}</div>}
        </div>
        <div className="foot">
          <button onClick={props.onClose}>取消</button>
          <button
            className="primary"
            onClick={submit}
            disabled={props.items.length === 0}
            title={`命令行: ${cmdOfRepo(props.repoType as 'git' | 'svn', 'commit', { msg: '…' }) ?? ''}`}
          >
            ✅ 提交勾选的 {checked.size} 个文件
          </button>
        </div>
      </ResizableModal>
    </div>
  );
}

export function LoginModal(props: {
  username: string;
  onClose: () => void;
  onSaved: () => void;
  onToast: (msg: string) => void;
}) {
  const [username, setUsername] = useState(props.username);
  const [password, setPassword] = useState('');
  const [trust, setTrust] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  // 已有账号时先显示状态面板（切换账号/退出登录），无账号直接显示表单
  const [editing, setEditing] = useState(!props.username);

  const submit = async () => {
    setBusy(true);
    try {
      await post.config({ username, password, trustServerCert: trust });
      props.onSaved();
      props.onToast(username ? 'SVN 账号已保存' : 'SVN 账号已清除');
      props.onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  /** 退出登录：清除保存的账号密码，改用 svn 官方凭据缓存 */
  const logout = async () => {
    setBusy(true);
    try {
      await post.config({ username: '', password: '', trustServerCert: false });
      props.onSaved();
      props.onToast('已退出 SVN 登录（改用官方凭据缓存）');
      props.onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-mask">
      <ResizableModal width={440} minWidth={420} onEsc={props.onClose}>
        <h3>SVN 账号设置</h3>
        <div className="body">
          {!editing && props.username ? (
            <>
              <div className="form-row">
                <label>当前已登录账号</label>
                <div className="help-note" style={{ alignItems: 'center' }}>
                  <span className="badge svn" style={{ fontSize: 11 }}>SVN</span>
                  <b>{props.username}</b>
                  <span className="dim small">（SVN 仓库操作使用此账号）</span>
                </div>
              </div>
              <div className="row" style={{ gap: 8 }}>
                <button className="primary" disabled={busy} onClick={() => setEditing(true)}>🔄 切换账号</button>
                <button className="danger" disabled={busy} onClick={() => void logout()}>🚪 退出登录</button>
              </div>
            </>
          ) : (
            <>
              <FormRow label="用户名（留空表示使用 svn 官方凭据缓存）">
                <input type="text" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus />
              </FormRow>
              <FormRow label="密码">
                <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
              </FormRow>
              <FormRow label={<><input type="checkbox" checked={trust} onChange={(e) => setTrust(e.target.checked)} /> 信任 HTTPS 自签名证书</>} />
            </>
          )}
          {err && <div className="error">{err}</div>}
        </div>
        <div className="foot">
          <button onClick={props.onClose} disabled={busy}>取消</button>
          {editing && (
            <button className="primary" onClick={() => void submit()} disabled={busy}>
              {busy ? '保存中…' : '保存'}
            </button>
          )}
        </div>
      </ResizableModal>
    </div>
  );
}

/** 信息提示弹窗（单按钮，用于"不可操作"类说明提示） */
export function InfoModal(props: { title: string; message: React.ReactNode; onClose: () => void }) {
  return (
    <div className="modal-mask">
      <ResizableModal width={440} minWidth={420} onEsc={props.onClose}>
        <h3>{props.title}</h3>
        <div className="body">{props.message}</div>
        <div className="foot">
          <button className="primary" onClick={props.onClose}>知道了</button>
        </div>
      </ResizableModal>
    </div>
  );
}

export function ConfirmModal(props: {
  title: string;
  message: React.ReactNode;
  danger?: boolean;
  confirmLabel?: string;
  secondaryLabel?: string;
  /** 命令预览：鼠标悬浮按钮时显示将执行的命令 */
  confirmCmd?: string;
  secondaryCmd?: string;
  /** 弹窗宽度（默认 440） */
  width?: number;
  onConfirm: () => void;
  onCancel: () => void;
  onSecondary?: () => void;
}) {
  return (
    <div className="modal-mask">
      <ResizableModal width={props.width ?? 440} minWidth={420} onEsc={props.onCancel}>
        <h3>{props.title}</h3>
        <div className="body">{props.message}</div>
        <div className="foot">
          <button onClick={props.onCancel}>取消</button>
          {props.secondaryLabel && props.onSecondary && (
            <button
              className="primary"
              onClick={props.onSecondary}
              title={props.secondaryCmd ? `命令行: ${props.secondaryCmd}` : undefined}
            >
              {props.secondaryLabel}
            </button>
          )}
          <button
            className={props.danger ? 'danger' : 'primary'}
            onClick={props.onConfirm}
            title={props.confirmCmd ? `命令行: ${props.confirmCmd}` : undefined}
          >
            {props.confirmLabel ?? '确认'}
          </button>
        </div>
      </ResizableModal>
    </div>
  );
}
