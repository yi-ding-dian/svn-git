/** Markdown 渲染（marked + GFM，转义安全）：标题/表格/列表/代码/链接/图片等完整语法
 *
 * 定制点：
 * - 图片：绝对 URL / 根路径原样放 src；相对路径（相对 md 文件目录，opts.baseDir）转 /api/file 读取
 * - raw HTML 一律转义显示（仓库内容可能来自远程，防 XSS）
 * - 链接：非 http(s)/mailto/ftp 的协议（javascript:、data:、vbscript: 等）**不生成 `<a>`**，
 *   退化成纯文本。marked 自己不清洗 URL —— 实测 `[x](javascript:alert(1))` 原样输出成可点链接，
 *   而这里渲染的除了本仓库的 md 文件，还有**提交信息**（clone 别人的仓库时内容来自任意人），得自己挡
 * - opts.breaks：单换行也当换行（GFM 硬换行）。**只给提交信息用** —— md 文档的作者是按标准写的
 *   （单换行 = 同一段落），开 breaks 会改掉既有排版；而提交信息大量是"一行一件事"的纯文本习惯，
 *   不开就会全粘成一段（用户正是担心这个）
 */

import { marked, type Tokens } from 'marked';

export function renderMarkdown(text: string, opts?: { baseDir?: string; breaks?: boolean }): string {
  const baseDir = opts?.baseDir ?? '';
  const renderer = new marked.Renderer();
  // 图片：绝对 URL / 根路径原样；相对路径转 /api/file?path= 可加载地址
  renderer.image = (token) => {
    const src = token.href.trim();
    const alt = (token.text ?? '').replace(/"/g, '&quot;');
    const title = token.title ? ` title="${token.title.replace(/"/g, '&quot;')}"` : '';
    if (/^[a-z][a-z0-9+.-]*:/i.test(src) || src.startsWith('/')) {
      return `<img class="md-img" src="${src.replace(/"/g, '&quot;')}" alt="${alt}"${title} />`;
    }
    const abs = `${baseDir ? baseDir + '/' : ''}${src.replace(/^\.\//, '')}`;
    return `<img class="md-img" src="/api/file?path=${encodeURIComponent(abs)}" alt="${alt}"${title} />`;
  };
  // 链接：危险协议退化成纯文本（见文件头）。相对路径/锚点没有协议头，照常渲染
  renderer.link = ((token: Tokens.Link) => {
    const href = (token.href ?? '').trim();
    const inner = renderer.parser.parseInline(token.tokens ?? []);
    if (/^[a-z][a-z0-9+.-]*:/i.test(href) && !/^(https?|mailto|ftp):/i.test(href)) return inner;
    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const title = token.title ? ` title="${esc(token.title)}"` : '';
    return `<a href="${esc(href)}"${title}>${inner}</a>`;
  }) as typeof renderer.link;
  // raw HTML 不执行：转义后按文本显示（防仓库内容注入）
  renderer.html = ((token: Tokens.HTML | Tokens.Tag) =>
    token.text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')) as typeof renderer.html;
  return marked.parse(text, { gfm: true, breaks: opts?.breaks ?? false, renderer }) as string;
}
