/** 还原到指定版本的确认框：把工作区里的某个文件（或某个目录）改回那次提交时的内容。
 *
 *  只写工作区，不产生提交、不改历史——后悔了用「还原」退回即可，不会造成版本混乱。
 *  历史详情（右侧变更文件列表 / 提交列表右键）与「文件变动详情」弹窗共用这一份，
 *  调用方只需给出 path：传文件就只还原这个文件，同一次提交的其它文件不受影响。
 *
 *  打开时先做只读预检：内容已经和目标版本一致 → 直接拦下（不再做无意义的写入）；
 *  有差异 → 显示行数/文件数摘要，并可一键跳到完整差异视图。 */
import React, { useEffect, useRef, useState } from 'react';
import { post } from '../shared/api.js';
import type { RestorePreview, VcsResult } from '../shared/api.js';
import { t } from '../../shared/i18n/index.js';
import { ConfirmModal, InfoModal } from '../ui/prompt.js';
import { cmdOfRepo } from '../shared/cmd-preview.js';

export interface RestoreVersionTarget {
  /** 目标提交（git 短 hash / svn 版本号） */
  rev: string;
  /** 还原对象：文件则只动这一个文件；目录则还原整棵子树 */
  path: string;
  /** 同一次提交里的其它文件数：>0 时确认框说明它们不受影响 */
  otherCount?: number;
  /** 还原对象是目录（svn 目录项）：确认框说明会反向合并整棵子树、可能冲突 */
  kind?: 'file' | 'dir';
}

/** 预检摘要：文件给增删行数，目录给修改/找回/删除的文件数 */
function previewText(p: RestorePreview): string {
  if (p.kind === 'dir') {
    const f = p.files ?? { modify: 0, restore: 0, remove: 0 };
    const n = f.modify + f.restore + f.remove;
    // 与当前工作区相比：将改动 {n} 个文件（修改 {m}、恢复 {r}、删除 {d}）
    return t('hist.previewDir', { n, m: f.modify, r: f.restore, d: f.remove });
  }
  if (p.binary) {
    // 二进制文件无法逐行比较，将直接用该版本内容覆盖。
    return t('hist.previewBinary');
  }
  const added = p.added ?? 0;
  const removed = p.removed ?? 0;
  if (added + removed === 0) {
    // 缺失文件已经没有工作区内容可比（SVN 路径被删后预检只给 missing）；由缺失提示单独说明
    if (p.missing) return '';
    // 与当前工作区相比：内容没有行差异（可能有属性变化）。
    return t('hist.previewPropOnly');
  }
  // 与当前工作区相比：改动 {n} 行（+{added} / −{removed}）
  return t('hist.previewDiffLines', { n: added + removed, added, removed });
}

export function RestoreVersionConfirm(props: {
  target: RestoreVersionTarget;
  repoType?: 'svn' | 'git';
  /** 跳到完整差异视图（目标版本 vs 当前工作区）；不传则不显示按钮 */
  onOpenDiff?: (path: string, rev: string) => void;
  onDone: (result: VcsResult) => void;
  onCancel: () => void;
}) {
  /** 写入中：防快速连点重复发请求（写同一个文件两次） */
  const busy = useRef(false);
  /** 组件自身的进行中状态只用于按钮置灰文案，组件在请求返回后由调用方卸载 */
  const [pending, setPending] = useState(false);
  /** 只读预检结果：null = 请求中 */
  const [preview, setPreview] = useState<(VcsResult & { preview?: RestorePreview }) | null>(null);
  const { rev, path, otherCount = 0, kind } = props.target;
  const isDir = kind === 'dir';
  const shortRev = rev.slice(0, 7);

  // 打开即预检：内容一致就拦下，不弹还原框（避免"点了还原但其实什么都没变"）
  useEffect(() => {
    let alive = true;
    post
      .restorePreview(path, rev)
      .then((r) => {
        if (alive) setPreview(r);
      })
      .catch((e: unknown) => {
        if (alive) setPreview({ ok: false, message: (e as Error).message });
      });
    return () => {
      alive = false;
    };
  }, [path, rev]);

  const doRestore = async () => {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    let result: VcsResult;
    try {
      result = await post.restoreVersion(path, rev);
    } catch (e) {
      result = { ok: false, message: (e as Error).message };
    }
    busy.current = false;
    setPending(false);
    props.onDone(result);
  };

  // 预检进行中：先给个轻量等待态（本地命令，一般几十毫秒）
  if (!preview) {
    return (
      <ConfirmModal
        title={t('hist.restoreTitle')}
        message={<div>{t('hist.previewLoading')}</div>}
        confirmLabel={t('hist.previewChecking')}
        onConfirm={() => {}}
        onCancel={props.onCancel}
      />
    );
  }

  // 内容已经和目标版本完全一致：不做任何写入
  if (preview.ok && preview.preview?.same) {
    return (
      <InfoModal
        title={t('hist.noRestoreNeededTitle')}
        message={t('hist.noRestoreNeeded', { path, rev: shortRev })}
        onClose={props.onCancel}
      />
    );
  }

  const info = preview.preview;
  const summaryText = info ? previewText(info) : '';
  // 缺失文件没有右栏可对比（file-versions 读不到工作区文件），不显示差异按钮
  const canOpenDiff = Boolean(props.onOpenDiff) && !isDir && Boolean(info) && !info?.binary && !info?.same && !info?.missing;

  return (
    <ConfirmModal
      // ↩ 还原到指定版本
      title={t('hist.restoreTitle')}
      message={
        <>
          {/* 将把  /  还原到提交  /  的版本内容：覆盖当前工作区。 */}
          {t('hist.restoreMsgA')}<b>{path}</b>{t('hist.restoreMsgB')}<span className="mono">{shortRev}</span>{t('hist.restoreMsgC')}
          {/* 与当前工作区的差异摘要（预检失败时说明原因，但不阻止还原） */}
          {summaryText && (
            <div style={{ marginTop: 8 }}>
              <div className="small" style={{ color: 'var(--accent)' }}>{summaryText}</div>
            </div>
          )}
          {info?.missing && (
            <div className="small dim" style={{ marginTop: 4 }}>
              {/* 文件当前在工作区里缺失，还原会把它找回来。 */}
              {t('hist.previewMissing')}
            </div>
          )}
          {!preview.ok && (
            <div className="small dim" style={{ marginTop: 8 }}>
              {/* 无法检测与当前工作区的差异（{msg}），仍可继续还原。 */}
              {t('hist.previewFailed', { msg: preview.message })}
            </div>
          )}
          {isDir && (
            <div className="small dim" style={{ marginTop: 8 }}>
              {/* 这是一个目录：会反向合并它下面的所有内容，可能产生冲突（未跟踪文件不动） */}
              {t('hist.restoreDirNote')}
            </div>
          )}
          {!isDir && otherCount > 0 && (
            <div className="small dim" style={{ marginTop: 8 }}>
              {/* 列表里的另外 {n} 个文件不受影响 */}
              {t('hist.restoreOtherFiles', { n: otherCount })}
            </div>
          )}
          <div className="small dim" style={{ marginTop: 4 }}>
            {/* 之后对这些内容的改动也会被覆盖；提交前可在工作区差异里核对 */}
            {t('hist.restoreLaterOverwritten')}
          </div>
          <div style={{ marginTop: 8 }}>
            {/* 还原后为一次本地修改，可再次提交。 */}
            {t('hist.restoreMsgTail')}
          </div>
        </>
      }
      // 还原此版本
      confirmLabel={pending ? t('hist.restoring') : t('hist.restoreThis')}
      onConfirm={() => void doRestore()}
      onCancel={props.onCancel}
      // 查看完整差异（目标版本 vs 当前工作区）：先关确认框再切视图
      secondaryLabel={canOpenDiff ? t('hist.viewRestoreDiff') : undefined}
      onSecondary={canOpenDiff ? () => {
        props.onCancel();
        props.onOpenDiff?.(path, rev);
      } : undefined}
      // 目录还原的实际命令与文件不同（svn 反向合并 / git checkout + 删除之后新增的文件）
      confirmCmd={cmdOfRepo(props.repoType ?? 'git', isDir ? 'restore_rev_dir' : 'restore_rev', { rev, path })}
    />
  );
}
