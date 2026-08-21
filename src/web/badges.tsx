/** 状态徽标：文件状态码徽标（CodeBadge）与目录操作集合徽标（DirBadge） */
import React from 'react';
import { CODE_DESC } from './api.js';
import { IconExternal } from './icons.js';

function CodeBadge({ code, title }: { code: string; title?: string }) {
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
    <span className={`code ${code}`} title={tip || undefined}>{code}</span>
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
function DirBadge({ codes }: { codes?: string[] }) {
  if (codes && codes.length > 0) {
    return (
      <span className="codes-row">
        {codes.map((c) => (
          <CodeBadge key={c} code={c} title={DIR_CODE_TITLE[c]} />
        ))}
      </span>
    );
  }
  return <CodeBadge code="" />;
}

export { CodeBadge, DirBadge };
