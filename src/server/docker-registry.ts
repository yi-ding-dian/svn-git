/** GHCR 镜像大小查询（registry v2 manifest）。
 *
 *  镜像大小 = config.size + 所有 layer.size（压缩后），近似 docker pull 的下载量，
 *  和安装包产物显示的大小口径一致。
 *  只接受 ghcr.io/owner/pkg 形式的地址，避免把配置文件内容变成任意 URL 请求。 */
import { loadConfig } from '../config.js';

const GHCR = 'https://ghcr.io';
const CACHE_TTL_MS = 10 * 60_000;
const cache = new Map<string, { size: number; at: number }>();

const ACCEPT = [
  'application/vnd.oci.image.index.v1+json',
  'application/vnd.docker.distribution.manifest.list.v2+json',
  'application/vnd.oci.image.manifest.v1+json',
  'application/vnd.docker.distribution.manifest.v2+json',
].join(', ');

function parseGhcr(image: string): { owner: string; pkg: string } | null {
  const m = /^ghcr\.io\/([^/\s]+)\/([^/\s:]+)$/.exec(image.trim());
  if (!m) return null;
  return { owner: m[1]!, pkg: m[2]! };
}

async function fetchJson(url: string, headers: Record<string, string>): Promise<unknown | null> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 8_000);
  try {
    const res = await fetch(url, { headers, signal: ctl.signal });
    if (!res.ok) return null;
    return (await res.json()) as unknown;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** 公开包匿名拿 token；私有包用已存的 GitHub Token 再试一次。 */
async function registryToken(owner: string, pkg: string): Promise<string | null> {
  const url = `${GHCR}/token?scope=repository:${encodeURIComponent(owner)}/${encodeURIComponent(pkg)}:pull&service=ghcr.io`;
  const anon = await fetchJson(url, {});
  const anonToken = (anon as { token?: unknown } | null)?.token;
  if (typeof anonToken === 'string') return anonToken;

  const git = loadConfig().git;
  if (!git?.password) return null;
  const basic = Buffer.from(`${git.username || 'x'}:${git.password}`).toString('base64');
  const authed = await fetchJson(url, { Authorization: `Basic ${basic}` });
  const authedToken = (authed as { token?: unknown } | null)?.token;
  return typeof authedToken === 'string' ? authedToken : null;
}

/** manifest 的 config + layers 之和；不是单架构 manifest 时返回 null */
function totalSize(manifest: unknown): number | null {
  if (!manifest || typeof manifest !== 'object') return null;
  const m = manifest as { config?: { size?: unknown }; layers?: unknown };
  if (!Array.isArray(m.layers)) return null;
  let total = Number(m.config?.size) || 0;
  for (const layer of m.layers) {
    total += Number((layer as { size?: unknown })?.size) || 0;
  }
  return total;
}

/** 查某个镜像标签的压缩后大小；失败/非 ghcr.io 返回 0（界面不显示大小）。 */
export async function dockerImageSize(image: string, tag: string): Promise<number> {
  const key = `${image}:${tag}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.size;

  const repo = parseGhcr(image);
  if (!repo) return 0;
  const token = await registryToken(repo.owner, repo.pkg);
  if (!token) return 0;

  const base = `${GHCR}/v2/${repo.owner}/${repo.pkg}`;
  const headers = { Authorization: `Bearer ${token}`, Accept: ACCEPT };
  const manifest = await fetchJson(`${base}/manifests/${encodeURIComponent(tag)}`, headers);
  let size = totalSize(manifest);

  // 多架构 index：选 linux/amd64 的 manifest 再查
  if (size === null && manifest && typeof manifest === 'object') {
    const list = (manifest as { manifests?: unknown }).manifests;
    if (Array.isArray(list)) {
      const picked =
        list.find((x) => {
          const p = (x as { platform?: { os?: unknown; architecture?: unknown } }).platform;
          return p?.os === 'linux' && p?.architecture === 'amd64';
        }) ?? list[0];
      const digest = (picked as { digest?: unknown } | undefined)?.digest;
      if (typeof digest === 'string') {
        size = totalSize(await fetchJson(`${base}/manifests/${digest}`, headers));
      }
    }
  }

  const value = size ?? 0;
  if (value > 0) cache.set(key, { size: value, at: Date.now() });
  return value;
}
