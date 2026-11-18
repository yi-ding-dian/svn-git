/** SVN 系统凭据缓存（`~/.subversion/auth/svn.simple/`）：解析 / 按 host 匹配 / 定向删除。
 *
 *  背景：svn 命令行的凭据有两个来源——① 本工具的 config.json（「SVN 登录」保存的）；
 *  ② svn **官方凭据缓存**（历史上在别的 svn 客户端登录时存的）。
 *  工具配置为空时会**静默使用**②——界面以前只显示①，导致「没登录却一直能提交」的困惑（用户实报）。
 *  这里把缓存读出来给界面显示；「退出/切换」时由前端二次确认后清除②里匹配的条目。
 *
 *  缓存文件格式（svn HashWrite）：`K <len>\n<key>\nV <len>\n<value>` 记录序列，末尾 END。
 *  **value 按字节长度截取**（可能含换行/非 ASCII），不能按行解析。
 *  匹配粒度：按 realm 里的 `://<host>[:/]` 匹配（防 192.168.0.3 误配 192.168.0.30）；
 *  同一服务器多 realm（同 host）会一并列出/清除——真实服务器通常整机一个 realm。
 *  Windows 的凭据缓存路径/加密方式不同，读不到时自然降级。 */
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

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

/** 删除缓存里匹配该 URL host 的条目，返回已清除的 realm 列表（删不掉的跳过、如实返回）。
 *  **危险操作**：会影响本机其他 svn 客户端（下次操作需重新登录）——调用方须二次确认后再调。 */
export function forgetCacheCreds(url: string): string[] {
  const creds = findCacheCreds(url);
  const cleared: string[] = [];
  for (const c of creds) {
    try {
      fs.unlinkSync(c.file);
      cleared.push(c.realm);
    } catch {
      /* 删不掉（权限等）就跳过，如实返回已清除的 */
    }
  }
  return cleared;
}
