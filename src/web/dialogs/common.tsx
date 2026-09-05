/** 版本管理对话框共享小部件（vcs-dialogs.tsx 拆分重构移入 dialogs/）：
 *  ResultLine：操作结果提示行（成功绿√ / 失败红×） / runAction：执行并刷新列表的通用逻辑 / LayoutNote：SVN 仓库布局提示条 */
import React from 'react';
import type { SvnLayout, VcsResult } from '../api.js';
import { IconErr, IconOk } from '../icons.js';
/** 操作结果提示行：成功绿√ / 失败红×（SVG 图标+文本，样式不变只加图标） */
export function ResultLine(props: { msg: string; err?: boolean }) {
  if (!props.msg) return null;
  return (
    <div
      className={props.err ? 'error mt8' : 'mt8 small'}
      style={{
        ...(props.err ? {} : { color: 'var(--ok)' }),
        display: 'flex',
        alignItems: 'center',
        gap: 6,
      }}
    >
      {props.err ? <IconErr /> : <IconOk />}
      <span>{props.msg}</span>
    </div>
  );
}

/** 执行并刷新列表的通用逻辑
 *  onFailOk=true 时失败（ok=false）也执行 afterOk：merge 冲突这类"返回失败但工作区已变"的操作（MERGE_HEAD/C 状态）
 *  不刷新的话「解决冲突」入口不会出现，用户看到提示却找不到地方 */
export async function runAction<T extends VcsResult = VcsResult>(
  fn: () => Promise<T>,
  onMsg: (msg: string, err?: boolean) => void,
  afterOk?: (r: T) => void,
  onFailOk = false
) {
  try {
    const r = await fn();
    onMsg(r.message, !r.ok);
    if (r.ok) afterOk?.(r);
    else if (onFailOk) afterOk?.(r);
  } catch (e) {
    onMsg((e as Error).message, true);
  }
}

// ==================== SVN 布局提示条 ====================

/** SVN 仓库布局提示条：标准布局绿色确认，非标准布局黄色提醒（分支/标签弹窗共用） */
export function LayoutNote(props: { layout: SvnLayout }) {
  const { trunk, branches, tags } = props.layout;
  if (trunk && branches && tags) {
    return <div className="small" style={{ color: 'var(--ok)', margin: '6px 0' }}>✓ 标准布局（trunk / branches / tags）</div>;
  }
  const missing: string[] = [];
  if (!trunk) missing.push('trunk/');
  if (!branches) missing.push('branches/');
  if (!tags) missing.push('tags/');
  const tips: string[] = [];
  if (!branches) tips.push('分支列表为空，可先「新建分支」自动创建该目录');
  if (!trunk) tips.push('无法切回主干，新建分支将以当前目录为来源');
  if (!tags) tips.push('标签列表为空，可先「创建标签」自动创建该目录');
  return (
    <div className="small" style={{ color: 'var(--warn)', margin: '6px 0' }}>
      ⚠ 仓库缺少 {missing.join('、')}（非标准布局）。{tips.join(' ')}
    </div>
  );
}
