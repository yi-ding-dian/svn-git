/** 推送确认弹窗：未推送提交列表（含变更文件）+ 推送条件（远程落后/冲突风险）；未推送提交可右键修改注释/撤销 */
import React, { useEffect, useState } from 'react';
import { get, post, type LogEntry } from '../shared/api.js';
import { cmdOf } from '../shared/cmd-preview.js';
import { ResizableModal } from '../shell/modal-shell.js';
import { ContextMenu } from '../ui/context-menu.js';
import { ConfirmModal, InfoModal } from '../ui/prompt.js';
import { ClickTip } from '../ui/ui.js';
import { autoSizeForText } from '../shared/utils.js';
import { renderMarkdown } from '../shared/markdown.js';
import { t } from '../../shared/i18n/index.js';

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
  /** 撤销提交/修改注释成功（HEAD 变化）：通知父级刷新全局状态（角标/历史/状态列） */
  onReset?: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [unpushed, setUnpushed] = useState<LogEntry[]>([]);
  const [pf, setPf] = useState<Awaited<ReturnType<typeof get.preflight>> | null>(null);
  /** 展开查看变更文件的提交 rev */
  const [expanded, setExpanded] = useState<string | null>(null);
  // 未推送提交右键（仅第一条=HEAD 可操作：amend/reset 只作用于最近一次提交；其余项提示需先撤销前面的）
  const [menu, setMenu] = useState<{ x: number; y: number; index: number } | null>(null);
  const [amendOf, setAmendOf] = useState<LogEntry | null>(null);
  /** 修改注释弹窗的「预览」态（false = 编写）：预览用与历史详情同一套 md 渲染，所见即所得 */
  const [amendPreview, setAmendPreview] = useState(false);
  const [amendMsg, setAmendMsg] = useState('');
  /** 提交完整说明缓存（rev → 标题+正文）：悬浮提示用（列表接口只带 %s 标题） */
  const [fullMsgs, setFullMsgs] = useState<Record<string, string>>({});
  const [resetCfm, setResetCfm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [noticeErr, setNoticeErr] = useState(false);
  /** 修改注释弹窗自己的错误提示：父级的 notice 在弹窗下层，会被盖住看不见（表现为"点了确认没反应"） */
  const [amendNotice, setAmendNotice] = useState('');
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

  // 拉取未推送提交的完整说明（悬浮提示用）：不阻塞列表显示，失败静默降级为标题
  useEffect(() => {
    const revs = unpushed.map((l) => l.rev);
    if (revs.length === 0) return;
    let cancelled = false;
    post
      .commitMessages(revs)
      .then((r) => {
        if (!cancelled) setFullMsgs(r.messages);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [unpushed]);

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
        props.onReset?.();
      } else {
        setNotice(r.message);
        setNoticeErr(true);
        setAmendNotice(r.message); // 同时显示在注释弹窗内，不让用户以为"点了没反应"
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
        props.onReset?.();
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
        {/* 🔄 确认推送（{n} 个未推送提交） */}
        <h3>{t('ops.push.title', { n: unpushed.length })}</h3>
        <div className="body" style={{ maxHeight: '60vh', overflow: 'auto' }}>
          {/* 推送条件 */}
          <div style={{ marginBottom: 10 }}>
            {loading ? (
              // ⏳ 检查远程状态…
              <div className="dim small">{t('ops.push.checking')}</div>
            ) : pf ? (
              pf.behind > 0 ? (
                <div className="error" style={{ marginBottom: 0 }}>
                  {/* ⚠ 远程有 {n} 个新提交，当前分支落后。直接推送会被拒绝，建议先「更新」拉取合并。 */}
                  {t('ops.push.behind', { n: pf.behind })}
                </div>
              ) : (
                // ✅ 远程状态正常（无新提交），可以推送
                <div className="small" style={{ color: 'var(--ok)' }}>{t('ops.push.upToDate')}</div>
              )
            ) : (
              // 远程状态检查失败，可尝试直接推送
              <div className="dim small">{t('ops.push.checkFailed')}</div>
            )}
            {pf && pf.conflictRisk.length > 0 && (
              <div className="error" style={{ margin: '8px 0 0' }}>
                {/* ⚠ 以下文件双方都有修改，推送后拉取时可能冲突： */}
                {t('ops.push.conflictRisk')}
                {pf.conflictRisk.map((f) => f.path).join(t('common.listSep'))}
              </div>
            )}
          </div>
          {/* 未推送提交列表（类似历史界面，只含未推送） */}
          {/* 未推送提交（点击展开变更文件）： */}
          <div className="dim small" style={{ marginBottom: 6 }}>{t('ops.push.unpushedList')}</div>
          {/* 没有未推送的提交 */}
          {unpushed.length === 0 && !loading && <div className="dim" style={{ padding: 8 }}>{t('ops.push.noUnpushed')}</div>}
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
                  title={`${fullMsgs[l.rev] ?? l.msg}\n${t(i === 0 ? 'ops.push.tipHead' : 'ops.push.tipOther')}`}
                >
                  <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#22c55e', boxShadow: '0 0 5px rgba(34,197,94,.6)', flexShrink: 0 }} />
                  <span className="mono small" style={{ flexShrink: 0 }}>{l.rev}</span>
                  <span className="small dim" style={{ flexShrink: 0 }}>{l.date.slice(0, 16)}</span>
                  <span className="small" style={{ flexShrink: 0 }}>{l.author}</span>
                  <span
                    className="small"
                    style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                  >
                    {l.msg}
                  </span>
                  {/* {n} 文件 */}
                  <span className="small dim" style={{ flexShrink: 0 }}>{t('ops.push.filesCount', { n: l.changed.length })} {expanded === l.rev ? '▾' : '▸'}</span>
                </div>
                {expanded === l.rev && (
                  <div style={{ padding: '2px 10px 8px 44px', background: 'var(--panel2)' }}>
                    {/* 无文件变更 */}
                    {l.changed.length === 0 && <div className="dim small">{t('ops.push.noFileChanges')}</div>}
                    {l.changed.map((c) => {
                      const text = isTextFile(c.path);
                      return (
                        <div
                          key={c.path}
                          className="small mono"
                          style={{ padding: '1px 0', cursor: props.onDiff && text ? 'pointer' : 'default' }}
                          // 双击查看差异 / （图片/二进制文件不支持查看差异）
                          title={text ? `${c.path}\n${t('ops.rowTip.diff')}` : `${c.path}\n${t('ops.push.binaryTip')}`}
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
          {/* 取消 */}
          <button onClick={props.onCancel}>{t('common.cancel')}</button>
          <button className="primary" disabled={unpushed.length === 0} onClick={props.onConfirm} title={`${cmdOf('git push')}`}>
            {/* 确认推送（{n}） */}
            {t('ops.push.confirm', { n: unpushed.length })}
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
              // 修改注释
              label: t('ops.push.editMsg'),
              action: () => {
                // 所有未推送提交都可改注释：HEAD 走 amend，其余走 reword（重写注释、代码不变）
                const it = unpushed[menu.index]!;
                setAmendOf(it);
                setAmendPreview(false); // 每次打开都从「编写」进（预览态是上次留下的会莫名其妙）
                setAmendMsg(it.msg); // 先回显标题（列表只带标题），完整说明异步补上，避免此前只编辑标题导致正文被覆盖丢失
                setAmendNotice('');
                void get
                  .commitMessage(it.rev)
                  .then((r) => setAmendMsg(r.message))
                  .catch(() => {});
              },
            },
            { sep: true },
            {
              icon: '↩',
              // 撤销提交
              label: t('ops.push.undoCommit'),
              danger: true,
              action: () => {
                if (menu.index === 0) setResetCfm(true);
                // 仅支持撤销最近一次提交。此项之前还有 {n} 个更新提交，需先逐一撤销前面的提交后，此项才可操作
                else setInfoTip(t('ops.push.onlyHead', { n: menu.index }));
              },
            },
          ]}
          onClose={() => setMenu(null)}
        />
      )}
      {/* 修改注释弹窗 */}
      {amendOf && (
        <div className="modal-mask">
          <ResizableModal width={autoSizeForText(amendMsg).width} minWidth={420}>
            {/* ✏️ 修改提交注释 */}
            <h3>{t('ops.push.amendTitle')}</h3>
            <div className="body">
              <div className="dim small" style={{ marginBottom: 6 }}>
                {/* 提交 {rev} */}
                {t('ops.push.commitRev', { rev: amendOf.rev })} · {amendOf.date.slice(0, 16)} · {amendOf.author}
              </div>
              {/* 编写 / 预览 切换（GitHub 评论框同款）：预览用与历史详情完全相同的渲染（含 breaks），
                  所见即所得 —— 不然得提交完去历史里才知道渲染成什么样 */}
              <div className="row" style={{ gap: 6, marginBottom: 6, alignItems: 'center' }}>
                <button className={`mini ${amendPreview ? '' : 'primary'}`} onClick={() => setAmendPreview(false)}>
                  {/* 编写 */}
                  {t('common.write')}
                </button>
                <button className={`mini ${amendPreview ? 'primary' : ''}`} onClick={() => setAmendPreview(true)}>
                  {/* 预览 */}
                  {t('common.preview')}
                </button>
                <span className="dim small" style={{ marginLeft: 'auto' }}>
                  {/* 渲染效果（与历史里显示的一致） / 支持 Markdown：**加粗**、- 列表、`代码`… */}
                  {amendPreview ? t('ops.push.previewHint') : t('ops.push.mdHint')}
                </span>
              </div>
              {amendPreview ? (
                <div
                  className="md-render"
                  style={{
                    flex: 1, minHeight: 120, overflow: 'auto',
                    border: '1px solid var(--border)', borderRadius: 6, background: 'var(--panel2)',
                  }}
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(amendMsg, { breaks: true }) }}
                />
              ) : (
                <textarea
                  className="mono"
                  rows={autoSizeForText(amendMsg).rows}
                  // 完整提交说明（第一行为标题，空行后为正文），可直接编辑
                  title={t('ops.push.amendTextTip')}
                  style={{ width: '100%', flex: 1, minHeight: 120 }}
                  value={amendMsg}
                  onChange={(e) => setAmendMsg(e.target.value)}
                  autoFocus
                />
              )}
              {amendNotice && (
                <div className="error small" style={{ marginTop: 6, wordBreak: 'break-all' }}>
                  {amendNotice}
                </div>
              )}
            </div>
            <div className="foot">
              {/* 取消时一并清掉错误提示：否则会残留在下方，看起来像又是新报的错 */}
              {/* 取消 */}
              <button onClick={() => { setAmendOf(null); setNotice(''); setNoticeErr(false); }} disabled={busy}>{t('common.cancel')}</button>
              <button
                className="primary"
                disabled={busy || !amendMsg.trim()}
                onClick={(e) => void doAmend(e.clientX, e.clientY)}
              >
                {/* 确认修改 */}
                {t('ops.push.amendConfirm')}
              </button>
            </div>
          </ResizableModal>
        </div>
      )}
      {/* 撤销提交二次确认 */}
      {resetCfm && unpushed[0] && (
        <ConfirmModal
          // ↩ 撤销最近一次提交
          title={t('ops.push.resetTitle')}
          // 将撤销最近一次提交 {rev}。这次提交的改动会回到暂存区（提交之后新改的内容不受影响），可以重新勾选文件再次提交。确认撤销?
          message={t('ops.push.resetMsg', { rev: unpushed[0]!.rev })}
          // 撤销
          confirmLabel={t('ops.push.undo')}
          danger
          onConfirm={() => void doReset()}
          onCancel={() => setResetCfm(false)}
        />
      )}
      {/* 非 HEAD 提交操作说明弹窗 */}
      {infoTip && (
        // ⚠ 无法操作此项
        <InfoModal title={t('ops.push.cannotTitle')} message={infoTip} onClose={() => setInfoTip('')} />
      )}
      {/* 修改注释成功提示：跟随鼠标点击处 */}
      {clickTip && <ClickTip x={clickTip.x} y={clickTip.y} msg={clickTip.msg} onHide={() => setClickTip(null)} />}
    </div>
  );
}
