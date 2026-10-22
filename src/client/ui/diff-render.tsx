/** diff 文本着色渲染 */
import React from 'react';
import { t } from '../../shared/i18n/index.js';

const CIRCLED = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳';

type FileStatus = 'add' | 'del' | 'mod' | 'rename' | 'binary';

/** 一个文件的 diff 段：文件头用序号 + 路径 + 状态 + 增删统计，原始元信息行隐藏 */
interface FileSection {
  path: string;
  status: FileStatus;
  add: number;
  del: number;
  /** 段内要渲染的行（已去掉 diff --git / index / --- / +++ 等） */
  lines: string[];
}

const META_PREFIXES = [
  'index ',
  'new file mode',
  'deleted file mode',
  'old mode',
  'new mode',
  'similarity index',
  'rename from',
  'rename to',
  'copy from',
  'copy to',
];

/** 按 `diff --git` 切文件段；commit 头等段外内容原样返回 */
function splitSections(text: string): { before: string[]; files: FileSection[] } {
  const before: string[] = [];
  const files: FileSection[] = [];
  let cur: FileSection | null = null;
  for (const l of text.split('\n')) {
    if (l.startsWith('diff --git ')) {
      const m = l.match(/^diff --git a\/(.+?) b\/(.+)$/);
      const a = m?.[1] ?? '';
      const b = m?.[2] ?? '';
      const path = a && b && a !== b ? `${a} → ${b}` : b || a || l.slice('diff --git '.length);
      cur = { path, status: 'mod', add: 0, del: 0, lines: [] };
      files.push(cur);
      continue;
    }
    if (!cur) {
      before.push(l);
      continue;
    }
    if (l.startsWith('Binary files ') || l.startsWith('GIT binary patch')) {
      cur.status = 'binary';
      continue;
    }
    if (l.startsWith('new file mode')) {
      cur.status = 'add';
      continue;
    }
    if (l.startsWith('deleted file mode')) {
      cur.status = 'del';
      continue;
    }
    if (l.startsWith('rename from') || l.startsWith('rename to') || l.startsWith('copy from') || l.startsWith('copy to')) {
      cur.status = 'rename';
      continue;
    }
    if (META_PREFIXES.some((p) => l.startsWith(p))) continue;
    // 文件路径行（a/… b/…）已经被文件头表达，不再渲染
    if (l.startsWith('--- ') || l.startsWith('+++ ')) continue;
    if (l.startsWith('+')) cur.add += 1;
    else if (l.startsWith('-')) cur.del += 1;
    cur.lines.push(l);
  }
  return { before, files };
}

/**
 * @param marks 可选：要标出的 **BASE 行号**（旧文件行号，即后端算出的"双方都改到的行"）。
 *   这里用与 `vcs/diff-lines.ts` **完全相同**的行号跟踪规则，保证标出来的行和后端判定冲突的行严格对上
 *   （hunk 头重置行号；`--- `/`+++ ` 文件头不推进；`-` 与上下文行推进；`+` 停在插入位置不推进）。
 */
export function DiffRender(props: { text: string; marks?: Set<number> }) {
  const marks = props.marks;
  const { before, files } = splitSections(props.text);
  let cur = 0;
  let lastDelMarked = false; // 上一个删除行是否被标记：改一行 = 删一行 + 插一行，插入行要跟着标

  /** 单行渲染（行号跟踪与标记规则保持不变；文件头/元信息不参与） */
  const renderLine = (l: string, key: string) => {
    let cls = '';
    let marked = false;
    if (l.startsWith('@@')) {
      cls = 'hunk';
      const h = l.match(/^@@ -(\d+)/);
      if (h?.[1]) cur = Number(h[1]);
      lastDelMarked = false;
    } else if (l.startsWith('diff --git') || l.startsWith('Index:') || l.startsWith('commit ')) {
      cls = 'filehead';
      lastDelMarked = false;
    } else if (/^---\s/.test(l) || /^\+\+\+\s/.test(l) || l.startsWith('===')) {
      cls = 'meta';
      lastDelMarked = false;
    } else if (l.startsWith('+')) {
      cls = 'add';
      // 插入位置的行号也参与判定（双方在同一位置各插入一行的情况），或跟着被标中的删除行
      marked = (marks?.has(cur) ?? false) || lastDelMarked;
    } else if (l.startsWith('-')) {
      cls = 'del';
      lastDelMarked = marks?.has(cur) ?? false;
      marked = lastDelMarked;
      cur += 1;
    } else if (l.startsWith(' ')) {
      // 上下文行一律不标：插入位置的行号会指向它下面那一行，标了就成了"第 N+1 行也冲突"的假象
      lastDelMarked = false;
      cur += 1;
    } else {
      lastDelMarked = false;
    }
    return (
      <div key={key} className={`line ${cls}${marked ? ' mark' : ''}`}>
        {l || ' '}
      </div>
    );
  };

  return (
    <div className="diff">
      {before.map((l, i) => renderLine(l, `b${i}`))}
      {files.map((f, fi) => (
        <React.Fragment key={`f${fi}`}>
          <div className="diff-filehead" title={f.path}>
            <span className="diff-filehead-no">{CIRCLED[fi] ?? `${fi + 1}.`}</span>
            <span className="diff-filehead-path">{f.path}</span>
            <span className={`diff-filehead-badge ${f.status}`}>{t(`ui.diffFileHead.${f.status}`)}</span>
            {f.status !== 'binary' && (
              <span className="diff-filehead-stat">
                <span className="add">+{f.add}</span>
                <span className="del">-{f.del}</span>
              </span>
            )}
          </div>
          {f.lines.map((l, i) => renderLine(l, `f${fi}l${i}`))}
        </React.Fragment>
      ))}
    </div>
  );
}
