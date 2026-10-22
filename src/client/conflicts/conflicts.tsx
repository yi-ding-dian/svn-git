/** 三方冲突解决器：冲突文件列表 + 三栏合并编辑器（对方 / 结果 / 本地）+ 手动编辑 + 采用按钮 */
import React, { useCallback, useEffect, useState } from 'react';
import { get, post } from '../shared/api.js';
import { cmdOfRepo } from '../shared/cmd-preview.js';
import { highlightLine, langOf } from '../shared/highlight.js';
import { t, type I18nKey } from '../../shared/i18n/index.js';
import { IconFolder, IconOk } from '../ui/icons.js';
import { ConfirmModal } from '../ui/prompt.js';
import { ResizableModal } from '../shell/modal-shell.js';
import { Tooltip } from '../ui/tooltip.js';
import { MergeEditor } from './merge-editor.js';

interface Conflict {
  path: string;
  ours: string;
  theirs: string;
  base: string;
  work: string;
  /** 二进制文件（Word/PDF/图片等）：不读内容、不对比，仅可选用本地/对方版本 */
  binary?: boolean;
  /** 该侧在合并里没有这个文件（一侧删除/未添加的冲突）：采用这一侧 = 删除文件 */
  oursExists?: boolean;
  theirsExists?: boolean;
  /** 工作区文件的编码（**仅非 UTF-8 时有值**，后端探测）：手动编辑框据此挂警告条 ——
   *  非 UTF-8 是按"不是合法 UTF-8 就当 GB18030"猜的，猜错时（日文/繁体）保存会毁掉原编码 */
  encoding?: string;
}

/** 解决方式二次确认消息：模式 → key（只存 key，用时才 t() —— 顶层求值文案切语言不会跟着变） */
const CONFIRM_MSG = {
  ours: 'conflict.confirm.ours',
  theirs: 'conflict.confirm.theirs',
  manual: 'conflict.confirm.manual',
} as const;
type ConfirmMode = keyof typeof CONFIRM_MSG;

/** 采用"不存在的那一侧"= 删除文件，确认文案要说清楚，不能沿用"用你的版本覆盖" */
function confirmKeyOf(mode: ConfirmMode, cur: Conflict | null): I18nKey {
  if (mode === 'ours' && cur?.oursExists === false) return 'conflict.confirm.oursDelete';
  if (mode === 'theirs' && cur?.theirsExists === false) return 'conflict.confirm.theirsDelete';
  return CONFIRM_MSG[mode];
}

/** 结果栏内容（由 MergeEditor 每次变化回传）：保存手动编辑时原样写入工作区 */
interface MergeResult {
  text: string;
  /** 还没选边的冲突块数：>0 时不能保存（保存等于把冲突标记留在文件里） */
  unresolved: number;
  total: number;
}

export function ConflictResolverModal(props: { onClose: () => void; onResolved: () => void }) {
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [sel, setSel] = useState(0);
  const [msg, setMsg] = useState('');
  const [msgErr, setMsgErr] = useState(false);
  const [busy, setBusy] = useState(false);
  const [repoType, setRepoType] = useState<'git' | 'svn'>('git');
  useEffect(() => {
    void get
      .info()
      .then((r) => r.type && setRepoType(r.type))
      .catch(() => {});
  }, []);
  const [loading, setLoading] = useState(true);
  /** 三栏编辑器的当前结果（切文件时由 MergeEditor 重新回调） */
  const [result, setResult] = useState<MergeResult>({ text: '', unresolved: 0, total: 0 });

  const load = useCallback(() => {
    setLoading(true);
    get
      .conflicts()
      .then((r) => {
        setConflicts(r.conflicts);
        setSel((s) => Math.min(s, Math.max(0, r.conflicts.length - 1)));
      })
      .catch((e: Error) => {
        setMsg(e.message);
        setMsgErr(true);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 选中变化：清掉上一份文件的提示
  useEffect(() => {
    setMsg('');
    setMsgErr(false);
  }, [sel]);

  const cur = conflicts[sel] ?? null;
  const lang = cur ? langOf(cur.path) : undefined;

  // 放大/还原（对比区撑满）：冲突解决默认就是最大化打开 —— 三栏 + 长行，
  // 普通尺寸下每栏太窄（用户要求）
  const [expanded, setExpanded] = useState(true);

  // 二次确认：避免误覆盖丢失内容（工具风格弹窗）
  const [confirmMode, setConfirmMode] = useState<'ours' | 'theirs' | 'manual' | null>(null);
  const [confirmAbort, setConfirmAbort] = useState(false);
  const resolve = async (mode: 'ours' | 'theirs' | 'manual') => {
    if (!cur) return;
    setConfirmMode(mode);
  };
  const doResolve = async (mode: 'ours' | 'theirs' | 'manual') => {
    if (!cur) return;
    setConfirmMode(null);
    setBusy(true);
    try {
      const r = await post.resolveConflict(cur.path, mode, mode === 'manual' ? result.text : '');
      setMsg(r.message);
      setMsgErr(!r.ok);
      if (r.ok) {
        // 重新加载列表（已解决的文件应消失）
        const res = await get.conflicts();
        setConflicts(res.conflicts);
        setSel((s) => Math.min(s, Math.max(0, res.conflicts.length - 1)));
        if (res.conflicts.length === 0) {
          // 🎉 所有冲突已解决
          setMsg(t('conflict.allResolved'));
          props.onResolved();
        }
      }
    } catch (e) {
      setMsg((e as Error).message);
      setMsgErr(true);
    } finally {
      setBusy(false);
    }
  };

  /** 中止合并（仅 git）：放弃本次合并，工作区回到合并前；成功则交给 onResolved 关闭弹窗+全局刷新 */
  const doAbort = async () => {
    setBusy(true);
    setConfirmAbort(false);
    try {
      const r = await post.branch('merge-abort', '');
      if (!r.ok) {
        setMsg(r.message || t('conflict.abortFailed'));
        setMsgErr(true);
        return;
      }
      props.onResolved();
    } catch (e) {
      setMsg((e as Error).message);
      setMsgErr(true);
    } finally {
      setBusy(false);
    }
  };

  /** 保存手动编辑：结果栏还有未选择的冲突块时不允许（保存等于把标记留在文件里） */
  const canSave = !!cur && !cur.binary && result.unresolved === 0;

  return (
    <div className="modal-mask">
      <ResizableModal
        width={1180}
        maxed={expanded}
        maxedWidth="98vw"
        maxedHeight="96vh"
        onToggleMax={() => setExpanded(false)}
        onEsc={props.onClose}
      >
        <div className="row" style={{ alignItems: 'center' }}>
          {/* ⚠ 解决冲突（{n}） */}
          <h3 style={{ flex: 1, margin: 0, position: 'relative' }}>
            {t('conflict.title', { n: conflicts.length })}
            {/* 右上角 × 关闭（替代原来的底部「关闭」按钮） */}
            <button
              className="modal-x"
              title={t('common.close')}
              aria-label={t('common.close')}
              onClick={props.onClose}
              disabled={busy}
            >
              ✕
            </button>
          </h3>
        </div>
        {/* 放大时不再手算 calc(96vh - 90px)：标题栏+底部栏+边框实际约 105px，
            算少了会让 body 的最小高度把整个弹窗顶过 96vh，底部按钮被挤出弹窗外
            （用户实报：放大后「关闭」跑到弹窗下面）。交给 flex 分配剩余高度即可。 */}
        <div
          className="body"
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
            minHeight: expanded ? 0 : 460,
            flex: expanded ? 1 : undefined,
          }}
        >
          {/* 上：冲突文件列表（横排铺满窗口宽；最多显示 3 个，超出滚动，少于自动收缩高度） */}
          <div className="vcs-list" style={{ width: '100%', flexShrink: 0, maxHeight: 106 }}>
            {/* 加载中… */}
            {loading && <div className="dim" style={{ padding: 10 }}>{t('conflict.loading')}</div>}
            {/* 暂无冲突 */}
            {!loading && conflicts.length === 0 && <div className="dim" style={{ padding: 10 }}>{t('conflict.none')}</div>}
            {conflicts.map((c, i) => (
              <div
                key={c.path}
                className={`vcs-row ${i === sel ? 'selected' : ''}`}
                onClick={() => setSel(i)}
                title={c.path}
              >
                <span className="badge" style={{ background: 'var(--err)', flexShrink: 0 }}>C</span>
                <span className="mono small" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {c.path.split('/').pop()}
                </span>
              </div>
            ))}
          </div>
          {/* 下：三栏合并编辑 */}
          {cur && (
            <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
              <div className="row" style={{ marginBottom: 6 }}>
                <span className="mono small dim" style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {cur.path}
                </span>
                <span className="dim small" style={{ marginRight: 8 }}>{t('conflict.merge.editHint')}</span>
                <button className="mini" onClick={() => setExpanded((s) => !s)}>
                  {/* ⛶ 还原 / ⛶ 放大 */}
                  {expanded ? t('conflict.vs.restore') : t('conflict.vs.expand')}
                </button>
              </div>
              {/* 二进制冲突文件：不读内容不对比，提示改用本地/对方版本 */}
              {cur.binary ? (
                <div
                  className="dim"
                  style={{
                    flex: 1, minHeight: 200, display: 'flex', flexDirection: 'column',
                    alignItems: 'center', justifyContent: 'center', gap: 8,
                    border: '1px dashed var(--border)', borderRadius: 8, textAlign: 'center', padding: 16,
                  }}
                >
                  <div style={{ fontSize: 26 }}>📎</div>
                  <div>
                    {/* 该文件为  / 二进制文件 / （Word 文档 / PDF / 图片等）， / 不支持文本对比 */}
                    {t('conflict.bin.lead')}<b>{t('conflict.bin.kind')}</b>{t('conflict.bin.types')}<b>{t('conflict.bin.noTextDiff')}</b>
                  </div>
                  <div className="small" style={{ maxWidth: 420 }}>
                    {/* 请用「采用本地 / 采用对方」直接选择一个版本保留，或在外部程序中打开文件手动处理 */}
                    {t('conflict.bin.hint')}
                  </div>
                </div>
              ) : (
                <>
                  {cur.encoding && (
                    <div className="enc-warn">
                      {/* ⚠ 该文件不是 UTF-8（工具按 {enc} 猜测解码）： */}
                      {t('conflict.enc.warnA', { enc: cur.encoding.toUpperCase() })}{' '}
                      {/* 若它其实是日文/繁体等其他编码，保存会把原编码改坏。 */}
                      {t('conflict.enc.warnB')}{' '}
                      {/* 拿不准就用「采用本地 / 采用对方」，或先用外部程序改好再回来。 */}
                      {t('conflict.enc.warnC')}
                    </div>
                  )}
                  <div
                    style={{
                      flex: expanded ? 1 : undefined,
                      // 非放大：给三栏一个固定高度（原双栏是 230，三栏内容更多，给 320）
                      height: expanded ? undefined : 320,
                      minHeight: 0,
                      display: 'flex',
                    }}
                  >
                    <MergeEditor
                      key={cur.path}
                      ours={cur.ours}
                      theirs={cur.theirs}
                      work={cur.work}
                      lang={lang}
                      oursMissing={cur.oursExists === false}
                      theirsMissing={cur.theirsExists === false}
                      onResultChange={setResult}
                    />
                  </div>
                  {!expanded && cur.base && (
                    <details className="base-details">
                      <summary className="dim small">{t('conflict.tab.base')}</summary>
                      <pre className="diff" style={{ maxHeight: 140, overflow: 'auto', fontSize: 12 }}>
                        {cur.base.split('\n').map((l, i) => (
                          <div key={i} dangerouslySetInnerHTML={{ __html: highlightLine(l, lang) }} />
                        ))}
                      </pre>
                    </details>
                  )}
                </>
              )}
              <div className="row" style={{ marginTop: 10, gap: 6 }}>
                <button className="primary" disabled={busy} onClick={() => void resolve('ours')} title={`${cmdOfRepo(repoType, 'resolve_ours', { path: cur.path }) ?? ''}`}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                    <IconOk size={13} />
                    {/* 采用本地 */}
                    {t('conflict.takeOurs')}
                  </span>
                </button>
                {/* 采用对方 */}
                <button disabled={busy} onClick={() => void resolve('theirs')} title={`${cmdOfRepo(repoType, 'resolve_theirs', { path: cur.path }) ?? ''}`}>{t('conflict.takeTheirs')}</button>
                {/* 💾 保存并标记已解决 */}
                {!cur.binary && (
                  <Tooltip
                    content={`${result.unresolved > 0 ? t('conflict.merge.unresolved', { n: result.unresolved }) : cmdOfRepo(repoType, 'resolve_manual', { path: cur.path }) ?? ''}`}
                  >
                    <button
                      disabled={busy || !canSave}
                      onClick={() => void resolve('manual')}
                    >
                      {t('conflict.saveManual')}
                    </button>
                  </Tooltip>
                )}
                {repoType === 'git' && (
                  <Tooltip content={t('conflict.abortTip')}>
                    <button
                      className="mini"
                      disabled={busy}
                      onClick={() => setConfirmAbort(true)}
                      // 放弃本次合并（git merge --abort）：丢弃合并以来所有改动，工作区回到合并前。分支本身不受影响，可稍后再合并。
                    >
                      {/* ↩ 中止合并 */}
                      {t('conflict.abort')}
                    </button>
                  </Tooltip>
                )}
                <Tooltip content={t('conflict.revealTip')}>
                  <button
                    className="mini tool-btn"
                    // 打开冲突文件所在文件夹
                    onClick={() => {
                      if (!cur) return;
                      void post
                        .reveal(cur.path)
                        .catch((e: Error) => setMsg((e as Error).message));
                    }}
                  >
                    {/* 打开文件夹 */}
                    <IconFolder /> {t('conflict.reveal')}
                  </button>
                </Tooltip>
                <span className="grow" />
                {msg && (
                  <>
                    <span className={`small ${msgErr ? 'dim' : ''}`} style={{ color: msgErr ? 'var(--err)' : 'var(--ok)' }}>{msg}</span>
                    {/* ×：关掉这条提示 */}
                    <button className="mini" title={t('common.close')} onClick={() => setMsg('')}>
                      ×
                    </button>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      </ResizableModal>
      {/* 解决方式二次确认（工具风格） */}
      {confirmMode && (
        <ConfirmModal
          // ⚠ 确认解决冲突
          title={t('conflict.confirm.title')}
          message={t(confirmKeyOf(confirmMode, cur))}
          // 确认
          confirmLabel={t('ui.modal.confirm')}
          onConfirm={() => void doResolve(confirmMode)}
          onCancel={() => setConfirmMode(null)}
        />
      )}
      {/* 中止合并二次确认（仅 git）：与「采用本地」互斥——此为全局退出，放弃的是整个合并 */}
      {confirmAbort && (
        <ConfirmModal
          // ⚠ 确认中止合并
          title={t('conflict.abortConfirm.title')}
          // 将丢弃本次合并以来的所有改动（含已自动合并的文件），工作区回到合并前状态；分支本身不受影响，可稍后再合并。确认中止？
          message={t('conflict.abortConfirm.msg')}
          // 中止合并
          confirmLabel={t('conflict.abortConfirm.btn')}
          onConfirm={() => void doAbort()}
          onCancel={() => setConfirmAbort(false)}
        />
      )}
    </div>
  );
}
