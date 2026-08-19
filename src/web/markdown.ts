/** 极简 Markdown 渲染（纯函数，转义安全）：标题/粗体/行内代码/代码块/列表/引用/分割线/链接 */

/** 将 Markdown 文本渲染为 HTML 字符串（配合 .md-render 样式 + dangerouslySetInnerHTML 使用） */
export function renderMarkdown(text: string): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  let html = '';
  let inCode = false;
  let codeBuf: string[] = [];
  for (const line of text.split('\n')) {
    if (line.trimStart().startsWith('```')) {
      if (!inCode) {
        inCode = true;
        codeBuf = [];
        continue;
      }
      inCode = false;
      html += `<pre class="md-code">${esc(codeBuf.join('\n'))}</pre>`;
      continue;
    }
    if (inCode) {
      codeBuf.push(line);
      continue;
    }
    let l = esc(line);
    // 标题
    const h = l.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      const n = h[1]!.length;
      html += `<h${n} class="md-h${n}">${h[2]}</h${n}>`;
      continue;
    }
    // 引用
    if (l.startsWith('&gt; ')) {
      html += `<blockquote class="md-quote">${l.slice(5)}</blockquote>`;
      continue;
    }
    // 列表
    const li = l.match(/^(\s*)([-*]|\d+\.)\s+(.*)$/);
    if (li) {
      html += `<div class="md-li">${li[3]}</div>`;
      continue;
    }
    // 分割线
    if (/^(-{3,}|\*{3,})$/.test(l)) {
      html += '<hr class="md-hr" />';
      continue;
    }
    // 行内：粗体、行内代码、链接
    l = l.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
    l = l.replace(/`([^`]+)`/g, '<code class="md-inline">$1</code>');
    l = l.replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    html += `<div class="md-line">${l}</div>`;
  }
  if (inCode) html += `<pre class="md-code">${esc(codeBuf.join('\n'))}</pre>`;
  return html;
}
