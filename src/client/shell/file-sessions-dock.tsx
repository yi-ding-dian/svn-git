/** 右侧文件会话胶囊：切换项目时挂起的「刚才在看/编辑什么」。
 *
 *  出现在窗口右缘（垂直居中偏上），最多 5 个（数据层控制）。
 *  点击 → 切回对应项目并打开文件（恢复模式/草稿/光标/滚动）；同一项目内直接打开不切项目；
 *  右键 → 删除会话（草稿按约定保留，下次打开文件仍可恢复）；
 *  每个胶囊可独立拖动（位置分别记住；拖动超过阈值不会触发点击）。
 *  只在文件浏览预览（原文 / md 预览 / 编辑态）产生；diff、历史等视图不参与。
 */
import React, { useRef, useState, useSyncExternalStore } from 'react';
import { t } from '../../shared/i18n/index.js';
import { ContextMenu } from '../ui/context-menu.js';
import { getSessions, subscribeSessions, removeSession, type FileSession } from '../shared/file-sessions.js';

/** 每个胶囊拖动后的位置（key = 项目根:文件相对路径） */
const POS_KEY = 'svngit-file-sessions-pos-v2';

type Pos = { left: number; top: number };

function loadPosMap(): Record<string, Pos> {
  try {
    const v = JSON.parse(localStorage.getItem(POS_KEY) ?? '{}') as unknown;
    if (!v || typeof v !== 'object') return {};
    const out: Record<string, Pos> = {};
    for (const [k, p] of Object.entries(v as Record<string, unknown>)) {
      const q = p as Partial<Pos> | null;
      if (q && typeof q.left === 'number' && typeof q.top === 'number') out[k] = { left: q.left, top: q.top };
    }
    return out;
  } catch {
    return {};
  }
}

function savePosMap(map: Record<string, Pos>): void {
  try {
    localStorage.setItem(POS_KEY, JSON.stringify(map));
  } catch {
    /* 隐私模式等：本次会话内仍生效 */
  }
}

/** 拖动阈值：小于它算点击，避免手抖把"点开"变成"拖了一下" */
const DRAG_THRESHOLD = 5;
/** 未拖动过的胶囊默认堆叠间距（px） */
const STACK_GAP = 56;

export function FileSessionsDock(props: { onOpen: (s: FileSession) => void }) {
  const sessions = useSyncExternalStore(subscribeSessions, getSessions);
  /** 右键菜单（删除会话） */
  const [menu, setMenu] = useState<{ x: number; y: number; s: FileSession } | null>(null);
  const [posMap, setPosMap] = useState<Record<string, Pos>>(loadPosMap);
  const posMapRef = useRef(posMap);
  posMapRef.current = posMap;
  const [draggingKey, setDraggingKey] = useState<string | null>(null);
  const drag = useRef<{
    key: string;
    active: boolean;
    moved: boolean;
    sx: number;
    sy: number;
    left: number;
    top: number;
  } | null>(null);

  if (sessions.length === 0) return null;

  const clamp = (left: number, top: number) => ({
    left: Math.min(Math.max(0, left), Math.max(0, window.innerWidth - 80)),
    top: Math.min(Math.max(0, top), Math.max(0, window.innerHeight - 40)),
  });

  const onDown = (e: React.PointerEvent<HTMLButtonElement>, key: string) => {
    if (e.button !== 0) return;
    const r = e.currentTarget.getBoundingClientRect();
    drag.current = { key, active: true, moved: false, sx: e.clientX, sy: e.clientY, left: r.left, top: r.top };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    if (!d?.active) return;
    const dx = e.clientX - d.sx;
    const dy = e.clientY - d.sy;
    if (!d.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    if (!d.moved) {
      d.moved = true;
      setDraggingKey(d.key);
    }
    const p = clamp(d.left + dx, d.top + dy);
    setPosMap((prev) => ({ ...prev, [d.key]: p }));
  };
  const onUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    if (!d?.active) return;
    d.active = false;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    if (d.moved) {
      savePosMap(posMapRef.current);
      // click 在 pointerup 之后同步触发（用来吞掉"拖动后的点击"）；没有 click 时兜底清除
      window.setTimeout(() => {
        if (drag.current && !drag.current.active) drag.current.moved = false;
      }, 0);
    }
    setDraggingKey(null);
  };

  /** 未拖动过的胶囊：右侧按顺序堆叠；拖动过的用记住的位置 */
  const styleOf = (key: string, index: number): React.CSSProperties => {
    const p = posMap[key];
    if (p) {
      const q = clamp(p.left, p.top);
      return { position: 'fixed', left: q.left, top: q.top };
    }
    return { position: 'fixed', right: 10, top: `calc(30% + ${index * STACK_GAP}px)` };
  };

  return (
    <>
      <div className="fsessions">
        {sessions.map((s, index) => {
          const key = `${s.root}:${s.rel}`;
          const state =
            s.mode === 'editing'
              ? s.dirty
                ? t('fs.session.unsaved')
                : t('fs.session.editing')
              : s.mode === 'md'
                ? t('fs.session.preview')
                : ''; // 原文查看不显示状态（只留项目名 + 文件名）
          return (
            <button
              key={key}
              className={`fsession${draggingKey === key ? ' dragging' : ''}`}
              style={styleOf(key, index)}
              title={`${s.root}\n${s.rel}${state ? `\n${state}` : ''}`}
              onPointerDown={(e) => onDown(e, key)}
              onPointerMove={onMove}
              onPointerUp={onUp}
              onPointerCancel={onUp}
              onClick={() => {
                // 拖动松手也会触发 click：拖动过就不当作"点开"
                if (drag.current?.moved) {
                  drag.current.moved = false;
                  return;
                }
                props.onOpen(s);
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                setMenu({ x: e.clientX, y: e.clientY, s });
              }}
            >
              {/* 项目名（路径最后一段） */}
              <span className="fsession-proj">{s.root.split(/[\\/]/).filter(Boolean).pop() ?? s.root}</span>
              {/* 文件名 */}
              <span className="fsession-name">{s.name}</span>
              {/* 状态：未保存 / 编辑中 / 预览（原文查看不显示） */}
              {state && <span className={`fsession-state${s.dirty ? ' dirty' : ''}`}>{state}</span>}
            </button>
          );
        })}
      </div>
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          mask
          zIndex={400}
          compact
          onClose={() => setMenu(null)}
          items={[
            {
              label: t('fs.session.delete'),
              action: () => {
                const key = `${menu.s.root}:${menu.s.rel}`;
                removeSession(menu.s.root, menu.s.rel);
                // 位置记录一并清掉（会话没了，位置也没意义）
                setPosMap((prev) => {
                  const n = { ...prev };
                  delete n[key];
                  savePosMap(n);
                  return n;
                });
              },
            },
          ]}
        />
      )}
    </>
  );
}
