/** 推送确认弹窗：未推送提交列表（含变更文件）+ 推送条件（远程落后/冲突风险）；未推送提交可右键修改注释/撤销 */
import React, { useEffect, useState } from 'react';
import { get, post, type LogEntry } from './api.js';
import { cmdOf } from './cmd-preview.js';
import { ResizableModal } from './modal-shell.js';
import { ContextMenu } from './context-menu.js';
import { ConfirmModal, InfoModal } from './modals.js';
import { ClickTip } from './ui.js';

/** 二进制/图片等不支持差异查看的文件扩展名（双击查看差异前过滤） */
const BINARY_EXT = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'ico', 'avif',
  'pdf', 'zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz',
  'mp3', 'mp4', 'avi', 'mov', 'wav', 'flac', 'ogg', 'mkv',
  'exe', 'dll', 'so', 'bin', 'dat', 'iso',
  'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
]);

/** 是否为文本文件（可查看差异） */
function isTextFile(p: string): boolean {
  const ext = p.split('.').pop()?.toLowerCase() ?? '';
  return ext ? !BINARY_EXT.has(ext) : true; // 无扩展名视为文本
}

export function PushConfirmModal(props: {
  onConfirm: () => void;
  onCancel: () => void;
  /** 双击变更文件查看差异（path, 所属提交 rev；返回时恢复本弹窗） */
  onDiff?: (path: string, rev: string) => void;
}) {
  const [loading, setLoading] = useState(true);
  const [unpushed, setUnpushed] = useState<LogEntry[]>([]);
  const [pf, setPf] = useState<Awaited<ReturnType<typeof get.preflight>> | null>(null);
  /** 展开查看变更文件的提交 rev */
  const [expanded, setExpanded] = useState<string | null>(null);
  // 未推送提交右键（仅第一条=HEAD 可操作：amend/reset 只作用于最近一次提交；其余项提示需先撤销前面的）
  const [menu, setMenu] = useState<{ x: number; y: number; index: number } | null>(null);
  const [amendOf, setAmendOf] = useState<LogEntry | null>(null);
  const [amendMsg, setAmendMsg] = useState('');
  const [resetCfm, setResetCfm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [noticeErr, setNoticeErr] = useState(false);
  /** 非 HEAD 提交右键操作的说明弹窗 */
  const [infoTip, setInfoTip] = useState('');
  /** 跟随鼠标提示（修改注释成功显示在点击处） */
  const [clickTip, setClickTip] = useState<{ x: number; y: number; msg: string } | null>(null);

  /** 操作完成后刷新未推送列表 */
  const reload = () => {
    get
      .gitUnpushed()
      .then((r) => setUnpushed(r.unpushed))
      .catch(() => {});
  };

  /** 修改注释确认（HEAD 用 amend；其余未推送提交用 reword 重写注释，代码内容不变） */
  const doAmend = async (x: number, y: number) => {
    if (!amendOf) return;
    const msg = amendMsg.trim();
    if (!msg) return;
    setBusy(true);
    try {
      const isHead = amendOf.rev === unpushed[0]?.rev;
      const r = isHead ? await post.gitAmend(msg) : await post.gitReword(amendOf.rev, msg);
      if (r.ok) {
        setClickTip({ x, y, msg: r.message }); // 成功提示显示在鼠标点击处
        setAmendOf(null);
        reload();
      } else {
        setNotice(r.message);
        setNoticeErr(true);
      }
    } catch (e) {
      setNotice((e as Error).message);
      setNoticeErr(true);
    } finally {
      setBusy(false);
    }
  };

  /** 撤销提交确认 */
  const doReset = async () => {
    setBusy(true);
    try {
      const r = await post.gitReset();
      setNotice(r.message);
      setNoticeErr(!r.ok);
      if (r.ok) {
        setResetCfm(false);
        reload();
      }
    } catch (e) {
      setNotice((e as Error).message);
      setNoticeErr(true);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    // 未推送提交列表 + 推送条件（落后/冲突检查；preflight 内部有超时，失败不阻断）
    get
      .gitUnpushed()
      .then((r) => {
        if (!cancelled) setUnpushed(r.unpushed);
      })
      .catch(() => {});
    get
      .preflight()
      .then((r) => {
        if (!cancelled) setPf(r);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="modal-mask">
      <ResizableModal width={680} minWidth={520}>
        <h3>🔄 确认推送（{unpushed.length} 个未推送提交）</h3>
        <div className="body" style={{ maxHeight: '60vh', overflow: 'auto' }}>
          {/* 推送条件 */}
          <div style={{ marginBottom: 10 }}>
            {loading ? (
              <div className="dim small">⏳ 检查远程状态…</div>
            ) : pf ? (
              pf.behind > 0 ? (
                <div className="error" style={{ marginBottom: 0 }}>
                  ⚠ 远程有 <b>{pf.behind}</b> 个新提交，当前分支落后。直接推送会被拒绝，建议先「更新」拉取合并。
                </div>
              ) : (
                <div className="small" style={{ color: 'var(--ok)' }}>✅ 远程状态正常（无新提交），可以推送</div>
              )
            ) : (
              <div className="dim small">远程状态检查失败，可尝试直接推送</div>
            )}
            {pf && pf.conflictRisk.length > 0 && (
              <div className="error" style={{ margin: '8px 0 0' }}>
                ⚠ 以下文件双方都有修改，推送后拉取时可能冲突：
                {pf.conflictRisk.map((f) => f.path).join('、')}
              </div>
            )}
          </div>
          {/* 未推送提交列表（类似历史界面，只含未推送） */}
          <div className="dim small" style={{ marginBottom: 6 }}>未推送提交（点击展开变更文件）：</div>
          {unpushed.length === 0 && !loading && <div className="dim" style={{ padding: 8 }}>没有未推送的提交</div>}
          <div className="vcs-list" style={{ border: '1px solid var(--border)', borderRadius: 8 }}>
            {unpushed.map((l, i) => (
              <div key={l.rev}>
                <div
                  className="vcs-row"
                  style={{ cursor: 'pointer' }}
                  onClick={() => setExpanded(expanded === l.rev ? null : l.rev)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setMenu({ x: e.clientX, y: e.clientY, index: i });
                  }}
                  title={i === 0 ? `${l.msg}\n（未推送的最新提交，右键可修改注释/撤销）` : `${l.msg}\n（右键菜单仅对最近一次提交生效）`}
                >
                  <span className="badge" style={{ background: '#22c55e', flexShrink: 0 }}>🟢</span>
                  <span className="mono small" style={{ flexShrink: 0 }}>{l.rev}</span>
                  <span className="small dim" style={{ flexShrink: 0 }}>{l.date.slice(0, 16)}</span>
                  <span className="small" style={{ flexShrink: 0 }}>{l.author}</span>
                  <span
                    className="small"
                    style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                  >
                    {l.msg}
                  </span>
                  <span className="small dim" style={{ flexShrink: 0 }}>{l.changed.length} 文件 {expanded === l.rev ? '▾' : '▸'}</span>
                </div>
                {expanded === l.rev && (
                  <div style={{ padding: '2px 10px 8px 44px', background: 'var(--panel2)' }}>
                    {l.changed.length === 0 && <div className="dim small">无文件变更</div>}
                    {l.changed.map((c) => {
                      const text = isTextFile(c.path);
                      return (
                        <div
                          key={c.path}
                          className="small mono"
                          style={{ padding: '1px 0', cursor: props.onDiff && text ? 'pointer' : 'default' }}
                          title={text ? `${c.path}\n双击查看差异` : `${c.path}\n（图片/二进制文件不支持查看差异）`}
                          onDoubleClick={(ev) => {
                            ev.preventDefault();
                            if (props.onDiff && text) props.onDiff(c.path, l.rev);
                          }}
                        >
                          <span className={`act ${c.action}`} style={{ marginRight: 6 }}>{c.action}</span>
                          <span className="dim">{c.path}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ))}
          </div>
          {notice && (
            <div className={noticeErr ? 'error' : 'small'} style={{ marginTop: 8 }}>{notice}</div>
          )}
        </div>
        <div className="foot">
          <button onClick={props.onCancel}>取消</button>
          <button className="primary" disabled={unpushed.length === 0} onClick={props.onConfirm} title={`命令行: ${cmdOf('git push')}`}>
            确认推送（{unpushed.length}）
          </button>
        </div>
      </ResizableModal>
      {/* 未推送提交右键菜单（仅第一条=HEAD 可操作；其余项提示先撤销前面的提交） */}
      {menu && unpushed[menu.index] && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          mask
          items={[
            {
              icon: '✏️',
              label: '修改注释',
              action: () => {
                // 所有未推送提交都可改注释：HEAD 走 amend，其余走 reword（重写注释、代码不变）
                setAmendOf(unpushed[menu.index]!);
                setAmendMsg(unpushed[menu.index]!.msg);
              },
            },
            { sep: true },
            {
              icon: '↩',
              label: '撤销提交',
              danger: true,
              action: () => {
                if (menu.index === 0) setResetCfm(true);
                else setInfoTip(`仅支持撤销最近一次提交。此项之前还有 ${menu.index} 个更新提交，需先逐一撤销前面的提交后，此项才可操作`);
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
              >
                确认修改
              </button>
            </div>
          </ResizableModal>
        </div>
      )}
      {/* 撤销提交二次确认 */}
      {resetCfm && unpushed[0] && (
        <ConfirmModal
          title="↩ 撤销最近一次提交"
          message={
            <>
              将撤销最近一次提交 <span className="mono">{unpushed[0]!.rev}</span>,工作区的修改会保留,
              可以重新勾选文件再次提交。确认撤销?
            </>
          }
          confirmLabel="撤销"
          danger
          onConfirm={() => void doReset()}
          onCancel={() => setResetCfm(false)}
        />
      )}
      {/* 非 HEAD 提交操作说明弹窗 */}
      {infoTip && (
        <InfoModal title="⚠ 无法操作此项" message={infoTip} onClose={() => setInfoTip('')} />
      )}
      {/* 修改注释成功提示：跟随鼠标点击处 */}
      {clickTip && <ClickTip x={clickTip.x} y={clickTip.y} msg={clickTip.msg} onHide={() => setClickTip(null)} />}
    </div>
  );
}
