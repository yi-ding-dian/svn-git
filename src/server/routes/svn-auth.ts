/** SVN 身份与系统凭据缓存：查询「当前实际以谁的身份操作」+ 定向清除缓存凭据。
 *
 *  背景：svn 命令行的凭据有两个来源——① 本工具的 config.json（「SVN 登录」保存的）；
 *  ② svn **官方凭据缓存**（`~/.subversion/auth/svn.simple/`，历史上在别的 svn 客户端登录时存的）。
 *  工具配置为空时会**静默使用**②——界面以前只显示①，导致「没登录却一直能提交」的困惑（用户实报）。
 *  这里把两处都读出来给界面显示；「退出/切换」时由前端二次确认后清除②里匹配的条目。
 *
 *  缓存文件格式（svn HashWrite）：`K <len>\n<key>\nV <len>\n<value>` 记录序列，末尾 END。
 *  **value 按字节长度截取**（可能含换行/非 ASCII），不能按行解析。
 *  匹配粒度：按 realm 里的 `://<host>[:/]` 匹配（防 192.168.0.3 误配 192.168.0.30）；
 *  同一服务器多 realm（同 host）会一并列出/清除——真实服务器通常整机一个 realm。
 *  Windows 的凭据缓存路径/加密方式不同，读不到时自然降级（config 照常返回）。 */
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../../config.js';
import { sendJson, readBody, vcsOf, type Ctx } from './util.js';
import { t } from '../../shared/i18n/index.js';

/** svn 官方凭据缓存目录（Linux/macOS；Windows 路径不同，读不到则降级为空） */
function cacheDir(): string {
  return path.join(os.homedir(), '.subversion', 'auth', 'svn.simple');
}

/** 解析一个 svn.simple 凭据文件 → KV 表；格式不认识时返回 null（跳过该文件，不影响其他） */
function parseSimple(buf: Buffer): Record<string, string> | null {
  const out: Record<string, string> = {};
  let i = 0;
  /** 读到下一个 \n 为止（不含）；EOF 返回 null */
  const readLine = (): string | null => {
    const nl = buf.indexOf(0x0a, i);
    if (nl < 0) return null;
    const s = buf.toString('utf8', i, nl);
    i = nl + 1;
    return s;
  };
  while (i < buf.length) {
    const head = readLine();
    if (head === null || head === 'END') break;
    if (!head.startsWith('K ')) continue; // 未知行容错跳过
    const key = readLine();
    const vLine = readLine();
    if (key === null || vLine === null || !vLine.startsWith('V ')) return null;
    const len = Number(vLine.slice(2));
    if (!Number.isFinite(len) || len < 0 || i + len > buf.length) return null;
    out[key] = buf.toString('utf8', i, i + len);
    i += len;
    if (buf[i] === 0x0a) i += 1; // 值后通常紧跟换行（值本身不含）
  }
  return out;
}

export interface CacheCred {
  file: string;
  username: string;
  realm: string;
}
/** 找出缓存里匹配该 URL host 的凭据条目（realm 里出现 `://<host>` 且 host 后是 : 或 /）。
 *  导出给 branch 路由：删除分支弹窗预填「操作系统凭据缓存里的用户名」（工具配置为空时） */
export function findCacheCreds(url: string): CacheCred[] {
  let host = '';
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return [];
  }
  if (!host) return []; // file:// 等无 host
  const dir = cacheDir();
  if (!fs.existsSync(dir)) return [];
  // 边界匹配：://host 后必须是 : 或 /（防 192.168.0.3 误配 192.168.0.30）
  const re = new RegExp('://' + host.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?=[:/])', 'i');
  const out: CacheCred[] = [];
  for (const f of fs.readdirSync(dir)) {
    try {
      const full = path.join(dir, f);
      const kv = parseSimple(fs.readFileSync(full));
      const realm = kv?.['svn:realmstring'] ?? '';
      const username = kv?.username ?? '';
      if (username && re.test(realm)) out.push({ file: full, username, realm });
    } catch {
      /* 单文件读失败不影响其他 */
    }
  }
  return out;
}

export async function handle(ctx: Ctx): Promise<boolean> {
  const { req, res, url } = ctx;
  const p = url.pathname;

  if (p === '/api/svn-verify' && req.method === 'POST') {
    // 保存 SVN 凭据前验证：用临时账号密码在工作副本根 URL 上跑 `svn log -l 1`（与历史页同命令同路径）。
    // 密码只在本次请求内存里（不落盘、不进日志）；--no-auth-cache 不写系统凭据缓存。
    const { vcs, repo } = vcsOf();
    if (repo.type !== 'svn' || !vcs.verifyCredential) {
      // 非 SVN 仓库没有可验证的凭据：直接放行
      sendJson(res, 200, { ok: true, skipped: true });
      return true;
    }
    const body = await readBody(req);
    sendJson(
      res,
      200,
      await vcs.verifyCredential(
        String(body.username ?? ''),
        String(body.password ?? ''),
        Boolean(body.trustServerCert ?? false),
      ),
    );
    return true;
  }

  if (p === '/api/svn-identity' && req.method === 'GET') {
    // 当前 SVN 身份（只读）：工具配置账号 + 系统凭据缓存账号（按 ?url= 的 host 匹配）
    const targetUrl = String(url.searchParams.get('url') ?? '').trim();
    const cfgUser = loadConfig().svn.username;
    const creds = targetUrl ? findCacheCreds(targetUrl) : [];
    const first = creds[0];
    sendJson(res, 200, {
      ok: true,
      config: cfgUser ? { username: cfgUser } : null,
      cache: first ? { username: first.username, realms: creds.map((c) => c.realm) } : null,
    });
    return true;
  }

  if (p === '/api/svn-forget-cache' && req.method === 'POST') {
    // 清除系统凭据缓存中匹配该 URL host 的条目（「退出登录 / 切换账号」用）。
    // **危险操作**：会影响本机其他 svn 客户端（下次操作需重新登录）——前端必须二次确认后再调。
    const body = await readBody(req);
    const targetUrl = String(body.url ?? '').trim();
    if (!targetUrl) {
      // 缺少路径
      sendJson(res, 400, { error: t('srv.missingPath') });
      return true;
    }
    const creds = findCacheCreds(targetUrl);
    const cleared: string[] = [];
    for (const c of creds) {
      try {
        fs.unlinkSync(c.file);
        cleared.push(c.realm);
      } catch {
        /* 删不掉（权限等）就跳过，如实返回已清除的 */
      }
    }
    sendJson(res, 200, { ok: true, cleared });
    return true;
  }

  return false;
}
