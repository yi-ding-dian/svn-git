/** SVN 实现：包装 svn 命令行，--xml 机器输出解析，密码走 stdin */
import path from 'node:path';
import fs from 'node:fs';
import { XMLParser } from 'fast-xml-parser';
import { run } from './exec.js';
import type { FileStatus, LogEntry, RepoInfo, SvnLayout, VcsResult } from './types.js';

export interface SvnCred {
  username: string;
  password: string;
  trustServerCert?: boolean;
}

/** SVN 认证失败错误码（E170001: auth failed; E170013: 底层 IO/连接错误） */
const AUTH_ERR = /E170001|Authentication failed|authorization failed/i;

/** svn status --xml 的 item 单词 -> 统一状态码 */
const ITEM_MAP: Record<string, string> = {
  modified: 'M',
  added: 'A',
  deleted: 'D',
  unversioned: '?',
  missing: '!',
  conflicted: 'C',
  replaced: 'R',
  external: 'X',
  ignored: 'I',
  incomplete: '!',
  obstructed: '~',
  merged: 'M',
};

export class SvnVcs {
  private xml = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });

  constructor(private repo: RepoInfo, private cred: SvnCred | null) {}

  /** 基础参数：凭据注入 + 非交互 */
  private baseArgs(): string[] {
    const args: string[] = [];
    if (this.cred?.username) {
      args.push('--username', this.cred.username);
      args.push('--password-from-stdin');
      args.push('--non-interactive');
    }
    if (this.cred?.trustServerCert) {
      args.push('--trust-server-cert');
    }
    return args;
  }

  private exec(args: string[], extra: { stdinData?: string; timeoutMs?: number; signal?: AbortSignal } = {}) {
    const stdinData = extra.stdinData ?? (this.cred?.username ? this.cred.password + '\n' : undefined);
    return run('svn', this.baseArgs().concat(args), {
      cwd: this.repo.root,
      stdinData,
      timeoutMs: extra.timeoutMs ?? 120_000,
      signal: extra.signal,
    });
  }

  /** 认证失败检查，返回错误信息或 null */
  authError(res: { stderr: string; stdout: string }): string | null {
    const s = res.stderr + '\n' + res.stdout;
    if (AUTH_ERR.test(s)) {
      const m = s.match(/E\d{6}|authentication failed|authorization failed/i);
      return `SVN 认证失败${m ? `（${m[0]}）` : ''}，请检查账号密码（按 o 设置）`;
    }
    return null;
  }

  /** 统一失败返回：认证失败时携带结构化 code（服务层透传,不再正则匹配文案） */
  private fail(auth: string | null, msg: string): VcsResult {
    return { ok: false, message: auth ?? msg, code: auth ? 'AUTH' : undefined };
  }

  /** svn info：URL、revision */
  async info(): Promise<{ url?: string; revision?: string; relUrl?: string }> {
    const res = await this.exec(['info', '--xml']);
    if (res.code !== 0) {
      const auth = this.authError(res);
      if (auth) throw new Error(auth);
      return {};
    }
    const doc = this.xml.parse(res.stdout);
    const entry = doc?.info?.entry ?? {};
    return {
      url: String(entry?.url ?? ''),
      revision: String(entry['@_revision'] ?? ''),
      relUrl: String(entry?.relative_url ?? ''),
    };
  }

  /** svn status --xml：工作副本状态 */
  async status(pathRel?: string): Promise<FileStatus[]> {
    // pathRel:限定扫描范围(大仓库中的子项目),只返回该路径内状态,避免全仓库扫描卡顿
    const args = ['status', '--xml'];
    if (pathRel) args.push(pathRel);
    const res = await this.exec(args);
    if (res.code !== 0) {
      const auth = this.authError(res);
      if (auth) throw new Error(auth);
      throw new Error(`svn status 失败: ${res.stderr.trim()}`);
    }
    const doc = this.xml.parse(res.stdout);
    const targets = doc?.status?.target ?? [];
    const list: FileStatus[] = [];
    const targetsArr = Array.isArray(targets) ? targets : [targets];
    for (const t of targetsArr) {
      const entries = t?.entry;
      if (!entries) continue;
      const arr = Array.isArray(entries) ? entries : [entries];
      for (const e of arr) {
        const relPath = e['@_path'] ?? '';
        const wc = e['wc-status'] ?? {};
        const item = String(wc['@_item'] ?? 'none');
        if (item === 'none' || item === 'normal') continue; // 无变化条目
        const code = ITEM_MAP[item] ?? '?';
        const isDir = String(wc['@_kind'] ?? e['@_kind'] ?? 'file') === 'dir';
        list.push({
          path: relPath,
          code,
          isDir,
          absPath: path.join(this.repo.root, relPath),
        });
      }
    }
    return list;
  }

  /** svn log -v --xml：历史记录（可限定路径） */
  /** 解析 svn log --xml -v 输出为 LogEntry[]（log 与 preflight 共用） */
  private parseLogXml(stdout: string): LogEntry[] {
    const doc = this.xml.parse(stdout);
    const entries = doc?.log?.logentry ?? [];
    const arr = Array.isArray(entries) ? entries : entries ? [entries] : [];
    return arr.map((e: any) => {
      const changed: { action: string; path: string }[] = [];
      const paths = e.paths?.path;
      if (paths) {
        const pArr = Array.isArray(paths) ? paths : [paths];
        for (const p of pArr) {
          changed.push({ action: String(p['@_action'] ?? ''), path: String(p['#text'] ?? p) });
        }
      }
      return {
        rev: String(e['@_revision'] ?? ''),
        author: String(e.author ?? ''),
        // svn log 的 date 是 UTC(如 2026-08-20T07:47:00Z):转本地时区,格式保持 "2026-08-20 15:47"
        date: (() => {
          const d = new Date(String(e.date ?? ''));
          if (isNaN(d.getTime())) return String(e.date ?? '');
          const pad = (n: number) => String(n).padStart(2, '0');
          return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
        })(),
        msg: String(e.msg ?? '').trim(),
        changed,
      };
    });
  }

  async log(limit = 200, pathRel?: string, _offset = 0, afterRev?: string): Promise<LogEntry[]> {
    // -r HEAD:1 范围写法：显式起点 HEAD（wc 可能停在旧 revision，mixed revision 下默认查询会查空），
    // 注意必须是 HEAD:1 范围而非 -r HEAD 单版本（单版本只返回该 revision 一条记录）
    // limit<=0 = 全量（不带 -l）；afterRev=追加续拉（从该版本之后继续拉旧历史，-r rev-1:1）
    const args = ['log', '-v', '--xml'];
    if (afterRev) args.push('-r', `${Number(afterRev) - 1}:1`);
    else args.push('-r', 'HEAD:1');
    if (limit > 0) args.push('-l', String(limit));
    if (pathRel) args.push(pathRel);
    const res = await this.exec(args);
    if (res.code !== 0) {
      const auth = this.authError(res);
      if (auth) throw new Error(auth);
      throw new Error(`svn log 失败: ${res.stderr.trim()}`);
    }
    return this.parseLogXml(res.stdout);
  }

  /** svn diff：工作区 vs 版本库，或 -r A:B 版本间；可限定路径 */
  async diff(a?: string, b?: string, pathRel?: string): Promise<{ ok: boolean; output: string; error?: string }> {
    const args = ['diff'];
    if (a && b) args.push('-r', `${a}:${b}`);
    else if (a) args.push('-r', a);
    if (pathRel) args.push(pathRel);
    const res = await this.exec(args, { timeoutMs: 120_000 });
    return {
      ok: res.code === 0,
      output: res.stdout,
      error: res.code !== 0 ? res.stderr.trim() : undefined,
    };
  }

  /** svn diff -r a:b URL（URL 用 ^/ 仓库根相对或完整 URL，不依赖本地工作副本） */
  async diffUrl(a: string, b: string, url: string): Promise<{ ok: boolean; output: string; error?: string }> {
    const res = await this.exec(['diff', '-r', `${a}:${b}`, url], { timeoutMs: 120_000 });
    return {
      ok: res.code === 0,
      output: res.stdout,
      error: res.code !== 0 ? res.stderr.trim() : undefined,
    };
  }

  /** svn add（svn add 默认递归目录）；已版本化文件（W150002）自动跳过不报错 */
  async add(relPaths: string[]): Promise<VcsResult> {
    const res = await this.exec(['add', '--parents', ...relPaths]);
    if (res.code !== 0) {
      const auth = this.authError(res);
      if (res.stderr.includes('W150002')) {
        return { ok: true, message: '添加完成（已版本化的文件已自动跳过）' };
      }
      return this.fail(auth, res.stderr.trim() || 'svn add 失败');
    }
    return { ok: true, message: res.stderr.trim() || `已添加 ${relPaths.length} 项` };
  }

  /** svn commit */
  async commit(relPaths: string[], msg: string): Promise<VcsResult> {
    const args = relPaths.length ? ['commit', ...relPaths, '-m', msg] : ['commit', '-m', msg];
    const res = await this.exec(args, { timeoutMs: 300_000 });
    if (res.code !== 0) {
      const auth = this.authError(res);
      return this.fail(auth, res.stderr.trim() || 'svn commit 失败');
    }
    // 中英文兼容提取版本号（英文 "Committed revision 13." / 中文 "提交后的版本为 13。"）
    const m = res.stdout.match(/Committed revision\s+(\d+)|版本\s*为?\s*r?(\d+)/);
    const rev = m?.[1] ?? m?.[2];
    return { ok: true, message: rev ? `提交成功，版本 r${rev}` : '提交成功' };
  }

  /** 提取 svn 警告行（中英文：svn: 警告: / svn: warning:），原样保留 */
  private extractWarnings(...texts: string[]): string[] {
    const re = /^svn:\s*(警告|warning):.*$/gm;
    const out: string[] = [];
    for (const t of texts) {
      for (const m of t.matchAll(re)) out.push(m[0].trimEnd());
    }
    return out;
  }

  /** 解析 svn update 文本输出（中英文兼容）为文件列表，code 为终端式状态字母（U/A/D/C/G/R…） */
  private parseUpdateFiles(stdout: string): { path: string; status: string; code: string }[] {
    // 英文: "U   file.cpp" / "A   dir/"；中文: "已更新   路径"
    const EN_MAP: Record<string, string> = { U: 'updated', A: 'added', D: 'deleted', C: 'conflicted', G: 'merged', E: 'updated', R: 'replaced' };
    const CN_MAP: Record<string, [string, string]> = {
      已更新: ['updated', 'U'],
      已添加: ['added', 'A'],
      已删除: ['deleted', 'D'],
      冲突: ['conflicted', 'C'],
      已合并: ['merged', 'G'],
      跳过: ['skipped', 'S'],
      已替换: ['replaced', 'R'],
    };
    const files: { path: string; status: string; code: string }[] = [];
    for (const line of stdout.split('\n')) {
      const mEn = line.match(/^([UADCGER])\s+(.+)$/);
      if (mEn && mEn[1] && mEn[2]) {
        const c = mEn[1];
        files.push({ path: mEn[2].trim(), status: EN_MAP[c] ?? c, code: c });
        continue;
      }
      const mCn = line.match(/^(已更新|已添加|已删除|冲突|已合并|跳过|已替换)\s+(.+)$/);
      if (mCn && mCn[1] && mCn[2]) {
        const [status, code] = CN_MAP[mCn[1]] ?? [mCn[1], mCn[1].slice(0, 1)];
        files.push({ path: mCn[2].trim(), status, code });
      }
    }
    return files;
  }

  /** 从 update 输出解析当前版本号（中英文），取不到返回 null */
  private revOf(text: string): string | null {
    // 有更新: "更新到版本 3。" / "Updated to revision 3."；已最新: "版本 3。"
    const m = text.match(/更新到版本\s*(\d+)|Updated to revision\s*(\d+)|版本\s*(\d+)\s*。/);
    return m ? (m[1] ?? m[2] ?? m[3] ?? null) : null;
  }

  /** svn update（可限定目录），返回更新文件列表 */
  async update(pathRel?: string, signal?: AbortSignal): Promise<VcsResult & { files?: { path: string; status: string; code: string }[] }> {
    // svn update 无 --xml 选项，解析文本输出（中英文兼容）
    const args = ['update'];
    if (pathRel) args.push(pathRel);
    const res = await this.exec(args, { timeoutMs: 300_000, signal });
    if (res.aborted) return { ok: false, message: '更新已取消' };
    // svn 部分失败时 exit code 可能为 0，错误码出现在输出中（如 E155007）
    if (res.code !== 0 || /svn: E\d{6}/.test(res.stdout + res.stderr)) {
      const errText = res.stdout + res.stderr;
      // E205011 外部定义失败（svn:externals 引用不可达/无权限）：
      // 自动用 --ignore-externals 重试一次，跳过外部引用先更新普通文件
      if (errText.includes('E205011')) {
        const retry = await this.exec(['update', ...(pathRel ? [pathRel] : []), '--ignore-externals'], { timeoutMs: 300_000, signal });
        if (retry.aborted) return { ok: false, message: '更新已取消' };
        if (retry.code === 0 && !/svn: E\d{6}/.test(retry.stdout + retry.stderr)) {
          // 第一次失败的输出可能已含普通文件更新行（svn 先更新文件后处理外部定义），合并两次结果按路径去重
          const seen = new Set<string>();
          const files = [...this.parseUpdateFiles(res.stdout), ...this.parseUpdateFiles(retry.stdout)].filter((f) =>
            seen.has(f.path) ? false : (seen.add(f.path), true),
          );
          // 外部定义失败的完整警告（W205011/W175013…）原样带回，界面"有什么提示什么"
          const warnings = this.extractWarnings(res.stdout, res.stderr, retry.stdout, retry.stderr);
          // 版本号从两次输出合并解析（第一次失败前 svn 可能已把文件更新完，版本行在第一次输出里）
          const rev = this.revOf(res.stdout + res.stderr + retry.stdout + retry.stderr);
          const msg =
            files.length > 0
              ? `更新了 ${files.length} 个文件（外部引用同步失败已跳过）${rev ? `，当前版本 r${rev}` : ''}`
              : retry.stderr.trim() || `外部引用同步失败已跳过，其余已是最新${rev ? `（当前 r${rev}）` : ''}`;
          return { ok: true, message: msg, files, warnings: warnings.length ? warnings : undefined };
        }
        // 重试（跳过外部引用）仍失败：提示原始错误并说明已尝试跳过
        const auth = this.authError(res);
        const errMsg = errText.match(/svn: E\d{6}[^\n]*/)?.[0];
        return this.fail(auth, `${errMsg ?? (res.stderr.trim() || 'svn update 失败')}（已尝试跳过外部引用仍失败）`);
      }
      const auth = this.authError(res);
      const errMsg = errText.match(/svn: E\d{6}[^\n]*/)?.[0];
      return this.fail(auth, errMsg ?? (res.stderr.trim() || 'svn update 失败'));
    }
    const files = this.parseUpdateFiles(res.stdout);
    // 更新成功但 svn 输出含警告（如 W205011）时原样带回，界面"有什么提示什么"
    const warnings = this.extractWarnings(res.stdout, res.stderr);
    // 当前版本号：优先解析 update 输出，无输出时补查 svn info（"已是最新"场景需要显示当前版本）
    let rev = this.revOf(res.stdout + res.stderr);
    if (!rev) {
      const info = await this.exec(['info', '--show-item', 'revision'], {});
      rev = info.stdout.trim() || null;
    }
    const msg =
      files.length > 0
        ? `更新了 ${files.length} 个文件${rev ? `，当前版本 r${rev}` : ''}`
        : rev
          ? `已是最新版本（当前 r${rev}）`
          : res.stderr.trim() || '已是最新版本';
    return { ok: true, message: msg, files, warnings: warnings.length ? warnings : undefined };
  }

  /** 恢复缺失文件（status '!' = 磁盘删除但版本库还在 → revert 拉回），返回恢复的文件列表 */
  async restoreMissing(): Promise<string[]> {
    const st = await this.status();
    const missing = st.filter((f) => f.code === '!').map((f) => f.path);
    if (missing.length) {
      await this.exec(['revert', ...missing]);
    }
    return missing;
  }

  /** svn revert（目录默认递归） */
  async revert(relPaths: string[]): Promise<VcsResult> {
    // svn revert 目录默认不清孩子（E155038："不能恢复目录，而不恢复孩子"）：目录单独带 --depth infinity 递归还原
    //（取消添加 A 目录的场景：目录自身调度也只在此路径下才会被撤销），文件直接 revert
    for (const p of relPaths) {
      const abs = path.join(this.repo.root, p);
      const isDir = fs.existsSync(abs) && fs.statSync(abs).isDirectory();
      const res = await this.exec(isDir ? ['revert', '--depth', 'infinity', p] : ['revert', p]);
      if (res.code !== 0) {
        return { ok: false, message: res.stderr.trim() || 'svn revert 失败' };
      }
    }
    return { ok: true, message: `已还原 ${relPaths.length} 项` };
  }

  /** svn delete --keep-local：仅标记从版本库删除,磁盘文件保留（提交后生效,提交前可还原） */
  async removeKeep(relPaths: string[]): Promise<VcsResult> {
    const res = await this.exec(['delete', '--keep-local', ...relPaths]);
    if (res.code !== 0) return this.fail(this.authError(res), res.stderr.trim() || '从版本库移除失败');
    return { ok: true, message: `已标记从版本库删除 ${relPaths.length} 项（本地文件保留）` };
  }

  /** svn move：本地重命名/移动（提交后生效）；未版本化对象不支持返回失败 */
  async move(from: string, to: string): Promise<VcsResult> {
    const res = await this.exec(['move', from, to]);
    if (res.code !== 0) return this.fail(this.authError(res), res.stderr.trim() || 'svn move 失败');
    return { ok: true, message: `已重命名 ${from} → ${to}（提交后生效）` };
  }

  /** svn delete（目录默认递归） */
  async remove(relPaths: string[]): Promise<VcsResult> {
    const res = await this.exec(['delete', ...relPaths]);
    if (res.code !== 0) {
      return { ok: false, message: res.stderr.trim() || 'svn delete 失败' };
    }
    return { ok: true, message: `已标记删除 ${relPaths.length} 项` };
  }

  /** svn cat -r REV：指定版本内容 */
  async catRev(rev: string, pathRel: string): Promise<{ ok: boolean; output: string; error?: string }> {
    const res = await this.exec(['cat', '-r', rev, pathRel], { timeoutMs: 60_000 });
    return {
      ok: res.code === 0,
      output: res.stdout,
      error: res.code !== 0 ? res.stderr.trim() : undefined,
    };
  }

  /** svn cat：查看版本库内文件内容 */
  async cat(url: string): Promise<{ ok: boolean; output: string; error?: string }> {
    const res = await this.exec(['cat', url], { timeoutMs: 60_000 });
    return {
      ok: res.code === 0,
      output: res.stdout,
      error: res.code !== 0 ? res.stderr.trim() : undefined,
    };
  }

  // ============ 提交前检查（服务器版本对比 / 锁定） ============

  /**
   * 提交前检查：svn status -u（查询服务器）
   * 返回：服务器是否更新、落后版本数、冲突风险文件（本地和服务器都改了）、被他人锁定文件
   */
  async preflight(): Promise<{
    remoteHasUpdate: boolean;
    behind: number;
    conflictRisk: string[];
    lockedByOthers: string[];
    updatedFiles: string[];
    remoteLogs: LogEntry[];
  }> {
    const res = await this.exec(['status', '-u'], { timeoutMs: 20_000 }); // 快速失败:网络不通时防卡连接槽 60s+
    if (res.code !== 0) {
      return { remoteHasUpdate: false, behind: 0, conflictRisk: [], lockedByOthers: [], updatedFiles: [], remoteLogs: [] };
    }
    const out = res.stdout.split('\n');
    // 格式（cat -A 实测）：条目行 "[列1状态][7空格][* 过期标记][ 版本号 ][ 路径]"
    // 例: "M       *       23   readme.md"（* 在第 8 字符）；汇总行在末尾（"版本 26 的状态" / "Status against revision: 26"）
    const conflictRisk: string[] = [];
    const lockedByOthers: string[] = [];
    const updatedFiles: string[] = []; // 服务器有新版本的完整文件列表（无论本地是否修改）
    let expiredCount = 0;
    for (const line of out) {
      if (line.length < 8 || !line.trim()) continue;
      if (/状态|Status/.test(line)) continue; // 汇总行
      const c1 = line[0]!;
      const c5 = line[5] ?? ' '; // 锁状态列（实测 index 5：K 自己锁 / O 他人锁）
      const star = line[8] === '*';
      // 路径：跳过状态区/过期标记/版本号
      const m2 = line.match(/^.{8}\*?\s+\d+\s+(.+)$/);
      const path = m2?.[1]?.trim() ?? '';
      if (c5 === 'O') lockedByOthers.push(path);
      if (star && path) {
        expiredCount += 1;
        updatedFiles.push(path);
        if (c1 !== ' ' && c1 !== '?') conflictRisk.push(path); // 本地也改了 → 冲突风险
      }
    }
    // 远程新提交列表（wc 的 BASE 之后的版本：HEAD:BASE），供"去查看"按提交分组显示
    let remoteLogs: LogEntry[] = [];
    if (expiredCount > 0) {
      const lg = await this.exec(['log', '-r', 'HEAD:BASE', '-v', '--xml']);
      if (lg.code === 0) remoteLogs = this.parseLogXml(lg.stdout);
    }
    return {
      remoteHasUpdate: expiredCount > 0,
      // behind 语义 = 提交数（HEAD:BASE 的版本数），而非 status -u 的过期文件数；
      // log 获取失败时回退文件数（至少提示有更新）
      behind: remoteLogs.length > 0 ? remoteLogs.length : expiredCount,
      conflictRisk,
      lockedByOthers,
      updatedFiles,
      remoteLogs,
    };
  }

  /** svn status 文本解析：自己锁定的文件（锁列在 index 5，K=自己锁） */
  async selfLockedFiles(): Promise<string[]> {
    const res = await this.exec(['status']);
    if (res.code !== 0) return [];
    const out: string[] = [];
    for (const line of res.stdout.split('\n')) {
      if (line.length >= 8 && line[5] === 'K') out.push(line.slice(8).trim());
    }
    return out;
  }

  // ============ 分支 / 标签 / 合并（基于 URL） ============

  /** 工作副本当前 URL */
  private async currentUrl(): Promise<string> {
    const info = await this.info();
    return info.url ?? '';
  }

  /** 当前分支名（URL 中 /branches/xxx 段；trunk 或非分支返回 trunk） */
  private async currentBranchName(): Promise<string> {
    const url = await this.currentUrl();
    const m = url.match(/\/branches\/([^/]+)/);
    return m?.[1] ?? 'trunk';
  }

  /** 仓库布局探测：标准布局 trunk/branches/tags 目录是否存在（非标准布局时前端提示） */
  /** 仓库布局探测（server 层 /api/tags 等使用,经 Vcs 接口暴露） */
  async layout(): Promise<SvnLayout> {
    const root = await this.repoRootUrl();
    const exists = async (url: string): Promise<boolean> => {
      try {
        await this.ls(url + '/');
        return true;
      } catch {
        return false;
      }
    };
    return { trunk: await exists(`${root}/trunk`), branches: await exists(`${root}/branches`), tags: await exists(`${root}/tags`) };
  }

  /** 分支列表（svn list <root>/branches），附带仓库布局探测结果 */
  async branchList(): Promise<{ current: string; branches: { name: string; remote: boolean }[]; layout: SvnLayout }> {
    const root = await this.repoRootUrl();
    let names: { name: string; isDir: boolean }[] = [];
    try {
      names = await this.ls(`${root}/branches/`);
    } catch {
      names = [];
    }
    const current = await this.currentBranchName();
    return {
      current,
      branches: names.filter((n) => n.isDir).map((n) => ({ name: n.name.replace(/\/$/, ''), remote: false })),
      layout: await this.layout(),
    };
  }

  /** 仓库根 URL */
  private async repoRootUrl(): Promise<string> {
    // 优先官方命令 repos-root-url（svn 1.9+）：返回真实仓库根，
    // 非标准布局深层检出（如 dev/branches/xxx）也不会被正则误判为根
    const res = await this.exec(['info', '--show-item', 'repos-root-url'], { timeoutMs: 60_000 });
    const root = res.code === 0 ? res.stdout.trim().split('\n')[0] : '';
    if (root) return root;
    // 兜底：从 wc URL 去掉 trunk/branches/tags 段
    const url = (await this.info()).url ?? '';
    return url.replace(/\/(trunk|branches|tags)(\/.*)?$/, '');
  }

  /** 确保 URL 目录存在（不存在则 svn mkdir 创建） */
  private async ensureDir(url: string): Promise<void> {
    try {
      await this.ls(url + '/');
    } catch {
      const mk = await this.exec(['mkdir', url, '-m', '创建目录'], { timeoutMs: 60_000 });
      if (mk.code !== 0) throw new Error(mk.stderr.trim() || '创建目录失败');
    }
  }

  /** 创建分支：svn copy <来源> <root>/branches/<name>（来源优先 trunk，无 trunk 用当前 URL；branches/ 自动创建） */
  async branchCreate(name: string): Promise<VcsResult> {
    const root = await this.repoRootUrl();
    // 目标已存在时 svn copy 会嵌套复制造成污染 → 先校验
    try {
      await this.ls(`${root}/branches/${name}/`);
      return { ok: false, message: `分支 ${name} 已存在` };
    } catch {
      /* 不存在，继续 */
    }
    const cur = await this.currentUrl();
    let from = `${root}/trunk`;
    // trunk 不存在则用当前 URL
    try {
      await this.ls(`${root}/trunk/`);
    } catch {
      from = cur;
    }
    try {
      await this.ensureDir(`${root}/branches`);
    } catch (err) {
      return { ok: false, message: `创建 branches 目录失败: ${(err as Error).message}` };
    }
    const res = await this.exec(['copy', from, `${root}/branches/${name}`, '-m', `创建分支 ${name}`], { timeoutMs: 120_000 });
    if (res.code !== 0) {
      const auth = this.authError(res);
      return this.fail(auth, res.stderr.trim() || '创建分支失败');
    }
    return { ok: true, message: `已创建分支 ${name}` };
  }

  /** 删除分支（远程删除 branches/<name>，危险操作由前端确认） */
  async branchDelete(name: string): Promise<VcsResult> {
    const root = await this.repoRootUrl();
    const res = await this.exec(['delete', `${root}/branches/${name}`, '-m', `删除分支 ${name}`], { timeoutMs: 120_000 });
    if (res.code !== 0) {
      const auth = this.authError(res);
      return this.fail(auth, res.stderr.trim() || '删除分支失败');
    }
    return { ok: true, message: `已删除分支 ${name}` };
  }

  /** 切换分支：svn switch <root>/branches/<name>；name=trunk/root 时切回主干 */
  /** 切换分支前的改动检查：svn switch 是 update 语义，本地改动尽量保留（可能冲突），只统计数量 */
  async switchCheck(_branch: string): Promise<{ changed: number; tracked: number; untracked: number; conflicts: string[] }> {
    const res = await this.exec(['status']);
    if (res.code !== 0) throw new Error(`svn status 失败: ${res.stderr.trim()}`);
    const lines = res.stdout.split('\n').map((l) => l.trim()).filter(Boolean);
    const untracked = lines.filter((l) => l.startsWith('?')).length;
    const tracked = lines.length - untracked;
    return { changed: lines.length, tracked, untracked, conflicts: [] };
  }

  /** 合并预检：本地改动统计 + outdated 检测（svn 规则：merge 前工作副本必须是最新的，否则合到旧 BASE 产生虚假冲突/重复合并。检测失败(null)不拦截） */
  async mergeCheck(_branch: string): Promise<{ changed: number; tracked: number; untracked: number; conflicts: string[]; outdated?: { wcRev: string; headRev: string } | null }> {
    const st = await this.status();
    const items = st.filter((i) => i.code !== 'I' && i.code !== 'X'); // 排除 ignored/external，与状态视图口径一致
    const untracked = items.filter((i) => i.code === '?').length;
    let outdated: { wcRev: string; headRev: string } | null = null;
    try {
      const wc = await this.exec(['info', '--show-item', 'revision'], { timeoutMs: 60_000 });
      const head = await this.exec(['info', '-r', 'HEAD', '--show-item', 'revision'], { timeoutMs: 60_000 });
      const wcRev = wc.stdout.trim().split('\n')[0] ?? '';
      const headRev = head.stdout.trim().split('\n')[0] ?? '';
      if (wcRev && headRev && wcRev !== headRev) outdated = { wcRev, headRev };
    } catch {
      /* 网络/权限失败：不拦截，仅缺失提示 */
    }
    return { changed: items.length, tracked: items.length - untracked, untracked, conflicts: [], outdated };
  }

  async branchSwitch(name: string): Promise<VcsResult> {
    const root = await this.repoRootUrl();
    let target: string;
    if (name === 'trunk' || name === 'root' || name === '') {
      try {
        await this.ls(`${root}/trunk/`);
      } catch {
        // 无 trunk 时不能 fallback 到仓库根：svn 1.10 要求切换目标与当前 URL 有共同祖先，
        // 子目录工作副本 switch 到根必报 E195012，且提示"已切换到主干"是误报
        return { ok: false, message: '仓库没有 trunk 目录，无法切回主干（请确认仓库布局或直接切换到其他分支）' };
      }
      target = `${root}/trunk`;
    } else {
      target = `${root}/branches/${name}`;
    }
    const res = await this.exec(['switch', target], { timeoutMs: 300_000 });
    if (res.code !== 0) {
      const auth = this.authError(res);
      return this.fail(auth, res.stderr.trim() || '切换分支失败');
    }
    const base = `已切换到${name === 'trunk' || name === 'root' ? '主干' : `分支 ${name}`}`;
    // svn switch 遇文本冲突时退出码仍为 0，需从输出识别冲突并提示用户处理
    const out = (res.stdout ?? '') + (res.stderr ?? '');
    if (/冲突概要|conflict/i.test(out)) return { ok: true, message: `${base}；⚠ 切换时产生冲突，请打开冲突视图处理冲突文件` };
    return { ok: true, message: base };
  }

  /** 合并分支到工作副本：svn merge <root>/branches/<name> */
  async merge(branchName: string): Promise<VcsResult> {
    const root = await this.repoRootUrl();
    const res = await this.exec(['merge', `${root}/branches/${branchName}`], { timeoutMs: 300_000 });
    if (res.code !== 0) {
      const auth = this.authError(res);
      return this.fail(auth, res.stderr.trim() || '合并失败（可能有冲突）');
    }
    const base = `已合并分支 ${branchName} 的改动`;
    // svn merge 遇文本冲突退出码仍为 0，需从输出识别冲突并提示用户处理
    const out = (res.stdout ?? '') + (res.stderr ?? '');
    if (/冲突概要|conflict/i.test(out)) return { ok: true, message: `${base}；⚠ 合并产生冲突，请打开冲突视图处理冲突文件` };
    return { ok: true, message: base };
  }

  /** 标签列表（svn list <root>/tags） */
  async tagList(): Promise<string[]> {
    const root = await this.repoRootUrl();
    try {
      const names = await this.ls(`${root}/tags/`);
      return names.filter((n) => n.isDir).map((n) => n.name.replace(/\/$/, ''));
    } catch {
      return [];
    }
  }

  /** 创建标签：svn copy <trunk/当前> <root>/tags/<name>（tags/ 自动创建） */
  async tagCreate(name: string): Promise<VcsResult> {
    const root = await this.repoRootUrl();
    // 目标已存在时 svn copy 会嵌套复制造成污染 → 先校验
    try {
      await this.ls(`${root}/tags/${name}/`);
      return { ok: false, message: `标签 ${name} 已存在` };
    } catch {
      /* 不存在，继续 */
    }
    const cur = await this.currentUrl();
    let from = `${root}/trunk`;
    try {
      await this.ls(`${root}/trunk/`);
    } catch {
      from = cur;
    }
    try {
      await this.ensureDir(`${root}/tags`);
    } catch (err) {
      return { ok: false, message: `创建 tags 目录失败: ${(err as Error).message}` };
    }
    const res = await this.exec(['copy', from, `${root}/tags/${name}`, '-m', `创建标签 ${name}`], { timeoutMs: 120_000 });
    if (res.code !== 0) {
      const auth = this.authError(res);
      return this.fail(auth, res.stderr.trim() || '创建标签失败');
    }
    return { ok: true, message: `已创建标签 ${name}` };
  }

  /** 删除远程标签（svn delete URL，危险操作由前端确认） */
  async tagDelete(name: string): Promise<VcsResult> {
    const root = await this.repoRootUrl();
    const res = await this.exec(['delete', `${root}/tags/${name}`, '-m', `删除标签 ${name}`], { timeoutMs: 120_000 });
    if (res.code !== 0) {
      const auth = this.authError(res);
      return this.fail(auth, res.stderr.trim() || '删除标签失败');
    }
    return { ok: true, message: `已删除标签 ${name}` };
  }

  // ============ 清理 / 冲突解决 / 忽略 ============

  /** svn cleanup：清理中断操作遗留的锁 */
  async cleanup(): Promise<VcsResult> {
    const res = await this.exec(['cleanup']);
    if (res.code !== 0) return { ok: false, message: res.stderr.trim() || '清理失败' };
    return { ok: true, message: '清理完成' };
  }

  /** svn resolve：解决冲突（accept: working/mine-full/theirs-full/base） */
  async resolve(pathRel: string, accept: string): Promise<VcsResult> {
    const res = await this.exec(['resolve', '--accept=' + accept, pathRel]);
    if (res.code !== 0) return { ok: false, message: res.stderr.trim() || '解决冲突失败' };
    return { ok: true, message: `已解决: ${pathRel}（${accept}）` };
  }

  /** svn propset svn:ignore：设置忽略模式（svn:ignore 只能设在目录上——目标是文件时改为设置到其父目录） */
  async propSetIgnore(pathRel: string, pattern: string): Promise<VcsResult> {
    let target = pathRel;
    // 文件 → 父目录承载忽略规则；目录 → 目录本身
    try {
      const abs = path.join(this.repo.root, pathRel);
      if (fs.existsSync(abs) && !fs.statSync(abs).isDirectory()) {
        target = path.dirname(pathRel);
        if (target === '.') target = '.';
      }
    } catch {
      /* 目标不存在时按传入路径处理 */
    }
    const res = await this.exec(['propset', 'svn:ignore', pattern, target]);
    if (res.code !== 0) return { ok: false, message: res.stderr.trim() || '设置忽略失败' };
    return { ok: true, message: `已设置忽略: ${target || '.'} → ${pattern}` };
  }

  // ============ 锁定 / Blame ============

  /** svn lock：锁定文件（独占修改） */
  async lock(pathRel: string, force = false): Promise<VcsResult> {
    const args = ['lock'];
    if (force) args.push('--force');
    args.push(pathRel);
    const res = await this.exec(args);
    if (res.code !== 0) return { ok: false, message: res.stderr.trim() || '锁定失败' };
    return { ok: true, message: `已锁定: ${pathRel}` };
  }

  /** svn unlock：解锁文件 */
  async unlock(pathRel: string, force = false): Promise<VcsResult> {
    const args = ['unlock'];
    if (force) args.push('--force');
    args.push(pathRel);
    const res = await this.exec(args);
    if (res.code !== 0) return { ok: false, message: res.stderr.trim() || '解锁失败' };
    return { ok: true, message: `已解锁: ${pathRel}` };
  }

  /** svn blame：逐行标注版本/作者 */
  async blame(pathRel: string): Promise<{ rev: string; author: string; date: string; line: number; text: string }[]> {
    const res = await this.exec(['blame', pathRel], { timeoutMs: 60_000 });
    if (res.code !== 0) throw new Error(`svn blame 失败: ${res.stderr.trim()}`);
    const out: { rev: string; author: string; date: string; line: number; text: string }[] = [];
    for (const line of res.stdout.split('\n')) {
      const m = line.match(/^\s*(\d+)\s+(\S+)\s+(.*)$/);
      if (m && m[1] && m[2]) {
        out.push({ rev: `r${m[1]}`, author: m[2], date: '', line: out.length + 1, text: m[3] ?? '' });
      }
    }
    return out;
  }

  /** svn list --xml：版本库目录浏览 */
  async ls(url: string): Promise<{ name: string; isDir: boolean }[]> {
    const res = await this.exec(['list', '--xml', url]);
    if (res.code !== 0) {
      const auth = this.authError(res);
      if (auth) throw new Error(auth);
      throw new Error(`svn list 失败: ${res.stderr.trim()}`);
    }
    const doc = this.xml.parse(res.stdout);
    const lists = doc?.lists?.list ?? [];
    const listArr = Array.isArray(lists) ? lists : [lists];
    const names: { name: string; isDir: boolean }[] = [];
    for (const l of listArr) {
      const entries = l?.entry;
      if (!entries) continue;
      const arr = Array.isArray(entries) ? entries : [entries];
      for (const e of arr) {
        const kind = String(e['@_kind'] ?? 'file');
        const name = String(e.name ?? '');
        if (name) names.push({ name, isDir: kind === 'dir' });
      }
    }
    return names;
  }
}
