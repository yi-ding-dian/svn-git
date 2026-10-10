/** 工作区整理弹窗：git 清理未跟踪文件（CleanDialog）+ Stash 储藏（StashDialog）
 *  术语：本文件的"储藏"= git stash；"暂存"专指 git index（`git add`，见提交弹窗的「部分暂存」）——
 *  两套东西此前共用一个词，用户看到「Stash 暂存区」以为文件被收进了索引，故 2026-09-20 拆开 */
import React, { useEffect, useState } from 'react';
import { get, post, type StashItem } from '../shared/api.js';
import { ModalShell } from '../shell/modal-shell.js';
import { IconErr, IconHelp, IconStash } from '../ui/icons.js';
import { ConfirmModal } from '../ui/prompt.js';
import { cmdOfRepo } from '../shared/cmd-preview.js';
import { runAction } from '../shared/vcs-action.js';
import { ResultLine } from '../ui/result-line.js';
import { t } from '../../shared/i18n/index.js';
// ==================== git 清理未跟踪（预览+确认） ====================

export function CleanDialog(props: { onClose: () => void; onDone: () => void }) {
  const [files, setFiles] = useState<string[] | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState('');
  const [msgErr, setMsgErr] = useState(false);
  const [busy, setBusy] = useState(false);
  // 二次确认：防误触（清理不可恢复，与删除分支/丢弃 stash 一致）
  const [cfm, setCfm] = useState<{ title: string; msg: string; action: () => void } | null>(null);

  const load = () => {
    get
      .gitClean()
      .then((r) => {
        setFiles(r.files);
        setChecked(new Set(r.files)); // 默认全选（全量清理语义与现状一致）
      })
      .catch((e: Error) => {
        setMsg(e.message);
        setMsgErr(true);
      });
  };
  useEffect(load, []);

  /** 全选（全部文件）→ 不传 paths 走原全量命令；部分勾选 → 只清理选中的路径 */
  const doClean = () => {
    const sel = (files ?? []).filter((f) => checked.has(f));
    const paths = sel.length > 0 && sel.length < (files?.length ?? 0) ? sel : undefined;
    setBusy(true);
    void runAction(
      () => post.gitClean(paths),
      (m, err) => {
        setMsg(m);
        setMsgErr(Boolean(err));
      },
      props.onDone
    ).finally(() => setBusy(false));
  };

  return (
    <ModalShell
      // 清理未跟踪文件 (GIT)
      title={t('ops.clean.title')}
      onClose={props.onClose}
      width={520}
      foot={
        <>
          {/* 关闭 */}
          <button onClick={props.onClose}>{t('common.close')}</button>
          <button
            className="danger"
            disabled={busy || !files || files.length === 0 || checked.size === 0}
            onClick={() =>
              setCfm({
                // ⚠ 确认清理
                title: t('ops.clean.cfmTitle'),
                // 将删除已勾选的 {n} 个未跟踪文件，不可恢复。确认清理？
                msg: t('ops.clean.cfmMsg', { n: checked.size }),
                action: () => doClean(),
              })
            }
            // 删除已勾选的 {n} 个未跟踪文件（{sample}）
            title={t('ops.clean.btnTip', { n: checked.size, sample: `${[...checked].slice(0, 3).join(' ')}${checked.size > 3 ? ' …' : ''}` })}
          >
            {/* 清理中… / 确认清理 */}
            {busy ? t('ops.clean.busy') : t('ops.clean.confirm')}
          </button>
        </>
      }
    >
      <div className="dim small" style={{ marginBottom: 8, flexShrink: 0 }}>
        {/* 以下文件将被永久删除，不可恢复。清理的是工作区里存在、但没被 git 纳入版本管理的文件（未跟踪文件：新建未提交、编译产物、临时文件、被忽略文件等）： */}
        <div>{t('ops.clean.intro')}</div>
        <div style={{ color: 'var(--warn)', marginTop: 6 }}>
          {/* ⚠ 特别提醒：如果你有自己新建的、还没想好要不要提交的文件，请先确认好再执行清理！ */}
          {t('ops.clean.warn')}
        </div>
      </div>
      {/* 扫描中… */}
      {files === null && !msgErr && <div className="dim" style={{ padding: '10px 6px', flexShrink: 0 }}>{t('ops.clean.scanning')}</div>}
      {/* 空列表不套滚动框：套了的话 flex-basis 会把框撑到 260px 一大块空白（改前 maxHeight 下只一行高） */}
      {files && files.length === 0 && (
        // 没有未跟踪文件 🎉
        <div className="dim" style={{ padding: '10px 6px', flexShrink: 0 }}>{t('ops.clean.none')}</div>
      )}
      {/* 列表是主伸缩区：默认 260px，弹窗拉高时吃掉多余高度；矮窗口下保底 80px（约 3 行） */}
      {files && files.length > 0 && (
        <div className="changed" style={{ flex: '1 1 260px', minHeight: 80, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 8, padding: 6, marginBottom: 12 }}>
          <label className="row" style={{ cursor: 'pointer', gap: 6, borderBottom: '1px solid var(--border2)', paddingBottom: 6, marginBottom: 4, flexShrink: 0 }}>
            <input
              type="checkbox"
              checked={checked.size === files.length}
              onChange={() => setChecked(checked.size === files.length ? new Set() : new Set(files))}
            />
            <span className="dim small">{t(checked.size === files.length ? 'ops.select.clear' : 'ops.select.all')}</span>
            {/* 已勾选 {n}/{total} */}
            <span className="dim small" style={{ marginLeft: 'auto' }}>{t('ops.checkedCount', { n: checked.size, total: files.length })}</span>
          </label>
          {files.map((f) => (
            <label key={f} className="changed-row" style={{ cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={checked.has(f)}
                onChange={() => {
                  const nx = new Set(checked);
                  if (nx.has(f)) nx.delete(f);
                  else nx.add(f);
                  setChecked(nx);
                }}
                style={{ flexShrink: 0 }}
              />
              <span style={{ color: 'var(--err)', flexShrink: 0, display: 'inline-flex', alignItems: 'center' }}>
                <IconErr size={12} />
              </span>
              <span className="mono small" style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f}</span>
            </label>
          ))}
        </div>
      )}
      <div style={{ flexShrink: 0 }}>
        <ResultLine msg={msg} err={msgErr} />
      </div>
      {cfm && (
        <ConfirmModal
          title={cfm.title}
          message={cfm.msg}
          danger
          // 确认清理
          confirmLabel={t('ops.clean.confirm')}
          confirmCmd="git clean -fd"
          onConfirm={() => {
            const a = cfm.action;
            setCfm(null);
            a();
          }}
          onCancel={() => setCfm(null)}
        />
      )}
    </ModalShell>
  );
}

// ==================== Stash（git） ====================

export function StashDialog(props: { onClose: () => void; onChanged: () => void }) {
  const [items, setItems] = useState<StashItem[]>([]);
  const [message, setMessage] = useState('');
  const [msg, setMsg] = useState('');
  const [msgErr, setMsgErr] = useState(false);
  const [busy, setBusy] = useState(false);
  // 当前工作区改动（可储藏列表）：含未跟踪(?)；冲突(C)不可储藏（先解决），I/X 同理排除
  const [files, setFiles] = useState<{ path: string; code: string }[]>([]);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  // 工具风格二次确认
  const [cfm, setCfm] = useState<{ title: string; msg: string; action: () => void } | null>(null);

  const load = () => {
    get
      .stash()
      .then((r) => setItems(r.items))
      .catch((e: Error) => {
        setMsg(e.message);
        setMsgErr(true);
      });
    get
      .status()
      .then((r) => {
        const list = (r.items ?? []).filter((i) => i.code && i.code !== 'I' && i.code !== 'X' && i.code !== 'C');
        setFiles(list.map((i) => ({ path: i.path, code: i.code })));
        setChecked(new Set(list.map((i) => i.path))); // 默认全选
      })
      .catch(() => {});
  };
  useEffect(load, []);

  const act = (action: 'push' | 'pop' | 'drop', index = 0, msg2 = '', paths?: string[]) => {
    setBusy(true);
    void runAction(
      () => post.stash(action, msg2, index, paths),
      (m, err) => {
        setMsg(m);
        setMsgErr(Boolean(err));
      },
      () => {
        load();
        props.onChanged();
      }
    ).finally(() => setBusy(false));
  };

  /** 保存当前改动：全选 = 全量 stash（-u 收全部，与原行为一致）；取消部分勾选 = 部分 stash（-- paths 只收选中的） */
  const doPush = () => {
    const sel = files.filter((f) => checked.has(f.path)).map((f) => f.path);
    act('push', 0, message, sel.length > 0 && sel.length < files.length ? sel : undefined);
  };

  return (
    // Stash 储藏 (GIT)
    <ModalShell icon={<IconStash size={16} />} title={t('ops.stash.title')} onClose={props.onClose} width={580}>
      {/* 当前工作区改动：可勾选部分储藏（默认全选=全量收走，含未跟踪）。
          原 HelpNote 说明块已撤（它占约 100px，把列表挤得只剩 4 行）→ 说明挪到行尾问号的悬浮提示。
          问号**紧跟在文字右侧**（不是贴到行右缘）：它是这行文字的注解，离得近才看得出注解的是谁。
          不设 cursor:help——图标本身已是问号，光标再冒一个问号是同一个意思说两遍（用户反馈，2026-09-20） */}
      <div className="small dim" style={{ margin: '0 0 4px', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
        {/* 当前工作区改动（{n} 项，默认全选；取消勾选 = 只储藏选中的文件） */}
        <span>{t('ops.stash.listTitle', { n: files.length })}</span>
        {/* Stash 把当前未提交的改动临时收起来（含未跟踪文件），让工作区变干净——适合"先切分支/先做别的，稍后再回来继续"。\n点「保存当前改动」收起（可写说明）；列表中「恢复」= 把改动取回工作区，「丢弃」= 放弃这份改动。 */}
        <span style={{ display: 'inline-flex' }} title={t('ops.stash.help')}>
          <IconHelp size={15} />
        </span>
      </div>
      {/* 主伸缩区：默认 180px（约 6 行），弹窗拉高时吃掉全部多余高度；
          矮窗口下可压到 60px（保底 2 行）——再小不如把空间让给「保存说明 + 保存按钮」，列表反正能滚 */}
      <div className="vcs-list" style={{ flex: '1 1 180px', minHeight: 60 }}>
        {/* 工作区没有改动可储藏（先修改文件，再回来保存） */}
        {files.length === 0 && <div className="dim" style={{ padding: '10px 6px' }}>{t('ops.stash.noChanges')}</div>}
        {files.map((f) => (
          <div key={f.path} className="vcs-row" style={{ cursor: 'default' }}>
            <input
              type="checkbox"
              checked={checked.has(f.path)}
              onChange={(e) => {
                const nx = new Set(checked);
                if (e.target.checked) nx.add(f.path);
                else nx.delete(f.path);
                setChecked(nx);
              }}
            />
            <span className={`code ${f.code}`}>{f.code}</span>
            <span className="mono small" style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.path}</span>
          </div>
        ))}
      </div>
      <div className="row" style={{ margin: '12px 0', flexShrink: 0 }}>
        <input
          type="text"
          // 保存说明（可选）…
          placeholder={t('ops.stash.msgPlaceholder')}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') doPush();
          }}
          style={{ flex: 1 }}
        />
        <button
          className="primary"
          disabled={busy || files.length === 0 || checked.size === 0}
          onClick={doPush}
          title={`${cmdOfRepo('git', 'stash_push', { msg: message.trim() || '…' }) ?? ''}`}
        >
          {/* 📦 保存当前改动 */}
          {t('ops.stash.save')}
        </button>
      </div>
      {/* Stash 列表不参与拉伸（多余高度归上面的工作区列表），仍按内容自适应、上限 260px */}
      <div className="vcs-list" style={{ flex: '0 1 auto', maxHeight: 260 }}>
        {/* 暂无 Stash */}
        {items.length === 0 && <div className="dim" style={{ padding: '10px 6px' }}>{t('ops.stash.none')}</div>}
        {items.map((it) => (
          <div key={it.index} className="changed-row">
            <span style={{ color: 'var(--warn)' }}>📦</span>
            <span className="mono small" style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              stash@{it.index}: {it.label}
            </span>
            <button
              className="mini"
              disabled={busy}
              onClick={() =>
                setCfm({
                  // 恢复 Stash
                  title: t('ops.stash.popTitle'),
                  // 确认恢复 stash@{index}？改动将合入工作区（如产生冲突会保留该条 Stash 供处理）。
                  msg: t('ops.stash.popMsg', { index: it.index }),
                  action: () => act('pop', it.index),
                })
              }
              title={`${cmdOfRepo('git', 'stash_pop', { index: String(it.index) }) ?? ''}`}
            >
              {/* 恢复 */}
              {t('ops.stash.pop')}
            </button>
            <button
              className="mini danger"
              disabled={busy}
              onClick={() =>
                setCfm({
                  // 丢弃 Stash
                  title: t('ops.stash.dropTitle'),
                  // 确认丢弃 stash@{index}？改动将丢失。
                  msg: t('ops.stash.dropMsg', { index: it.index }),
                  action: () => act('drop', it.index),
                })
              }
            >
              {/* 丢弃 */}
              {t('ops.stash.drop')}
            </button>
          </div>
        ))}
      </div>
      <div style={{ flexShrink: 0 }}>
        <ResultLine msg={msg} err={msgErr} />
      </div>
      {/* 二次确认（工具风格） */}
      {cfm && (
        <ConfirmModal
          title={cfm.title}
          message={cfm.msg}
          // 确认
          confirmLabel={t('ui.modal.confirm')}
          onConfirm={() => {
            const a = cfm.action;
            setCfm(null);
            a();
          }}
          onCancel={() => setCfm(null)}
        />
      )}
    </ModalShell>
  );
}
