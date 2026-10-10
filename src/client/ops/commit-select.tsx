/** 勾选式提交弹窗：列举变更文件可勾选 + 提交信息注释 */
import React, { useState } from 'react';
import { ResizableModal } from '../shell/modal-shell.js';
import { pathAutoWidth, useCheckedSet } from '../shared/utils.js';
import { cmdOfRepo } from '../shared/cmd-preview.js';
import { IconOk } from '../ui/icons.js';
import { t } from '../../shared/i18n/index.js';
import { StageHunksModal } from './stage-hunks.js';
import { CommitCommentBox } from './commit-comment.js';

/** 勾选式提交弹窗：列举变更文件可勾选 + 提交信息注释 */
export function CommitSelectModal(props: {
  repoType: string;
  dirLabel: string;
  items: { path: string; code: string; isDir: boolean }[];
  /** 恢复勾选（从差异视图/提交确认返回时保留）；缺省全选 */
  checked?: string[];
  /** 已部分暂存（hunk 级）的文件：提交时跳过整文件 add，只提交已选中的块 */
  stagedOnly?: string[];
  /** 恢复写好的提交注释：去看差异 / 去提交确认再返回时，注释不能丢（用户实报"返回发现注释清空了"） */
  msg?: string;
  /** 双击文件查看差异（path, 当前勾选快照, 已部分暂存列表, 当前注释） */
  onDiff?: (path: string, checked: string[], stagedOnly: string[], msg: string) => void;
  onClose: () => void;
  onConfirm: (paths: string[], message: string, stagedOnly: string[]) => void;
}) {
  const { checked, setChecked, toggle } = useCheckedSet(props.checked ?? props.items.map((i) => i.path));
  const [msg, setMsg] = useState(props.msg ?? '');
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
      // 请至少勾选一个文件
      setErr(t('ops.err.needFile'));
      return;
    }
    if (!msg.trim()) {
      // 请填写提交信息
      setErr(t('ops.commitSelect.err.noMessage'));
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
          {/* 📝 提交修改的文件 */}
          <span style={{ flex: 1 }}>{t('ops.commitSelect.title')} ({props.repoType.toUpperCase()})</span>
          <button className="mini" title={t(maxed ? 'ops.window.restore' : 'ops.window.maximize')} onClick={() => setMaxed((m) => !m)}>
            {maxed ? '🗗' : '⛶'}
          </button>
          {/* 关闭 */}
          <button className="mini danger" title={t('common.close')} onClick={props.onClose}>✕</button>
        </h3>
        <div className="body" style={{ display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
          <div className="dim small" style={{ marginBottom: 8, flexShrink: 0 }}>
            {/* ℹ️ 未版本化文件（?）不在列表中——需先在文件夹视图右键「添加到版本库」，再提交 */}
            {t('ops.commitSelect.hintUnversioned')}
            {props.repoType === 'svn' && (
              <>
                <br />
                {/* 🔗 外部引用（文件夹视图里带链环图标的目录）也不在列表中——它装的是另一个仓库路径的内容，提交它等于提交那个目录，请直接到那里提交 */}
                {t('ops.commitSelect.hintExternals')}
              </>
            )}
          </div>
          {/* 目录信息条：清晰展示提交范围与勾选进度 */}
          <div className="help-note" style={{ alignItems: 'center', marginBottom: 10, padding: '8px 12px', flexShrink: 0 }}>
            <span style={{ flexShrink: 0 }}>📁</span>
            {/* （仓库根） */}
            <span className="small" style={{ flex: 1, wordBreak: 'break-all' }}>{props.dirLabel || t('ops.repoRoot')}</span>
            <span className="small dim nowrap" style={{ flexShrink: 0 }}>
              {/* 已勾选 */}
              {t('ops.checkedLabel')} <b>{checked.size}</b>/{props.items.length}
              {/*  · 过滤显示 {n} 个（{codes}） */}
              {filterA || filterD ? t('ops.commitSelect.filtered', { n: visibleItems.length, codes: [filterA ? 'A' : '', filterD ? 'D' : ''].filter(Boolean).join('+') }) : ''}
            </span>
          </div>
          {/* 文件列表：弹窗高度变化时跟随伸缩，全部显示得下则不滚动 */}
          <div className="changed" style={{ flex: 1, minHeight: 80, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 8, padding: 6, marginBottom: 12 }}>
            {/* 全选/全不选 + 状态过滤开关（仅列表存在该状态时显示） */}
            <div className="row" style={{ gap: 12, borderBottom: '1px solid var(--border2)', paddingBottom: 6, marginBottom: 4 }}>
              <label className="row" style={{ cursor: 'pointer', gap: 6, flexShrink: 0 }}>
                <input type="checkbox" checked={allOn} onChange={toggleAllVisible} />
                <span className="dim small">{t(allOn ? 'ops.select.clear' : 'ops.select.all')}</span>
              </label>
              {hasA && (
                // 只显示已添加的文件（勾选自动限定为可见项）
                <label className="row" style={{ cursor: 'pointer', gap: 6, flexShrink: 0 }} title={t('ops.commitSelect.filterATip')}>
                  <input type="checkbox" checked={filterA} onChange={() => applyFilter(!filterA, filterD)} />
                  <span className="act A small">A</span>
                  {/* 添加 */}
                  <span className="dim small">{t('ops.commitSelect.filterA')}</span>
                </label>
              )}
              {hasD && (
                // 只显示已删除的文件（勾选自动限定为可见项）
                <label className="row" style={{ cursor: 'pointer', gap: 6, flexShrink: 0 }} title={t('ops.commitSelect.filterDTip')}>
                  <input type="checkbox" checked={filterD} onChange={() => applyFilter(filterA, !filterD)} />
                  <span className="act D small">D</span>
                  {/* 删除 */}
                  <span className="dim small">{t('ops.commitSelect.filterD')}</span>
                </label>
              )}
            </div>
            {visibleItems.map((it) => (
              <label
                key={it.path}
                className="changed-row"
                style={{ cursor: 'pointer' }}
                title={props.onDiff && !it.isDir
                  // 双击查看差异 /  · 右键选择部分改动
                  ? `${it.path}\n${t('ops.rowTip.diff')}${isGit ? t('ops.rowTip.stagePartial') : ''}`
                  : it.path}
                onDoubleClick={(ev) => {
                  ev.preventDefault();
                  if (props.onDiff && !it.isDir) props.onDiff(it.path, [...checked], stagedLocal, msg);
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
                  // 已部分暂存：提交时只提交选中的改动，未选中的留在工作区
                  <span className="small" style={{ flexShrink: 0, color: 'var(--accent)' }} title={t('ops.commitSelect.stagePartialTip')}>
                    {/* ✂ 部分 */}
                    {t('ops.commitSelect.stagePartial')}
                  </span>
                )}
              </label>
            ))}
            {/* 当前目录下没有变更文件 */}
            {props.items.length === 0 && <div className="dim" style={{ padding: '8px 4px' }}>{t('ops.commitSelect.noChanges')}</div>}
            {/* 没有匹配当前过滤的文件 */}
            {props.items.length > 0 && visibleItems.length === 0 && <div className="dim" style={{ padding: '8px 4px' }}>{t('ops.commitSelect.noMatch')}</div>}
          </div>
          <div style={{ marginTop: 2 }}>
            <CommitCommentBox
              value={msg}
              onChange={setMsg}
              onSubmit={submit}
              rows={3}
              // 简要说明本次提交内容，如：修复xxx问题、新增xxx功能…
              placeholder={t('ops.commit.msgPlaceholder')}
            />
          </div>
          {err && <div className="error mt8">{err}</div>}
        </div>
        <div className="foot">
          {/* 取消 */}
          <button onClick={props.onClose}>{t('common.cancel')}</button>
          <button
            className="primary"
            onClick={submit}
            disabled={props.items.length === 0}
            title={`${cmdOfRepo(props.repoType as 'git' | 'svn', 'commit', { msg: '…' }) ?? ''}`}
          >
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <IconOk size={13} />
              {/* 提交勾选的 {n} 个文件 */}
              {t('ops.commitSelect.confirm', { n: checked.size })}
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
