/** GET /api/repo-cat：远程文件内容（文本预览；二进制/大文件按协议返回标记或错误）。 */
import { sendJson, type Ctx } from '../../http/response.js';
import { isBinaryFile } from '../../path-safety.js';
import { decodeMixedText } from '../../../shared/text.js';
import { t } from '../../../shared/i18n/index.js';
import { URL_OK, catRemote, looksBinary } from '../../../vcs/svn/remote.js';

export async function handle(ctx: Ctx): Promise<boolean> {
  const { req, res, url } = ctx;
  const p = url.pathname;

  if (p === '/api/repo-cat' && req.method === 'GET') {
    const target = String(url.searchParams.get('url') ?? '').trim();
    if (!URL_OK.test(target)) {
      // 仓库地址无效（仅支持 svn / http(s) / file）
      sendJson(res, 400, { error: t('srv.badRepoUrl') });
      return true;
    }
    // 二进制判定**优先于**"文件太大"：文档/图片/压缩包无论多大都是"不支持浏览"
    //（用户实报：7.5MB 的 .doc 只提示"文件太大"，没说清是根本没法预览）。
    // 扩展名已知的二进制**连下载都不必**（省一次 7.5MB 的白拉）——先判、直接返回
    if (isBinaryFile(target)) {
      sendJson(res, 200, { ok: true, binary: true });
      return true;
    }
    try {
      const r = await catRemote(target);
      if (!r.ok) {
        sendJson(res, 200, { ok: false, error: r.error });
        return true;
      }
      const buf = r.buf;
      // 内容探测也在"太大"之前：表外扩展名的二进制（如 .emmx）同样报"不支持浏览"
      if (looksBinary(buf)) {
        sendJson(res, 200, { ok: true, binary: true });
        return true;
      }
      // 走到这里都是**文本**——太大才提示"文件太大"（请用「下载到…」）
      if (buf.length > 2 * 1024 * 1024) {
        // 文件太大（超过 2MB），请「下载到…」查看
        sendJson(res, 200, { ok: false, error: t('srv.repoFileTooBig') });
        return true;
      }
      sendJson(res, 200, { ok: true, text: decodeMixedText(buf) });
    } catch (e) {
      sendJson(res, 200, { ok: false, error: (e as Error).message });
    }
    return true;
  }

  return false;
}
