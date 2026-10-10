/** 文件拖入上传端点：冲突预检 + 流式落盘。
 *
 *  为什么单独一个模块：上传的 body 是**原始二进制**（不是 JSON），必须流式写盘——
 *  不能走 util.readBody（那是文本拼接 + 10MB 上限，会把整个文件读进内存）。
 *
 *  协议：
 *  - POST /api/upload-check  body={dir, paths[]}                → { conflicts: string[] }
 *    只探路不传内容：先把冲突挑出来问用户，再决定怎么传，避免白传一遍。
 *  - POST /api/upload?dir=&path=&mode=   body=文件原始字节     → { ok, savedAs, skipped? }
 *    mode: overwrite（默认）/ rename（a.txt → a (1).txt）/ skip
 *  - POST /api/copy-into     body={dir, src, path?, mode?}     → { ok, savedAs, skipped? }
 *    打包版快路径：src 是源绝对路径（Electron webUtils 提供），后端 fs.cp 直接复制，
 *    不经 HTTP 传内容——大文件零拷贝、目录整树复制，且保留权限位与时间戳。
 *
 *  目录结构由调用方保留在 path 里（拖入 foo/bar/a.txt → path=foo/bar/a.txt，落在 <dir>/foo/bar/a.txt）。
 *  不做大小限制（流式写盘不占内存），磁盘满/写失败时删掉半截文件避免留下损坏文件。
 */
import fs from 'node:fs';
import path from 'node:path';
import type http from 'node:http';
import { sendJson, readBody, vcsOf, inRepoRoot, MSG_PATH_OUT_OF_BOUNDS } from './util.js';
import { t } from '../../shared/i18n/index.js';
import type { Ctx } from './util.js';

/** dir/path 拼成绝对路径并校验落在仓库根内；越界或不合法返回 null。
 *  dir 为相对仓库根的目录（'' = 根），rel 是相对 dir 的路径（可含子目录）。 */
function targetOf(repoRoot: string, dir: string, rel: string): string | null {
  // 绝对路径会让 resolve 直接丢弃前面的参数（rel=/etc/passwd → 落到 /etc/passwd），必须先挡掉
  if (!rel || path.isAbsolute(rel) || path.isAbsolute(dir)) return null;
  const abs = path.resolve(repoRoot, dir, rel);
  return inRepoRoot(repoRoot, abs) ? abs : null;
}

/** 同名时的备用名：a.txt → a (1).txt → a (2).txt …… */
function uniquePath(abs: string): string {
  const dir = path.dirname(abs);
  const ext = path.extname(abs);
  const base = path.basename(abs, ext);
  for (let i = 1; i < 1000; i++) {
    const cand = path.join(dir, `${base} (${i})${ext}`);
    if (!fs.existsSync(cand)) return cand;
  }
  return path.join(dir, `${base} (${Date.now()})${ext}`);
}

/** 把请求体流式写入 abs（不占内存）；失败时删除半截文件 */
function pipeToFile(req: http.IncomingMessage, abs: string): Promise<void> {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    const ws = fs.createWriteStream(abs);
    let settled = false;
    const fail = (e: Error) => {
      if (settled) return;
      settled = true;
      ws.destroy();
      try {
        fs.unlinkSync(abs); // 半截文件比没有更糟：留着会被当成「已上传成功」
      } catch {
        /* 文件尚未建成，忽略 */
      }
      reject(e);
    };
    req.on('error', fail);
    ws.on('error', fail);
    ws.on('finish', () => {
      if (settled) return;
      settled = true;
      resolve();
    });
    req.pipe(ws);
  });
}

export async function handle(ctx: Ctx): Promise<boolean> {
  const { req, res, url, p } = ctx;

  // ---------- 冲突预检：只传路径列表，返回已存在的目标 ----------
  if (p === '/api/upload-check' && req.method === 'POST') {
    const { repo } = vcsOf();
    const body = await readBody(req);
    const dir = String(body.dir ?? '');
    const paths = Array.isArray(body.paths) ? body.paths.map(String) : [];
    const conflicts: string[] = [];
    for (const rel of paths) {
      const abs = targetOf(repo.root, dir, rel);
      if (!abs) {
        sendJson(res, 403, { error: MSG_PATH_OUT_OF_BOUNDS() });
        return true;
      }
      if (fs.existsSync(abs)) conflicts.push(rel);
    }
    sendJson(res, 200, { conflicts });
    return true;
  }

  // ---------- 上传单个文件：body 是原始字节，流式落盘 ----------
  if (p === '/api/upload' && req.method === 'POST') {
    const { repo } = vcsOf();
    const dir = url.searchParams.get('dir') ?? '';
    const rel = url.searchParams.get('path') ?? '';
    const mode = url.searchParams.get('mode') ?? 'overwrite';
    const abs0 = targetOf(repo.root, dir, rel);
    if (!abs0) {
      sendJson(res, 403, { error: MSG_PATH_OUT_OF_BOUNDS() });
      return true;
    }

    let abs = abs0;
    if (fs.existsSync(abs)) {
      if (mode === 'skip') {
        req.resume(); // 丢弃 body 也要读完，否则连接不干净
        // 已跳过（同名文件已存在）
        sendJson(res, 200, { ok: true, skipped: true, savedAs: rel, message: t('srv.uploadSkipped') });
        return true;
      }
      if (mode === 'rename') abs = uniquePath(abs);
    }

    try {
      await pipeToFile(req, abs);
    } catch (e) {
      // 写入失败: {msg}
      sendJson(res, 500, { ok: false, error: t('srv.writeFailed', { msg: (e as Error).message }) });
      return true;
    }
    // 已上传
    sendJson(res, 200, { ok: true, savedAs: path.relative(repo.root, abs), message: t('srv.uploaded') });
    return true;
  }

  // ---------- 打包版快路径：源已在磁盘上（Electron 拿到绝对路径），直接复制 ----------
  // 不走 HTTP 传内容：大文件零拷贝、目录一条命令整树复制，且保留权限位（可执行位）与时间戳——
  // 走上传写出来的文件是默认权限，脚本的 +x 会丢。
  // body = { dir, src, path?, mode? }；src 是源**绝对路径**（文件或目录），path 缺省用 basename。
  if (p === '/api/copy-into' && req.method === 'POST') {
    const { repo } = vcsOf();
    const body = await readBody(req);
    const dir = String(body.dir ?? '');
    const src = String(body.src ?? '');
    const mode = String(body.mode ?? 'overwrite');
    const rel = String(body.path ?? '') || path.basename(src);

    if (!src || !path.isAbsolute(src) || !fs.existsSync(src)) {
      // 源路径无效或不存在
      sendJson(res, 400, { error: t('srv.srcInvalid') });
      return true;
    }
    const abs0 = targetOf(repo.root, dir, rel);
    if (!abs0) {
      sendJson(res, 403, { error: MSG_PATH_OUT_OF_BOUNDS() });
      return true;
    }
    // 防「复制到自己里面」：目标等于源、或源是目标的祖先，cp 会无限递归
    const realSrc = fs.realpathSync(src);
    const dst = path.resolve(abs0);
    if (dst === realSrc || dst.startsWith(realSrc + path.sep)) {
      // 源与目标位置冲突
      sendJson(res, 400, { error: t('srv.srcDstConflict') });
      return true;
    }

    let abs = abs0;
    if (fs.existsSync(abs)) {
      if (mode === 'skip') {
        // 已跳过（同名已存在）
        sendJson(res, 200, { ok: true, skipped: true, savedAs: rel, message: t('srv.copySkipped') });
        return true;
      }
      if (mode === 'rename') abs = uniquePath(abs);
      else fs.rmSync(abs, { recursive: true, force: true }); // overwrite：目录也要能整个替掉（否则 cp 会合并内容）
    }
    try {
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      await fs.promises.cp(src, abs, { recursive: true, force: true });
    } catch (e) {
      // 复制失败: {msg}
      sendJson(res, 500, { ok: false, error: t('srv.copyFailed', { msg: (e as Error).message }) });
      return true;
    }
    // 已复制
    sendJson(res, 200, { ok: true, savedAs: path.relative(repo.root, abs), message: t('srv.copied') });
    return true;
  }

  return false;
}
