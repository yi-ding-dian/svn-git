/** 右栏「就地编辑」：进入前拉最新工作区文本（兼做准入检查）、脏态、保存后重新对比。 */
import { useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import { get } from '../../shared/api.js';
import { t } from '../../../shared/i18n/index.js';
import type { InlineEditorHandle } from '../../shared/inline-editor.js';
import type { DiffTarget } from './diff-types.js';
import type { DiffBlock } from './use-diff-rows.js';

export function useDiffEdit(args: {
  target: DiffTarget | null;
  blocksRef: MutableRefObject<DiffBlock[]>;
  curBlockRef: MutableRefObject<number>;
  setError: (msg: string) => void;
  onToast?: (msg: string) => void;
}) {
  const { target, blocksRef, curBlockRef, setError, onToast } = args;

  /** 右栏「就地编辑」（diff 内直接改工作区文件）：编辑模式 + 编辑器句柄/脏态 +
   *  进入前拉到的最新文本（准入检查一并做掉）+ 保存后重对比的加载 key */
  const [editing, setEditing] = useState(false);
  const editorRef = useRef<InlineEditorHandle>(null);
  // editing 的镜像：goBlock 是 useCallback（闭包缓存），直读 editing 会拿旧值（进出编辑态
  // 不触发它重建）——"编辑态跳转走编辑器"的分支必须读 ref 才可靠
  const editingRef = useRef(false);
  editingRef.current = editing;
  const [editDirty, setEditDirty] = useState(false);
  const [editData, setEditData] = useState<{ text: string; eol: '\n' | '\r\n'; jumpLine?: number } | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  /** 进入就地编辑：先拉一次**最新工作区文本**（兼做准入——非 UTF-8/超限文件不给编辑），
   *  光标定位到当前差异块的右栏行号（与「下一个」定位同一套；纯删除块/占位行不定位） */
  const startEdit = () => {
    if (!target?.path) return;
    const b = blocksRef.current[curBlockRef.current];
    const jumpLine = b && b.right > 0 && b.right < Number.MAX_SAFE_INTEGER ? b.right : undefined;
    void get
      .cat(target.path, true)
      .then((r) => {
        if (!r.ok) {
          setError(r.error ?? t('fs.pv.readFailed'));
          return;
        }
        if (r.encoding) {
          // 该文件是 {enc} 编码，不支持内联编辑（怕改坏原编码）；请用外部程序打开
          setError(t('fs.pv.encNoEditFull', { enc: r.encoding }));
          return;
        }
        if (r.truncated) {
          // 文件过大（超过 5MB），未读取全文，不支持内联编辑；请用外部程序打开
          setError(t('fs.pv.tooLargeNoEdit'));
          return;
        }
        const text = r.output;
        setEditData({ text, eol: text.includes('\r\n') ? '\r\n' : '\n', jumpLine });
        setEditDirty(false);
        setEditing(true);
      })
      .catch((e: Error) => setError((e as Error).message));
  };

  /** 取消：丢弃修改，回到差异视图（不重载——工作区没被改过） */
  const cancelEdit = () => {
    setEditing(false);
    setEditData(null);
  };

  /** 换文件时退出编辑态：不退出的话新文件会拿旧文件的内容进编辑器 */
  const resetEdit = () => {
    setEditing(false);
    setEditData(null);
    setEditDirty(false);
  };

  /** 保存成功：退出编辑 + 重新对比（工作区文件与 diff 一起重载） */
  const onEditorSaved = (m: string) => {
    setEditing(false);
    setEditData(null);
    setReloadKey((k) => k + 1); // 保存后重新对比（工作区文件与 diff 一起重载）
    onToast?.(m);
  };

  return {
    editing,
    editorRef,
    editingRef,
    editDirty,
    setEditDirty,
    editData,
    reloadKey,
    setReloadKey,
    startEdit,
    cancelEdit,
    resetEdit,
    onEditorSaved,
    onEditorError: (m: string) => setError(m),
  };
}

export type DiffEditApi = ReturnType<typeof useDiffEdit>;
