/** 应用自身在线升级端点。
 *
 *  真正的检查/下载/安装在 main（electron-updater 只能在 Electron 主进程跑），
 *  这里只做 HTTP 转发和加速设置读写——和 /api/pick-dir 的注入方式一致。
 *  纯 Node（WSL 包）或源码运行时没有注入处理器，返回 unsupported，前端只显示说明。 */
import { sendJson, readBody, type Ctx } from './util.js';
import { loadConfig, saveConfig } from '../../config.js';
import { t } from '../../shared/i18n/index.js';
import type { AppUpdateHandlers, AppUpdateProxySettings, AppUpdateStatus } from '../../shared/app-update.js';

/** main 注入的处理器；纯 Node 为 null */
let handlers: AppUpdateHandlers | null = null;

export function setAppUpdateHandlers(next: AppUpdateHandlers | null): void {
  handlers = next;
}

function proxyFromConfig(): AppUpdateProxySettings {
  const cfg = loadConfig();
  return {
    // 缺省 true：老配置文件里没有 update 段时，升级默认走加速
    enabled: cfg.update?.githubDownloadProxy !== false,
    prefix: cfg.update?.githubDownloadProxyUrl ?? '',
  };
}

function fallbackStatus(): AppUpdateStatus {
  return {
    // Electron 里没注入处理器 = 源码运行；纯 Node = WSL 包
    mode: process.versions.electron ? 'source' : 'node',
    supported: false,
    phase: 'unsupported',
    proxy: proxyFromConfig(),
  };
}

export async function handle(ctx: Ctx): Promise<boolean> {
  const { req, res, p } = ctx;

  if (p === '/api/app-update/status' && req.method === 'GET') {
    sendJson(res, 200, handlers ? handlers.status() : fallbackStatus());
    return true;
  }

  if (p === '/api/app-update/check' && req.method === 'POST') {
    if (!handlers) {
      sendJson(res, 200, fallbackStatus());
      return true;
    }
    try {
      sendJson(res, 200, await handlers.check());
    } catch (e) {
      sendJson(res, 500, { error: (e as Error).message });
    }
    return true;
  }

  if (p === '/api/app-update/download' && req.method === 'POST') {
    sendJson(res, 200, handlers ? handlers.download() : fallbackStatus());
    return true;
  }

  if (p === '/api/app-update/install' && req.method === 'POST') {
    sendJson(res, 200, handlers ? handlers.install() : { ok: false, error: 'unsupported' });
    return true;
  }

  if (p === '/api/app-update/proxy' && req.method === 'GET') {
    sendJson(res, 200, proxyFromConfig());
    return true;
  }

  if (p === '/api/app-update/proxy' && req.method === 'POST') {
    const body = await readBody(req);
    const enabled = Boolean(body.enabled);
    const prefix = String(body.prefix ?? '').trim();
    if (prefix && !/^https?:\/\/[^\s]+$/i.test(prefix)) {
      // 加速地址必须以 http:// 或 https:// 开头
      sendJson(res, 400, { error: t('srv.gitDownloadProxyBadPrefix') });
      return true;
    }
    const cfg = loadConfig();
    cfg.update = {
      ...cfg.update,
      githubDownloadProxy: enabled,
      githubDownloadProxyUrl: prefix,
    };
    saveConfig(cfg);
    handlers?.setProxy({ enabled, prefix });
    sendJson(res, 200, { ok: true, enabled, prefix });
    return true;
  }

  return false;
}
