/** SVN 仓库获取：远程 checkout 工作副本 + 本地 svnadmin create（含标准布局与初始工作副本）。
 *
 *  **与仓库浏览的远程检出（vcs/svn/checkout.ts）不是同一套行为**，不要为了"看起来像"把它们合并：
 *  - 这里跑 `checkout -q`，不输出/收集文件清单，也不登记传输进度；超时上限 10 分钟；
 *  - 这里**不做**「目标已存在且非空」预检（原行为：交给 svn 自己报错）；
 *  - 认证失败用 classifySvnError（auth/authz，排除 proxy），响应带 authType='svn'；
 *  - 没有 externals E205011 特判（失败就是失败）、没有稀疏检出（include）。
 *  共用部分已抽到 vcs/svn/net.ts（网络参数）与 vcs/leftover.ts（半截目录清理）。
 *
 *  客户端断开要真的停：与 git 克隆同一套（用户点「取消」/关弹窗 → 停掉 svn 并清半截目录）。
 *  原先这里没接 abort：取消后 svn checkout 会在后台跑到 10 分钟上限，还会留下半个工作副本。 */
import fs from 'node:fs';
import type http from 'node:http';
import { run } from '../../vcs/exec.js';
import { resolveSvnBin, classifySvnError } from '../../vcs/svn.js';
import { svnNetArgs } from '../../vcs/svn/net.js';
import { loadConfig } from '../../config.js';
import { markInflight, clearInflight } from '../../inflight.js';
import { t } from '../../shared/i18n/index.js';
import { removeLeftoverTarget } from './leftover.js';
import type { RepoCreateResult } from './clone.js';

/** 路由层解析好的 SVN 获取参数 */
export interface SvnCreateParams {
  body: Record<string, unknown>;
  target: string;
  url: string;
  /** 开始时清掉了「只有 .git/.svn」的残骸（结果文案里要说明） */
  cleanedRemnant: boolean;
}

export async function createSvnRepo(p: SvnCreateParams, res: http.ServerResponse): Promise<RepoCreateResult> {
  const { body, target, url, cleanedRemnant } = p;
  let result: RepoCreateResult;
  if (url) {
    // 从远程/本地检出工作副本（成员获取仓库；svn checkout 目标目录名即本地名称）
    // **客户端断开要真的停**：与 git 克隆同一套（用户点「取消」/关弹窗 → 停掉 svn 并清半截目录）。
    // 原先这里没接 abort：取消后 svn checkout 会在后台跑到 10 分钟上限，还会留下半个工作副本。
    const ac = new AbortController();
    const onClose = () => ac.abort();
    res.on('close', onClose);
    const targetExistedBefore = fs.existsSync(target);
    // 登记"正在检出到哪儿"（与 git 克隆同一套：强杀后下次启动收尾）
    markInflight(target);
    // 凭据：本次请求带的临时账号（获取前/认证失败后弹框填写，不落盘）优先，
    // 其次工具配置（「SVN 登录」保存的）；两者都空 = 匿名。
    // **必须 --non-interactive**：没有凭据时 svn 会尝试交互读账号，而子进程 stdin
    // 已立即关闭，结果只会是 E215004/E170001（用户实报"没配账号直接报错"）。
    // 网络参数与仓库浏览的远程检出共用 vcs/svn/net.ts。
    const cfg = loadConfig();
    const tempUser = typeof body.username === 'string' ? String(body.username).trim() : '';
    const svnUser = tempUser || cfg.svn.username;
    const svnPass = tempUser ? String(body.password ?? '') : cfg.svn.password;
    const svnNet = svnNetArgs({ user: svnUser, tempUser, trustServerCert: cfg.svn.trustServerCert });
    const r = await run(await resolveSvnBin(), ['checkout', '-q', ...svnNet, url, target], {
      timeoutMs: 600_000,
      signal: ac.signal,
      stdinData: svnUser ? svnPass + '\n' : undefined,
    });
    res.off('close', onClose);
    clearInflight(target); // 检出跑完了（成功/失败/取消都算）：撤掉登记
    if (r.aborted || r.timedOut) {
      // 只清"这次刚建出来的"：原本就存在的目录一个字节都不许动（同 git 克隆的守卫）
      if (!targetExistedBefore) removeLeftoverTarget(target);
      result = {
        ok: false,
        // 检出超时，已停止 / 已取消获取
        message: r.timedOut ? t('srv.cloneTimeout', { min: 10 }) : t('srv.cloneCancelled'),
      };
    } else if (r.code === 0) {
      // 已检出 SVN 工作副本 {path}
      result = { ok: true, message: t('srv.svnCheckedOut', { path: target }) + (cleanedRemnant ? t('srv.remnantCleaned') : ''), repoDir: target };
    } else {
      // svn checkout 失败。认证/授权失败（密码错、匿名无读权限）→ 带 authError 回前端弹账号框；
      // 代理认证失败不在此列（那是系统代理设置问题，弹 SVN 账号框没用）
      const detail = classifySvnError(`${r.stderr}\n${r.stdout}`);
      const needCred = detail?.kind === 'auth' || detail?.kind === 'authz';
      result = {
        ok: false,
        message: r.stderr.trim() || t('srv.svnCheckoutFailed'),
        ...(needCred ? { authError: true, authType: 'svn' as const, user: svnUser } : {}),
      };
    }
  } else {
    // svnadmin create（本地仓库）+ 可选标准布局 + 工作副本
    fs.mkdirSync(target, { recursive: true });
    const r = await run('svnadmin', ['create', target], { timeoutMs: 120_000 });
    if (r.code !== 0) {
      // svnadmin create 失败
      result = { ok: false, message: r.stderr.trim() || t('srv.svnadminFailed') };
    } else {
      let wcUrl = `file://${target}`;
      const standard = body.standard !== false;
      if (standard) {
        // 标准布局：创建 trunk/branches/tags（svn 分支机制依赖目录约定）
        const mk = await run(
          'svn',
          // 创建标准布局 trunk/branches/tags
          ['mkdir', '-q', `${wcUrl}/trunk`, `${wcUrl}/branches`, `${wcUrl}/tags`, '-m', t('vcs.commitMsg.stdLayout')],
          { timeoutMs: 60_000 }
        );
        if (mk.code !== 0) {
          // 标准布局创建失败: {msg} / 未知
          // 原实现直接 sendJson(...) 后 return；返回同形结果交给路由层统一发送，响应字节一致
          return { ok: false, message: t('srv.layoutCreateFailed', { msg: mk.stderr.trim() || t('srv.unknown') }), authError: false };
        }
        // 工作副本检出 trunk（根下只有布局目录，检出根会把 branches 全部拖进来）
        wcUrl += '/trunk';
      }
      const wcDir = target + '-wc';
      const c = await run('svn', ['checkout', '-q', wcUrl, wcDir], { timeoutMs: 120_000 });
      result = c.code === 0
        // 已创建 SVN 仓库 {path}{layout}（工作副本 {wc}） / （标准布局，工作副本检出 trunk）
        ? { ok: true, message: t('srv.createdSvnRepo', { path: target, layout: standard ? t('srv.stdLayoutTrunk') : '', wc: wcDir }), repoDir: wcDir }
        // 已创建 SVN 仓库 {path}{layout}（工作副本检出失败: {msg}） / （标准布局） / 未知
        : { ok: true, message: t('srv.createdSvnRepoWcFailed', { path: target, layout: standard ? t('srv.stdLayout') : '', msg: c.stderr.trim() || t('srv.unknown') }), repoDir: wcDir };
    }
  }
  return result;
}
