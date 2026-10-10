/** 还原清单弹窗（目录还原）：列出可还原文件，确认后只还原选中的 —— 破坏性操作前置清单 */
import React, { useState } from 'react';
import { t } from '../../shared/i18n/index.js';
import { ResizableModal } from '../shell/modal-shell.js';
import { pathAutoWidth } from '../shared/utils.js';
import { IconOk, IconWarn } from '../ui/icons.js';
import { ConfirmModal } from '../ui/prompt.js';

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
  // 取消添加 / 撤销删除 / 还原
  const actionName = allA ? t('fs.revert.cancelAdd') : allD ? t('fs.revert.undoDelete') : t('fs.revert.revert');
  const titleName = allA
    ? allTc
      // 接受服务器的删除（解决树冲突）
      ? t('fs.tcFix.accept')
      // 取消添加确认
      : t('fs.revert.titleCancelAdd')
    : allD
      // 撤销删除确认
      ? t('fs.revert.titleUndoDelete')
      // 还原确认
      : t('fs.revert.titleRevert');
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
              {/* 已勾选 */}
              {t('fs.revert.checked')} <b>{checked.size}</b>/{props.items.length}
            </span>
          </div>
          {/* 可还原文件列表：全选/取消全选 + 勾选 */}
          <div className="changed" style={{ flex: 1, minHeight: 80, maxHeight: 300, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 8, padding: 6, marginBottom: 12 }}>
            <label className="row" style={{ cursor: 'pointer', gap: 6, borderBottom: '1px solid var(--border2)', paddingBottom: 6, marginBottom: 4, flexShrink: 0 }}>
              <input type="checkbox" checked={allOn} onChange={toggleAll} />
              {/* 取消全选 / 全选 */}
              <span className="dim small">{allOn ? t('fs.unselectAll') : t('fs.selectAll')}</span>
            </label>
            {props.items.map((it) => (
              <label key={it.path} className="changed-row" style={{ cursor: 'pointer' }} title={it.path}>
                <input type="checkbox" checked={checked.has(it.path)} onChange={() => toggle(it.path)} style={{ flexShrink: 0 }} />
                <span className={`act ${it.code}`}>{it.code}</span>
                {/* 树冲突项标一个中性 ⚠：弹窗里拿不到服务器状态（那要另查），只说"这项是冲突" */}
                {it.treeConflicted && (
                  // 树冲突：本地与服务器对同一路径的操作冲突
                  <span className="code tc unknown" style={{ width: 18, height: 15, fontSize: 10 }} title={t('fs.revert.tcBadgeTitle')}>
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
                {/* 其中 / 项是树冲突：服务器上同路径已删除或移动。 */}
                {t('fs.revert.tcIntroPre')} <b>{tcItems.length}</b>{t('fs.revert.tcIntroPost')}
                {allA
                  // 取消添加＝接受服务器的删除，本地文件会一并删除（与服务器保持一致，不可恢复），之后即可正常提交。
                  ? t('fs.revert.tcAcceptNote')
                  // 还原后本地会与服务器保持一致（本地改动不可恢复），随后更新即可同步服务器的删除。
                  : t('fs.revert.tcRevertNote')}
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
                  // 还原会放弃这些文件的本地修改（不可恢复）。未版本化（?）与忽略/外部文件不在列表中。
                  ? t('fs.revert.hasModNote')
                  // 仅撤销版本库调度（取消添加 / 撤销删除），磁盘文件保留，不丢失任何数据。未版本化（?）与忽略/外部文件不在列表中。
                  : t('fs.revert.noModNote')}
              </span>
            </div>
          )}
        </div>
        <div className="foot">
          {/* 取消 */}
          <button onClick={props.onClose}>{t('common.cancel')}</button>
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
                      // 服务器上这些路径已删除或移动，将连同这 {n} 项本地文件一起删除（与服务器保持一致，不可恢复）。确认？
                      ? t('fs.revert.confirmAllTc', { n: checked.size })
                      // 其中 {n} 项在服务器上已删除或移动，会连同本地文件一起删除（不可恢复）；其余勾选项按一般还原处理。确认？
                      : t('fs.revert.confirmSomeTc', { n: selTc })
                    : hasMod
                      // 将放弃已勾选的 {n} 个文件的本地修改，不可恢复（A 文件变为未版本化，M/C 改动丢失）。确认{action}？
                      ? t('fs.revert.confirmMod', { n: checked.size, action: actionName })
                      // 将撤销已勾选的 {n} 项版本库调度（{detail}），不丢失任何数据。确认{action}？
                      : t('fs.revert.confirmSched', {
                          n: checked.size,
                          // 文件变回未版本化 ?，内容保留 / 文件从版本库找回，内容保留
                          detail: allA ? t('fs.revert.schedDetailAdd') : t('fs.revert.schedDetailDelete'),
                          action: actionName,
                        }),
              });
            }}
          >
            {/* 按钮文案跟菜单入口一致：用户是从「接受服务器的删除」点进来的，
                这里却说"取消添加"就是同一操作两个名字；底层确实是 svn revert，但用户视角的动作是删本地副本 */}
            {/* 接受服务器的删除（{n} 项） / {action}勾选的 {n} 项 */}
            ↩ {selAllTc ? t('fs.revert.acceptSelected', { n: checked.size }) : t('fs.revert.actionSelected', { action: actionName, n: checked.size })}
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
          // 确认删除本地文件 / 确认{action}
          confirmLabel={selAllTc ? t('fs.revert.confirmDeleteLocal') : t('fs.revert.confirmAction', { action: actionName })}
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
