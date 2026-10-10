/** 状态徽标：文件状态码徽标（CodeBadge）与目录操作集合徽标（DirBadge） */
import React from 'react';
import { CODE_DESC } from '../api.js';
import { IconExternal } from './icons.js';

function CodeBadge({ code, title, onClick }: { code: string; title?: string; onClick?: (e: React.MouseEvent) => void }) {
  // ✓(无状态)不显示描边、绿色表示干净；悬浮显示状态含义
  const tip = title ?? (code ? CODE_DESC[code] : '');
  if (!code) {
    return <span className="code" style={{ background: 'transparent', boxShadow: 'none', color: 'var(--ok)' }}>✓</span>;
  }
  // 外部引用：链环图标（不用字母 X，仅显示在引用目录自身）
  if (code === 'X') {
    return (
      <span className="code X" title={tip || undefined}>
        <IconExternal size={12} />
      </span>
    );
  }
  return (
    <span
      className={`code ${code}${onClick ? ' clickable' : ''}`}
      title={onClick ? `${tip || ''}\n（点击定位到最近的该状态文件）` : tip || undefined}
      onClick={onClick}
    >
      {code}
    </span>
  );
}

/** 目录徽标：同时显示 M/A/D 等全部操作标识；无操作一律显示 √（文件夹不显示 ?，未版本化由文件体现） */
const DIR_CODE_TITLE: Record<string, string> = {
  '?': '整个目录未版本化（未加入版本库）',
  M: '有修改的文件',
  A: '有添加的文件',
  D: '有删除的文件',
  C: '有冲突的文件',
  R: '有重命名/替换的文件',
  '!': '有缺失的文件（更新可恢复）',
  U: '有更新的文件',
  '~': '有类型变更的文件',
};
function DirBadge({ codes, onBadgeClick }: { codes?: string[]; onBadgeClick?: (code: string, e: React.MouseEvent) => void }) {
  if (codes && codes.length > 0) {
    return (
      <span className="codes-row">
        {codes.map((c) => (
          <CodeBadge
            key={c}
            code={c}
            title={DIR_CODE_TITLE[c]}
            onClick={onBadgeClick ? (e) => { e.stopPropagation(); onBadgeClick(c, e); } : undefined}
          />
        ))}
      </span>
    );
  }
  return <CodeBadge code="" />;
}

/** 树冲突角标：本地已添加/修改，服务器同路径已被删除或移动（提交会被拒）。
 *  与字母徽标**并列**显示，不占字母位——字母说明"本地在干什么"（A/M），⚠ 说明"这事有冲突"。
 *  同一棵树冲突有两种成因，颜色不同：红=服务器已删除 · 黄=服务器上仍在（本地与服务器各执一词）·
 *  灰=只知道本地冲突、服务器状态没查到（未诊断/没连上）。 */
export type TreeConflictState = 'missing' | 'present' | 'unknown';

const TC_TITLE: Record<TreeConflictState, string> = {
  missing: '树冲突：服务器上该路径已删除，直接提交会被拒绝（右键 → 接受服务器的删除）',
  present: '树冲突：服务器上该路径仍在，本地与服务器对同一路径各执一词（先 update 或找管理员）',
  unknown: '树冲突：本地与服务器对同一路径的操作冲突（未查到服务器状态）',
};

/** 目录**内部**有冲突（不是它自己）：文案要说清"里面"，别让人以为这个目录本身有问题 */
const TC_TITLE_INNER: Record<TreeConflictState, string> = {
  missing: '树冲突：目录内部有路径在服务器上已删除，提交会被拒绝 —— 点进去逐条处理',
  present: '树冲突：目录内部有路径与服务器各执一词 —— 点进去逐条处理',
  unknown: '树冲突：目录内部有树冲突（未查到服务器状态）',
};

function TreeConflictBadge({ state, inner, innerCount, onClick }: { state: TreeConflictState; inner?: boolean; innerCount?: number; onClick?: (e: React.MouseEvent) => void }) {
  const base = inner ? TC_TITLE_INNER[state] : TC_TITLE[state];
  // 内部冲突带条数（⚠ 2）：与"自身冲突"（只有 ⚠）一眼分开。
  // 两者颜色相同（都按服务器状态上色），只靠 tooltip 根本分不出——用户报过。
  // 而且两者的**下一步动作相反**：自身冲突在本目录右键接受删除；内部冲突要点进去、在子项上处理
  const num = inner && innerCount ? innerCount : null;
  const title = `${num ? `内部有 ${num} 处。` : ''}${base}${onClick ? '\n（点击定位到该冲突项，连点轮转）' : ''}`;
  return (
    <span
      className={`code tc ${state}${num ? ' with-num' : ''}${onClick ? ' clickable' : ''}`}
      title={title}
      onClick={onClick ? (e) => { e.stopPropagation(); onClick(e); } : undefined}
    >
      ⚠{num ? <span className="tc-num">{num}</span> : null}
    </span>
  );
}

export { CodeBadge, DirBadge, TreeConflictBadge };
