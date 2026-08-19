/** diff 文本着色渲染 */
import React from 'react';

export function DiffRender(props: { text: string }) {
  const lines = props.text.split('\n');
  return (
    <div className="diff">
      {lines.map((l, i) => {
        let cls = '';
        if (l.startsWith('@@')) cls = 'hunk';
        else if (l.startsWith('diff --git') || l.startsWith('Index:') || l.startsWith('commit ')) cls = 'filehead';
        else if (/^---\s/.test(l) || /^\+\+\+\s/.test(l) || l.startsWith('===')) cls = 'meta';
        else if (l.startsWith('+')) cls = 'add';
        else if (l.startsWith('-')) cls = 'del';
        return (
          <div key={i} className={`line ${cls}`}>
            {l || ' '}
          </div>
        );
      })}
    </div>
  );
}
