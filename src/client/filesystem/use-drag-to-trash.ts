/** 拖到窗口边缘「丢回收站」手势：
 *  可磁盘删除的条目（未版本化 ?；git 忽略 I）拖起后，光标进入窗口四周边缘热区 → 视觉进入
 *  「删除态」：对应边缘亮起红色光带 + 被拖的行整体泛红（红色即提示，不做垃圾桶浮标）；
 *  在热区内松手（drop）→ 弹「移到回收站」确认（复用 fs-delete 全流程：确认 → 丢出动画 → 删除）。
 *  规则要点：
 *  - 拖出窗口外松手：页面收不到 drop，什么都不做——拖出去可能另有用途（给其他程序），手势作废；
 *  - 拖到目录行上：closest(data-dir-rel) 判定让位——"移动文件"优先，绝不误删；
 *  - 批里混着版本化条目则整个手势不启用（拖出去 = 照旧取消），避免"为什么这里不让我丢"。
 *  实现：document 级 dragover/drop/dragleave/dragend（挂载时一次，回调走 ref 取最新值）；
 *  热区内才 preventDefault（**没变红的位置不可 drop**，防惊吓）；红光带是命令式 DOM（不进 React
 *  状态；每帧切四条边的亮灭），行泛红靠 body 上的状态 class 命中 .drag-src，拖出窗口即全部熄灭。 */
import { useCallback, useEffect, useRef } from 'react';
import { isInternalDrag } from './use-file-transfer.js';

/** 边缘热区宽度（px）：四周距窗口边多近算"丢" */
const HOT_ZONE = 36;

/** 可磁盘删除判定（与右键菜单「移到回收站」同一规则）：未版本化 ?；git 忽略 I 同样可删（svn 不行） */
const canTrash = (code: string, repoType: 'svn' | 'git') => code === '?' || (repoType === 'git' && code === 'I');

/** 光标是否在窗口边缘热区内。
 *  用 **clientWidth/clientHeight（内容区，不含滚动条）** 而不是 innerWidth：
 *  鼠标压在滚动条上时浏览器不再派发 dragover——按 innerWidth 算的话最右/最下十几像素
 *  是永远收不到事件的死区（实测：拖到最右边停在 1216 后就没有 dragover 了）。 */
const nearEdge = (x: number, y: number) => {
  const cw = document.documentElement.clientWidth;
  const ch = document.documentElement.clientHeight;
  return x <= HOT_ZONE || y <= HOT_ZONE || x >= cw - HOT_ZONE || y >= ch - HOT_ZONE;
};

/** 松手位置是否落在"窗口自身 UI 的死区"（滚动条 / 窗口 resize 边框，距窗口边 16px 的窄带）：
 *  那里浏览器不派发 dragover/drop，只能靠 dragend 坐标补判定。
 *  两个前置条件防误判：坐标必须在窗口内（拖出窗口的 dragend 坐标不可靠，绝不能当删除）；
 *  调用方还得确认本次拖拽没有拖出过窗口（见 leftWindowRef）。 */
const inDeadZone = (x: number, y: number) => {
  if (x <= 0 || y <= 0 || x >= window.innerWidth || y >= window.innerHeight) return false;
  const DEAD_EDGE = 16;
  return x >= window.innerWidth - DEAD_EDGE || y >= window.innerHeight - DEAD_EDGE;
};

/** 事件目标是否落在目录行/格子上（"移动"的落点，优先于删除热区） */
const onDirTarget = (target: EventTarget | null) =>
  !!(target as HTMLElement | null)?.closest?.('[data-dir-rel]');

interface EdgeGlow {
  root: HTMLElement;
  top: HTMLElement;
  right: HTMLElement;
  bottom: HTMLElement;
  left: HTMLElement;
}

export function useDragToTrash(opts: { onTrash: (rels: string[]) => void }) {
  /** 可删批的 rels；null = 本批未启用手势（含不可删条目 / 不在拖动中） */
  const armedRef = useRef<string[] | null>(null);
  /** 本次拖拽是否发生过 drop（任何落点）：dragend 补判定据此避免与正常投放重复触发 */
  const droppedRef = useRef(false);
  /** 本次拖拽是否离开过窗口（dragleave 到文档外）：拖出去=另有用途绝不补删；拖回来即清除 */
  const leftWindowRef = useRef(false);
  const glowRef = useRef<EdgeGlow | null>(null);
  /** onTrash 走 ref 镜像：document 监听只在挂载时挂一次，回调总取最新 */
  const onTrashRef = useRef(opts.onTrash);
  onTrashRef.current = opts.onTrash;

  /** 进入删除态：按光标位置点亮对应边缘的红光带 + 被拖的行泛红（幂等，每帧调用） */
  const showHot = useCallback((x: number, y: number) => {
    let g = glowRef.current;
    if (!g) {
      const root = document.createElement('div');
      root.className = 'drag-edge-glow';
      const mk = (cls: string) => {
        const i = document.createElement('i');
        i.className = `edge ${cls}`;
        root.appendChild(i);
        return i;
      };
      g = { root, top: mk('top'), right: mk('right'), bottom: mk('bottom'), left: mk('left') };
      document.body.appendChild(root);
      glowRef.current = g;
    }
    const cw = document.documentElement.clientWidth;
    const ch = document.documentElement.clientHeight;
    g.top.classList.toggle('on', y <= HOT_ZONE);
    g.left.classList.toggle('on', x <= HOT_ZONE);
    g.right.classList.toggle('on', x >= cw - HOT_ZONE);
    g.bottom.classList.toggle('on', y >= ch - HOT_ZONE);
    g.root.classList.add('show');
    document.body.classList.add('drag-trash-hot');
  }, []);
  /** 退出删除态（回到中央 / 拖出窗口 / 结束） */
  const hideHot = useCallback(() => {
    glowRef.current?.root.classList.remove('show');
    document.body.classList.remove('drag-trash-hot');
  }, []);

  useEffect(() => {
    const onDragOver = (ev: DragEvent) => {
      leftWindowRef.current = false; // 回到窗口内了
      const rels = armedRef.current;
      if (!rels || !isInternalDrag(ev.dataTransfer)) return;
      // 落在目录行上 → 让位给"移动"（现有高亮/drop 逻辑接管），不进入删除态
      if (nearEdge(ev.clientX, ev.clientY) && !onDirTarget(ev.target)) {
        ev.preventDefault(); // 允许 drop——与"变红"同条件：没变红的位置不可 drop，防惊吓
        if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'move';
        showHot(ev.clientX, ev.clientY);
      } else {
        hideHot();
      }
    };
    const onDragLeave = (ev: DragEvent) => {
      // relatedTarget 为 null = 离开整个文档（拖出窗口）→ 手势作废：红色熄掉、本次记"出过窗"，
      // dragend 补判定据此跳过（拖出去是其他用途，绝不删）
      if (ev.relatedTarget) return;
      leftWindowRef.current = true;
      if (armedRef.current) hideHot();
    };
    const onDrop = (ev: DragEvent) => {
      droppedRef.current = true; // 任何落点发生过 drop（dragend 补判定用）
      const rels = armedRef.current;
      if (!rels || !isInternalDrag(ev.dataTransfer)) return;
      if (nearEdge(ev.clientX, ev.clientY) && !onDirTarget(ev.target)) {
        ev.preventDefault();
        armedRef.current = null;
        hideHot();
        onTrashRef.current(rels);
      }
    };
    const onDragEnd = (ev: DragEvent) => {
      const rels = armedRef.current;
      // 补判定：松手压在窗口自身 UI 死区（滚动条/resize 边框，收不到 drop/dragover）——
      // 位置语义上就是"丢到了最边上的删除区"（拖到最右边最后几像素松手的常见落点）。
      // 三个前提缺一不可：可删批、本次没有 drop 过、**没有拖出过窗口**（拖出去=其他用途，绝不删）
      if (rels && !droppedRef.current && !leftWindowRef.current && inDeadZone(ev.clientX, ev.clientY)) {
        onTrashRef.current(rels);
      }
      droppedRef.current = false;
      leftWindowRef.current = false;
      armedRef.current = null;
      hideHot();
    };
    document.addEventListener('dragover', onDragOver);
    document.addEventListener('dragleave', onDragLeave);
    document.addEventListener('drop', onDrop);
    document.addEventListener('dragend', onDragEnd);
    return () => {
      document.removeEventListener('dragover', onDragOver);
      document.removeEventListener('dragleave', onDragLeave);
      document.removeEventListener('drop', onDrop);
      document.removeEventListener('dragend', onDragEnd);
      glowRef.current?.root.remove();
      glowRef.current = null;
      document.body.classList.remove('drag-trash-hot');
    };
  }, [showHot, hideHot]);

  return {
    /** 拖拽开始：本批全部可磁盘删除才启用手势（空批/含版本化条目 = 不启用） */
    begin: (items: { rel: string; code: string }[], repoType: 'svn' | 'git') => {
      droppedRef.current = false;
      leftWindowRef.current = false;
      armedRef.current = items.length > 0 && items.every((i) => canTrash(i.code, repoType)) ? items.map((i) => i.rel) : null;
    },
    /** 拖拽结束：清理（删除的触发在 drop 里，dragend 只作收尾） */
    end: () => {
      armedRef.current = null;
      hideHot();
    },
  };
}
