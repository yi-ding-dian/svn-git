/** 历史视图：提交列表 + 变更文件详情，点击查看 diff；未推送提交显示绿灯可修改注释/撤销 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { get, post, type LogEntry } from './api.js';
import { isBinaryFile } from './utils.js';
import { DiffRender } from './diff-render.js';
import { ContextMenu, type CtxMenuItem } from './context-menu.js';
import { ConfirmModal, InfoModal } from './modals.js';
import { ResizableModal } from './modal-shell.js';
import { ClickTip } from './ui.js';
import { cmdOfRepo } from './cmd-preview.js';

interface Props {
  path?: string;
  tick: number;
  /** 提交操作（修改注释/撤销提交）后通知父级刷新文件状态 */
  onChanged?: () => void;
  /** 返回按钮：退出历史视图回到文件浏览 */
  onBack: () => void;
}

export function HistoryView(props: Props) {
  const [logs, setLogs] = useState<LogEntry[] | null>(null);
  const [error, setError] = useState('');
  const [sel, setSel] = useState<LogEntry | null>(null);
  const [diffOf, setDiffOf] = useState<{ rev: string; prev?: string; path?: string } | null>(null);
  const [diffText, setDiffText] = useState('');
  const [diffLoading, setDiffLoading] = useState(false);
  /** 未推送提交（长 hash 列表，来自后端） */
  const [unpushed, setUnpushed] = useState<string[]>([]);
  /** 本地重载计数（修改注释/撤销提交后刷新） */
  const [reloadKey, setReloadKey] = useState(0);
  /** 操作成功提示 */
  const [notice, setNotice] = useState('');
  const [noticeErr, setNoticeErr] = useState(false);
  /** 右键菜单位置（仅 HEAD 未推送行可弹出） */
  const [menu, setMenu] = useState<{ x: number; y: number; index: number } | null>(null);
  /** 非 HEAD 未推送提交右键操作的说明弹窗 */
  const [infoTip, setInfoTip] = useState('');
  /** 修改注释弹窗：当前提交 */
  const [amendOf, setAmendOf] = useState<LogEntry | null>(null);
  const [amendMsg, setAmendMsg] = useState('');
  /** 撤销提交二次确认 */
  const [resetCfm, setResetCfm] = useState(false);
  const [busy, setBusy] = useState(false);
  /** 跟随鼠标提示（修改注释成功显示在点击处） */
  const [clickTip, setClickTip] = useState<{ x: number; y: number; msg: string } | null>(null);

  // 模糊过滤：按消息/作者/版本号（大小写不敏感），实时过滤提交列表
  const [filterQ, setFilterQ] = useState('');
  const visibleLogs = useMemo(() => {
    if (!logs) return [];
    const q = filterQ.trim().toLowerCase();
    if (!q) return logs;
    return logs.filter(
      (l) => l.msg.toLowerCase().includes(q) || l.author.toLowerCase().includes(q) || l.rev.toLowerCase().includes(q),
    );
  }, [logs, filterQ]);

  // 左右栏比例拖拽（列表 / 详情，与 diff 界面同一套逻辑）
  const [leftRatio, setLeftRatio] = useState(38);
  const dragState = useRef<{ startX: number; startRatio: number } | null>(null);
  const startDrag = (e: React.MouseEvent) => {
    dragState.current = { startX: e.clientX, startRatio: leftRatio };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };
  useEffect(() => {
    const move = (e: MouseEvent) => {
      if (!dragState.current) return;
      const delta = ((e.clientX - dragState.current.startX) / window.innerWidth) * 100;
      setLeftRatio(Math.min(80, Math.max(20, dragState.current.startRatio + delta)));
    };
    const up = () => {
      dragState.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLogs(null);
    setError('');
    setNotice('');
    setNoticeErr(false);
    setSel(null);
    setDiffOf(null);
    setUnpushed([]);
    get
      .log(props.path)
      .then((r) => {
        if (!cancelled) {
          setLogs(r.logs);
          setUnpushed(r.unpushed ?? []);
          if (r.logs.length > 0) setSel(r.logs[0]!);
        }
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [props.path, props.tick, reloadKey]);

  /** 未推送 hash 集合（短 7 位比对）+ 第一条未推送（HEAD）下标 */
  const unpushedSet = new Set(unpushed.map((h) => h.slice(0, 7)));
  const headIdx = logs ? logs.findIndex((l) => unpushedSet.has(l.rev)) : -1;

  /** 修改注释确认（HEAD 用 amend；其余未推送提交用 reword 重写注释，代码内容不变） */
  const doAmend = async (x: number, y: number) => {
    if (!amendOf) return;
    const msg = amendMsg.trim();
    if (!msg) return;
    setBusy(true);
    try {
      const isHead = logs && logs[headIdx] ? amendOf.rev === logs[headIdx]!.rev : false;
      const r = isHead ? await post.gitAmend(msg) : await post.gitReword(amendOf.rev, msg);
      if (r.ok) {
        setClickTip({ x, y, msg: r.message }); // 成功提示显示在鼠标点击处
        setNotice(''); // 清除上一次失败的红色 notice,避免成功与错误信息并存
        setNoticeErr(false);
        setAmendOf(null);
        setReloadKey((k) => k + 1);
        props.onChanged?.();
      } else {
        setNoticeErr(true);
        setNotice(r.message); // 失败信息显示在标题栏下方
      }
    } catch (e) {
      setNoticeErr(true);
      setNotice((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  /** 撤销提交确认 */
  const doReset = async () => {
    setBusy(true);
    try {
      const r = await post.gitReset();
      if (r.ok) {
        setNoticeErr(false);
        setNotice(r.message);
        setResetCfm(false);
        setReloadKey((k) => k + 1);
        props.onChanged?.();
      } else {
        setNoticeErr(true);
        setNotice(r.message);
      }
    } catch (e) {
      setNoticeErr(true);
      setNotice((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const showDiff = async (rev: string, prev: string | undefined, path?: string) => {
    setDiffOf({ rev, prev, path });
    setDiffLoading(true);
    try {
      // 二进制文件（Word/PDF/图片等）：文本对比无意义，直接提示
      if (path && isBinaryFile(path)) {
        setDiffText('该文件为二进制文件（Word 文档 / PDF / 图片等），不支持文本对比');
        return;
      }
      const r = await get.show(rev, path);
      setDiffText(r.output || r.error || '(无差异)');
    } catch (e) {
      setDiffText(`读取失败: ${(e as Error).message}`);
    } finally {
      setDiffLoading(false);
    }
  };

  return (
    <div style={{ display: 'flex', gap: 14, height: '100%', minHeight: 0 }}>
      <div style={{ width: `${leftRatio}%`, flex: '0 0 auto', display: 'flex', flexDirection: 'column', minWidth: 220 }}>
        <div className="row dim" style={{ marginBottom: 8, gap: 8 }}>
          历史: {props.path ? <span>{props.path}</span> : '全部提交'}
          {filterQ && <span className="small" style={{ color: 'var(--warn)' }}>{visibleLogs.length}/{logs?.length ?? 0}</span>}
          <span className="grow" />
          {/* 模糊过滤：按消息/作者/版本号实时过滤提交列表 */}
          <input
            type="text"
            placeholder="🔍 过滤提交（消息/作者/版本号）…"
            value={filterQ}
            onChange={(e) => setFilterQ(e.target.value)}
            style={{ width: 220, fontSize: 12 }}
          />
        </div>
        {error && <div className="error">{error}</div>}
        {notice && (
          <div className="small" style={{ color: noticeErr ? 'var(--err)' : 'var(--ok)', margin: '4px 0', wordBreak: 'break-all' }}>{notice}</div>
        )}
        {!logs && !error && <div className="loading">⏳ 读取提交记录…</div>}
        {logs && logs.length === 0 && !error && <div className="empty">暂无提交记录</div>}
        {logs && logs.length > 0 && (
          <div className="list" style={{ overflow: 'auto', flex: 1 }}>
            {visibleLogs.length === 0 && <div className="empty">没有匹配的提交</div>}
            {visibleLogs.map((l, i) => {
              const isUnpushed = unpushedSet.has(l.rev);
              // 只有第一条未推送（HEAD）可右键操作：amend/reset 只作用于最近一次提交
              const opable = isUnpushed && logs.indexOf(l) === headIdx;
              return (
                <div
                  key={l.rev}
                  className="list-item"
                  style={{ background: sel === l ? 'var(--panel2)' : undefined }}
                  onClick={() => {
                    setSel(l);
                    setDiffOf(null);
                  }}
                  onContextMenu={
                    isUnpushed
                      ? (e) => {
                          e.preventDefault();
                          setMenu({ x: e.clientX, y: e.clientY, index: logs.indexOf(l) });
                        }
                      : undefined
                  }
                >
                  <span className="rev">{l.rev}</span>
                  <span className="date">{l.date.slice(0, 16)}</span>
                  <span className="author">{l.author}</span>
                  <span className="msg">{l.msg}</span>
                  <span className="stat">{l.changed.length}</span>
                  {isUnpushed && (
                    <span className="unpushed" title={`未推送：本地领先远程 ${unpushed.length} 个提交`}>
                      <span className="unpushed-dot" />
                      {opable && <span className="unpushed-n">{unpushed.length}</span>}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
      <div className="sb-resizer" onMouseDown={startDrag} title="拖动调整左右栏宽度" />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {!sel && <div className="empty">选择提交查看详情</div>}
        {sel && !diffOf && (
          <>
            {/* 返回按钮行：与左栏标题栏同一水平线（marginBottom/高度一致，视觉同行） */}
            <div className="row" style={{ marginBottom: 8, height: 24, alignItems: 'center' }}>
              <button className="mini" onClick={props.onBack}>← 返回</button>
              <span className="grow" />
            </div>
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
      {/* 未推送提交右键菜单（仅第一条=HEAD 可操作；其余项提示先撤销前面的提交） */}
      {menu && logs && headIdx >= 0 && logs[menu.index] && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          mask
          items={[
            {
              icon: '✏️',
              label: '修改注释',
              cmd: menu.index === headIdx ? cmdOfRepo('git', 'amend', { msg: '…' }) : cmdOfRepo('git', 'reword'),
              action: () => {
                // 所有未推送提交都可改注释：HEAD 走 amend，其余走 reword（重写注释、代码不变）
                setAmendOf(logs[menu.index]!);
                setAmendMsg(logs[menu.index]!.msg);
              },
            },
            { sep: true },
            {
              icon: '↩',
              label: '撤销提交',
              danger: true,
              cmd: cmdOfRepo('git', 'reset_soft'),
              action: () => {
                if (menu.index === headIdx) setResetCfm(true);
                else setInfoTip(`仅支持撤销最近一次提交。此项之前还有 ${headIdx - menu.index} 个更新提交，需先逐一撤销前面的提交后，此项才可操作`);
              },
            },
          ]}
          onClose={() => setMenu(null)}
        />
      )}
      {/* 修改注释弹窗 */}
      {amendOf && (
        <div className="modal-mask">
          <ResizableModal width={480} minWidth={420}>
            <h3>✏️ 修改提交注释</h3>
            <div className="body">
              <div className="dim small" style={{ marginBottom: 6 }}>
                提交 {amendOf.rev} · {amendOf.date.slice(0, 16)} · {amendOf.author}
              </div>
              <textarea
                className="mono"
                rows={4}
                style={{ width: '100%' }}
                value={amendMsg}
                onChange={(e) => setAmendMsg(e.target.value)}
                autoFocus
              />
            </div>
            <div className="foot">
              <button onClick={() => setAmendOf(null)} disabled={busy}>取消</button>
              <button
                className="primary"
                disabled={busy || !amendMsg.trim()}
                onClick={(e) => void doAmend(e.clientX, e.clientY)}
                title={`命令行: ${cmdOfRepo('git', 'amend', { msg: amendMsg.trim() || '…' }) ?? ''}`}
              >
                确认修改
              </button>
            </div>
          </ResizableModal>
        </div>
      )}
      {/* 撤销提交二次确认 */}
      {resetCfm && logs && headIdx >= 0 && (
        <ConfirmModal
          title="↩ 撤销最近一次提交"
          message={
            <>
              将撤销最近一次提交 <span className="mono">{logs[headIdx]!.rev}</span>,工作区的修改会保留,
              可以重新勾选文件再次提交。确认撤销?
            </>
          }
          confirmLabel="撤销"
          danger
          onConfirm={() => void doReset()}
          onCancel={() => setResetCfm(false)}
        />
      )}
      {/* 非 HEAD 未推送提交操作说明弹窗 */}
      {infoTip && (
        <InfoModal title="⚠ 无法操作此项" message={infoTip} onClose={() => setInfoTip('')} />
      )}
      {/* 修改注释成功提示：跟随鼠标点击处 */}
      {clickTip && <ClickTip x={clickTip.x} y={clickTip.y} msg={clickTip.msg} onHide={() => setClickTip(null)} />}
    </div>
  );
}
