/** FsView 的框选 + 拖放：从 index.tsx 原样抽出。
 *
 *  - 浏览模式拖拽框选：起点/矩形 ref（直接操作 DOM，避免 mousemove 高频 re-render）+ mouseup 丢失兜底
 *  - 应用内拖拽移动：拖起条目记录、整批淡化、自定义「N 项」拖拽图像
 *  - 拖入上传（外部文件复制进来）= 现有 useDropUpload；冲突策略弹窗状态也在这里
 *  - 拖到窗口边缘丢回收站手势 = 现有 useDragToTrash
 *
 *  ⚠ 框选的 mouseup 兜底保留：松手移出窗口/松开在菜单遮罩上时，任何 position 都要清掉拖拽状态并隐藏矩形。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type React from 'react';
import type { FsEntry } from '../shared/api.js';
import { t } from '../../shared/i18n/index.js';
import { useDropUpload, moveItemsTo, MOVE_MIME, type ConflictChoice, type ClipItem } from './use-file-transfer.js';
import { useDragToTrash } from './use-drag-to-trash.js';
import type { Mode, VisibleRow } from './utils.js';

export function useFsDrag(opts: {
  dir: string;
  mode: Mode;
  repoType: 'svn' | 'git';
  selected: Set<string>;
  rowsRef: React.MutableRefObject<(VisibleRow | FsEntry)[]>;
  rowRel: (r: VisibleRow | FsEntry) => string;
  setTip: (v: null) => void;
  load: (dir: string, force: boolean, quiet?: boolean) => Promise<void> | void;
  invalidateCache: () => void;
  reloadOpenNodes: () => void;
  setPendingLocate: (v: { rel: string; at: number; only: string[] } | null) => void;
  onToast: (m: string, err?: boolean) => void;
  onTrash: (rels: string[]) => void;
}) {
  const { dir, mode, repoType, selected, rowsRef, rowRel, setTip, load, invalidateCache, reloadOpenNodes, setPendingLocate, onToast, onTrash } = opts;

  // 浏览模式拖拽框选：拖拽起点 / 框选矩形（ref 直接操作 DOM，避免 mousemove 高频 re-render 卡顿） / 本次是否发生过拖动（供 click 判断，避免空白点击清空误伤框选结果）
  const selBoxRef = useRef<HTMLDivElement | null>(null);
  const selDragRef = useRef<{ startX: number; startY: number } | null>(null);
  // 框选 mouseup 丢失兜底（松手移出窗口/松开在菜单遮罩上等）：任何 position 清除拖拽状态并隐藏矩形，
  // 避免"没按左键移动鼠标也画出框选"；grid 内正常松开由 grid 的 onMouseUp 先行处理，此兜底无副作用
  useEffect(() => {
    const onWinUp = () => {
      if (selDragRef.current) {
        selDragRef.current = null;
        if (selBoxRef.current) selBoxRef.current.style.display = 'none';
      }
    };
    window.addEventListener('mouseup', onWinUp);
    return () => window.removeEventListener('mouseup', onWinUp);
  }, []);
  const lastWasDragRef = useRef(false);

  /** 拖入上传：落点 = 文件区（当前目录）或文件夹行/格子（该文件夹）。
   *  冲突时弹窗问策略：用 promise 把弹窗结果交回给 hook（弹窗状态只服务本视图，不进全局 modal-host） */
  const [conflictAsk, setConflictAsk] = useState<{ conflicts: string[]; resolve: (c: ConflictChoice | null) => void } | null>(null);
  const askConflict = useCallback(
    (conflicts: string[]) => new Promise<ConflictChoice | null>((resolve) => setConflictAsk({ conflicts, resolve })),
    [],
  );

  /** 应用内拖拽移动：拖起时把要搬的条目记在这里。
   *  拖拽期间浏览器不让读 dataTransfer 的内容（只在 drop 时才能读），所以拖了哪些只能自己记。 */
  const dragItemsRef = useRef<ClipItem[]>([]);
  /** 正在被拖的条目：整批一起变淡，让"我拖着的是一整批"一眼可见（浏览器默认只淡化鼠标按住的那一行） */
  const [dragRels, setDragRels] = useState<Set<string>>(new Set());
  /** 自定义拖拽图像（多点拖动时跟随鼠标的「N 项」卡片）；浏览器在下一帧才取快照，所以挂到 body 上、dragend 再摘 */
  const dragGhostRef = useRef<HTMLElement | null>(null);

  // 拖到窗口边缘「丢回收站」手势：热区内松手 → 弹「移到回收站」确认（复用 fs-delete 全流程）；
  // 拖出窗口外/落在目录行上 → 不触发（详见 use-drag-to-trash.ts 头注释）
  const trashGesture = useDragToTrash({ onTrash });

  /** 拖起一行/一格：拖的是选中集合里的一员就整批搬，否则只搬它自己 */
  const onRowDragStart = (ev: React.DragEvent, rel: string, name: string, isDir: boolean, code: string) => {
    const picked: ClipItem[] =
      selected.has(rel) && selected.size > 1
        ? rowsRef.current.filter((r) => selected.has(rowRel(r))).map((r) => ({ rel: rowRel(r), name: r.name, isDir: r.isDir, code: r.code }))
        : [{ rel, name, isDir, code }];
    dragItemsRef.current = picked;
    setDragRels(new Set(picked.map((i) => i.rel)));
    // 拖动期间不挂悬浮卡：卡片是拖起来之前悬停弹出来的，不关掉它会一直停在原处挡路
    // （HTML5 拖拽期间浏览器抑制鼠标事件，卡片既不会更新也不会自动消失）
    setTip(null);
    ev.dataTransfer.effectAllowed = 'move';
    // 必须 setData，否则部分浏览器不触发 drop；值只在 drop 时读得到，
    // 这里主要靠这个 MIME 让投放区分出「项目内拖拽」和「外部文件拖入」
    ev.dataTransfer.setData(MOVE_MIME, picked.map((i) => i.rel).join('\n'));
    // 丢回收站手势：本批全可磁盘删除（? / git 的 I）才武装——拖到窗口边缘松手 = 弹确认删除
    trashGesture.begin(picked, repoType);
    // 多个条目才换图像：只拖一条时，浏览器默认给的那一行就是最好的提示
    if (picked.length > 1) {
      const ghost = document.createElement('div');
      ghost.className = 'drag-ghost';
      // 移动 {n} 项
      ghost.textContent = t('fs.drop.movingGhost', { n: picked.length });
      document.body.appendChild(ghost);
      ev.dataTransfer.setDragImage(ghost, 18, 14);
      dragGhostRef.current = ghost;
    }
  };
  const onRowDragEnd = () => {
    dragItemsRef.current = []; // 拖到窗口外松手不会触发 drop，这里兜底清掉
    setDragRels(new Set());
    dragGhostRef.current?.remove();
    dragGhostRef.current = null;
    trashGesture.end(); // 垃圾桶手势收尾（桶隐藏；删除的触发在 drop 里）
  };

  const drop = useDropUpload({
    dir,
    askConflict,
    /** 项目内拖拽落在目录上 → 移动过去（规则与剪切粘贴同一套：版本化走 svn move / git mv） */
    onMoveDrop: (destDir) => {
      const items = dragItemsRef.current;
      dragItemsRef.current = [];
      // 松开在非文件夹上 = 用户自己放弃了这次拖拽：静默结束，不弹提示（拖没拖动他看得见）
      if (destDir === null) return;
      if (items.length === 0) return;
      void (async () => {
        const outcome = await moveItemsTo(items, destDir, onToast);
        if (outcome !== 'ok') return;
        // 移动同时改了两个目录（源与目标）→ 失效目录缓存再静默强刷（保留渲染中的不闪）
        invalidateCache();
        if (mode === 'tree') reloadOpenNodes();
        else void load(dir, true, true);
      })();
    },
    onDone: useCallback(
      async (okCount: number, failed: string[], saved: string[]) => {
        if (okCount > 0) {
          // 落地改变了目录内容：静默重载（树模式连已展开节点一起）。
          // 列表/网格必须等刷新完成再定位：否则 pendingLocate 会拿旧列表找行号，找不到就超时放弃
          if (mode === 'tree') reloadOpenNodes();
          else await load(dir, true, true);
        }
        // 只能选中当前目录下的：拖进子文件夹的那些不在本视图里，改用文案告诉用户它们去哪了
        const parentOf = (r: string) => (r.includes('/') ? r.slice(0, r.lastIndexOf('/')) : '');
        const here = saved.filter((r) => parentOf(r) === dir);
        if (here.length > 0) {
          // 数据就绪后由 pendingLocate effect 完成选中 + 滚动到首个 + 脉冲闪烁
          setPendingLocate({ rel: here[0]!, at: Date.now(), only: here });
        }
        const elsewhere = saved.length - here.length;
        // ，已选中并定位
        const picked = here.length > 0 ? t('fs.drop.picked') : '';
        // ，另有 {n} 个在子文件夹里
        const sub = elsewhere > 0 ? t('fs.drop.elsewhere', { n: elsewhere }) : '';
        onToast(
          failed.length
            // 已复制 {ok} 个文件{picked}{sub}；{n} 个失败：{list}
            ? t('fs.drop.copiedFailed', {
                ok: okCount,
                picked,
                sub,
                n: failed.length,
                //  等
                list: failed.slice(0, 3).join(t('common.listSep')) + (failed.length > 3 ? t('fs.andMore') : ''),
              })
            // 已复制 {n} 个文件{picked}{sub}
            : t('fs.drop.copied', { n: okCount, picked, sub }),
          failed.length > 0, // 有失败项就按错误态显示（停留久一点，也提醒去处理）
        );
      },
      [mode, dir, load], // eslint-disable-line react-hooks/exhaustive-deps
    ),
  });

  return { selBoxRef, selDragRef, lastWasDragRef, dragRels, onRowDragStart, onRowDragEnd, drop, conflictAsk, setConflictAsk, askConflict };
}
