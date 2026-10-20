/** 搜索端点：文件名搜索与文件内容搜索。
 *
 *  两者共享同一套"限定目录 + 跳过隐藏/node_modules + 深度上限"的遍历口径，
 *  内容搜索额外按 git ls-files 取未忽略文件全集。 */
import fs from 'node:fs';
import path from 'node:path';
import { decodeMixedText } from '../../../shared/text.js';
import { run } from '../../../vcs/exec.js';
import { inRepoRoot, sendJson, vcsOf, MSG_OUT_OF_SCOPE } from '../util.js';
import type { Ctx } from '../util.js';

export async function handle(ctx: Ctx): Promise<boolean> {
  const { res, url } = ctx;
  const p = url.pathname;

  if (p === '/api/search') {
    // 文件名搜索：仅搜索指定目录（dir 相对仓库根，默认根目录），深度限制 + 结果上限
    const { repo } = vcsOf();
    const query = url.searchParams.get('query') ?? '';
    const dirRel = url.searchParams.get('dir') ?? '';
    if (!query.trim()) {
      sendJson(res, 200, { paths: [] });
      return true;
    }
    const start = path.join(repo.root, dirRel);
    if (!inRepoRoot(repo.root, start)) {
      sendJson(res, 403, { error: MSG_OUT_OF_SCOPE() });
      return true;
    }
    const q = query.toLowerCase();
    const out: string[] = [];
    const LIMIT = 100;
    const walk = (dir: string, depth: number) => {
      if (depth > 12 || out.length >= LIMIT) return;
      let entries: fs.Dirent[];
      try {
        // withFileTypes：目录类型直接由 Dirent 给出，省掉"每个条目一次 statSync"——
        // 一次搜索要遍历上万个文件，Windows 上每个 stat 都要过杀软实时扫描，是慢的主因
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        if (out.length >= LIMIT) return; // 命中上限就早停（原先只挡递归，本目录仍全扫）
        const n = e.name;
        if (n === '.svn' || n === '.git' || n.startsWith('.')) continue;
        const p = path.join(dir, n);
        // 软链单独 stat：Dirent.isDirectory() **不跟随符号链接**，直接用它会让"软链指向的目录"
        // 搜不到（Linux 上并不罕见）；普通条目走 Dirent 免 stat
        let isDir = e.isDirectory();
        if (e.isSymbolicLink()) {
          try {
            isDir = fs.statSync(p).isDirectory();
          } catch {
            continue; // 断链：与改动前一致，直接跳过
          }
        }
        // 统一成 '/'：全应用（git 输出的路径、前端取父目录/匹配）都用 '/'，
        // Windows 上 path.relative 给的是 ''，前端 lastIndexOf('/') 取不到父目录 → 点了跳不过去
        if (n.toLowerCase().includes(q)) out.push(path.relative(repo.root, p).split(path.sep).join('/'));
        if (isDir) walk(p, depth + 1);
      }
    };
    walk(start, 0);
    sendJson(res, 200, { paths: out });
    return true;
  }

  if (p === '/api/search-content') {
    // 文件内容搜索：仅搜索指定目录（dir 相对仓库根，默认根目录）。
    // 实测（SCA_HB 4.8 万文件/9.1GB）：常见词 0.2s 级、最坏全量 2.7s——关键在
    //  ①跳二进制（含 NUL 字节）与 >2MB 文件（9.1GB 实际只读 502MB 文本）
    //  ②并发读 ③命中满 200 早停 ④10s 超时兜底
    // 解码走 decodeMixedText（GBK 老工程的中文注释也能搜到）；req close → 停扫（前端连续打字会 abort）
    const { repo } = vcsOf();
    const query = url.searchParams.get('query') ?? '';
    const dirRel = url.searchParams.get('dir') ?? '';
    if (!query.trim()) {
      sendJson(res, 200, { hits: [] });
      return true;
    }
    const start = path.join(repo.root, dirRel);
    if (!inRepoRoot(repo.root, start)) {
      sendJson(res, 403, { error: MSG_OUT_OF_SCOPE() });
      return true;
    }
    const q = query.toLowerCase();
    const LIMIT = 200; // 全局命中上限
    const PER_FILE = 5; // 每文件最多计入的命中行
    const MAX_BYTES = 2 * 1024 * 1024; // 单文件大小上限
    const MAX_FILES = 50000; // 候选文件上限（防极端目录把内存拉爆；超出按截断标注）
    const CONC = 16; // 并发读
    const deadline = Date.now() + 10_000;
    let closed = false;
    res.on('close', () => {
      closed = true;
    });
    const hits: { path: string; line: number; text: string }[] = [];
    /** 停止条件：客户端断开 / 超时 / 命中满 */
    const stop = () => closed || Date.now() > deadline || hits.length >= LIMIT;

    // ---- 候选文件收集：git 用 ls-files（未忽略文件全集），svn / 失败回退遍历 ----
    const files: { abs: string; rel: string }[] = [];
    let capped = false;
    /** 过滤规则（两来源共用）：任一段以 '.' 开头（.git/.svn/隐藏文件）或 node_modules */
    const skipRel = (rel: string) => rel.split('/').some((seg) => seg === 'node_modules' || seg.startsWith('.'));
    const dirPrefix = dirRel ? dirRel.replace(/\/+$/, '') + '/' : '';
    /** git：一次 `git ls-files` 拿"工作区未忽略文件"全集——天然排除 .gitignore 里的
     *  产物目录（node_modules/dist/修改记录 等），也避免"src 与 dist 的命中重复、
     *  早停名额被构建产物挤掉"（实报：搜到 dist/client 的拷贝排在真结果前面）。
     *  失败（非 git 环境/命令异常）→ 回退下方遍历，行为与文件名搜索一致。 */
    let listed = false;
    if (repo.type === 'git') {
      try {
        const r = await run('git', ['ls-files', '-co', '--exclude-standard', '-z'], { cwd: repo.root, timeoutMs: 15_000 });
        if (r.code === 0) {
          listed = true;
          for (const rel of r.stdout.split('\0')) {
            if (!rel) continue;
            if (dirRel && !rel.startsWith(dirPrefix)) continue; // 限定子树之外
            if (skipRel(rel)) continue;
            if (files.length >= MAX_FILES) {
              capped = true;
              break;
            }
            files.push({ abs: path.join(repo.root, rel), rel });
          }
        }
      } catch {
        /* 回退遍历 */
      }
    }
    if (!listed) {
      // 异步遍历（跳过规则与文件名搜索一致，另加 node_modules——
      // 内容搜索不跳它的话，依赖包里的命中会把真实结果淹掉）
      const walk = async (dir: string, depth: number): Promise<void> => {
        if (depth > 12 || stop() || capped) return;
        let entries: fs.Dirent[];
        try {
          entries = await fs.promises.readdir(dir, { withFileTypes: true });
        } catch {
          return;
        }
        for (const e of entries) {
          if (stop() || capped) return;
          const n = e.name;
          if (n === '.svn' || n === '.git' || n === 'node_modules' || n.startsWith('.')) continue;
          const abs = path.join(dir, n);
          // 软链单独 stat：Dirent.isDirectory() 不跟随符号链接（同 /api/search，保持行为一致）
          let isDir = e.isDirectory();
          if (e.isSymbolicLink()) {
            try {
              isDir = fs.statSync(abs).isDirectory();
            } catch {
              continue; // 断链
            }
          }
          if (isDir) {
            await walk(abs, depth + 1);
          } else {
            if (files.length >= MAX_FILES) {
              capped = true;
              return;
            }
            files.push({ abs, rel: path.relative(repo.root, abs).split(path.sep).join('/') });
          }
        }
      };
      await walk(start, 0);
    }

    let timedOut = false;
    let idx = 0;
    const worker = async (): Promise<void> => {
      while (idx < files.length && !stop()) {
        if (Date.now() > deadline) {
          timedOut = true;
          return;
        }
        const f = files[idx++]!;
        let buf: Buffer;
        try {
          const st = await fs.promises.stat(f.abs);
          if (st.size === 0 || st.size > MAX_BYTES) continue;
          buf = await fs.promises.readFile(f.abs);
        } catch {
          continue;
        }
        if (buf.includes(0)) continue; // 含 NUL 字节 = 二进制
        const lines = decodeMixedText(buf).split('\n');
        let perFile = 0;
        for (let i = 0; i < lines.length; i++) {
          if (hits.length >= LIMIT) break; // 并发下别的 worker 可能刚推满上限：push 前再确认，保证不超
          const line = lines[i]!;
          const at = line.toLowerCase().indexOf(q);
          if (at < 0) continue;
          // 命中在行尾时按行首截断会看不到命中词：偏后（>150 字符）就从命中点前 60 字符开窗
          let shown = at > 150 ? '… ' + line.slice(at - 60) : line;
          shown = shown.trim().slice(0, 200);
          hits.push({ path: f.rel, line: i + 1, text: shown });
          perFile++;
          if (perFile >= PER_FILE || hits.length >= LIMIT) break;
        }
      }
    };
    await Promise.all(Array.from({ length: CONC }, worker));
    if (closed) return true; // 客户端已取消（清空输入/切换查询）：连接已断，不回写
    const truncated = timedOut ? ('time' as const) : hits.length >= LIMIT || capped ? ('limit' as const) : undefined;
    sendJson(res, 200, { hits, truncated });
    return true;
  }

  return false;
}
