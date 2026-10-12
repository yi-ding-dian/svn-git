/** 语法高亮公共模块（hljs 子集 + 语言推断） */
import hljs from 'highlight.js/lib/core';
import cpp from 'highlight.js/lib/languages/cpp';
import c from 'highlight.js/lib/languages/c';
import python from 'highlight.js/lib/languages/python';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import json from 'highlight.js/lib/languages/json';
import xml from 'highlight.js/lib/languages/xml';
import css from 'highlight.js/lib/languages/css';
import bash from 'highlight.js/lib/languages/bash';
import ini from 'highlight.js/lib/languages/ini';
import markdown from 'highlight.js/lib/languages/markdown';

hljs.registerLanguage('cpp', cpp);
hljs.registerLanguage('c', c);
hljs.registerLanguage('python', python);
hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('json', json);
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('css', css);
hljs.registerLanguage('bash', bash);
hljs.registerLanguage('ini', ini);
hljs.registerLanguage('markdown', markdown);

/** 语言标识 → 注册语言名映射（两种来源共用：文件扩展名、Markdown 代码块标记） */
const EXT_LANG: Record<string, string> = {
  c: 'c', h: 'c', cpp: 'cpp', hpp: 'cpp', cc: 'cpp', cxx: 'cpp', hh: 'cpp', hxx: 'cpp',
  py: 'python', js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  ts: 'typescript', tsx: 'typescript', json: 'json', xml: 'xml', html: 'xml', htm: 'xml',
  css: 'css', scss: 'css', sh: 'bash', bash: 'bash', zsh: 'bash', shell: 'bash', ini: 'ini', cfg: 'ini', conf: 'ini',
  md: 'markdown', markdown: 'markdown',
};

/** 语言标识归一化：别名查表（py→python），表里没有就原样小写（python→python）；未注册名由调用方回退纯文本 */
export function normalizeLang(raw?: string): string | undefined {
  if (!raw) return undefined;
  const lower = raw.toLowerCase();
  return EXT_LANG[lower] ?? lower;
}

/** 按文件扩展名推断语言（未命中返回 undefined——调用方回退纯文本，语义同旧版） */
export function langOf(name: string): string | undefined {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  return EXT_LANG[ext];
}

/** HTML 转义（无语言高亮时必须转义，防 XSS） */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** 单行高亮（返回带 span 的 HTML，已转义） */
export function highlightLine(line: string, lang?: string): string {
  if (!lang || !line.trim()) return escapeHtml(line);
  try {
    return hljs.highlight(line, { language: lang, ignoreIllegals: true }).value;
  } catch {
    return escapeHtml(line);
  }
}

/** Markdown 代码块：整块高亮 → 完整 `<pre><code>` HTML（与源码预览/差异视图同一份语言表）。
 *  语言未标注或未注册（```text 目录树等）→ 纯文本转义，外观与原来一致。
 *  class 拼进属性前过字符白名单：lang 来自文档内容（仓库可能来自远程），不能直接拼 HTML。 */
export function renderCodeBlock(code: string, langInfo?: string): string {
  const raw = (langInfo ?? '').trim().split(/\s+/)[0] ?? ''; // info string 首词才是语言（```ts title=…）
  const name = normalizeLang(raw);
  const known = !!name && /^[a-z0-9-]+$/.test(name) && !!hljs.getLanguage(name);
  if (!known) return `<pre><code>${escapeHtml(code)}</code></pre>`;
  try {
    const html = hljs.highlight(code, { language: name, ignoreIllegals: true }).value;
    return `<pre><code class="hljs language-${name}">${html}</code></pre>`;
  } catch {
    return `<pre><code>${escapeHtml(code)}</code></pre>`;
  }
}
