/** Markdown 渲染（marked + GFM，转义安全）：标题/表格/列表/代码/链接/图片等完整语法
 *
 * 定制点：
 * - 图片：绝对 URL / 根路径原样放 src；相对路径（相对 md 文件目录，opts.baseDir）转 /api/file 读取
 * - raw HTML 一律转义显示（仓库内容可能来自远程，防 XSS）
 */

import { marked, type Tokens } from 'marked';

export function renderMarkdown(text: string, opts?: { baseDir?: string }): string {
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
  // raw HTML 不执行：转义后按文本显示（防仓库内容注入）
  renderer.html = ((token: Tokens.HTML | Tokens.Tag) =>
    token.text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')) as typeof renderer.html;
  return marked.parse(text, { gfm: true, renderer }) as string;
}
