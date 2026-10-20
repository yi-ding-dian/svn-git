/** 文件版本端点：工作区文件指纹与两版本并排对比（BASE/HEAD vs 工作区）。 */
import fs from 'node:fs';
import path from 'node:path';
import { inRepoRoot, sendJson, readTextFileChecked, vcsOf, MSG_OUT_OF_SCOPE, type Ctx } from '../util.js';
import { t } from '../../../shared/i18n/index.js';

export async function handle(ctx: Ctx): Promise<boolean> {
  const { res, url } = ctx;
  const p = url.pathname;

  if (p === '/api/file-mtime') {
    // 工作区文件指纹（检测外部更新）
    const { repo } = vcsOf();
    const rel = url.searchParams.get('path') ?? '';
    const abs = path.join(repo.root, rel);
    if (!inRepoRoot(repo.root, abs)) {
      sendJson(res, 403, { error: MSG_OUT_OF_SCOPE() });
      return true;
    }
    if (!fs.existsSync(abs)) {
      // 文件不存在
      sendJson(res, 404, { error: t('srv.fileNotFound') });
      return true;
    }
    const st = fs.statSync(abs);
    sendJson(res, 200, { mtime: st.mtimeMs, size: st.size });
    return true;
  }

  if (p === '/api/file-versions') {
    // 并排对比：左右版本文件内容（无 a/b：左=BASE/HEAD 右=工作区；有 a/b：两版本）
    const { vcs, repo } = vcsOf();
    const rel = url.searchParams.get('path') || '';
    const a = url.searchParams.get('a') || undefined;
    const b = url.searchParams.get('b') || undefined;
    const abs = path.join(repo.root, rel);
    if (!inRepoRoot(repo.root, abs)) {
      sendJson(res, 403, { error: MSG_OUT_OF_SCOPE() });
      return true;
    }
    // 工作区模式且文件不存在（路径错误）→ 明确报错，避免空白对比
    if (!a && !b && !fs.existsSync(abs)) {
      // 文件不存在: {path}
      sendJson(res, 404, { error: t('srv.fileNotFoundAt', { path: rel }) });
      return true;
    }
    let left = '';
    let right = '';
    let leftLabel = '';
    let rightLabel = '';
    const gitShow = async (rev: string, r: string): Promise<string> => {
      const out = await vcs.show?.(`${rev}:${r}`);
      return out && out.ok ? out.output : '';
    };
    const svnCat = async (rev: string, r: string): Promise<string> => {
      const out = await vcs.catRev?.(rev, r);
      return out && out.ok ? out.output : '';
    };
    if (repo.type === 'git') {
      // HEAD（原版）
      leftLabel = a ? a : t('srv.headLabel');
      // 工作区（当前）
      rightLabel = b ? b : t('srv.worktreeLabel');
      left = await gitShow(a ?? 'HEAD', rel);
      // 工作区裸读：readTextFileChecked 含大小预检（>5MB 不整读入内存），读取失败明确报错
      if (b) right = await gitShow(b, rel);
      else {
        const rd = readTextFileChecked(abs);
        if (!rd.ok) {
          sendJson(res, 500, { error: t('srv.readFailedDetail', { msg: rd.message }) });
          return true;
        }
        right = rd.text;
      }
    } else {
      // BASE（原版）
      leftLabel = a ? `r${a}` : t('srv.baseLabel');
      // 工作区（当前）
      rightLabel = b ? `r${b}` : t('srv.worktreeLabel');
      left = await svnCat(a ?? 'BASE', rel);
      if (b) right = await svnCat(b, rel);
      else {
        const rd = readTextFileChecked(abs);
        if (!rd.ok) {
          sendJson(res, 500, { error: t('srv.readFailedDetail', { msg: rd.message }) });
          return true;
        }
        right = rd.text;
      }
    }
    // 截断超大文件
    const MAX = 200_000;
    // …（文件过大已截断）
    if (left.length > MAX) left = left.slice(0, MAX) + '\n' + t('srv.truncatedLarge');
    // …（文件过大已截断）
    if (right.length > MAX) right = right.slice(0, MAX) + '\n' + t('srv.truncatedLarge');
    sendJson(res, 200, { left, right, leftLabel, rightLabel, rel });
    return true;
  }

  return false;
}
