/** 文件级操作端点：定位、还原到指定版本、新建、重命名/移动、删除（回收站/直删）、文本保存。
 *
 *  与 core 的仓库级操作区分：这里动的是"工作区里的文件和目录"，多数只改磁盘、不进版本库调度。 */
import fs from 'node:fs';
import path from 'node:path';
import { platform } from '../../../platform/index.js';
import {
  sendJson, readBody, vcsOf, inRepoRoot, authErrorOf, realpathSafe, invalidateStatusCache, getStatusCached, runVcs, MSG_UNSUPPORTED_OP, MSG_PATH_OUT_OF_BOUNDS, writeTextKeepEncoding, isBinaryFile,
} from '../util.js';
import type { Ctx } from '../util.js';
import { t } from '../../../shared/i18n/index.js';

export async function handle(ctx: Ctx): Promise<boolean> {
  const { req, res, url } = ctx;
  const p = url.pathname;

  if (p === '/api/locate') {
    // 定位：目录（含子目录）下 code 匹配的文件，按 mtime 降序（点击文件夹角标跳"最近一个"）
    const { repo } = vcsOf();
    const dir = String(url.searchParams.get('dir') ?? '').replace(/\/$/, '');
    const code = String(url.searchParams.get('code') ?? '');
    if (!code || !inRepoRoot(repo.root, path.join(repo.root, dir))) {
      // 参数不合法
      sendJson(res, 400, { error: t('srv.invalidParams') });
      return true;
    }
    const items = (await getStatusCached(repo, false)) as { path: string; code: string }[];
    const prefix = dir ? dir + '/' : '';
    let list = items.filter((i) => i.path.startsWith(prefix) && i.path !== dir && i.code === code);
    if (list.length > 1000) list = list.slice(0, 1000); // 超大目录保护：最多统计前 1000
    const out = list
      .map((i) => {
        let mtime = 0;
        try {
          mtime = fs.statSync(path.join(repo.root, i.path)).mtimeMs;
        } catch {
          /* 已删除磁盘文件：mtime 0 排最后 */
        }
        return { path: i.path, mtime };
      })
      .sort((a, b) => b.mtime - a.mtime);
    sendJson(res, 200, { files: out });
    return true;
  }

  if (p === '/api/restore-preview' && req.method === 'POST') {
    // 还原前预检（只读）：目标版本与当前工作区差多少。不改文件，所以不失效状态缓存
    const { vcs, repo } = vcsOf();
    const body = await readBody(req);
    const relPath = String(body.path ?? '');
    const rev = String(body.rev ?? '');
    if (!relPath || !rev || !inRepoRoot(repo.root, path.resolve(repo.root, relPath))) {
      // 参数不合法
      sendJson(res, 400, { error: t('srv.invalidParams') });
      return true;
    }
    const result = (await vcs.restorePreview?.(relPath, rev)) ?? { ok: false, message: MSG_UNSUPPORTED_OP() };
    sendJson(res, 200, { ...result, authError: authErrorOf(result) });
    return true;
  }

  if (p === '/api/restore-version' && req.method === 'POST') {
    // 还原到指定历史版本：文件=git checkout / svn cat；目录=git checkout+清理 / svn 反向合并
    const { vcs, repo } = vcsOf();
    const body = await readBody(req);
    const relPath = String(body.path ?? '');
    const rev = String(body.rev ?? '');
    if (!relPath || !rev || !inRepoRoot(repo.root, path.resolve(repo.root, relPath))) {
      // 参数不合法
      sendJson(res, 400, { error: t('srv.invalidParams') });
      return true;
    }
    return runVcs(ctx, () => vcs.restoreToRev?.(relPath, rev) ?? { ok: false, message: MSG_UNSUPPORTED_OP() });
  }

  if (p === '/api/fs-delete' && req.method === 'POST') {
    // 移到回收站（未版本化 ? / 忽略 I 专属入口：不做版本库调度，仅动本地文件）。
    // 回收站不可用时**不删任何文件**——返回 failedPaths 交前端弹二次确认，用户确认后 force 重发直接删
    const { repo } = vcsOf();
    const body = await readBody(req);
    const paths = Array.isArray(body.paths) ? body.paths.map(String).filter(Boolean) : [];
    const force = body.force === true;
    if (paths.length === 0) {
      // 缺少路径
      sendJson(res, 400, { error: t('srv.missingPath') });
      return true;
    }
    const rootAbs = path.resolve(repo.root);
    if (paths.some((p) => !inRepoRoot(repo.root, path.join(repo.root, p)) || path.resolve(repo.root, p) === rootAbs)) {
      sendJson(res, 400, { error: MSG_PATH_OUT_OF_BOUNDS() });
      return true;
    }
    if (force) {
      // 直接磁盘删除：仅用于用户在「回收站不可用」弹窗里确认过不可恢复之后
      try {
        for (const p of paths) fs.rmSync(path.join(repo.root, p), { recursive: true, force: true });
        invalidateStatusCache(repo.root);
        // 已从磁盘删除 {n} 项（不可恢复）
        sendJson(res, 200, { ok: true, message: t('srv.fsPurged', { n: paths.length }) });
      } catch (e) {
        // 从磁盘删除失败: {msg}
        sendJson(res, 500, { error: t('srv.purgeFailed', { msg: (e as Error).message }) });
      }
      return true;
    }
    // 逐项尝试入回收站；失败项收集起来（原因取第一条）——不静默回退删除
    const failed: string[] = [];
    let reason = '';
    for (const p of paths) {
      try {
        await platform.trashPath(path.join(repo.root, p));
      } catch (e) {
        failed.push(p);
        if (!reason) reason = (e as Error).message;
      }
    }
    invalidateStatusCache(repo.root); // 磁盘文件集变化（? 项被删/被移入回收站），防状态缓存/过滤树显示旧文件
    if (failed.length === 0) {
      // 已移到回收站 {n} 项
      sendJson(res, 200, { ok: true, message: t('srv.fsDeleted', { n: paths.length }) });
    } else {
      // 系统回收站不可用，{n} 项未能移入回收站（尚未删除）
      sendJson(res, 200, { ok: false, message: t('srv.trashUnavailable', { n: failed.length }), trashUnavailable: true, failedPaths: failed, trashReason: reason });
    }
    return true;
  }

  if (p === '/api/write-file' && req.method === 'POST') {
    // 内联编辑的保存：**按目标文件原编码写回**（GBK 文件写回去还是 GBK，两道守卫见 writeTextKeepEncoding），
    // 行尾由前端负责保持（textarea 会把 CRLF 规范化成 LF，前端按原文风格还原后再发过来）。
    const { repo } = vcsOf();
    const body = await readBody(req);
    const rel = String(body.path ?? '');
    const content = String(body.content ?? '');
    const abs = path.resolve(repo.root, rel);
    if (!inRepoRoot(repo.root, abs)) {
      sendJson(res, 400, { error: MSG_PATH_OUT_OF_BOUNDS() });
      return true;
    }
    // 二进制不给写：编辑入口只对文本预览开，这里再挡一道（防止接口被直接调用时把图片写成文本）
    if (isBinaryFile(rel)) {
      // 二进制文件不支持文本编辑
      sendJson(res, 400, { error: t('srv.binaryNoEdit') });
      return true;
    }
    if (!fs.existsSync(abs)) {
      // 文件不存在（可能已被删除或移走）
      sendJson(res, 404, { error: t('srv.fileGone') });
      return true;
    }
    // 超限文件的守卫不在这里 —— 挪进了 writeTextKeepEncoding（所有写回路径的唯一入口），
    // 那样 /api/write-file 和 /api/resolve-conflict 一处覆盖，免得两条路各写一遍还漏
    const w = writeTextKeepEncoding(abs, content);
    if (!w.ok) {
      sendJson(res, 400, { error: w.message });
      return true;
    }
    invalidateStatusCache(repo.root); // 保存后状态会变（干净 → M），缓存要失效
    // 已保存 {path}
    sendJson(res, 200, { ok: true, message: t('srv.savedFile', { path: rel }) });
    return true;
  }

  if ((p === '/api/new-dir' || p === '/api/new-file') && req.method === 'POST') {
    // 仓库内新建（文件浏览视图用）：path 相对仓库根，**单级**（名字里不许带路径分隔符）。
    // 与目录选择器那个系统级 /api/mkdir 分开：那个是"选仓库位置"用的、路径可以不在任何仓库内、
    // 因而不校验边界也不递归；仓库内的新建必须挡越界，且只建一级（用户要的语义）。
    const { repo } = vcsOf();
    const body = await readBody(req);
    const rel = String(body.path ?? '').trim().replace(/\/+$/, '');
    const isDir = p === '/api/new-dir';
    // 文件夹 / 文件
    const what = isDir ? t('srv.folder') : t('srv.file');
    if (!rel) {
      // {what}名为空
      sendJson(res, 400, { error: t('srv.nameEmpty', { what }) });
      return true;
    }
    const name = rel.slice(rel.lastIndexOf('/') + 1);
    if (name === '.' || name === '..' || /[/\\]/.test(name)) {
      // {what}名不能含路径分隔符
      sendJson(res, 400, { error: t('srv.nameHasSep', { what }) });
      return true;
    }
    const abs = path.resolve(repo.root, rel);
    if (!inRepoRoot(repo.root, abs)) {
      sendJson(res, 400, { error: MSG_PATH_OUT_OF_BOUNDS() });
      return true;
    }
    // 已存在就直接说清楚：recursive 模式下 mkdir 对已存在的目录**不报错**，
    // 不先查一下的话，输入一个已有名字会得到"已新建"的成功提示（误导）
    if (fs.existsSync(abs)) {
      // 已存在同名文件或文件夹：{name}
      sendJson(res, 400, { error: t('srv.nameExists', { name }) });
      return true;
    }
    try {
      // 文件用 wx（已存在即失败）：与上面那道存在性检查双保险，绝不覆盖已有内容
      if (isDir) fs.mkdirSync(abs);
      else fs.writeFileSync(abs, '', { flag: 'wx' });
      invalidateStatusCache(repo.root); // 新建条目状态是 '?'，缓存要失效
      // 已新建{what}: {rel}
      sendJson(res, 200, { ok: true, message: t('srv.created', { what, rel }) });
    } catch (e) {
      // EEXIST / EACCES 等原样回给用户，比"新建失败"有用
      sendJson(res, 500, { error: (e as Error).message });
    }
    return true;
  }

  if (p === '/api/move' && req.method === 'POST') {
    // 版本化文件/目录重命名/移动（svn move / git mv：本地调度，提交后生效）
    const { vcs, repo } = vcsOf();
    const body = await readBody(req);
    const from = String(body.from ?? '');
    const to = String(body.to ?? '');
    // 路径为空
    if (!from || !to) { sendJson(res, 400, { error: t('srv.pathEmpty') }); return true; }
    // 新旧路径相同
    if (from === to) { sendJson(res, 400, { error: t('srv.samePath') }); return true; }
    // from 存在可正常 realpath；to 可能尚未存在（新名字目录也可能未建），用 realpathSafe 逐级解析
    if (!inRepoRoot(repo.root, path.resolve(repo.root, from)) || !inRepoRoot(repo.root, realpathSafe(path.resolve(repo.root, to)))) {
      sendJson(res, 400, { error: MSG_PATH_OUT_OF_BOUNDS() });
      return true;
    }
    const result = await vcs.move(from, to);
    if (result.ok) invalidateStatusCache(repo.root);
    sendJson(res, 200, {
      ...result,
      authError: authErrorOf(result),
    });
    return true;
  }

  if (p === '/api/fs-move' && req.method === 'POST') {
    // 磁盘改名（未版本化 ? / 忽略 I 文件/目录专属：不做版本库调度，仅改本地文件名，状态不变）
    const { repo } = vcsOf();
    const body = await readBody(req);
    const from = String(body.from ?? '');
    const to = String(body.to ?? '');
    // 路径为空
    if (!from || !to) { sendJson(res, 400, { error: t('srv.pathEmpty') }); return true; }
    // 新旧路径相同
    if (from === to) { sendJson(res, 400, { error: t('srv.samePath') }); return true; }
    const fromAbs = path.resolve(repo.root, from);
    const toAbs = path.resolve(repo.root, to);
    if (!inRepoRoot(repo.root, fromAbs) || !inRepoRoot(repo.root, realpathSafe(toAbs))) {
      sendJson(res, 400, { error: MSG_PATH_OUT_OF_BOUNDS() });
      return true;
    }
    if (fs.existsSync(toAbs)) {
      // 目标已存在
      sendJson(res, 400, { error: t('srv.targetExists') }); // renameSync 会静默覆盖，先预检拒绝
      return true;
    }
    try {
      fs.renameSync(fromAbs, toAbs);
      invalidateStatusCache(repo.root); // ?/I 路径变化，旧缓存中路径失效
      // 已重命名 {from} → {to}（磁盘，不影响版本库）
      sendJson(res, 200, { ok: true, message: t('srv.fsRenamed', { from, to }) });
    } catch (e) {
      // 重命名失败: {msg}
      sendJson(res, 500, { error: t('srv.renameFailed', { msg: (e as Error).message }) });
    }
    return true;
  }

  return false;
}
