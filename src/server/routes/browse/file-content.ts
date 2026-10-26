/** 文件内容端点：历史版本差异、目录列举、文件读取与图片预览。 */
import fs from 'node:fs';
import path from 'node:path';
import { detectTextEncoding } from '../../../shared/text.js';
import { isBinaryFile, inRepoRoot, sendJson, readTextFileChecked, MAX_READ_BYTES, TOO_LARGE_PLACEHOLDER, vcsOf, MSG_PATH_OUT_OF_BOUNDS, type Ctx } from '../util.js';
import { t } from '../../../shared/i18n/index.js';
import { streamZip } from './zip.js';

/** /api/raw 的 Content-Type：按扩展名交给浏览器渲染（未列出的按二进制下载） */
const RAW_MIME: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  htm: 'text/html; charset=utf-8',
  css: 'text/css; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  json: 'application/json; charset=utf-8',
  xml: 'application/xml; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
  md: 'text/plain; charset=utf-8',
  log: 'text/plain; charset=utf-8',
  csv: 'text/csv; charset=utf-8',
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  webp: 'image/webp',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  zip: 'application/zip',
};

export async function handle(ctx: Ctx): Promise<boolean> {
  const { res, url } = ctx;
  const p = url.pathname;

  if (p === '/api/show') {
    const { vcs, repo } = vcsOf();
    const rev = url.searchParams.get('rev') || '';
    const pathRel = url.searchParams.get('path') || undefined;
    if (pathRel && isBinaryFile(pathRel)) {
      // 二进制文件（{path}），不支持文本对比
      sendJson(res, 200, { ok: false, output: '', error: t('srv.binaryNoDiff', { path: pathRel }) });
      return true;
    }
    if (repo.type === 'git') {
      const s = await vcs.show?.(rev, pathRel);
      sendJson(res, 200, s);
    } else {
      const n = Number(rev);
      // svn log -v 的变更路径是仓库内路径（相对 repository root，如 /projects/CWBS-SCA/tags/SCA_HB/...），
      // 不能直接当工作副本相对路径用（会报 E155007 不是工作副本）。
      // 转换：取 wc URL path 的最长后缀 Y（wc 在仓库内的位置），pathRel 以它开头则截掉 → wc 相对路径
      let rel = pathRel;
      let y = '';
      if (pathRel && repo.url) {
        try {
          const urlPath = new URL(repo.url).pathname;
          const segs = urlPath.split('/').filter(Boolean);
          for (let i = segs.length - 1; i >= 1; i--) {
            const cand = segs.slice(i).join('/');
            if (cand.length > y.length && pathRel.startsWith(`/${cand}`)) y = cand;
          }
          if (y) rel = pathRel.slice(('/' + y).length + 1) || '';
        } catch {
          /* URL 解析失败保持原样 */
        }
      }
      // 转换失败（y === ''）分两种：
      //  - 以 / 开头：仓库内绝对路径，但它不属于当前工作副本（其他分支/标签的提交）→ 只能走服务器 URL
      //  - 不以 / 开头：前端历史视图直接传的工作副本相对路径 → 照常本地 diff
      //    （远程新提交还没 update 到本地时，svn diff -r N-1:N 仍能用工作副本 URL 比较两个版本）
      const urlPath = pathRel ?? '';
      const serverUrl = urlPath
        ? urlPath.startsWith('/')
          ? '^' + urlPath
          : `${(repo.url ?? '').replace(/\/+$/, '')}/${urlPath}`
        : '';
      const canUrlDiff = Boolean(urlPath) && (urlPath.startsWith('/') || Boolean(repo.url));
      if (pathRel && y === '' && urlPath.startsWith('/')) {
        try {
          const du = await vcs.diffUrl?.(String(n - 1), rev, serverUrl);
          if (du && (du.ok || du.output)) {
            sendJson(res, 200, du);
            return true;
          }
        } catch {
          /* URL 失败走下方提示 */
        }
        // 该文件不在当前工作副本中，无法查看差异：{path}
        sendJson(res, 200, { ok: false, output: '', error: t('srv.notInWcNoDiff', { path: pathRel }) });
        return true;
      }
      const d = await vcs.diff(String(n - 1), rev, rel);
      // 文件不在当前工作副本（D 已删除 / A 未更新到本地）或新增文件版本间不存在 →
      // 回退服务器 URL 版本间比较（不依赖工作副本，A/D 都能输出）；
      // URL 也失败时（极端场景）用 svn cat 取内容构造"整文件新增"
      if ((!d.ok || !d.output.trim()) && canUrlDiff) {
        try {
          const du = await vcs.diffUrl?.(String(n - 1), rev, serverUrl);
          if (du && (du.ok || du.output)) {
            sendJson(res, 200, du);
            return true;
          }
          // cat 兜底：URL 带 @rev peg（路径在 HEAD 已删除时无 peg 会解析失败）
          const cat = await vcs.catRev?.(rev, `${serverUrl}@${rev}`);
          if (cat && cat.ok && cat.output) {
            const lines = cat.output.split('\n');
            if (lines.length && lines[lines.length - 1] === '') lines.pop();
            const range = lines.length === 0 ? '0,0' : `1,${lines.length}`;
            sendJson(res, 200, {
              ok: true,
              output:
                // (不存在的) / (版本 {rev})
                `--- ${pathRel}\t${t('srv.diffNotExist')}\n+++ ${pathRel}\t${t('srv.diffRevision', { rev })}\n@@ -0,0 +${range} @@\n` +
                lines.map((l: string) => '+' + l).join('\n'),
            });
            return true;
          }
        } catch {
          /* 保持原结果 */
        }
      }
      sendJson(res, 200, d);
    }
    return true;
  }

  if (p === '/api/ls') {
    const { vcs, repo } = vcsOf();
    const dir = url.searchParams.get('dir') || '';
    // svn list 以 URL 语义解析参数，防 ../ 指向仓库根之外（^/ 相对 URL 除外）
    if (dir && !dir.startsWith('^/') && !inRepoRoot(repo.root, path.resolve(repo.root, dir))) {
      sendJson(res, 400, { error: MSG_PATH_OUT_OF_BOUNDS() });
      return true;
    }
    const list = await vcs.ls(dir);
    sendJson(res, 200, { items: list, repoType: repo.type });
    return true;
  }

  if (p === '/api/cat') {
    const { vcs, repo } = vcsOf();
    const rel = url.searchParams.get('path') || '';
    // source=worktree：明确读**工作区**版本（内容搜索跳转用——搜的就是工作区内容，
    // 打开的必须是同一份，否则有未提交修改的文件行号对不上：git 默认走 vcs.cat 读 HEAD 版本）
    const fromWorktree = url.searchParams.get('source') === 'worktree';
    let out: { ok: boolean; output: string; error?: string };
    if (repo.type === 'git' && !fromWorktree) {
      // git.cat 内部有磁盘回退（未跟踪文件读盘），同样先做越界校验防 ../ 出界
      const abs = path.resolve(repo.root, rel);
      if (!inRepoRoot(repo.root, abs)) {
        sendJson(res, 400, { ok: false, output: '', error: MSG_PATH_OUT_OF_BOUNDS() });
        return true;
      }
      // 读取失败
      out = (await vcs.cat?.(rel)) ?? { ok: false, output: '', error: t('srv.readFailed') };
    } else {
      // svn 工作副本直接读本地文件
      const abs = path.resolve(repo.root, rel);
      // 路径越界校验：svn 分支是裸磁盘读取,与 /api/file-versions 一致,防 ../ 穿越与符号链接出界
      if (!inRepoRoot(repo.root, abs)) {
        sendJson(res, 400, { ok: false, output: '', error: MSG_PATH_OUT_OF_BOUNDS() });
        return true;
      }
      if (!fs.existsSync(abs)) {
        // 文件不存在
        sendJson(res, 404, { ok: false, output: '', error: t('srv.fileNotFound') });
        return true;
      }
      const rd = readTextFileChecked(abs);
      if (!rd.ok) {
        // 读取失败（权限/文件被占用等）：**不能**返回空串——前端会当空文件显示，编辑保存会覆盖原文件
        sendJson(res, 500, { ok: false, output: '', error: t('srv.readFailedDetail', { msg: rd.message }) });
        return true;
      }
      out = { ok: true, output: rd.text };
    }
    // 编码提示：工作区文件不是 UTF-8（如 GBK）时告诉前端一声——用户才知道看到的是按什么编码解出来的，
    // 否则"不乱了"反而让人以为文件本来就是 UTF-8。探测看磁盘那份（预览的对象就是它）。
    let encoding: string | undefined;
    try {
      const absFile = path.resolve(repo.root, rel);
      if (inRepoRoot(repo.root, absFile) && fs.statSync(absFile).size <= MAX_READ_BYTES) {
        const enc = detectTextEncoding(fs.readFileSync(absFile));
        if (enc !== 'utf-8') encoding = enc;
      }
    } catch {
      /* 读不到（已删除等）：不提示 */
    }
    // 超限文件：正文是 readTextFile 的**占位符**，不是真内容 —— 必须告诉前端，
    // 否则编辑态拿它当正文，保存就把这句话写进文件（真内容被覆盖）。
    // 判据是"手里这份是不是占位符"，不是"源文件多大"：git 分支走 vcs.cat（读 HEAD 版本、不截断），
    // 按工作区文件大小判会误报（工作区 6MB、HEAD 版本很小的情况）。
    const truncated = out.output === TOO_LARGE_PLACEHOLDER;
    sendJson(res, 200, { ...out, ...(encoding ? { encoding } : {}), ...(truncated ? { truncated: true } : {}) });
    return true;
  }

  // 下载：文件按附件返回；目录边遍历边打包 ZIP（远程右键「下载」用，本机也可访问）
  if (p === '/api/download' && ctx.req.method === 'GET') {
    const { repo } = vcsOf();
    const rel = url.searchParams.get('path') || '';
    const abs = path.resolve(repo.root, rel);
    if (!rel || !inRepoRoot(repo.root, abs)) {
      sendJson(res, 400, { error: MSG_PATH_OUT_OF_BOUNDS() });
      return true;
    }
    let st: fs.Stats;
    try {
      st = fs.statSync(abs);
    } catch {
      sendJson(res, 404, { error: t('srv.fileNotFound') });
      return true;
    }
    const base = path.basename(abs);
    if (st.isDirectory()) {
      try {
        await streamZip(res, abs, `${base}.zip`);
      } catch {
        // 客户端中断下载：连接已不可写，直接销毁即可
        if (!res.writableEnded) res.destroy();
      }
      return true;
    }
    if (!st.isFile()) {
      sendJson(res, 404, { error: t('srv.fileNotFound') });
      return true;
    }
    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Length': st.size,
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(base)}`,
      'Cache-Control': 'no-store',
    });
    fs.createReadStream(abs).pipe(res);
    return true;
  }

  // 原始文件（远程「在新标签页打开」用）：把文件字节原样交给访客自己的浏览器，
  // 由浏览器按 Content-Type 渲染 HTML/图片/PDF 等。仅 GET，路径限制在仓库根内。
  // 同时支持路径式 `/api/raw/<rel>`：HTML 里的同目录相对链接会按该 URL 解析
  // （查询式 `/api/raw?path=` 打开时，相对链接会被解析成 `/api/xxx`，必然 404）。
  if ((p === '/api/raw' || p.startsWith('/api/raw/')) && ctx.req.method === 'GET') {
    const { repo } = vcsOf();
    const rel = p.startsWith('/api/raw/')
      ? decodeURIComponent(p.slice('/api/raw/'.length))
      : (url.searchParams.get('path') || '');
    const abs = path.resolve(repo.root, rel);
    if (!rel || !inRepoRoot(repo.root, abs)) {
      sendJson(res, 400, { error: MSG_PATH_OUT_OF_BOUNDS() });
      return true;
    }
    let st: fs.Stats;
    try {
      st = fs.statSync(abs);
    } catch {
      sendJson(res, 404, { error: t('srv.fileNotFound') });
      return true;
    }
    if (!st.isFile()) {
      sendJson(res, 404, { error: t('srv.fileNotFound') });
      return true;
    }
    if (st.size > 50 * 1024 * 1024) {
      sendJson(res, 400, { error: t('srv.fileTooLarge') });
      return true;
    }
    const ext = abs.split('.').pop()!.toLowerCase();
    res.writeHead(200, {
      'Content-Type': RAW_MIME[ext] ?? 'application/octet-stream',
      'Content-Length': st.size,
      'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(path.basename(abs))}`,
      'Cache-Control': 'no-store',
    });
    res.end(fs.readFileSync(abs));
    return true;
  }

  if (p === '/api/file') {
    // md 预览图片：读取仓库内文件（仅图片扩展名 + 防目录穿越）
    const { repo } = vcsOf();
    const fileRel = url.searchParams.get('path') || '';
    if (!/\.(png|jpe?g|gif|svg|webp|bmp|ico)$/i.test(fileRel)) {
      // 仅支持图片文件
      sendJson(res, 400, { error: t('srv.imageOnly') });
      return true;
    }
    const root = path.resolve(repo.root);
    const abs = path.resolve(root, fileRel);
    // 统一 inRepoRoot（含 realpath）：与其余端点一致,防 symlink 出界
    if (!inRepoRoot(repo.root, abs)) {
      sendJson(res, 400, { error: MSG_PATH_OUT_OF_BOUNDS() });
      return true;
    }
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
      // 文件不存在
      sendJson(res, 404, { error: t('srv.fileNotFound') });
      return true;
    }
    // 超大图片（如几百 MB 的 PNG）：整读入内存会 OOM,读前拦截
    const imgSize = fs.statSync(abs).size;
    if (imgSize > 50 * 1024 * 1024) {
      // 图片过大（超过 50MB），无法预览
      sendJson(res, 400, { error: t('srv.imageTooLarge') });
      return true;
    }
    const ext = abs.split('.').pop()!.toLowerCase();
    // 注（去重）：server.ts 顶层曾有同块局部重定义 fmtMtime（函数体与模块顶层 93 行完全相同且块内从未调用，
    // 属合并遗留死代码，已删除）与局部 MIME。局部 MIME 键无点、仅图片类型，与 server.ts 静态资源用的
    // 顶层 MIME（键带点 .html/.js…）非同一用途，故保守改名 IMG_MIME 消除遮蔽而非强行合并；
    // 值与模块顶层 EXT_MIME 的图片键完全一致，但 EXT_MIME 注释用途为 .desktop 程序匹配，不跨用途复用。
    const IMG_MIME: Record<string, string> = {
      png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
      svg: 'image/svg+xml', webp: 'image/webp', bmp: 'image/bmp', ico: 'image/x-icon',
    };
    res.writeHead(200, { 'Content-Type': IMG_MIME[ext] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(fs.readFileSync(abs));
    return true;
  }

  return false;
}
