/** 宿主环境域端点：跟**运行本工具的这台机器**打交道（打开方式/图标/字体/环境安装/目录选择）。
 *  与仓库无关——路径可以不在任何仓库内，故不做 inRepoRoot 校验。
 *  （名字不叫 sys：项目里已有 src/platform/ 做平台抽象，"系统"太笼统，容易和它撞语义。） */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { detectRepo } from '../vcs/detect.js';
import { platform } from '../platform/index.js';
import { BINARY_EXTS, compareName } from '../shared/types.js';
import { run } from '../vcs/exec.js';
import { inRepoRoot, sendJson, readBody, vcsOf, START_DIR, MSG_PATH_OUT_OF_BOUNDS, type Ctx } from './util.js';
import type { RepoInfo } from '../vcs/index.js';

/** 系统目录选择器（Electron dialog 注入；纯 node 为 null） */
let pickDirHandler: (() => Promise<string | null>) | null = null;
export function setPickDirHandler(fn: () => Promise<string | null>): void {
  pickDirHandler = fn;
}

/** 目录浏览（打开仓库页用）：列目录 + 仓库识别 */
function browseDirs(dir: string): { entries: { name: string; isDir: boolean }[]; repo: RepoInfo | null } {
  const out: { name: string; isDir: boolean }[] = [];
  const cur = path.resolve(dir);
  let entries: string[];
  try {
    entries = fs.readdirSync(cur);
  } catch (err) {
    throw new Error(`无法读取目录: ${(err as Error).message}`);
  }
  if (cur !== '/') out.push({ name: '..', isDir: true });
  const dirs: string[] = [];
  const files: string[] = [];
  for (const n of entries) {
    if (n.startsWith('.')) continue; // 隐藏目录默认过滤
    let isDir = false;
    try {
      isDir = fs.statSync(path.join(cur, n)).isDirectory();
    } catch {
      continue;
    }
    if (isDir) dirs.push(n);
    else files.push(n);
  }
  dirs.sort(compareName);
  files.sort(compareName);
  for (const d of dirs) out.push({ name: d, isDir: true });
  for (const f of files) out.push({ name: f, isDir: false });
  return { entries: out, repo: detectRepo(cur) };
}

/** 扩展名 → MIME（办公文档/图片/文本/压缩包,用于匹配系统 .desktop 程序） */
const EXT_MIME: Record<string, string> = {
  pdf: 'application/pdf', doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  odt: 'application/vnd.oasis.opendocument.text', ods: 'application/vnd.oasis.opendocument.spreadsheet', odp: 'application/vnd.oasis.opendocument.presentation',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', svg: 'image/svg+xml', webp: 'image/webp', bmp: 'image/bmp', ico: 'image/x-icon',
  txt: 'text/plain', md: 'text/markdown', log: 'text/plain', rst: 'text/plain', csv: 'text/csv',
  zip: 'application/zip', rar: 'application/vnd.rar', '7z': 'application/x-7z-compressed', tar: 'application/x-tar', gz: 'application/gzip',
};

export async function handle(ctx: Ctx): Promise<boolean> {
  const { req, res, url } = ctx;
  const p = url.pathname;

      if (p === '/api/fonts') {
        // 系统字体表（字体设置：不存在的字体不给选；系统级查询无仓库语义，仅受 CSRF 同源限制）
        sendJson(res, 200, { families: platform.listFontFamilies() });
        return true;
      }

      if (p === '/api/browse') {
        const dir = String(url.searchParams.get('path') ?? START_DIR);
        const result = browseDirs(dir);
        sendJson(res, 200, { ...result, dir });
        return true;
      }

      if (p === '/api/mkdir' && req.method === 'POST') {
        // 目录选择器：新建文件夹——系统级目录操作（打开项目的路径选择处使用,路径可不在任何仓库内,
        // 无仓库路径语义,故不做 inRepoRoot 校验,仅受 CSRF 同源限制（本地凭证场景））
        const body = await readBody(req);
        const dir = String(body.path ?? '');
        if (!dir) {
          sendJson(res, 400, { error: '路径为空' });
          return true;
        }
        try {
          fs.mkdirSync(dir);
          sendJson(res, 200, { ok: true });
        } catch (e) {
          sendJson(res, 500, { error: (e as Error).message });
        }
        return true;
      }

      if (p === '/api/rename' && req.method === 'POST') {
        // 目录选择器：重命名文件夹——同 mkdir,系统级操作不校验仓库路径。
        const body = await readBody(req);
        const from = String(body.from ?? '');
        const to = String(body.to ?? '');
        if (!from || !to) {
          sendJson(res, 400, { error: '路径为空' });
          return true;
        }
        try {
          fs.renameSync(from, to);
          sendJson(res, 200, { ok: true });
        } catch (e) {
          sendJson(res, 500, { error: (e as Error).message });
        }
        return true;
      }

      if (p === '/api/pick-dir') {
        // 系统目录选择对话框（Electron 打包版可用；纯 node 返回不支持）
        if (!pickDirHandler) {
          sendJson(res, 200, { path: null, unsupported: true });
          return true;
        }
        const picked = await pickDirHandler();
        sendJson(res, 200, { path: picked, unsupported: false });
        return true;
      }

      if (p === '/api/shutdown' && req.method === 'POST') {
        sendJson(res, 200, { ok: true });
        setTimeout(() => process.exit(0), 200);
        return true;
      }

      if (p === '/api/env-check') {
        const check = async (cmd: string): Promise<{ installed: boolean; version: string }> => {
          try {
            const r = await run(cmd, ['--version'], { timeoutMs: 10_000 });
            return { installed: r.code === 0, version: r.stdout.split('\n')[0]?.trim() ?? '' };
          } catch {
            // 命令不存在(如未安装 svn)→ 视为未安装,而非接口 500
            return { installed: false, version: '' };
          }
        };
        const [svn, git] = await Promise.all([check('svn'), check('git')]);
        sendJson(res, 200, { svn, git });
        return true;
      }

      if (p === '/api/apps-for') {
        // 系统可用打开方式（办公/图片/文本/压缩文档）：按 MimeType 匹配 .desktop 程序
        const ext = (url.searchParams.get('ext') ?? '').toLowerCase();
        const mime = EXT_MIME[ext];
        // 文本族父类回退：md/log/rst 等子类型（text/markdown 等）几乎无程序声明,
        // 回退用 text/plain 匹配——任意文本编辑器皆可打开
        const mimes = new Set<string>();
        if (mime) {
          mimes.add(mime);
          if (mime.startsWith('text/') && mime !== 'text/plain') mimes.add('text/plain');
        } else if (!BINARY_EXTS.has(ext)) {
          // 代码/配置等未映射扩展（json/sh/yaml/html…）:文本编辑器兜底
          mimes.add('text/plain');
        }
        // Linux 按 MimeType 匹配 .desktop 程序;Windows 无 .desktop 清单,按注册表枚举该扩展名已关联程序
        const apps = platform.listOpenWithApps(ext, mimes);
        sendJson(res, 200, {
          apps,
          // Windows 额外提供「选择其他应用…」：经 shell32,OpenAs_RunDLL 调系统「打开方式」选择器
          chooseOpen: platform.chooseOpenCmd,
        });
        return true;
      }

      if (p === '/api/icon') {
        // 图标：Windows = 从 .exe/.ico 提取嵌入图标；Linux = 按 .desktop Icon 名在系统图标目录找图片
        const key = (url.searchParams.get('k') ?? '').trim();
        if (!key) {
          res.writeHead(404);
          res.end();
          return true;
        }
        const icon = platform.resolveAppIcon(key);
        if (icon) {
          res.writeHead(200, { 'Content-Type': icon.contentType, 'Cache-Control': 'public, max-age=3600' });
          res.end(icon.data);
          return true;
        }
        res.writeHead(404);
        res.end();
        return true;
      }

      if (p === '/api/open-with' && req.method === 'POST') {
        // 用指定系统程序打开仓库内文件（win 注册表 / linux .desktop Exec 模板解析；平台逻辑下沉到 src/platform）
        const { repo } = vcsOf();
        const body = await readBody(req);
        const rel = String(body.path ?? '');
        const exec = String(body.exec ?? '');
        const abs = path.resolve(repo.root, rel);
        if (!inRepoRoot(repo.root, abs)) {
          sendJson(res, 400, { error: MSG_PATH_OUT_OF_BOUNDS });
          return true;
        }
        if (!fs.existsSync(abs)) {
          sendJson(res, 404, { error: '文件不存在' });
          return true;
        }
        const r = await platform.openWithApp(abs, exec, rel);
        sendJson(res, r.ok ? 200 : 500, r.ok ? { ok: true, message: r.message } : { ok: false, error: r.message });
        return true;
      }

      if (p === '/api/app-menu') {
        // 系统应用菜单集成（AppImage 运行方式）：GET 查状态；POST 安装；DELETE 卸载
        if (req.method === 'GET') {
          const desktopPath = path.join(os.homedir(), '.local', 'share', 'applications', 'svngit.desktop');
          sendJson(res, 200, {
            appImage: Boolean(process.env.APPIMAGE),
            installed: process.platform === 'linux' && fs.existsSync(desktopPath),
          });
          return true;
        }
        if (req.method === 'POST') {
          const appImagePath = process.env.APPIMAGE;
          if (!appImagePath) {
            sendJson(res, 400, { error: '仅 AppImage 运行方式支持；源码运行请用 scripts/install-appimage.sh' });
            return true;
          }
          sendJson(res, 200, platform.installAppMenu(appImagePath));
          return true;
        }
        if (req.method === 'DELETE') {
          sendJson(res, 200, platform.uninstallAppMenu());
          return true;
        }
      }

      if (p === '/api/net-check') {
        // 远程连通性检测（网络灯）：只握手不取数据(git ls-remote / svn ls),8s 超时。
        // 区分"网络断"与"认证失败"：认证失败=网络通的（前端显示绿,tooltip 说明认证问题）
        const { repo, vcs } = vcsOf();
        let ok = false;
        let reason = '未知错误';
        try {
          if (repo.type === 'git') {
            const u = await run('git', ['remote', 'get-url', 'origin'], { cwd: repo.root, timeoutMs: 8_000 });
            if (u.code !== 0 || !u.stdout.trim()) {
              ok = true; // 未配置远程：无远程可检,不视为离线
              reason = '未配置远程';
            } else {
              const r = await run('git', ['ls-remote', 'origin'], { cwd: repo.root, timeoutMs: 8_000 });
              const errText = (r.stderr + '\n' + r.stdout).trim();
              if (r.code === 0) {
                ok = true; reason = '网络正常';
              } else if (/auth|credential|401|403|could not read Username|terminal prompts/i.test(errText)) {
                ok = true; reason = '已连通（认证失败，需检查令牌）';
              } else {
                ok = false; reason = errText.split('\n')[0] || '连接失败';
              }
            }
          } else {
            // svn: 访问仓库 URL（工作副本 svn info 无网络请求,必须直接打 URL）。
            // repo.url 恒空（detectRepo 不含 url），改用 vcs.info() 与 /api/info 同源获取
            const info = await vcs.info?.();
            const url = info?.url ?? repo.url;
            if (!url) {
              ok = true; reason = '未配置仓库 URL';
            } else {
              const r = await run('svn', ['ls', url], { timeoutMs: 8_000 });
              const errText = r.stderr.trim();
              if (r.code === 0) {
                ok = true; reason = '网络正常';
              } else if (/E170001|Authorization failed|Authentication failed/i.test(errText)) {
                ok = true; reason = '已连通（认证失败，请检查账号）';
              } else {
                ok = false; reason = errText.split('\n')[0] || '连接失败';
              }
            }
          }
        } catch (e) {
          ok = false;
          reason = (e as Error).message;
        }
        sendJson(res, 200, { ok, reason });
        return true;
      }

      if (p === '/api/env-install/stream') {
        // SSE：流式执行系统安装，前端显示实时日志/进度（平台差异下沉到 src/platform：win=winget 引导，linux=免密 sudo 自动装）
        const tool = (url.searchParams.get('tool') ?? 'both') as 'svn' | 'git' | 'both';
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        });
        const send = (data: Record<string, unknown>) => res.write(`data: ${JSON.stringify(data)}\n\n`);
        await platform.envInstall(tool, send, () => res.end());
        return true;
      }

  return false;
}
