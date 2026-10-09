/** FsView 的键盘导航：↑↓/jk 选择 · →/Enter 进入 · ←/Backspace 返回 · Esc 关右键菜单。
 *
 *  从 index.tsx 的「---------- 键盘导航 ----------」一节抽出（那一节和视图状态混在一起、上百行）。
 *  只搬"按键 → 动作"这部分：`rows` / `focusRef` / `gridRef` 由调用方持有（别处也在用），按引用读写；
 *  `modeRef` / `dirRef` 只有这里用，搬进来自己维护 —— 它们存在只为"按键回调读到最新值而不用重挂监听"。
 */
import { useEffect, useRef } from 'react';
import type { FsEntry } from '../api.js';
import { relOfName, type Mode, type VisibleRow } from './utils.js';

export function useFsKeyboard(opts: {
  /** 视图是否激活（隐藏时不响应，防按键穿透到其他视图） */
  active: boolean;
  mode: Mode;
  /** 当前目录（相对仓库根）：←/Enter 在列表/网格模式下要用它拼路径 */
  dir: string;
  /** 当前视图的行（树 = 可见行，列表/网格 = 当前目录条目） */
  rows: (VisibleRow | FsEntry)[];
  /** 行的引用（按键回调走它取最新值，避免把 rows 塞进 effect 依赖） */
  rowsRef: React.MutableRefObject<(VisibleRow | FsEntry)[]>;
  focusIndex: number;
  /** 焦点下标引用：外部（快捷键、拖拽起手）也在读它 */
  focusRef: React.MutableRefObject<number>;
  /** 网格容器：browse 模式按列数跳行要量它的宽度 */
  gridRef: React.RefObject<HTMLDivElement | null>;
  /** 右键菜单状态：菜单开着时只吃 Esc（其余交给菜单） */
  ctx: unknown;
  /** 预览状态：预览开着时整个不吃键（PreviewPane 有自己的监听） */
  preview: unknown;
  closeCtx: () => void;
  toggleExpand: (rel: string) => void;
  openFile: (name: string, code: string, rel: string) => unknown;
  setFocusIndex: (i: number) => void;
  setDir: React.Dispatch<React.SetStateAction<string>>;
  /** 键盘主动导航（进目录/返回上级）时取消残留定位 */
  clearLocate: () => void;
}) {
  const { active, mode, dir, rows, rowsRef, focusIndex, focusRef, gridRef, ctx, preview, closeCtx, toggleExpand, openFile, setFocusIndex, setDir, clearLocate } = opts;

  // 只在按键回调里读、不值得进依赖的最新值
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const dirRef = useRef(dir);
  dirRef.current = dir;

  useEffect(() => {
    if (!active) return; // 视图隐藏时键盘不响应（防止穿透到其他视图）
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return; // 输入框内不拦截
      if (ctx) {
        if (e.key === 'Escape') {
          closeCtx(); // 统一关闭路径：清计时器 + 解锁 + 清原条目记录
        }
        return;
      }
      if (preview) return; // 预览打开：按键由 PreviewPane 自己的监听处理（/ 搜索 · Esc/←/Backspace 返回），这里只吃键防止列表响应
      const list = rowsRef.current;
      if (list.length === 0) return;
      const k = e.key;
      const fi = focusRef.current;
      const cur = list[fi] ?? list[0]!;

      if (k === 'ArrowDown' || k === 'j') {
        e.preventDefault();
        // 网格模式按列数跳行，其余单行移动
        if (modeRef.current === 'browse') {
          const w = gridRef.current?.clientWidth ?? 600;
          const cols = Math.max(1, Math.floor(w / 120));
          setFocusIndex(Math.min(list.length - 1, fi + cols));
        } else {
          setFocusIndex(Math.min(list.length - 1, fi + 1));
        }
        return;
      }
      if (k === 'ArrowUp' || k === 'k') {
        e.preventDefault();
        if (modeRef.current === 'browse') {
          const w = gridRef.current?.clientWidth ?? 600;
          const cols = Math.max(1, Math.floor(w / 120));
          setFocusIndex(Math.max(0, fi - cols));
        } else {
          setFocusIndex(Math.max(0, fi - 1));
        }
        return;
      }
      if (k === 'Enter' || k === 'ArrowRight') {
        e.preventDefault();
        if (mode === 'tree') {
          const row = cur as VisibleRow;
          if (row.isDir) {
            if (!row.open) {
              toggleExpand(row.rel);
              // 展开后焦点移到第一个子行
              setFocusIndex(Math.min(list.length, fi + 1));
            }
          } else {
            void openFile(row.name, row.code, row.rel);
          }
        } else {
          const row = cur as FsEntry;
          if (row.isDir) {
            setDir(relOfName(dirRef.current, row.name));
            clearLocate(); // 键盘进入目录：取消残留定位
          } else {
            void openFile(row.name, row.code, relOfName(dirRef.current, row.name));
          }
        }
        return;
      }
      if (k === 'ArrowLeft' || k === 'Backspace') {
        e.preventDefault();
        if (mode === 'tree') {
          const row = cur as VisibleRow;
          if (row.isDir && row.open) {
            toggleExpand(row.rel); // 收起
            return;
          }
          // 焦点上移到最近父级行
          for (let i = fi - 1; i >= 0; i--) {
            if ((list[i] as VisibleRow).depth < row.depth) {
              setFocusIndex(i);
              return;
            }
          }
        } else if (dirRef.current) {
          setDir((d) => (d.includes('/') ? d.slice(0, d.lastIndexOf('/')) : ''));
          clearLocate(); // 键盘返回上级：取消残留定位
          setFocusIndex(0);
        }
        return;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ctx, preview, mode, toggleExpand, openFile, active]); // eslint-disable-line react-hooks/exhaustive-deps

  // 焦点越界修正（切视图/目录后行数变少）
  useEffect(() => {
    if (focusIndex >= rows.length) setFocusIndex(Math.max(0, rows.length - 1));
  }, [rows.length, focusIndex]); // eslint-disable-line react-hooks/exhaustive-deps

  // 网格模式：焦点变化时滚动到选中项
  useEffect(() => {
    if (mode !== 'browse' || !rows.length) return;
    const el = gridRef.current?.children[focusIndex] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }, [focusIndex, mode, rows.length]); // eslint-disable-line react-hooks/exhaustive-deps
}
