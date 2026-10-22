/** 块级还原：把工作区的某一块改回原版，其余修改保留。
 *  写回工作区 + 扫光/收起动画；只对「工作区 vs 原版」可用（版本间对比没有还原语义）。 */
import { useCallback, useMemo, useRef, useState } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import { get, post } from '../../shared/api.js';
import { t } from '../../../shared/i18n/index.js';
import type { DiffLine } from '../../../shared/diff-parse.js';
import type { DiffTarget } from './diff-types.js';
import type { DiffVersions, LeftRow, RightAnchor, RightRow } from './use-diff-rows.js';

export function useDiffRestore(args: {
  target: DiffTarget | null;
  versions: DiffVersions | null;
  diffLines: DiffLine[];
  delAnchorRight: Map<number, RightAnchor>;
  leftRows: LeftRow[];
  rightRows: RightRow[];
  leftRefs: MutableRefObject<Map<number, HTMLDivElement>>;
  rightRefs: MutableRefObject<Map<number, HTMLDivElement>>;
  leftPhRefs: MutableRefObject<Map<number, HTMLDivElement[]>>;
  mtimeRef: MutableRefObject<{ mtime: number; size: number } | null>;
  setStaleTip: (v: boolean) => void;
  setError: (msg: string) => void;
  setReloadKey: Dispatch<SetStateAction<number>>;
  onToast?: (msg: string) => void;
}) {
  const {
    target,
    versions,
    diffLines,
    delAnchorRight,
    leftRows,
    rightRows,
    leftRefs,
    rightRefs,
    leftPhRefs,
    mtimeRef,
    setStaleTip,
    setError,
    setReloadKey,
    onToast,
  } = args;

  /** 块级还原确认：左栏差异块旁的箭头点击后要还原的块（确认前不动文件） */
  const [restoreTarget, setRestoreTarget] = useState<{ blockId: number; kind: 'mod' | 'del' | 'add' } | null>(null);
  /** 还原写入中：防止快速连点/多个块并发写同一文件 */
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  /** 块的变更类型：有删有加=修改、只有加=新增、只有删=删除（与连接带配色同一口径） */
  const blockKindOf = useCallback(
    (blockId: number): 'mod' | 'del' | 'add' => {
      let hasDel = false;
      let hasAdd = false;
      for (const l of diffLines) {
        if (l.block !== blockId) continue;
        if (l.type === 'del') hasDel = true;
        else if (l.type === 'add') hasAdd = true;
      }
      return hasAdd && hasDel ? 'mod' : hasAdd ? 'add' : 'del';
    },
    [diffLines],
  );

  /** 还原动画：新增行绿色扫光、删除行擦除，扫完把行折叠（写回后重载即消失）。
   *  Promise 最多等 650ms——大块（上千行）逐行 30ms 错峰会把重载拖到几十秒，
   *  用户看到「右边没了、左边还挂着差异」。只给前 24 行播动画，总时长封顶。 */
  const playRestoreAnim = useCallback(
    (blockId: number, kind: 'mod' | 'del' | 'add'): Promise<void> => {
      if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return Promise.resolve();
      const MAX_ANIM_ROWS = 24;
      const pick = (side: 'left' | 'right') => {
        const rows = side === 'left' ? leftRows : rightRows;
        const els: HTMLElement[] = [];
        for (const r of rows) {
          if (r.block !== blockId) continue;
          // 折叠行/收起行是提示行，不参与扫光
          if ('fold' in r || 'tail' in r) continue;
          // 左栏占位行的 ref 按块号存数组（leftPhRefs），真实行按行号存（leftRefs）
          const isPh = 'ph' in r && r.ph;
          const phIdx = 'phIndex' in r ? (r.phIndex ?? 0) : 0;
          const el = side === 'left' ? (isPh ? leftPhRefs.current.get(r.block)?.[phIdx] : leftRefs.current.get(r.no)) : rightRefs.current.get(r.no);
          if (el?.isConnected) els.push(el);
        }
        return els;
      };
      const sweep = (els: HTMLElement[], color: 'ok' | 'err', base: number) =>
        els.slice(0, MAX_ANIM_ROWS).map((el, i) => {
          el.style.position = 'relative';
          el.style.overflow = 'hidden';
          const beam = document.createElement('div');
          beam.className = 'anim-sweep-beam';
          // 删除侧用红色光带（与行底色一致）；新增侧沿用动画域默认的绿色光带
          if (color === 'err') beam.style.background = 'linear-gradient(90deg, rgba(207,34,46,0), rgba(207,34,46,.38), rgba(207,34,46,0))';
          el.appendChild(beam);
          const a = beam.animate(
            [
              { transform: 'translateX(-130%)', opacity: 0, easing: 'cubic-bezier(.45,.05,.6,1)' },
              { transform: 'translateX(30%)', opacity: 1, offset: 0.22 },
              { transform: 'translateX(170%)', opacity: 1, offset: 0.8 },
              { transform: 'translateX(300%)', opacity: 0 },
            ],
            { duration: 420, delay: base + Math.min(i * 30, 240), fill: 'both' },
          );
          a.onfinish = () => beam.remove();
          return a;
        });
      const collapse = (els: HTMLElement[], base: number) =>
        els.slice(0, MAX_ANIM_ROWS).map((el) => {
          el.style.overflow = 'hidden';
          const h = el.getBoundingClientRect().height;
          return el.animate(
            [
              { maxHeight: `${h}px`, opacity: 1 },
              { maxHeight: '0px', opacity: 0 },
            ],
            { duration: 220, delay: base + 360, easing: 'ease-in', fill: 'forwards' },
          );
        });
      const leftEls = pick('left');
      const rightEls = pick('right');
      const anims: Animation[] = [];
      if (kind === 'mod') {
        // 修改块：左栏删除侧擦除、右栏新增侧绿色扫光，两侧都收起
        anims.push(...sweep(leftEls, 'err', 0), ...sweep(rightEls, 'ok', 60), ...collapse(leftEls, 0), ...collapse(rightEls, 60));
      } else if (kind === 'add') {
        // 新增块：右栏行扫光收起；左栏占位区同步收起，不能只消失一侧
        anims.push(...sweep(rightEls, 'ok', 0), ...collapse(rightEls, 0), ...collapse(leftEls, 0));
      } else {
        // 删除块：左栏删除行擦除收起；右栏删除占位行同步收起
        anims.push(...sweep(leftEls, 'err', 0), ...collapse(leftEls, 0), ...collapse(rightEls, 0));
      }
      const done = Promise.all(anims.map((a) => a.finished.catch(() => undefined))).then(() => undefined);
      // 动画最多 ~1.2s；再封 650ms，保证写回后立刻重载（大块逐行错峰曾把重载拖到几十秒）
      return Promise.race([done, new Promise<void>((r) => setTimeout(r, 650))]);
    },
    [leftRows, rightRows, leftRefs, rightRefs, leftPhRefs],
  );

  /** 执行块级还原：用 diff 行号精确改写工作区文本，只动这一块。
   *  新增块=删掉工作区对应行；纯删除块=按占位落点插回原版行；修改块=整块替换。 */
  const doRestoreBlock = useCallback(
    async (target0: { blockId: number; kind: 'mod' | 'del' | 'add' }) => {
      if (!target?.path || !versions || busyRef.current) return;
      busyRef.current = true;
      setBusy(true);
      try {
      // 外部改动检测：mtime/size 变了说明行号可能已失效，先让用户更新对比（避免改错位置）
      try {
        const m = await get.fileMtime(target.path);
        const prev = mtimeRef.current;
        if (prev && (m.mtime !== prev.mtime || m.size !== prev.size)) {
          setStaleTip(true);
          onToast?.(t('hist.restoreStale'));
          return;
        }
      } catch {
        /* 检测失败不阻塞：写回接口自己会报错 */
      }
      const addRows = diffLines.filter((l) => l.type === 'add' && l.block === target0.blockId);
      const delRows = diffLines.filter((l) => l.type === 'del' && l.block === target0.blockId);
      const adds = addRows.map((l) => l.rightNo);
      const dels = delRows.map((l) => l.text);
      if (adds.length === 0 && dels.length === 0) return;
      // 工作区按行拆分：保留原 EOL（CRLF 文件每行末尾的 \r 原样不动；git diff 解析出的
      // 新增/删除文本不带 \r，插回时按工作区风格补齐）
      const lines = versions.right.split('\n');
      const crlf = versions.right.includes('\r\n');
      const delTexts = dels.map((x) => (crlf && !x.endsWith('\r') ? x + '\r' : x));
      let next: string[];
      if (adds.length > 0 && delRows.length > 0) {
        // 修改块：用 BASE 对应行区间整体替换工作区区间。
        // 同一 block 可能被空白上下文行合并（adds/dels 行号不连续），
        // 不能只看 min/max 再拼 delTexts——那会把中间的空行一起删掉。
        const rightStart = Math.min(...adds);
        const rightEnd = Math.max(...adds);
        const leftStart = Math.min(...delRows.map((l) => l.leftNo));
        const leftEnd = Math.max(...delRows.map((l) => l.leftNo));
        const baseLines = versions.left.split('\n');
        next = [
          ...lines.slice(0, rightStart - 1),
          ...baseLines.slice(leftStart - 1, leftEnd),
          ...lines.slice(rightEnd),
        ];
      } else if (adds.length > 0) {
        // 纯新增块：逐行删除新增行，中间上下文行保留
        const drop = new Set(adds);
        next = lines.filter((_, idx) => !drop.has(idx + 1));
      } else {
        // 纯删除块：右栏没有对应行，按占位行落点插回（after=删除段位于文件末尾）
        const anchor = delAnchorRight.get(target0.blockId);
        if (!anchor) return;
        const at = anchor.after ? anchor.rightNo : anchor.rightNo - 1;
        next = [...lines.slice(0, at), ...delTexts, ...lines.slice(at)];
      }
      // 还原块触及文件末尾时，末尾换行要跟原版（BASE）一致：
      // 否则「仅差一个末尾换行」的差异还原后会原样保留（用户实报：点了还原没反应）
      let content = next.join('\n');
      const touchesEnd =
        (adds.length > 0 && Math.max(...adds) >= lines.length) ||
        (adds.length === 0 && delAnchorRight.get(target0.blockId)?.after === true);
      if (touchesEnd) {
        const stripEol = (s: string) => (s.endsWith('\r\n') ? s.slice(0, -2) : s.endsWith('\n') ? s.slice(0, -1) : s);
        if (versions.left.endsWith('\n') && !content.endsWith('\n')) content += crlf ? '\r\n' : '\n';
        else if (!versions.left.endsWith('\n') && content.endsWith('\n')) content = stripEol(content);
      }
      const anim = playRestoreAnim(target0.blockId, target0.kind);
      const res = await post.writeFile(target.path, content);
      if (!res.ok) {
        // 写失败：重载一次清掉折叠动画留下的视觉状态，并报错
        setError(res.message ?? t('fs.pv.saveFailed'));
        setReloadKey((k) => k + 1);
        return;
      }
      await anim;
      onToast?.(t('hist.restoreDone'));
      setReloadKey((k) => k + 1);
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- playRestoreAnim/versions/diffLines 每次渲染重建，无需进依赖（闭包取当前值）
    [target, diffLines, versions, delAnchorRight],
  );

  // 还原确认文案：行数直接数当前块的 diff 行（不估算），三种块各说清楚会动什么
  const restoreMsg = useMemo(() => {
    if (!restoreTarget) return '';
    const a = diffLines.filter((l) => l.type === 'add' && l.block === restoreTarget.blockId).length;
    const d = diffLines.filter((l) => l.type === 'del' && l.block === restoreTarget.blockId).length;
    if (restoreTarget.kind === 'add') return t('hist.restoreBlockMsgAdd', { n: a });
    if (restoreTarget.kind === 'del') return t('hist.restoreBlockMsgDel', { n: d });
    return t('hist.restoreBlockMsgMod', { a, d });
  }, [restoreTarget, diffLines]);

  /** 换文件时清掉待还原目标（确认框不该跟着到新文件） */
  const resetRestore = () => setRestoreTarget(null);

  return { restoreTarget, setRestoreTarget, resetRestore, blockKindOf, doRestoreBlock, restoreMsg, busy };
}

export type DiffRestoreApi = ReturnType<typeof useDiffRestore>;
