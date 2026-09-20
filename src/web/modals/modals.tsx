/** 模态框：提交信息 / SVN 登录 / 危险操作确认 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { post } from '../api.js';
import { ResizableModal } from './modal-shell.js';
import { HelpNote, FormRow } from '../ui/ui.js';
import { IconOk, IconErr, IconWarn } from '../ui/icons.js';
import { pathAutoWidth, useCheckedSet } from '../utils.js';
import { cmdOfRepo } from '../cmd-preview.js';
import { StageHunksModal } from './stage-hunks.js';

/** 全局弹窗状态（App 根组件 / 顶部工具栏共用） */
export type Modal =
  | { type: 'commit'; paths: string[] }
  | { type: 'commit-select'; dir: string; dirLabel: string; items: { path: string; code: string; isDir: boolean }[]; checked?: string[]; stagedOnly?: string[] }
  | { type: 'login' }
  | { type: 'open' }
  | { type: 'branches' }
  | { type: 'tags' }
  | { type: 'stash' }
  | { type: 'create-repo' }
  | { type: 'get-repo' }
  | { type: 'git-info' }
  | { type: 'git-push-auth'; authType: 'github' | 'server' | 'ssh' }
  | { type: 'push-confirm' }
  | { type: 'clean' }
  | { type: 'env' }
  | { type: 'font' }
  | { type: 'conflicts' }
  | { type: 'remote-conflicts'; files: string[] }
  | { type: 'revert-confirm'; dir: string; dirLabel: string; items: { path: string; code: string }[] }
  | { type: 'rename'; from: string; fsMode: boolean }
  | {
      type: 'confirm';
      title: React.ReactNode;
      message: React.ReactNode;
      danger?: boolean;
      confirmLabel?: string;
      secondaryLabel?: string;
      /** 副按钮是否红色（危险选项） */
      secondaryDanger?: boolean;
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
            title={`${cmdOfRepo(props.repoType as 'git' | 'svn', 'commit', { msg: msg.trim() || '…' }) ?? ''}`}
          >
            {busy ? (
              '⏳ 提交中…'
            ) : (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <IconOk size={13} />
                确认提交
              </span>
            )}
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
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            {props.ok ? <IconOk size={16} /> : <IconErr size={16} />}
            {props.ok ? '更新完成' : '更新失败'}
          </span>
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

/** 勾选式提交弹窗：列举变更文件可勾选 + 提交信息注释 */
export function CommitSelectModal(props: {
  repoType: string;
  dirLabel: string;
  items: { path: string; code: string; isDir: boolean }[];
  /** 恢复勾选（从差异视图/提交确认返回时保留）；缺省全选 */
  checked?: string[];
  /** 已部分暂存（hunk 级）的文件：提交时跳过整文件 add，只提交已选中的块 */
  stagedOnly?: string[];
  /** 双击文件查看差异（path, 当前勾选快照, 已部分暂存列表） */
  onDiff?: (path: string, checked: string[], stagedOnly: string[]) => void;
  onClose: () => void;
  onConfirm: (paths: string[], message: string, stagedOnly: string[]) => void;
}) {
  const stagedSet = new Set(props.stagedOnly ?? []);
  const { checked, setChecked, toggle } = useCheckedSet(props.checked ?? props.items.map((i) => i.path));
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  /** 已部分暂存（hunk 级）的文件；先在本地维护，随 onConfirm 一并交出去，App 再持久到弹窗状态里 */
  const [stagedLocal, setStagedLocal] = useState<string[]>(props.stagedOnly ?? []);
  /** 正在「选择部分改动」的文件（null = 未打开那个弹窗） */
  const [stagePath, setStagePath] = useState<string | null>(null);
  /** hunk 级部分提交（「选择部分改动」）是 **git 独有**的（git add -p），svn 没有对应概念——
      svn 下这个入口整体不该出现：后端只会回一句"仅 git 仓库支持"，那就成了"点了才知道不行" */
  const isGit = props.repoType === 'git';

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
    props.onConfirm([...checked], msg.trim(), stagedLocal);
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
            {props.repoType === 'svn' && (
              <>
                <br />
                🔗 外部引用（文件夹视图里带链环图标的目录）也不在列表中——它装的是另一个仓库路径的内容，
                提交它等于提交那个目录，请直接到那里提交
              </>
            )}
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
                title={props.onDiff && !it.isDir
                  ? `${it.path}\n双击查看差异${isGit ? ' · 右键选择部分改动' : ''}`
                  : it.path}
                onDoubleClick={(ev) => {
                  ev.preventDefault();
                  if (props.onDiff && !it.isDir) props.onDiff(it.path, [...checked], stagedLocal);
                }}
                onContextMenu={(ev) => {
                  ev.preventDefault();
                  // svn 下右键**完全没反应**（不弹、不提示）：这功能它根本没有，别让人点了才知道
                  if (isGit && !it.isDir) setStagePath(it.path);
                }}
              >
                <input type="checkbox" checked={checked.has(it.path)} onChange={() => toggle(it.path)} style={{ flexShrink: 0 }} />
                <span className={`act ${it.code}`}>{it.code}</span>
                {/* minWidth:0 让超长路径省略号生效，勾选框不会被挤出 */}
                <span className="mono" style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {it.path}{it.isDir ? '/' : ''}
                </span>
                {stagedLocal.includes(it.path) && (
                  <span className="small" style={{ flexShrink: 0, color: 'var(--accent)' }} title="已部分暂存：提交时只提交选中的改动，未选中的留在工作区">
                    ✂ 部分
                  </span>
                )}
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
            title={`${cmdOfRepo(props.repoType as 'git' | 'svn', 'commit', { msg: '…' }) ?? ''}`}
          >
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <IconOk size={13} />
              提交勾选的 {checked.size} 个文件
            </span>
          </button>
        </div>
      </ResizableModal>
      {/* hunk 级部分提交：右键文件打开，选中的块暂存后该文件标记为「部分」 */}
      {stagePath && (
        <StageHunksModal
          path={stagePath}
          onClose={() => setStagePath(null)}
          onStaged={() => {
            const p = stagePath;
            setStagedLocal((prev) => (prev.includes(p) ? prev : [...prev, p]));
          }}
          onToast={(m) => setErr(m)}
        />
      )}
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
        <div className="body" style={{ whiteSpace: 'pre-wrap' }}>
          {/* 内层文本流容器：body 是 flex column，message 若是裸片段（无外层元素）会被拆成一行一个段，
              包一层 div 让文本自然内联（行宽不足才换行），所有调用方一致 */}
          <div style={{ lineHeight: 1.7 }}>{props.message}</div>
        </div>
        <div className="foot">
          <button className="primary" onClick={props.onClose}>知道了</button>
        </div>
      </ResizableModal>
    </div>
  );
}

export function ConfirmModal(props: {
  /** 弹窗标题（可含 SVG 图标，如 <IconErr/> 推送失败） */
  title: React.ReactNode;
  message: React.ReactNode;
  danger?: boolean;
  confirmLabel?: string;
  secondaryLabel?: string;
  /** 副按钮是否红色（危险选项） */
  secondaryDanger?: boolean;
  /** 隐藏「取消」按钮：仅"知道了"一种回应（信息型通知） */
  hideCancel?: boolean;
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
        <div className="body" style={{ whiteSpace: 'pre-wrap' }}>
          {/* 内层文本流容器：body 是 flex column，message 若是裸片段（无外层元素）会被拆成一行一个段，
              包一层 div 让文本自然内联（行宽不足才换行），所有调用方一致 */}
          <div style={{ lineHeight: 1.7 }}>{props.message}</div>
        </div>
        <div className="foot">
          {!props.hideCancel && <button onClick={props.onCancel}>取消</button>}
          {props.secondaryLabel && props.onSecondary && (
            <button
              className={props.secondaryDanger ? 'danger' : 'primary'}
              onClick={props.onSecondary}
              title={props.secondaryCmd ? `${props.secondaryCmd}` : undefined}
            >
              {props.secondaryLabel}
            </button>
          )}
          <button
            className={props.danger ? 'danger' : 'primary'}
            onClick={props.onConfirm}
            title={props.confirmCmd ? `${props.confirmCmd}` : undefined}
          >
            {props.confirmLabel ?? '确认'}
          </button>
        </div>
      </ResizableModal>
    </div>
  );
}

/** 重命名/移动弹窗：只输入文件名（自动保留原目录），确认按钮悬浮显示将执行命令。
 * fsMode=true 走磁盘改名（?/I 未版本化文件）；否则 svn move / git mv（提交后生效）。 */
export function RenameModal(props: {
  repoType: 'svn' | 'git';
  from: string;
  fsMode: boolean;
  onConfirm: (to: string) => void;
  onCancel: () => void;
}) {
  // 只编辑文件名（basename），目录部分固定不动：to = 原目录 + 新文件名；提示文本不显示完整路径（避免长路径干扰）
  const dir = props.from.includes('/') ? props.from.slice(0, props.from.lastIndexOf('/')) : '';
  const baseName = props.from.split('/').pop() ?? '';
  const [to, setTo] = useState(baseName);
  const trimmed = to.trim();
  const err = !trimmed
    ? '名字不能为空'
    : trimmed === baseName
      ? '名字未变化'
      : trimmed.includes('/') || trimmed.includes('\\')
        ? '只输入文件名，不用写路径'
        : '';
  const fullTo = dir ? `${dir}/${trimmed}` : trimmed;
  const cmd = props.fsMode
    ? '从磁盘直接改名，不影响版本库（状态保持 ? / I）'
    : cmdOfRepo(props.repoType, 'move', { from: baseName, to: trimmed || '…' }) ?? '';
  return (
    <div className="modal-mask">
      <ResizableModal width={440} minWidth={420} onEsc={props.onCancel}>
        <h3>重命名</h3>
        <div className="body">
          <div className="dim small" style={{ marginBottom: 8 }}>
            {props.fsMode ? '未版本化文件，仅改磁盘文件名，不影响版本库' : '本地改名，提交后生效'}
          </div>
          <input
            autoFocus
            type="text"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            onFocus={(e) => e.currentTarget.select()}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !err) props.onConfirm(fullTo);
            }}
            style={{ width: '100%', fontFamily: 'var(--mono)' }}
          />
          {err && (
            <div className="small" style={{ marginTop: 8, color: 'var(--err)' }}>
              {err}
            </div>
          )}
          <div className="dim small" style={{ marginTop: 8 }}>
            只输入文件名，改名后仍在当前目录
          </div>
        </div>
        <div className="foot">
          <button onClick={props.onCancel}>取消</button>
          <button className="primary" disabled={!!err} onClick={() => props.onConfirm(fullTo)} title={cmd}>
            重命名
          </button>
        </div>
      </ResizableModal>
    </div>
  );
}

/** 备注弹窗（最近项目右键「备注」）：给项目写一句自己的话，侧边栏显示在时间前面。
 *  打开时预填现有备注并全选——多半是来改的，直接打字即替换；清空后保存 = 删除备注 */
export function RemarkModal(props: {
  /** 项目名（只给 basename：长路径塞进弹窗反而看不清在给谁写备注） */
  projectName: string;
  /** 现有备注；没有则传空串 */
  current: string;
  onConfirm: (remark: string) => void;
  onCancel: () => void;
}) {
  const MAX = 60;
  const [text, setText] = useState(props.current);
  const trimmed = text.trim();
  // 本来就没备注、输入又是空 → 保存无事可做（避免按钮显示成「删除备注」却什么也没删）
  const noop = !trimmed && !props.current;
  const submit = () => props.onConfirm(trimmed.slice(0, MAX));
  return (
    <div className="modal-mask">
      <ResizableModal width={440} minWidth={420} onEsc={props.onCancel}>
        <h3>备注</h3>
        <div className="body">
          <div className="dim small" style={{ marginBottom: 8 }}>
            给「{props.projectName}」写一句备注，显示在最近项目的时间前面
            （侧边栏窄，过长会被截断成「…」，悬浮该项可看全文）
          </div>
          <input
            autoFocus
            type="text"
            value={text}
            maxLength={MAX}
            placeholder="例如：客户演示用 / 主要开发仓库…"
            onChange={(e) => setText(e.target.value)}
            onFocus={(e) => e.currentTarget.select()}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !noop) submit();
            }}
            style={{ width: '100%' }}
          />
          <div className="dim small" style={{ marginTop: 8, display: 'flex' }}>
            <span>清空后保存 = 删除备注</span>
            <span style={{ marginLeft: 'auto' }}>
              {trimmed.length}/{MAX}
            </span>
          </div>
        </div>
        <div className="foot">
          <button onClick={props.onCancel}>取消</button>
          <button className="primary" disabled={noop} onClick={submit} title={noop ? '还没有输入备注' : ''}>
            {trimmed ? '保存备注' : '删除备注'}
          </button>
        </div>
      </ResizableModal>
    </div>
  );
}

/** 还原清单弹窗（目录还原）：列出可还原文件（默认全选、可勾选），确认后只还原选中的——破坏性操作前置清单 */
export function RevertModal(props: {
  repoType: 'svn' | 'git';
  dirLabel: string;
  /** treeConflicted：树冲突项（本地已添加/修改，服务器同路径已删除或移动）——从「放弃本地添加」进来时要标出来 */
  items: { path: string; code: string; treeConflicted?: boolean }[];
  onConfirm: (paths: string[]) => void;
  onClose: () => void;
}) {
  const [checked, setChecked] = useState<Set<string>>(new Set(props.items.map((i) => i.path)));
  // 最终二次确认：M/C/D 还原不可恢复（丢弃本地修改）
  const [cfm, setCfm] = useState<{ msg: string } | null>(null);
  const allOn = checked.size === props.items.length;
  const toggle = (p: string) => {
    const nx = new Set(checked);
    if (nx.has(p)) nx.delete(p);
    else nx.add(p);
    setChecked(nx);
  };
  const toggleAll = () => setChecked(allOn ? new Set() : new Set(props.items.map((i) => i.path)));
  // 弹窗宽度自适应最长文件名（与提交面板同公式）
  const maxPathLen = props.items.reduce((m, i) => Math.max(m, i.path.length), 0);
  const autoWidth = pathAutoWidth(maxPathLen, 620, 1400);
  // 标题按清单状态语义化：全 A=取消添加 / 全 D=撤销删除 / 混合=还原
  const allA = props.items.length > 0 && props.items.every((i) => i.code === 'A');
  const allD = props.items.length > 0 && props.items.every((i) => i.code === 'D');
  // 含 M/C：真丢弃本地修改（红色警告）；仅 A/D/R 等调度撤销 → 不丢数据，中性提示
  const hasMod = props.items.some((i) => i.code === 'M' || i.code === 'C');
  // 树冲突项：弹窗只显示 code 的话会是一排干巴巴的 A，看不出"这几项提交会被拒、得先定夺"
  const tcItems = props.items.filter((i) => i.treeConflicted);
  const allTc = tcItems.length > 0 && tcItems.length === props.items.length;
  // 勾选项的同一判断：用户可能只勾了一部分，按钮文案要跟着勾选走
  const selItems = props.items.filter((i) => checked.has(i.path));
  const selAllTc = selItems.length > 0 && selItems.every((i) => i.treeConflicted);
  const actionName = allA ? '取消添加' : allD ? '撤销删除' : '还原';
  const titleName = allA
    ? allTc
      ? '接受服务器的删除（解决树冲突）'
      : '取消添加确认'
    : allD
      ? '撤销删除确认'
      : '还原确认';
  return (
    <div className="modal-mask">
      <ResizableModal width={autoWidth}>
        <h3>↩ {titleName} ({props.repoType.toUpperCase()})</h3>
        <div className="body" style={{ display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
          {/* 目录信息条：还原范围 + 勾选进度 */}
          <div className="help-note" style={{ alignItems: 'center', marginBottom: 10, padding: '8px 12px', flexShrink: 0 }}>
            <span style={{ flexShrink: 0 }}>📁</span>
            <span className="small" style={{ flex: 1, wordBreak: 'break-all' }}>{props.dirLabel}</span>
            <span className="small dim nowrap" style={{ flexShrink: 0 }}>
              已勾选 <b>{checked.size}</b>/{props.items.length}
            </span>
          </div>
          {/* 可还原文件列表：全选/取消全选 + 勾选 */}
          <div className="changed" style={{ flex: 1, minHeight: 80, maxHeight: 300, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 8, padding: 6, marginBottom: 12 }}>
            <label className="row" style={{ cursor: 'pointer', gap: 6, borderBottom: '1px solid var(--border2)', paddingBottom: 6, marginBottom: 4, flexShrink: 0 }}>
              <input type="checkbox" checked={allOn} onChange={toggleAll} />
              <span className="dim small">{allOn ? '取消全选' : '全选'}</span>
            </label>
            {props.items.map((it) => (
              <label key={it.path} className="changed-row" style={{ cursor: 'pointer' }} title={it.path}>
                <input type="checkbox" checked={checked.has(it.path)} onChange={() => toggle(it.path)} style={{ flexShrink: 0 }} />
                <span className={`act ${it.code}`}>{it.code}</span>
                {/* 树冲突项标一个中性 ⚠：弹窗里拿不到服务器状态（那要另查），只说"这项是冲突" */}
                {it.treeConflicted && (
                  <span className="code tc unknown" style={{ width: 18, height: 15, fontSize: 10 }} title="树冲突：本地与服务器对同一路径的操作冲突">
                    ⚠
                  </span>
                )}
                <span className="mono" style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {it.path}
                </span>
              </label>
            ))}
          </div>
          {/* 树冲突说明：放在通用提示上方——这几项是"提交必被拒"的根因，比"丢不丢数据"更该先说。
              措辞要点：放弃本地添加**会连本地文件一起删**（接受服务器那个删除），不是"只取消登记" */}
          {tcItems.length > 0 && (
            <div className="small" style={{ color: 'var(--err)', marginBottom: 8, flexShrink: 0, display: 'flex', alignItems: 'flex-start', gap: 6 }}>
              <IconWarn size={13} />
              <span>
                其中 <b>{tcItems.length}</b> 项是<b>树冲突</b>：服务器上同路径已删除或移动。
                {allA
                  ? '取消添加＝接受服务器的删除，本地文件会一并删除（与服务器保持一致，不可恢复），之后即可正常提交。'
                  : '还原后本地会与服务器保持一致（本地改动不可恢复），随后更新即可同步服务器的删除。'}
              </span>
            </div>
          )}
          {/* 通用说明：**有树冲突项时不显示**——这条说"磁盘文件保留、不丢失任何数据"，而冲突项那条
              （上面的红条）说的是"本地文件会一并删除"，两条并列自相矛盾（用户实报）。
              冲突场景下用户最需要知道的"会不会删文件"由红条说清了 */}
          {tcItems.length === 0 && (
            <div className="small" style={{ color: hasMod ? 'var(--err)' : 'var(--ok)', marginBottom: 10, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
              {hasMod ? <IconWarn size={13} /> : <IconOk size={13} />}
              <span>
                {hasMod
                  ? '还原会放弃这些文件的本地修改（不可恢复）。未版本化（?）与忽略/外部文件不在列表中。'
                  : '仅撤销版本库调度（取消添加 / 撤销删除），磁盘文件保留，不丢失任何数据。未版本化（?）与忽略/外部文件不在列表中。'}
              </span>
            </div>
          )}
        </div>
        <div className="foot">
          <button onClick={props.onClose}>取消</button>
          <button
            className="danger"
            disabled={checked.size === 0}
            onClick={() => {
              // 二次确认要说准：树冲突项会被**连本地文件一起删**（接受服务器的删除），
              // 跟普通 A"只取消登记、文件保留"是两码事——实测复现过，别混用同一句
              const selTc = selItems.filter((i) => i.treeConflicted).length;
              setCfm({
                msg:
                  selTc > 0
                    ? selTc === selItems.length
                      ? `服务器上这些路径已删除或移动，将连同这 ${checked.size} 项本地文件一起删除（与服务器保持一致，不可恢复）。确认？`
                      : `其中 ${selTc} 项在服务器上已删除或移动，会连同本地文件一起删除（不可恢复）；其余勾选项按一般还原处理。确认？`
                    : hasMod
                      ? `将放弃已勾选的 ${checked.size} 个文件的本地修改，不可恢复（A 文件变为未版本化，M/C 改动丢失）。确认${actionName}？`
                      : `将撤销已勾选的 ${checked.size} 项版本库调度（${allA ? '文件变回未版本化 ?，内容保留' : '文件从版本库找回，内容保留'}），不丢失任何数据。确认${actionName}？`,
              });
            }}
          >
            {/* 按钮文案跟菜单入口一致：用户是从「接受服务器的删除」点进来的，
                这里却说"取消添加"就是同一操作两个名字；底层确实是 svn revert，但用户视角的动作是删本地副本 */}
            ↩ {selAllTc ? `接受服务器的删除（${checked.size} 项）` : `${actionName}勾选的 ${checked.size} 项`}
          </button>
        </div>
      </ResizableModal>
      {/* 最终二次确认：M/C 还原丢弃修改不可恢复 */}
      {cfm && (
        <ConfirmModal
          title={
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: 'var(--warn)' }}>
              <IconWarn size={16} />
              {titleName}
            </span>
          }
          message={cfm.msg}
          danger
          confirmLabel={selAllTc ? '确认删除本地文件' : `确认${actionName}`}
          onConfirm={() => {
            const sel = [...checked];
            setCfm(null);
            props.onConfirm(sel);
          }}
          onCancel={() => setCfm(null)}
        />
      )}
    </div>
  );
}
