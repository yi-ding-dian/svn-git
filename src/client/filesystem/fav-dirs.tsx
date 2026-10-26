/** 常用文件夹弹窗：目录勾选树即管理界面。
 *  - 打开即列出仓库目录树，**默认全选一级目录**；展开可细选子目录（懒加载）
 *  - 勾选 = 加入常用并在确定后后台预加载（自身 + 一层子目录，产物目录自动跳过）
 *  - 取消勾选 / 取消祖先 = 移除（祖先被拆开时，已加载的子目录按显式勾选保留）
 *  - 预加载后进入这些目录命中缓存秒开（本机保存，仅当前电脑生效） */
import React, { useCallback, useRef, useState } from 'react';
import { t } from '../../shared/i18n/index.js';
import { get } from '../shared/api.js';
import { ModalShell } from '../shell/modal-shell.js';
import { IconOk } from '../ui/icons.js';
import { DirCheckTree } from '../ui/dir-check-tree.js';

export interface FavDir {
  path: string;
  name: string;
  addedAt: number;
}

export function FavDirsModal(props: {
  favs: FavDir[];
  preload: { done: number; total: number; cur: string; running: boolean } | null;
  /** 确定：保存勾选集合（仓库相对路径），调用方负责写 localStorage 并预加载 */
  onSave: (paths: string[]) => void;
  /** 全部重新预加载（作用域 = 已保存的常用文件夹） */
  onPreloadAll: () => void;
  onClose: () => void;
}) {
  /** 显式勾选集合（祖先覆盖子级，规则见 DirCheckTree） */
  const [checked, setChecked] = useState<Set<string>>(() => new Set(props.favs.map((f) => f.path)));
  /** 根级一级目录（树汇报；全选按钮用） */
  const [rootDirs, setRootDirs] = useState<string[]>([]);
  /** 默认全选只给「首次使用」（没有任何已保存常用）：
   *  已有常用时以保存的勾选为准，否则用户上次的细选会被每次打开覆盖成"全选一级"。 */
  const initedRef = useRef(props.favs.length > 0);
  const onRootDirs = (dirs: string[]) => {
    setRootDirs(dirs);
    if (!initedRef.current) {
      initedRef.current = true;
      // 默认全选一级目录（用户约定：打开即全选，自己取消不要的）
      setChecked(new Set(dirs));
    }
  };
  /** 全选态：全部一级目录都显式在集合里（拆开深层会自然回到非全选态） */
  const allRootChecked = rootDirs.length > 0 && rootDirs.every((d) => checked.has(d));
  /** 树的数据源：本地工作副本（相对路径），只取目录；失败返回 null。
   *  过滤版本库元数据（后端 /api/fs 会返回 .svn）：不该出现在勾选树里，更不该被存成常用。 */
  const loadDirs = useCallback(async (rel: string): Promise<string[] | null> => {
    try {
      const r = await get.fs(rel);
      return r.entries.filter((e) => e.isDir && e.name !== '.svn' && e.name !== '.git').map((e) => e.name);
    } catch {
      return null;
    }
  }, []);

  return (
    <ModalShell
      // ⭐ 常用文件夹
      title={t('fs.fav.title')}
      width={560}
      minWidth={480}
      onClose={props.onClose}
      foot={
        <>
          {/* 关闭 */}
          <button onClick={props.onClose}>{t('common.close')}</button>
          {props.favs.length > 0 && (
            <button className="primary" disabled={props.preload?.running} onClick={props.onPreloadAll}>
              {/* 预加载中… / 全部重新预加载 */}
              {props.preload?.running ? t('fs.fav.preloading') : t('fs.fav.preloadAll')}
            </button>
          )}
          <button className="primary" onClick={() => props.onSave([...checked])}>
            {/* 确定并预加载 */}
            {t('fs.fav.confirm')}
          </button>
        </>
      }
    >
      <div className="dim small" style={{ marginBottom: 8, lineHeight: 1.8 }}>
        {/* 勾选要预加载的文件夹（默认全选一级目录），取消勾选即移除；… */}
        {t('fs.fav.hint')}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <div className="dim small" style={{ flex: 1 }}>
          {/* 默认全选一级目录；展开可细选子目录 */}
          {t('fs.fav.defaultAll')}
        </div>
        {/* 全选/全不选（开关式）：全选态再点 = 清空；否则 = 全选（并重置深层取消） */}
        <button
          className="mini tool-btn"
          disabled={rootDirs.length === 0}
          onClick={() => setChecked(allRootChecked ? new Set() : new Set(rootDirs))}
          title={allRootChecked ? t('fs.fav.unselectAllTip') : t('fs.fav.selectAllTip')}
        >
          {allRootChecked ? t('fs.fav.unselectAll') : t('fs.fav.selectAll')}
        </button>
      </div>
      <DirCheckTree loadDirs={loadDirs} value={checked} onChange={setChecked} onRootDirs={onRootDirs} />
      {props.preload && (
        <div className="small" style={{ marginTop: 8, color: 'var(--accent)' }}>
          {props.preload.running
            // ⏳ 正在后台预加载：{done}/{total}（{cur}）
            ? t('fs.fav.progress', { done: props.preload.done, total: props.preload.total, cur: props.preload.cur })
            : (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <IconOk size={12} />
                {/* 后台预加载完成（{n} 个目录） */}
                {t('fs.fav.done', { n: props.preload.done })}
              </span>
            )}
        </div>
      )}
    </ModalShell>
  );
}
