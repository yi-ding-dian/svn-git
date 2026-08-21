/** Git 实现：包装 git 命令行，--porcelain 机器输出解析 */
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { statSync } from 'node:fs';
import { run } from './exec.js';
import { loadConfig } from '../config.js';
import type { FileStatus, LogEntry, RepoInfo, VcsResult } from './types.js';

/** 生成 GIT_ASKPASS 脚本（凭据经 base64 传递，避免特殊字符破坏 shell；脚本 600 权限） */
function createAskPass(cred: { username: string; password: string }): { path: string; cleanup: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'svnkit-askpass-'));
  const file = path.join(dir, 'askpass.sh');
  const u = Buffer.from(cred.username, 'utf8').toString('base64');
  const p = Buffer.from(cred.password, 'utf8').toString('base64');
  fs.writeFileSync(
    file,
    `#!/bin/sh\ncase "$1" in\n  *Username*) printf '%s' '${u}' | base64 -d ;;\n  *Password*) printf '%s' '${p}' | base64 -d ;;\nesac\n`,
    // 0o700：owner 读写执行（git 需要执行脚本），其他用户无权限（凭据安全）
    { mode: 0o700 },
  );
  return {
    path: file,
    cleanup: () => {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        /* 忽略清理失败 */
      }
    },
  };
}

/** 认证失败类型：基于 remote URL 判断（github / 其他 https 服务器 / ssh） */
function authTypeOf(remoteUrl: string): 'github' | 'server' | 'ssh' | undefined {
  if (!remoteUrl) return undefined;
  if (/github\.com/i.test(remoteUrl)) return 'github';
  if (/^(git@|ssh:\/\/)/.test(remoteUrl)) return 'ssh';
  return 'server';
}

/** stat 检测目录 */
function isDir(abs: string): boolean {
  try {
    return statSync(abs).isDirectory();
  } catch {
    return false;
  }
}

/**
 * 解析 git log 机器输出（--format 含 \x1e 分隔 + --name-status）。
 * 输出结构：<format 行(含 \x1e)>\n\n<name-status 行…>。name-status 属于其上方那条记录，
 * 与下一条 format 之间无分隔，因此按行扫描：含 \x1e 的行是新记录头。
 */
function parseGitLog(stdout: string): LogEntry[] {
  const out: LogEntry[] = [];
  let cur: LogEntry | null = null;
  for (const line of stdout.split('\n')) {
    const sep = line.indexOf('\x1e');
    if (sep >= 0) {
      const head = line.slice(0, sep);
      const [hash, author, date, msg] = head.split('\x1f');
      if (hash) {
        cur = {
          rev: hash.slice(0, 7),
          author: author ?? '',
          date: (date ?? '').replace('T', ' ').replace(/[+-]\d{2}:\d{2}$/, ''),
          msg: msg ?? '',
          changed: [],
        };
        out.push(cur);
      }
    } else if (cur && line) {
      const m = line.match(/^([MADRCU])\t(.+)$/);
      if (m && m[1] && m[2]) {
        const p = m[2].includes('\t') ? m[2].split('\t').pop()! : m[2];
        cur.changed.push({ action: m[1], path: p });
      }
    }
  }
  return out;
}

/** git porcelain 状态码 -> 统一语义码 */
function mapCode(x: string): string {
  switch (x) {
    case 'M':
    case 'T':
      return 'M';
    case 'A':
      return 'A';
    case 'D':
      return 'D';
    case '?':
      return '?';
    case 'U':
    case 'AA':
    case 'DD':
    case 'AU':
    case 'UA':
    case 'UD':
    case 'DU':
      return 'C';
    case 'R':
      return 'R';
    case 'C':
      return 'A';
    case '!':
      return '!';
    case 'I':
      return 'I';
    default:
      return ' ';
  }
}

/** 解析 porcelain 路径（可能被 C 风格引号包裹） */
function unquote(s: string): string {
  if (s.startsWith('"')) {
    try {
      return JSON.parse(s);
    } catch {
      return s;
    }
  }
  return s;
}

export class GitVcs {
  constructor(private repo: RepoInfo) {}

  private exec(args: string[], extra: { stdinData?: string; timeoutMs?: number; signal?: AbortSignal; env?: Record<string, string> } = {}) {
    return run('git', args, {
      cwd: this.repo.root,
      timeoutMs: extra.timeoutMs ?? 120_000,
      signal: extra.signal,
      // GIT_TERMINAL_PROMPT=0：禁用终端交互提示（否则 git 检测到启动终端会卡在 "Username for..." 等输入，
      //  不走工具的认证弹窗）；GIT_SSH_COMMAND BatchMode：SSH 不交互（不卡主机指纹/密码输入），失败快速返回
      env: { GIT_TERMINAL_PROMPT: '0', GIT_SSH_COMMAND: 'ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new', ...extra.env },
    });
  }

  /** 当前分支 */
  async branch(): Promise<string> {
    const res = await this.exec(['rev-parse', '--abbrev-ref', 'HEAD']);
    if (res.code === 0 && res.stdout.trim() && res.stdout.trim() !== 'HEAD') return res.stdout.trim();
    const res2 = await this.exec(['rev-parse', '--short', 'HEAD']);
    return res2.code === 0 ? res2.stdout.trim() : '';
  }

  /** remote origin URL */
  async remote(): Promise<string> {
    const res = await this.exec(['remote', 'get-url', 'origin']);
    if (res.code === 0) return res.stdout.trim();
    const res2 = await this.exec(['config', 'remote.origin.url']);
    return res2.code === 0 ? res2.stdout.trim() : '';
  }

  /** Git 信息汇总：分支 / 远程 / 上游 / 最近提交（git 信息弹窗用） */
  async gitInfo(): Promise<{
    branch: string;
    remote: string;
    upstream: string;
    lastCommit: { hash: string; author: string; date: string; msg: string } | null;
  }> {
    const branch = await this.branch();
    const remote = await this.remote();
    const up = await this.exec(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']);
    const upstream = up.code === 0 ? up.stdout.trim() : '';
    const lg = await this.exec(['log', '-1', '--format=%h%x1f%an%x1f%aI%x1f%s']);
    let lastCommit: { hash: string; author: string; date: string; msg: string } | null = null;
    if (lg.code === 0 && lg.stdout.trim()) {
      const [hash, author, date, msg] = lg.stdout.trim().split('\x1f');
      if (hash) lastCommit = { hash, author: author ?? '', date: (date ?? '').replace('T', ' ').slice(0, 16), msg: msg ?? '' };
    }
    return { branch, remote, upstream, lastCommit };
  }

  /** 设置/修改 origin 远程地址 */
  async setRemote(url: string): Promise<VcsResult> {
    const hasOrigin = (await this.exec(['remote'])).stdout.split('\n').map((s) => s.trim()).includes('origin');
    const r = hasOrigin
      ? await this.exec(['remote', 'set-url', 'origin', url])
      : await this.exec(['remote', 'add', 'origin', url]);
    if (r.code !== 0) return { ok: false, message: r.stderr.trim() || '设置远程地址失败' };
    return { ok: true, message: hasOrigin ? '远程地址已更新' : '远程地址已添加' };
  }

  /** git status --porcelain=v1 */
  async status(pathRel?: string): Promise<FileStatus[]> {
    // 注意：git 2.20 的 -u 不接受分离参数（-u normal 会把 normal 当路径），必须 -unormal
    // -c core.quotepath=false：中文文件名不做八进制转义（否则 unquote 解析失败，未跟踪中文文件显示为干净）
    // pathRel:限定扫描范围(大仓库中的子项目),只返回该路径内状态,避免全仓库扫描卡顿
    const args = ['-c', 'core.quotepath=false', 'status', '--porcelain=v1', '-unormal'];
    if (pathRel) args.push('--', pathRel);
    const res = await this.exec(args);
    if (res.code !== 0) throw new Error(`git status 失败: ${res.stderr.trim()}`);
    const list: FileStatus[] = [];
    for (const line of res.stdout.split('\n')) {
      if (!line || line.length < 4) continue;
      const xy = line.slice(0, 2);
      const p = line.slice(3);
      // 重命名/复制: "R  old -> new"
      let pname = p;
      const arrow = p.indexOf(' -> ');
      if (arrow > 0) pname = p.slice(arrow + 4);
      let relPath = unquote(pname.trim());
      // 未跟踪目录输出 "?? dir/" 带尾部斜杠：去掉，统一为无斜杠路径（否则状态匹配/拼接会双斜杠）
      if (relPath.endsWith('/')) relPath = relPath.slice(0, -1);
      const main = mapCode(xy[0] ?? ' ');
      const wc = mapCode(xy[1] ?? ' ');
      let code = main === ' ' ? wc : main;
      // worktree 列删除(" D"=磁盘删除,index/版本库还在)是「缺失」而非版本控制删除：
      // 更新(git pull/checkout)即可恢复，与 svn 的 '!' 语义一致；只有 index 列 D(git rm)才是真删除
      if (code === 'D' && xy[0] !== 'D') code = '!';
      list.push({
        path: relPath,
        code,
        porcelain: xy,
        wcCode: wc,
        isDir: isDir(path.join(this.repo.root, relPath)),
        absPath: path.join(this.repo.root, relPath),
      });
    }
    return list;
  }

  /** git log --name-status（可限定路径） */
  async log(limit = 200, pathRel?: string): Promise<LogEntry[]> {
    // -c core.quotepath=false：中文路径不做八进制转义（否则 changed 路径乱码）
    const args = ['-c', 'core.quotepath=false', 'log', '-n', String(limit), '--format=%H%x1f%an%x1f%aI%x1f%s%x1e', '--name-status'];
    if (pathRel) args.push('--', pathRel);
    const res = await this.exec(args);
    if (res.code !== 0) throw new Error(`git log 失败: ${res.stderr.trim()}`);
    return parseGitLog(res.stdout);
  }

  /**
   * 未推送提交（本地领先远程）的 hash 列表。
   * 有上游：@{u}..HEAD；无上游（无远程分支）：全部提交视为未推送；空仓库返回空。
   */
  async unpushed(): Promise<string[]> {
    // 有上游：rev-list 纯 hash 输出（无 pretty 头行）
    const up = await this.exec(['rev-list', '@{u}..HEAD']);
    if (up.code === 0) {
      return up.stdout.split('\n').map((l) => l.trim()).filter(Boolean);
    }
    // 无上游 / 上游不存在：全部提交均未推送（与 log 同量级）
    const all = await this.exec(['log', '-n', '200', '--format=%H']);
    return all.code === 0 ? all.stdout.split('\n').map((l) => l.trim()).filter(Boolean) : [];
  }

  /** 未推送提交数量（轻量，推送按钮角标用；逻辑与 unpushed 一致） */
  async unpushedCount(): Promise<number> {
    const up = await this.exec(['rev-list', '--count', '@{u}..HEAD']);
    if (up.code === 0) return Number(up.stdout.trim()) || 0;
    const all = await this.exec(['rev-list', '--count', 'HEAD']);
    return all.code === 0 ? Number(all.stdout.trim()) || 0 : 0;
  }

  /** 未推送提交完整列表（含变更文件，推送确认弹窗用；无未推送时返回空数组） */
  async unpushedLog(): Promise<LogEntry[]> {
    // 有上游：@{u}..HEAD（只显示未推送，避免 log 多 hash 时展开已推送的祖先）；无上游：全部
    const up = await this.exec(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']);
    if (up.code === 0) {
      const res = await this.exec([
        '-c', 'core.quotepath=false',
        'log', '-n', '200',
        '--format=%H%x1f%an%x1f%aI%x1f%s%x1e',
        '--name-status',
        '@{u}..HEAD',
      ]);
      if (res.code !== 0) throw new Error(`git log 失败: ${res.stderr.trim()}`);
      return parseGitLog(res.stdout);
    }
    const all = await this.exec([
      '-c', 'core.quotepath=false',
      'log', '-n', '200',
      '--format=%H%x1f%an%x1f%aI%x1f%s%x1e',
      '--name-status',
    ]);
    if (all.code !== 0) throw new Error(`git log 失败: ${all.stderr.trim()}`);
    return parseGitLog(all.stdout);
  }

  /** 修改最近一次提交注释（--amend，-m 避免打开编辑器） */
  async amend(message: string): Promise<VcsResult> {
    const res = await this.exec(['commit', '--amend', '-m', message]);
    if (res.code !== 0) return { ok: false, message: res.stderr.trim() || '修改注释失败' };
    const m = res.stdout.match(/\[(\S+)\s+([0-9a-f]+)\]/);
    return { ok: true, message: m ? `已修改注释 ${m[2]?.slice(0, 7)}` : '已修改注释' };
  }

  /**
   * 修改任意未推送提交的注释（git rebase -i reword 自动化，不改代码内容）。
   * 安全约束：仅允许未推送提交（已推送的修改会重写远程历史需 force push，禁止）。
   * 实现：GIT_SEQUENCE_EDITOR 脚本把 todo 里目标行 pick 改 reword，GIT_EDITOR 脚本写入新注释，全程非交互。
   */
  async reword(hash: string, message: string): Promise<VcsResult> {
    // 1. 目标提交必须存在（转完整 hash）
    const full = await this.exec(['rev-parse', '--verify', `${hash}^{commit}`]);
    if (full.code !== 0 || !full.stdout.trim()) return { ok: false, message: '提交不存在' };
    const h = full.stdout.trim();
    // 2. 必须未推送（防重写远程历史）。
    //    双重检查：a) 不在未推送集合（有上游时精确）；b) 任何远程分支不包含它
    //    （无上游时 unpushed() 会把全部提交视为未推送，此时靠 b 兜底）
    const up = await this.unpushed();
    if (!up.includes(h)) return { ok: false, message: '该提交已推送，修改注释需重写远程历史（force push），已禁止' };
    const remoteContains = await this.exec(['branch', '-r', '--contains', h]);
    if (remoteContains.code === 0 && remoteContains.stdout.trim()) {
      return { ok: false, message: '该提交已推送，修改注释需重写远程历史（force push），已禁止' };
    }
    // 3. 确定 rebase 基点与目标在 todo 中的行号（todo 里 hash 是短 hash，须按行号定位）：
    //    普通提交 → 基点为父提交，行号 = base..h 深度；根提交（无父）→ 基点 --root，行号 = rev-list --count h
    const parents = await this.exec(['rev-list', '--parents', '-n', '1', h]);
    const isRoot = parents.code !== 0 || parents.stdout.trim().split(/\s+/).filter(Boolean).length <= 1;
    let base: string;
    let lineNo: number;
    if (isRoot) {
      base = '--root';
      const cnt = await this.exec(['rev-list', '--count', h]);
      lineNo = Number(cnt.stdout.trim()) || 1;
    } else {
      const parent = await this.exec(['rev-parse', `${h}^`]);
      if (parent.code !== 0 || !parent.stdout.trim()) return { ok: false, message: '无法确定该提交的父提交' };
      base = parent.stdout.trim();
      const depth = await this.exec(['rev-list', '--count', `${base}..${h}`]);
      lineNo = Number(depth.stdout.trim()) || 1;
    }
    // 4. 生成临时脚本：序列编辑器（第 lineNo 行 pick→reword）+ 消息编辑器（写新注释）
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'svnkit-reword-'));
    const seq = path.join(dir, 'seq.sh');
    fs.writeFileSync(seq, `#!/bin/sh\nsed -i "${lineNo}s/^pick /reword /" "$1"\n`, { mode: 0o700 });
    const msgScript = path.join(dir, 'msg.sh');
    const b64 = Buffer.from(message, 'utf8').toString('base64');
    fs.writeFileSync(msgScript, `#!/bin/sh\nprintf '%s' '${b64}' | base64 -d > "$1"\n`, { mode: 0o700 });
    try {
      const res = await this.exec(['-c', 'core.quotepath=false', 'rebase', '-i', base], {
        timeoutMs: 120_000,
        env: { GIT_SEQUENCE_EDITOR: seq, GIT_EDITOR: msgScript },
      });
      if (res.code !== 0) return { ok: false, message: res.stderr.trim() || '修改注释失败（工作区有未提交修改时需先提交或还原）' };
      return { ok: true, message: `已修改注释 ${h.slice(0, 7)}` };
    } finally {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        /* 忽略清理失败 */
      }
    }
  }

  /** 撤销最近一次提交（--soft 保留工作区修改，可重新勾选提交） */
  async resetSoft(): Promise<VcsResult> {
    const res = await this.exec(['reset', '--soft', 'HEAD~']);
    if (res.code !== 0) return { ok: false, message: res.stderr.trim() || '撤销提交失败' };
    return { ok: true, message: '已撤销最近一次提交（修改保留在工作区，可重新提交）' };
  }

  /** git diff：工作区/暂存区，或版本间；可限定路径 */
  async diff(a?: string, b?: string, pathRel?: string): Promise<{ ok: boolean; output: string; error?: string }> {
    // -c core.quotepath=false：diff 头部路径行中文不做八进制转义
    const args = ['-c', 'core.quotepath=false', 'diff'];
    if (a && b) args.push(a, b);
    else if (a) args.push(a);
    if (pathRel) args.push('--', pathRel);
    const res = await this.exec(args, { timeoutMs: 120_000 });
    return {
      ok: res.code === 0,
      output: res.stdout,
      error: res.code !== 0 ? res.stderr.trim() : undefined,
    };
  }

  /** git show：单次提交完整内容（含 message + diff） */
  async show(rev: string, pathRel?: string): Promise<{ ok: boolean; output: string; error?: string }> {
    // -c core.quotepath=false：diff 头部路径行中文不做八进制转义
    const args = ['-c', 'core.quotepath=false', 'show', rev];
    if (pathRel) args.push('--', pathRel);
    const res = await this.exec(args, { timeoutMs: 120_000 });
    return {
      ok: res.code === 0,
      output: res.stdout,
      error: res.code !== 0 ? res.stderr.trim() : undefined,
    };
  }

  /** git show HEAD:path：查看版本库内文件内容；未跟踪文件（不在 HEAD）回退直接读磁盘 */
  async cat(pathRel: string): Promise<{ ok: boolean; output: string; error?: string }> {
    const res = await this.exec(['show', `HEAD:${pathRel}`], { timeoutMs: 120_000 });
    if (res.code === 0) return { ok: true, output: res.stdout };
    // 未跟踪/新增文件不在 HEAD：直接读磁盘（存在才读）
    const abs = path.join(this.repo.root, pathRel);
    if (fs.existsSync(abs)) {
      return { ok: true, output: fs.readFileSync(abs, 'utf8') };
    }
    return { ok: false, output: '', error: res.stderr.trim() };
  }

  /** git diff --cached：暂存区（可限定路径） */
  async diffStaged(pathRel?: string): Promise<{ ok: boolean; output: string; error?: string }> {
    const args = ['diff', '--cached'];
    if (pathRel) args.push('--', pathRel);
    const res = await this.exec(args, { timeoutMs: 120_000 });
    return {
      ok: res.code === 0,
      output: res.stdout,
      error: res.code !== 0 ? res.stderr.trim() : undefined,
    };
  }

  /** git add */
  async add(relPaths: string[]): Promise<VcsResult> {
    const res = await this.exec(['add', ...relPaths]);
    if (res.code !== 0) return { ok: false, message: res.stderr.trim() || 'git add 失败' };
    return { ok: true, message: `已暂存 ${relPaths.length} 项` };
  }

  /** git add -A + commit */
  async commit(relPaths: string[], msg: string): Promise<VcsResult> {
    if (relPaths.length) {
      // 磁盘存在的文件(修改/新增/未跟踪):add 暂存；已删除(D)文件磁盘不存在无法 add，由 commit -- 直接提交其 index 状态
      const exist = relPaths.filter((p) => fs.existsSync(path.join(this.repo.root, p)));
      const deleted = relPaths.filter((p) => !fs.existsSync(path.join(this.repo.root, p)));
      if (exist.length) {
        const addRes = await this.exec(['add', '-A', '--', ...exist]);
        if (addRes.code !== 0) return { ok: false, message: `暂存失败: ${addRes.stderr.trim()}` };
      }
      // 指定路径提交：已删除文件也在 paths 里（提交其 index 删除记录）
      const res = await this.exec(['commit', '-m', msg, '--', ...relPaths], { timeoutMs: 120_000 });
      if (res.code !== 0) return { ok: false, message: res.stderr.trim() || 'git commit 失败' };
      const m = res.stdout.match(/\[(\S+)\s+([0-9a-f]+)\]/);
      return { ok: true, message: m ? `提交成功 ${m[1]} ${m[2]?.slice(0, 7)}` : '提交成功' };
    }
    // 未指定路径：全部暂存并提交
    const addRes = await this.exec(['add', '-A']);
    if (addRes.code !== 0) return { ok: false, message: `暂存失败: ${addRes.stderr.trim()}` };
    const res = await this.exec(['commit', '-m', msg], { timeoutMs: 120_000 });
    if (res.code !== 0) return { ok: false, message: res.stderr.trim() || 'git commit 失败' };
    const m = res.stdout.match(/\[(\S+)\s+([0-9a-f]+)\]/);
    return { ok: true, message: m ? `提交成功 ${m[1]} ${m[2]?.slice(0, 7)}` : '提交成功' };
  }

  /** git pull */
  async pull(signal?: AbortSignal): Promise<VcsResult & { files?: { path: string; status: string; code: string }[] }> {
    // -c core.quotepath=false：更新输出的中文文件名不做八进制转义
    let res = await this.exec(['-c', 'core.quotepath=false', 'pull'], { timeoutMs: 600_000, signal });
    if (res.aborted) return { ok: false, message: '更新已取消' };
    if (res.code !== 0) {
      // 当前分支无上游跟踪信息（git pull 不知道拉哪个远程分支）：
      // 自动用 git pull origin <当前分支> 重试，无需用户手动设置 upstream
      if (/没有跟踪信息|no tracking information/i.test(res.stderr)) {
        const branch = (await this.exec(['rev-parse', '--abbrev-ref', 'HEAD'])).stdout.trim();
        if (branch && branch !== 'HEAD') {
          const retry = await this.exec(['-c', 'core.quotepath=false', 'pull', 'origin', branch], { timeoutMs: 600_000, signal });
          if (retry.aborted) return { ok: false, message: '更新已取消' };
          if (retry.code === 0) res = retry;
          else return { ok: false, message: retry.stderr.trim() || 'git pull 失败' };
        }
      }
      if (res.code !== 0) return { ok: false, message: res.stderr.trim() || 'git pull 失败' };
    }
    const out = res.stdout.trim();
    // 无更新：git 输出 "Already up to date." 等（中英文），提示当前分支 + 短 hash
    if (/up to date|up-to-date|已经是最新|已是最新/i.test(out)) {
      const branch = (await this.exec(['rev-parse', '--abbrev-ref', 'HEAD'])).stdout.trim();
      const short = (await this.exec(['rev-parse', '--short', 'HEAD'])).stdout.trim();
      return { ok: true, message: `已是最新（分支 ${branch} @ ${short}）` };
    }
    // 有更新：解析 diffstat 文件列表（" file.txt | 2 +-"；重命名 " a => b | n ++--" 取目标路径）
    const files: { path: string; status: string; code: string }[] = [];
    for (const line of out.split('\n')) {
      const m = line.match(/^\s+(\S.*?)\s*\|/);
      if (!m || !m[1]) continue;
      const raw = m[1].trim();
      if (raw.startsWith('mode change')) continue;
      files.push({ path: raw.includes('=>') ? raw.split('=>').pop()!.trim() : raw, status: 'updated', code: 'U' });
    }
    const msg = files.length > 0 ? `更新了 ${files.length} 个文件` : out.split('\n').slice(0, 2).join('; ') || '更新完成';
    return { ok: true, message: msg, files: files.length ? files : undefined };
  }

  /** 恢复缺失文件（磁盘删除但版本库还在的 " D" 工作区删除 → checkout 拉回），返回恢复的文件列表 */
  async restoreMissing(): Promise<string[]> {
    const st = await this.status();
    const missing = st
      .filter((f) => f.porcelain && f.porcelain[0] === ' ' && f.porcelain[1] === 'D')
      .map((f) => f.path);
    if (missing.length) {
      await this.exec(['checkout', '--', ...missing]);
    }
    return missing;
  }

  /** git checkout -- path（还原工作区修改；git 2.20 无 restore） */
  async revert(relPaths: string[]): Promise<VcsResult> {
    const res = await this.exec(['checkout', '--', ...relPaths]);
    if (res.code !== 0) return { ok: false, message: res.stderr.trim() || 'git 还原失败' };
    return { ok: true, message: `已还原 ${relPaths.length} 项` };
  }

  /** git rm；未跟踪文件（git rm 不支持）直接删除磁盘 */
  async remove(relPaths: string[]): Promise<VcsResult> {
    const res = await this.exec(['rm', '-r', '--quiet', ...relPaths]);
    if (res.code !== 0) {
      // git rm 失败：未跟踪文件改为磁盘删除
      const failed: string[] = [];
      for (const p of relPaths) {
        const abs = path.join(this.repo.root, p);
        try {
          if (fs.existsSync(abs)) fs.rmSync(abs, { recursive: true, force: true });
        } catch {
          failed.push(p);
        }
      }
      if (failed.length === 0 && fs.existsSync(path.join(this.repo.root, relPaths[0] ?? '')) === false) {
        return { ok: true, message: `已删除 ${relPaths.length} 项` };
      }
      return { ok: false, message: res.stderr.trim() || 'git rm 失败' };
    }
    return { ok: true, message: `已删除 ${relPaths.length} 项` };
  }

  /** git push：认证失败时用保存的凭据(GIT_ASKPASS)自动重试；仍失败返回 authType 供前端引导认证 */
  async push(signal?: AbortSignal): Promise<VcsResult & { authType?: 'github' | 'server' | 'ssh' }> {
    const cred = loadConfig().git;
    let res = await this.exec(['push'], { timeoutMs: 600_000, signal });
    if (res.aborted) return { ok: false, message: '推送已取消' };
    if (res.code === 0) return { ok: true, message: '推送成功' };
    // 无上游分支：自动 git push -u origin <当前分支>（-u 建立上游跟踪，角标才能正确归零；与 pull 的无上游自动重试一致）
    if (/没有对应的上游分支|no upstream branch|no tracking information/i.test(res.stderr)) {
      const branch = await this.branch();
      if (branch && branch !== 'HEAD') {
        const r2 = await this.exec(['push', '-u', 'origin', branch], { timeoutMs: 600_000, signal });
        if (r2.aborted) return { ok: false, message: '推送已取消' };
        if (r2.code === 0) return { ok: true, message: '推送成功' };
        res = r2;
      }
    }
    const errText = res.stderr + res.stdout;
    const isAuthError = /Authentication failed|could not read Username|terminal prompts disabled|Permission denied \(publickey\)|HTTP 401|HTTP 403/i.test(errText);
    if (isAuthError && cred?.username && cred?.password) {
      // 已有保存的凭据 → 用 GIT_ASKPASS 重试一次
      const ask = createAskPass(cred);
      const retry = await this.exec(['push'], { timeoutMs: 600_000, signal, env: { GIT_ASKPASS: ask.path } });
      ask.cleanup();
      if (retry.aborted) return { ok: false, message: '推送已取消' };
      if (retry.code === 0) return { ok: true, message: '推送成功' };
      return { ok: false, message: retry.stderr.trim() || 'git push 失败', authType: authTypeOf(await this.remote()) };
    }
    return {
      ok: false,
      message: res.stderr.trim() || 'git push 失败',
      authType: isAuthError ? authTypeOf(await this.remote()) : undefined,
    };
  }

  /** git ls-tree：版本库内容浏览（HEAD） */
  async ls(dir: string): Promise<{ name: string; isDir: boolean }[]> {
    // 目录参数需带尾部 /（ls-tree HEAD -- src 输出的是 src 自身，src/ 才是其内容）
    const target = dir ? `${dir.replace(/\/$/, '')}/` : '.';
    // -c core.quotepath=false：中文文件名不做八进制转义
    const res = await this.exec(['-c', 'core.quotepath=false', 'ls-tree', 'HEAD', '--', target]);
    if (res.code !== 0) throw new Error(`git ls-tree 失败: ${res.stderr.trim()}`);
    const out: { name: string; isDir: boolean }[] = [];
    const prefix = dir ? `${dir.replace(/\/$/, '')}/` : '';
    for (const line of res.stdout.split('\n')) {
      const m = line.match(/^\d+\s+(\w+)\s+[0-9a-f]+\t(.+)$/);
      if (!m) continue;
      let name = m[2]!;
      if (name === '.') continue;
      // ls-tree 输出带目录前缀，剥离后才是显示名
      if (prefix && name.startsWith(prefix)) name = name.slice(prefix.length);
      out.push({ name, isDir: m[1] === 'tree' });
    }
    return out;
  }

  // ============ 分支管理 ============

  /** 分支列表（本地+远程），current 为当前分支名 */
  async branchList(): Promise<{ current: string; branches: { name: string; remote: boolean }[] }> {
    const cur = await this.branch();
    const res = await this.exec(['branch', '-a']);
    if (res.code !== 0) throw new Error(`git branch 失败: ${res.stderr.trim()}`);
    const branches: { name: string; remote: boolean }[] = [];
    for (const line of res.stdout.split('\n')) {
      const t = line.trim();
      if (!t) continue;
      // "* master" 当前分支（去星号）；"remotes/origin/xxx" 远程
      if (t.startsWith('remotes/')) {
        // 过滤符号引用（remotes/origin/HEAD -> origin/main）：非真实分支，checkout 会失败
        if (t.includes(' -> ')) continue;
        branches.push({ name: t.replace(/^remotes\//, ''), remote: true });
      } else if (t !== 'HEAD') {
        const name = t.replace(/^\*\s*/, '');
        if (name) branches.push({ name, remote: false });
      }
    }
    return { current: cur, branches };
  }

  /** 创建分支 */
  async branchCreate(name: string): Promise<VcsResult> {
    const res = await this.exec(['branch', name]);
    if (res.code !== 0) return { ok: false, message: res.stderr.trim() || '创建分支失败' };
    return { ok: true, message: `已创建分支 ${name}` };
  }

  /** 切换分支（git 2.20 无 switch，用 checkout） */
  async branchSwitch(name: string): Promise<VcsResult> {
    // 远程分支（origin/xxx，refs/remotes 下存在）：
    // 直接 checkout origin/xxx 会进游离 HEAD（detached），改动不在任何分支上易丢失；
    // 本地已有同名分支则切本地（跟踪关系保留），否则自动创建本地跟踪分支。
    const remoteRef = await this.exec(['rev-parse', '--verify', '--quiet', `refs/remotes/${name}`]);
    if (remoteRef.code === 0) {
      const local = name.split('/').slice(1).join('/');
      const hasLocal = await this.exec(['rev-parse', '--verify', '--quiet', `refs/heads/${local}`]);
      if (hasLocal.code !== 0) {
        const res = await this.exec(['checkout', '-b', local, name], { timeoutMs: 60_000 });
        if (res.code !== 0) return { ok: false, message: res.stderr.trim() || '切换分支失败' };
        return { ok: true, message: `已切换到 ${name}（自动创建本地跟踪分支 ${local}）` };
      }
      name = local; // 本地已有同名分支，直接切换（保留跟踪关系）
    }
    const res = await this.exec(['checkout', name], { timeoutMs: 60_000 });
    if (res.code !== 0) return { ok: false, message: res.stderr.trim() || '切换分支失败' };
    return { ok: true, message: `已切换到 ${name}` };
  }

  /** 删除分支（force 为 true 时 -D） */
  async branchDelete(name: string, force = false): Promise<VcsResult> {
    const res = await this.exec(['branch', force ? '-D' : '-d', name]);
    if (res.code !== 0) return { ok: false, message: res.stderr.trim() || '删除分支失败' };
    return { ok: true, message: `已删除分支 ${name}` };
  }

  /** 合并分支到当前分支 */
  async merge(name: string): Promise<VcsResult> {
    const res = await this.exec(['merge', name], { timeoutMs: 120_000 });
    if (res.code !== 0) return { ok: false, message: res.stderr.trim() || '合并失败（可能有冲突）' };
    // 中英文兼容：真实合并（Merge made by / 策略合并）vs 快进
    const m = res.stdout.match(/Merge made by|merge made by|策略合并|合并提交/i);
    return { ok: true, message: m ? '合并成功' : '合并完成（快进）' };
  }

  // ============ 标签管理 ============

  /** 标签列表 */
  async tagList(): Promise<string[]> {
    const res = await this.exec(['tag', '-l']);
    if (res.code !== 0) throw new Error(`git tag 失败: ${res.stderr.trim()}`);
    return res.stdout.split('\n').filter(Boolean);
  }

  /** 创建标签（annotated，附当前/指定提交） */
  async tagCreate(name: string, message = '', rev?: string): Promise<VcsResult> {
    const args = ['tag', '-a', name, '-m', message || `标签 ${name}`];
    if (rev) args.push(rev);
    const res = await this.exec(args);
    if (res.code !== 0) return { ok: false, message: res.stderr.trim() || '创建标签失败' };
    return { ok: true, message: `已创建标签 ${name}` };
  }

  /** 删除标签 */
  async tagDelete(name: string): Promise<VcsResult> {
    const res = await this.exec(['tag', '-d', name]);
    if (res.code !== 0) return { ok: false, message: res.stderr.trim() || '删除标签失败' };
    return { ok: true, message: `已删除标签 ${name}` };
  }

  // ============ Stash ============

  /** Stash 列表 */
  async stashList(): Promise<{ index: number; label: string }[]> {
    const res = await this.exec(['stash', 'list']);
    if (res.code !== 0) return [];
    return res.stdout
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const m = line.match(/^stash@\{(\d+)\}:\s*(.+)$/);
        return m ? { index: Number(m[1]), label: m[2]! } : { index: 0, label: line };
      });
  }

  /** 保存 stash */
  async stashPush(message = ''): Promise<VcsResult> {
    const args = ['stash', 'push', '-u']; // 包含未跟踪文件
    if (message) args.push('-m', message);
    const res = await this.exec(args, { timeoutMs: 60_000 });
    // git 2.20 无改动时 exit code 为 0（仅 stderr 提示 "没有要保存的本地修改"/"No local changes to save"），
    // 因此成功分支也需检查提示，避免误报"已保存"但实际未保存
    const msg = res.stderr.trim() || res.stdout.trim();
    if (res.code !== 0) {
      return { ok: false, message: /No local changes|没有要保存的本地修改/i.test(msg) ? '没有可保存的改动' : msg || 'stash 失败' };
    }
    if (/No local changes|没有要保存的本地修改/i.test(msg)) {
      return { ok: false, message: '没有可保存的改动' };
    }
    return { ok: true, message: '改动已保存到 Stash' };
  }

  /** 恢复 stash */
  async stashPop(index: number): Promise<VcsResult> {
    // -c core.quotepath=false：恢复输出的中文文件名不做八进制转义
    const res = await this.exec(['-c', 'core.quotepath=false', 'stash', 'pop', `stash@{${index}}`], { timeoutMs: 60_000 });
    if (res.code !== 0) return { ok: false, message: res.stderr.trim() || '恢复失败（可能有冲突）' };
    return { ok: true, message: `已恢复 stash@{${index}}` };
  }

  /** 丢弃 stash */
  async stashDrop(index: number): Promise<VcsResult> {
    const res = await this.exec(['stash', 'drop', `stash@{${index}}`]);
    if (res.code !== 0) return { ok: false, message: res.stderr.trim() || '丢弃失败' };
    return { ok: true, message: `已丢弃 stash@{${index}}` };
  }

  // ============ 仓库创建 / 克隆 / 远程 ============

  /** git init 初始化仓库（git init <dir>，路径参数，无需 cd；dir 不存在会自动创建） */
  async init(dir: string): Promise<VcsResult> {
    const res = await this.exec(['init', dir], { timeoutMs: 30_000 });
    if (res.code !== 0) return { ok: false, message: res.stderr.trim() || 'git init 失败' };
    return { ok: true, message: `仓库已初始化: ${dir}` };
  }

  /** git clone 克隆远程仓库到目标目录 */
  async clone(url: string, dir: string): Promise<VcsResult> {
    const res = await this.exec(['clone', url, dir], { timeoutMs: 600_000 });
    if (res.code !== 0) return { ok: false, message: res.stderr.trim() || '克隆失败' };
    return { ok: true, message: `已克隆到 ${dir}` };
  }

  /** 远程列表 */
  async remoteList(): Promise<{ name: string; url: string }[]> {
    const res = await this.exec(['remote', '-v']);
    if (res.code !== 0) return [];
    const seen = new Set<string>();
    const out: { name: string; url: string }[] = [];
    for (const line of res.stdout.split('\n')) {
      const m = line.match(/^(\S+)\s+(\S+)/);
      if (m && m[1] && m[2] && !seen.has(m[1])) {
        seen.add(m[1]);
        out.push({ name: m[1], url: m[2] });
      }
    }
    return out;
  }

  /** 添加远程 */
  async remoteAdd(name: string, url: string): Promise<VcsResult> {
    const res = await this.exec(['remote', 'add', name, url]);
    if (res.code !== 0) return { ok: false, message: res.stderr.trim() || '添加远程失败' };
    return { ok: true, message: `已添加远程 ${name}` };
  }

  /** 移除远程 */
  async remoteRemove(name: string): Promise<VcsResult> {
    const res = await this.exec(['remote', 'remove', name]);
    if (res.code !== 0) return { ok: false, message: res.stderr.trim() || '移除远程失败' };
    return { ok: true, message: `已移除远程 ${name}` };
  }

  // ============ 提交前检查（远程对比） ============

  /**
   * 提交/推送前检查：git fetch + 比较 ahead/behind + 双方修改文件交集
   */
  async preflight(): Promise<{
    remoteHasUpdate: boolean;
    behind: number;
    ahead: number;
    conflictRisk: string[];
    updatedFiles: string[];
    remoteLogs: LogEntry[];
  }> {
    // 拉取远程元数据（静默，失败不阻塞）
    await this.exec(['fetch', '--quiet', 'origin'], { timeoutMs: 60_000 }).catch(() => {});
    const branch = await this.branch();
    const upstream = `origin/${branch}`;
    // ahead/behind 计数：git rev-list --left-right --count HEAD...origin/xxx
    const cnt = await this.exec(['rev-list', '--left-right', '--count', `HEAD...${upstream}`], { timeoutMs: 30_000 });
    let ahead = 0;
    let behind = 0;
    if (cnt.code === 0) {
      const parts = cnt.stdout.trim().split(/\s+/);
      ahead = Number(parts[0] ?? 0) || 0;
      behind = Number(parts[1] ?? 0) || 0;
    }
    // 本地修改文件（不含未跟踪）；-c core.quotepath=false：中文路径不做八进制转义（unquote 只解引号不解转义）
    const st = await this.exec(['-c', 'core.quotepath=false', 'status', '--porcelain=v1', '-unormal']);
    const localChanged = new Set<string>();
    for (const line of st.stdout.split('\n')) {
      if (!line || line.length < 4) continue;
      const xy = line.slice(0, 2);
      const p = unquote(line.slice(3).trim());
      if (xy[0] !== '?' && xy[0] !== '!') localChanged.add(p);
    }
    // 远程新提交修改的文件
    const remoteChanged = new Set<string>();
    // 远程新提交列表（HEAD..origin/xxx），供"去查看"按提交分组显示
    let remoteLogs: LogEntry[] = [];
    if (behind > 0) {
      const diff = await this.exec(['-c', 'core.quotepath=false', 'diff', '--name-only', `HEAD...${upstream}`], { timeoutMs: 30_000 });
      if (diff.code === 0) {
        for (const p of diff.stdout.split('\n')) {
          if (p.trim()) remoteChanged.add(p.trim());
        }
      }
      const lg = await this.exec(
        ['-c', 'core.quotepath=false', 'log', '--format=%H%x1f%an%x1f%aI%x1f%s%x1e', '--name-status', `HEAD..${upstream}`],
        { timeoutMs: 30_000 },
      );
      if (lg.code === 0) remoteLogs = parseGitLog(lg.stdout);
    }
    const conflictRisk = [...localChanged].filter((p) => remoteChanged.has(p));
    return { remoteHasUpdate: behind > 0, behind, ahead, conflictRisk, updatedFiles: [...remoteChanged], remoteLogs };
  }

  // ============ Blame 追溯 ============

  /** git blame --porcelain：逐行标注提交/作者 */
  async blame(pathRel: string): Promise<{ rev: string; author: string; date: string; line: number; text: string }[]> {
    const res = await this.exec(['blame', '--porcelain', pathRel], { timeoutMs: 60_000 });
    if (res.code !== 0) throw new Error(`git blame 失败: ${res.stderr.trim()}`);
    const out: { rev: string; author: string; date: string; line: number; text: string }[] = [];
    const lines = res.stdout.split('\n');
    let i = 0;
    while (i < lines.length) {
      const l = lines[i]!;
      const m = l.match(/^([0-9a-f]{40}) \d+ (\d+)/);
      if (m && m[1] && m[2]) {
        let author = '';
        let time = 0;
        let text = '';
        i += 1;
        while (i < lines.length) {
          const ml = lines[i]!;
          if (ml.startsWith('author ')) author = ml.slice(7);
          else if (ml.startsWith('author-time ')) time = Number(ml.slice(12)) || 0;
          else if (ml.startsWith('\t')) {
            text = ml.slice(1);
            break;
          }
          i += 1;
        }
        out.push({
          rev: m[1].slice(0, 7),
          author,
          date: time ? new Date(time * 1000).toLocaleDateString('zh-CN') : '',
          line: Number(m[2]),
          text,
        });
      }
      i += 1;
    }
    return out;
  }

  // ============ 清理未跟踪文件 ============

  /** git clean -ndx：预览将被删除的未跟踪文件（中英文输出兼容） */
  async cleanList(): Promise<string[]> {
    // -c core.quotepath=false：中文文件名不做八进制转义（与 status 一致，否则显示 \346\226\260…）
    const res = await this.exec(['-c', 'core.quotepath=false', 'clean', '-ndx'], { timeoutMs: 60_000 });
    if (res.code !== 0) throw new Error(`git clean 预览失败: ${res.stderr.trim()}`);
    return res.stdout
      .split('\n')
      .filter(Boolean)
      .map((l) => l.replace(/^(Would remove |将删除 |即将删除 )/, ''));
  }

  /** git clean -fdx：删除未跟踪文件（危险，前端必须确认） */
  async clean(): Promise<VcsResult> {
    const res = await this.exec(['clean', '-fdx'], { timeoutMs: 120_000 });
    if (res.code !== 0) return { ok: false, message: res.stderr.trim() || '清理失败' };
    return { ok: true, message: '未跟踪文件已清理' };
  }

  // ============ 忽略文件 ============

  /** 追加忽略规则到 .gitignore */
  async ignoreAdd(pattern: string): Promise<VcsResult> {
    const gitignore = path.join(this.repo.root, '.gitignore');
    try {
      let content = '';
      if (fs.existsSync(gitignore)) content = fs.readFileSync(gitignore, 'utf8');
      if (!content.endsWith('\n') && content) content += '\n';
      content += pattern + '\n';
      fs.writeFileSync(gitignore, content);
      return { ok: true, message: `已加入忽略: ${pattern}` };
    } catch (err) {
      return { ok: false, message: `写入 .gitignore 失败: ${(err as Error).message}` };
    }
  }
}
