/** GET /api/transfer-progress：传输进度（顶栏任务面板每秒轮询）。 */
import { sendJson, type Ctx } from '../http/response.js';
import { progressGet } from '../../transfer-progress.js';

export async function handle(ctx: Ctx): Promise<boolean> {
  const { req, res, url, p } = ctx;
  if (p === '/api/transfer-progress' && req.method === 'GET') {
    // 传输进度（顶栏任务面板每秒轮询）：只读内存里的进度表，不碰磁盘、不联网。
    // chan = 目标目录（获取）或 'push' / 'pull'（推送/拉取）
    sendJson(res, 200, progressGet(url.searchParams.get('chan') ?? ''));
    return true;
  }
  return false;
}
