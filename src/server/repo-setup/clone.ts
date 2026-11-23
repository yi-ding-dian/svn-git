/** Git 仓库获取：克隆（含标签/分支/浅克隆）、worktree 检出、空目录 init（默认分支 / .gitignore /
 *  提交现有文件）。
 *
 *  路由层只做协议转换（字段校验 / 响应封装）；命令执行、认证、进度、取消、半截目录清理都在这里。
 *  `res` 仅用于监听连接关闭（用户取消 / 关弹窗）：必须听 **res** 的 close，不能听 req 的——
 *  请求体已被 readBody 读完，req 的 'close' 在那时就已经触发过了（挂上去等于空放，实测克隆照样跑满）。 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type http from 'node:http';
import { run, type RunResult } from '../../vcs/exec.js';
import { createAskPass, authTypeOf } from '../../vcs/git.js';
import { t } from '../../shared/i18n/index.js';
import { loadConfig } from '../../config.js';
import { markInflight, clearInflight } from '../../inflight.js';
import { progressStart, progressSetTotal, progressDone, progressFromStderr } from '../../transfer-progress.js';
import { githubRepoBytes } from '../github/repo-info.js';
import { removeLeftoverTarget } from './leftover.js';

/** 路由层解析好的获取参数（字段含义见 routes/repo-create.ts 的协议转换） */
export interface GitCreateParams {
  body: Record<string, unknown>;
  target: string;
  url: string;
  ref: string;
  depth: number;
  mode: 'worktree' | 'clone';
  repoRoot: string;
  checkout: 'detach' | 'branch';
  /** 开始时清掉了「只有 .git/.svn」的残骸（结果文案里要说明） */
  cleanedRemnant: boolean;
}

/** /api/repo-create 的响应体（git / svn 两个分支同形，路由层统一补 authError） */
export interface RepoCreateResult {
  ok: boolean;
  message: string;
  repoDir?: string;
  /** 克隆因认证失败时带给前端，由它引导用户去设置里填 git 凭据（SVN 同理，authType='svn'） */
  authError?: boolean;
  authType?: 'github' | 'server' | 'ssh' | 'svn';
  /** 本次实际使用的账号（SVN 用；空 = 匿名） */
  user?: string;
  /** commitExisting：是否已把目标目录的现有文件提交到新仓库 */
  committed?: boolean;
  /** 提交现有文件失败的原因（仓库本身仍创建成功） */
  commitError?: string;
  /** 是否自动生成了 .gitignore */
  gitignoreWritten?: boolean;
  /** 失败时的**原始命令输出**（含进度行）：任务详情窗据此展示"真正发生了什么"。
   *  message 只是提炼后的一句话，进度输出全在 stderr 里，直接用整段当消息会把原因藏到看不见的地方。 */
  errorDetail?: string;
}

/** 从 git 的 stderr 里提炼"一句话原因"。
 *  clone/fetch 的进度输出（`Cloning into…` / `Receiving objects…`）**也在 stderr 里**，整段拿去做消息
 *  等于把真正的原因（末尾的 `fatal:` / `remote: error:`）截断在界面外——取最后一条错误行；
 *  一条都没有（进程被外部杀掉等）才退回最后一条非空行。中文本地化输出也要认（致命错误：）。 */
export function summarizeGitFailure(stderr: string): string {
  const lines = stderr
    .split(/[\r\n]+/)
    .map((line) => line.trim())
    .filter(Boolean);
  // `remote: error:` 是远端报的（如 GH001 大文件、钩子拒绝），同样算原因
  const errorLine = /(?:^|[\s:：])(?:fatal|error|致命错误|错误)\s*[:：]/i;
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (errorLine.test(lines[i]!)) return lines[i]!;
  }
  return lines[lines.length - 1] ?? '';
}

export async function createGitRepo(p: GitCreateParams, res: http.ServerResponse): Promise<RepoCreateResult> {
  const { body, target, url, ref, depth, mode, repoRoot, checkout, cleanedRemnant } = p;
  let result: RepoCreateResult;
  if (mode === 'worktree' && ref) {
    // worktree 检出：在当前工作副本里创建共享 .git 的第二工作树（省磁盘）。
    // 目标必须不存在（git worktree add 不会写入已有目录）。
    if (!repoRoot || !fs.existsSync(repoRoot)) {
      result = { ok: false, message: t('srv.worktreeNoRepo') };
    } else if (fs.existsSync(target)) {
      result = { ok: false, message: t('srv.coTargetExists', { path: target }) };
    } else {
      const args = ref.startsWith('origin/')
        ? ['worktree', 'add', '-b', ref.slice('origin/'.length), target, ref]
        : ['worktree', 'add', target, ref];
      const r = await run('git', args, { cwd: repoRoot, timeoutMs: 30 * 60_000 });
      if (r.code === 0) {
        result = { ok: true, message: t('srv.clonedTo', { path: target }), repoDir: target };
      } else {
        removeLeftoverTarget(target);
        result = { ok: false, message: r.stderr.trim() || t('srv.cloneFailed') };
      }
    }
  } else if (url) {
    // 克隆（私有仓库要认证）：保存过凭据时**首次请求就带 GIT_ASKPASS**（省掉"先 401 失败、
    // 再带凭据重试"的一来一回）；没存凭据 = 匿名，公开仓库直接成功。
    // 认证失败（凭据错/没凭据）时带 authType 交给前端，引导用户去设置里填 git 凭据。
    //
    // **客户端断开要真的停**：用户点「取消」/关掉弹窗（或前端 10 分钟超时）会 abort 请求，
    // 这里把它接到子进程上 —— 否则 git 会在后台白跑到 10 分钟，还可能凭空建出目录。
    // ⚠ 必须听 **res** 的 close，不能听 req 的：请求体已被 readBody 读完，
    // req 的 'close' 在那时就已经触发过了（挂上去等于空放，实测克隆照样跑满）。
    // res 的 'close' 才是"这条连接没了"（客户端关弹窗/超时断开）。
    const ac = new AbortController();
    const onClose = () => ac.abort();
    res.on('close', onClose);
    /** 克隆上限：网络卡住时别让用户干等。
     *  原来是 30s；后改 10 分钟；**再改 30 分钟**——用户实报一个 26 MB 的仓库（里面有个
     *  21.5 MB 的模型）在 19 KB/s 下要 23 分钟，10 分钟那个上限等于每次都白跑。
     *  现在顶栏任务面板有实时进度（已下载 / 速度 / 预计剩余），用户能自己判断该不该等，
     *  不必靠短超时兜底。 */
    const CLONE_TIMEOUT_MS = 30 * 60_000;
    const isAuthFail = (r: { stderr: string; stdout: string }): boolean =>
      // 解析 git 输出判断认证失败（含中文 locale 的「没有那个设备或地址」），不是界面文案，禁止翻译
      /Authentication failed|could not read Username|terminal prompts disabled|Permission denied \(publickey\)|HTTP 401|HTTP 403|没有那个设备或地址/i.test(r.stderr + r.stdout); // i18n-ignore: 解析 git 输出的匹配表
    /** 克隆**开始前**目标是否已存在：
     *  决定失败后能不能清理 —— 只清"这次克隆刚建出来的"，**绝不动用户已有的目录**。
     *  （曾因为不判这个，把用户已有的整个目录连内容一起删了：重复获取同一位置时
     *    clone 报"目标已存在且非空"，那句 cleanup 就把人家目录端了。） */
    const targetExistedBefore = fs.existsSync(target);
    /** 清掉本次克隆失败残留的半截目录（不清的话重试会报"目标已存在且非空"，掩盖真正原因）；
     *  带重试、清不掉会记进登记表（详见 leftover.ts 的 removeLeftoverTarget） */
    const cleanupTarget = () => {
      if (targetExistedBefore) return; // 原本就在的东西，一个字节都不许动
      removeLeftoverTarget(target);
    };
    // 登记"正在克隆到哪儿"：app 被强杀时靠它在下一次启动收尾（见 inflight.ts）
    markInflight(target);
    // 标签检出（ref = refs/tags/x）：
    //  - Git 2.20 的 `clone --branch` 不接受完整 refs/tags/ 前缀，且同名分支会优先于标签；
    //    所以**不用 --branch**：先完整克隆/抓取，再显式 checkout 标签。
    //  - 浅克隆不能直接 `clone --depth`（只按分支浅），改为
    //    init + fetch --depth 1 refs/tags/x:refs/tags/x + checkout，只拉该标签的提交。
    // 本地路径 + 浅克隆必须走 file://——git 对本地 clone 会忽略 --depth。
    let cloneUrl = url;
    if (depth > 0 && (path.isAbsolute(url) || /^[A-Za-z]:[\\/]/.test(url))) cloneUrl = pathToFileURL(url).href;
    // 进度：登记 + 并行查总大小（分母；查不到就 0，界面只显示已下载与速度），
    // `--progress` 是必需的——stderr 不是终端时 git 默认不吐进度。
    // 浅克隆的"总大小"是远端仓库全量，不能当分母（会永远到不了 100%），跳过。
    progressStart(target);
    if (!depth) void githubRepoBytes(cloneUrl).then((n) => progressSetTotal(target, n));
    const onStderrLine = (line: string) => progressFromStderr(target, line);
    const gitCred = loadConfig().git;
    /** 保存过凭据就**首次请求直接带上**（GIT_ASKPASS），省掉"先 401 失败、再带凭据重试"的往返；
     *  凭据本身错误时 git 会立即报认证失败，由下方 authError 引导用户换凭据。 */
    const askPass = gitCred?.username && gitCred?.password ? createAskPass(gitCred) : null;
    const runGit = (args: string[], extra?: { cwd?: string; env?: Record<string, string> }) =>
      run('git', args, {
        timeoutMs: CLONE_TIMEOUT_MS,
        signal: ac.signal,
        cwd: extra?.cwd,
        env: askPass ? { ...extra?.env, GIT_ASKPASS: askPass.path } : extra?.env,
        onStderrLine,
      });
    /** 浅克隆走 init：它不像 clone 那样拒绝非空目录，必须自己拦 */
    let blocked = '';
    let r: RunResult;
    if (ref && depth > 0 && checkout === 'detach') {
      if (fs.existsSync(target)) {
        try {
          if (fs.readdirSync(target).length > 0) blocked = t('srv.coTargetExists', { path: target });
        } catch {
          /* 读不到就交给 git 报错 */
        }
      }
      if (blocked) {
        r = { code: 1, stdout: '', stderr: blocked };
      } else {
        const init = await runGit(['init', '-q', target]);
        const remote = init.code === 0 ? await runGit(['remote', 'add', 'origin', cloneUrl], { cwd: target }) : init;
        if (init.code !== 0 || remote.code !== 0) {
          r = init.code !== 0 ? init : remote;
        } else {
          // 只取该标签指向的提交（depth 1）；refspec 同时建立本地标签
          const fetchArgs = ['fetch', '--progress', '--depth', String(depth), 'origin', `${ref}:${ref}`];
          r = await runGit(fetchArgs, { cwd: target });
          if (r.code === 0) {
            const co = await runGit(['checkout', '-q', '--detach', ref], { cwd: target });
            if (co.code !== 0) r = co;
          }
        }
      }
    } else if (ref) {
      // 完整克隆到标签/分支：拉全历史/分支，成功后显式 checkout 目标
      const cloneArgs = ['clone', '--progress', cloneUrl, target];
      r = await runGit(cloneArgs);
      if (r.code === 0) {
        // 标签 → detached；分支 → checkout 本地分支（远程分支建同名跟踪分支）
        const co = await runGit(
          checkout === 'detach'
            ? ['checkout', '-q', '--detach', ref]
            : ref.startsWith('origin/')
              ? ['checkout', '-q', '-b', ref.slice('origin/'.length), ref]
              : ['checkout', '-q', ref.replace(/^refs\/heads\//, '')],
          { cwd: target },
        );
        if (co.code !== 0) r = co;
      }
    } else {
      // 普通获取仓库（原行为）
      const cloneArgs = ['clone', '--progress', cloneUrl, target];
      r = await runGit(cloneArgs);
    }
    const authFail = isAuthFail(r);
    res.off('close', onClose);
    clearInflight(target); // 克隆跑完了（成功/失败/取消都算）：撤掉登记
    progressDone(target); // 进度同上：跑完就撤
    // ⚠ aborted（用户取消/断开）与 timedOut（自己到 30 分钟上限）是两个字段，都要判 ——
    // 只判 aborted 的话，超时会被当成"克隆失败"、把 git 的半截 stderr（"正克隆到…"）当错误抛给用户
    if (blocked) {
      cleanupTarget();
      result = { ok: false, message: blocked };
    } else if (r.aborted || r.timedOut) {
      cleanupTarget(); // 收拾可能留下的半截目录
      result = {
        ok: false,
        // 获取超时（超过 {sec} 秒），已停止 / 已取消获取
        message: r.timedOut ? t('srv.cloneTimeout', { min: CLONE_TIMEOUT_MS / 60_000 }) : t('srv.cloneCancelled'),
      };
    } else if (r.code === 0) {
      // 已克隆到 {path}
      result = { ok: true, message: t('srv.clonedTo', { path: target }) + (cleanedRemnant ? t('srv.remnantCleaned') : ''), repoDir: target };
    } else {
      cleanupTarget(); // 失败也别留半个仓库，否则下次重试会撞"目录已存在"
      // 原因提炼成一行（进度输出也在 stderr 里，整段当消息等于把原因藏在末尾看不到）；
      // 完整原文交给 errorDetail，任务详情窗里可展开看走到哪一步断的。
      const reason = summarizeGitFailure(r.stderr);
      result = {
        ok: false,
        // 克隆失败：{reason} / 克隆失败
        message: reason ? t('srv.cloneFailedReason', { reason }) : t('srv.cloneFailed'),
        errorDetail: r.stderr.trim() || undefined,
        authError: authFail || undefined,
        authType: authFail ? authTypeOf(url) : undefined,
      };
    }
    askPass?.cleanup(); // 临时 askpass 脚本（含凭据）用完即删
  } else {
    // init：新建仓库的默认分支统一指到 main（init.defaultBranch 配置要 git 2.28+，用户机器实测
    // git 2.20——老到没有该配置，init 只会产出 master；GitHub 生态默认 main）。
    // symbolic-ref 改 HEAD 指向，新旧 git 都支持。只在目标原本没有 .git 时做：
    // 对本就存在的仓库 reinit 时改 HEAD 会让分支悬空、仓库"看起来变空"，绝不能碰
    const freshInit = !fs.existsSync(path.join(target, '.git'));
    fs.mkdirSync(target, { recursive: true });
    const r = await run('git', ['init', target], { timeoutMs: 60_000 });
    const DEFAULT_GITIGNORE = [
      '# 依赖',
      'node_modules/',
      '.venv/',
      'venv/',
      '__pycache__/',
      '*.py[cod]',
      '',
      '# 构建产物',
      'dist/',
      'build/',
      '*.log',
      '',
      '# 环境与密钥',
      '.env',
      '.env.local',
      '.env.*.local',
      '*.pem',
      '*.key',
      '*.p12',
      '*.pfx',
      'id_rsa',
      'id_ed25519',
      '',
      '# 系统',
      '.DS_Store',
      'Thumbs.db',
      '',
    ].join('\n');
    if (r.code === 0 && freshInit) {
      // 失败不回滚（仓库已建好，最多退回 master 的旧行为），不值得让创建整体失败
      await run('git', ['-C', target, 'symbolic-ref', 'HEAD', 'refs/heads/main'], { timeoutMs: 15_000 });
    }
    // 把目标目录的现有文件提交到新仓库（非空目录直接建 GitHub/Git 仓库时用）。
    // 只在 freshInit（目标原本没有 .git）时做：已有仓库的重初始化不能替用户提交/推历史。
    let committed = false;
    let commitError = '';
    let gitignoreWritten = false;
    if (r.code === 0 && freshInit && body.commitExisting === true) {
      try {
        const gi = path.join(target, '.gitignore');
        if (body.writeGitignore !== false && !fs.existsSync(gi)) {
          fs.writeFileSync(gi, DEFAULT_GITIGNORE);
          gitignoreWritten = true;
        }
        const add = await run('git', ['-C', target, 'add', '-A'], { timeoutMs: 120_000 });
        if (add.code !== 0) throw new Error(add.stderr.trim() || t('srv.cloneGitAddFailed'));
        const status = await run('git', ['-C', target, 'status', '--porcelain'], {
          timeoutMs: 15_000,
        });
        // 全部被 .gitignore 排除时没有可提交内容：不算失败
        if (status.stdout.trim()) {
          const uname = (
            await run('git', ['-C', target, 'config', 'user.name'], { timeoutMs: 5_000 })
          ).stdout.trim();
          const uemail = (
            await run('git', ['-C', target, 'config', 'user.email'], { timeoutMs: 5_000 })
          ).stdout.trim();
          const commit = await run(
            'git',
            [
              '-C',
              target,
              '-c',
              `user.name=${uname || 'svn-git'}`,
              '-c',
              `user.email=${uemail || 'svn-git@localhost'}`,
              'commit',
              '-m',
              '初始化仓库',
            ],
            { timeoutMs: 120_000 },
          );
          if (commit.code !== 0) throw new Error(commit.stderr.trim() || t('srv.cloneGitCommitFailed'));
          committed = true;
        }
      } catch (e) {
        commitError = (e as Error).message;
      }
    }
    // 已初始化仓库 {path} / git init 失败
    result =
      r.code === 0
        ? {
            ok: true,
            message:
              t('srv.initedRepo', { path: target }) +
              (commitError ? t('srv.initCommitFailed', { msg: commitError }) : ''),
            repoDir: target,
            committed,
            commitError: commitError || undefined,
            gitignoreWritten,
          }
        : { ok: false, message: r.stderr.trim() || t('srv.gitInitFailed') };
  }
  return result;
}
