/** 仓库浏览右键「检出到本地」的编排（URL 直连检出工作副本，不依赖已打开项目）。
 *
 *  凭据：本次请求带的临时凭据优先（**只本次用、绝不落盘**），否则用已保存的 SVN 账号；
 *  两者都没有 = 匿名裸跑。认证失败按 authError 返回（带 user 供前端拼"当前账号无权限"），
 *  由前端弹凭据框重试——"开跑即验"：有权限的人不弹任何框。
 *  路由层只传参数、发响应；命令执行、稀疏检出、扫盘进度、半截目录清理都在这里。 */
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { run, type RunResult } from '../exec.js';
import { resolveSvnBin } from '../svn.js';
import { createLeftoverCleaner } from '../leftover.js';
import { svnNetArgs } from './net.js';
import { loadConfig } from '../../config.js';
import { progressStart, progressDone, progressReport } from '../../transfer-progress.js';
import { t } from '../../shared/i18n/index.js';

/** 检出失败/取消后没清干净的半截目录：下次对同一目标检出时开始时先重试清理。
 *  与「获取仓库」的登记表分开（见 vcs/leftover.ts）；清不掉**绝不算检出失败**。 */
const coLeftover = createLeftoverCleaner();

/** 递归统计目录下已落盘文件数与字节（跳过 .svn 元数据）。svn 检出没有 --progress，
 *  周期扫盘估算"已检出多少文件 / 多大"用；竞态（文件正写入/刚被清）静默跳过。 */
async function scanDirStat(dir: string): Promise<{ files: number; bytes: number }> {
  let files = 0;
  let bytes = 0;
  const walk = async (d: string): Promise<void> => {
    let ents: fs.Dirent[];
    try {
      ents = await fs.promises.readdir(d, { withFileTypes: true });
    } catch {
      return; // 目录刚被清理/不可读：跳过
    }
    for (const e of ents) {
      if (e.name === '.svn') continue;
      const full = path.join(d, e.name);
      if (e.isDirectory()) {
        await walk(full);
      } else if (e.isFile()) {
        try {
          const st = await fs.promises.stat(full);
          files += 1;
          bytes += st.size;
        } catch {
          /* 正在写入或被删：跳过 */
        }
      }
    }
  };
  await walk(dir);
  return { files, bytes };
}

/** SVN 认证/授权失败判定（解析 svn 输出文本，不是界面文案，禁止翻译）：
 *  E170001 认证/授权被拒、E215004 凭据用完或被拒、本地化消息；宽匹配——
 *  宁可按认证失败处理（前端弹凭据框可重试），也不把用户卡在看不明白的错误里。 */
const SVN_AUTH_FAIL = /E170001|E215004|Authentication failed|Authentication required|authorization failed|Not authorized|认证失败/i; // i18n-ignore: 解析 svn 输出的匹配表

export interface RemoteCheckoutParams {
  /** 仓库 URL（已由路由层校验协议白名单） */
  url: string;
  /** 本地父目录 */
  dir: string;
  /** 本地目录名 */
  name: string;
  /** body.include：前端树勾选的多级相对路径（未知类型按缺失处理） */
  include: unknown;
  /** body.username / body.password：本次请求带的临时凭据（重试用），不落盘 */
  username: unknown;
  password: unknown;
}

/** 检出结果（与端点原响应 JSON 同形，由路由层直接 sendJson）。 */
export type RemoteCheckoutResult = Record<string, unknown>;

/** URL 直连检出工作副本。`signal` 由路由层在客户端断开（取消/关弹窗）时触发。 */
export async function checkoutRemote(p: RemoteCheckoutParams, signal: AbortSignal): Promise<RemoteCheckoutResult> {
  const targetUrl = p.url;
  const dir = p.dir;
  const name = p.name;
  // 与原实现一致：把请求体字段收进 body，后续逻辑逐字搬运
  const body: Record<string, unknown> = { include: p.include, username: p.username, password: p.password };
  const target = path.join(dir, name);
  // 上次同目标的半截检出没清干净（或服务重启丢了记录）：开始时先清一遍
  if (coLeftover.has(target)) coLeftover.remove(target);
  let existedBefore = fs.existsSync(target);
  if (existedBefore) {
    try {
      const entries = fs.readdirSync(target);
      if (entries.length === 1 && entries[0] === '.svn') {
        // 只有 .svn 一个条目 = 上次检出中断留下的残骸（必然检出失败）；清掉继续
        coLeftover.remove(target);
        existedBefore = false;
      } else if (entries.length > 0) {
        // 目标目录已存在且非空：{path}
        return { ok: false, message: t('srv.coTargetExists', { path: target }) };
      }
      // 空目录：留给 svn 检出进去（existedBefore=true → 失败/取消时一个字节都不动）
    } catch {
      /* 读不到就按原样交给 svn，让它报自己的错 */
    }
  }
  // 凭据解析：本次请求带的临时凭据（重试用）优先，否则已保存配置，都没有 = 匿名裸跑。
  // 临时凭据**只用于本次检出**：加 --no-auth-cache，连 svn 自己的 auth 缓存都不写入
  //（非交互模式默认会存——"下次悄悄记住"违背"只本次用"的决策）；配置凭据/匿名沿用 svn 默认。
  const cfg = loadConfig();
  const tempCred =
    typeof body.username === 'string' && body.username
      ? { username: body.username, password: String(body.password ?? '') }
      : null;
  const cred = tempCred ?? (cfg.svn.username ? { username: cfg.svn.username, password: cfg.svn.password } : null);
  /** 失败/取消清半截目录：只清"这次刚建出来的"，原本就存在的（哪怕空的）一个字节都不动 */
  const cleanup = () => {
    if (!existedBefore) coLeftover.remove(target);
  };
  // 选择性检出（SVN 深度检出）：前端树勾选的**相对路径**（可多级，如 branches/AnHui）——勾了
  // 则只检出勾选项，未勾选的连空壳都不留（--set-depth exclude），且后续 update 也只更新勾选的
  // （SVN 深度机制的固有行为——"其他目录不检测更新"由此天然成立）。空/缺省 = 完整检出（原行为）。
  // 路径来自前端：逐段校验（每段非空、非 . / ..——防路径穿越）；勾了父又勾子时去掉子（父已覆盖）
  const include = ((): string[] => {
    if (!Array.isArray(body.include)) return [];
    const norm = (body.include as unknown[])
      .map(String)
      .map((s) => s.replace(/\\/g, '/').replace(/^\/+|\/+$/g, ''))
      .map((s) => s.split('/').filter((seg) => seg && seg !== '.' && seg !== '..'))
      .filter((segs) => segs.length > 0)
      .map((segs) => segs.join('/'));
    const uniq = [...new Set(norm)].sort((a, b) => a.split('/').length - b.split('/').length);
    return uniq.filter((p, i) => !uniq.slice(0, i).some((q) => p === q || p.startsWith(q + '/')));
  })();
  /** 每条 svn 命令的公共网络参数（与「获取仓库」共用 vcs/svn/net.ts）。
   *  -q 由各命令自加：svn list 不接受 -q（实测），不能混进公共组 */
  const svnNet = () =>
    svnNetArgs({
      user: cred?.username,
      tempUser: tempCred ? tempCred.username : '',
      trustServerCert: cfg.svn.trustServerCert,
    });
  const runOpts = {
    cwd: os.tmpdir(),
    stdinData: cred ? cred.password + '\n' : undefined,
    timeoutMs: 600_000, // 与「获取仓库」一致：大仓库首次检出常常要几分钟
    signal,
  };
  // 进度：登记到传输进度表（chan = target，与「获取仓库」同语义）——svn 检出没有 --progress，
  // 文件数/字节靠周期扫盘已落盘内容估算（1.5s 一次 + 防重叠）；只影响展示，扫不动就跳过
  progressStart(target);
  let scanning = false;
  const scanTimer = setInterval(() => {
    if (scanning) return;
    scanning = true;
    void scanDirStat(target)
      .then(({ files, bytes }) => progressReport(target, files, bytes))
      .catch(() => {
        /* 这一轮扫不动就跳过 */
      })
      .finally(() => {
        scanning = false;
      });
  }, 1500);
  // —— 检出结果收集（任务详情窗展示：文件清单 + svn 警告）——
  const coFiles: { code: string; path: string }[] = [];
  let coTotal = 0;
  const coWarnings: string[] = [];
  /** 收集一条检出命令的输出：stdout 里 `A/U 路径` 行 → 清单（上限 2000 条，路径转相对 target；
   *  超出只计总数）；stderr 非空行 → svn 警告（上限 50 条）。检出命令一律不加 -q——清单就靠这些行。 */
  const collectR = (rr: RunResult): RunResult => {
    for (const raw of rr.stdout.split('\n')) {
      const m = /^([ADUGECR])\s+(.+)$/.exec(raw);
      if (!m) {
        // 非状态行里的"警告类"（Skipped 'path' -- … 等，常见于外部定义失败）：归入警告区
        const s = raw.trim();
        if (s && /^(Skipped|Warning|W\d{6})/i.test(s) && coWarnings.length < 50) coWarnings.push(s);
        continue;
      }
      coTotal += 1;
      if (coFiles.length >= 2000) continue;
      const p = m[2]!;
      // svn 输出的路径是**相对 cwd** 的（cwd=os.tmpdir）——先转绝对再裁成相对 target 的干净路径
      const abs = path.resolve(os.tmpdir(), p);
      coFiles.push({ code: m[1]!, path: abs.startsWith(target + path.sep) ? abs.slice(target.length + 1) : p });
    }
    for (const line of rr.stderr.split('\n')) {
      const s = line.trim();
      // 全收（含 E 错误行）：失败 message 只留第一行摘要，完整多行信息这里是唯一的完整展示位
      if (s && coWarnings.length < 50) coWarnings.push(s);
    }
    return rr;
  };
  let r: RunResult;
  try {
    const bin = await resolveSvnBin();
    /** 检出期跑一条 svn 命令（不加 -q：要 stdout 的文件行做清单） */
    const runCo = async (args: string[]): Promise<RunResult> => collectR(await run(bin, args, runOpts));
    if (include.length === 0) {
      // 完整检出（原行为，单条命令）
      r = await runCo(['checkout', ...svnNet(), targetUrl, target]);
    } else {
      // 稀疏检出：勾选路径可任意深（branches/AnHui/…）。步骤：
      //   1) 空深度检出 → 根文件（files）
      //   2) 根 + 勾选路径的**祖先目录**逐个物化子项（immediates，浅→深）——祖先不出空壳，
      //      深处的 infinity 到不了
      //   3) 勾选目录全量加深（infinity，浅→深）
      //   4) 回到每个物化目录：远程列直接子目录，不在保留集（勾选项 + 祖先链）的**批量** exclude
      //      （空壳也去掉，后续 update 不拉；一条 update 多目标，避免逐个子进程调用）
      // 任一步失败即整体失败（走既有 cleanup 清半截目录）
      r = await runCo(['checkout', '--depth', 'empty', ...svnNet(), targetUrl, target]);
      if (r.code === 0) r = await runCo(['update', '--depth', 'files', ...svnNet(), target]);
      const byDepth = (a: string, b: string) => a.split('/').length - b.split('/').length;
      const ancestors = new Set<string>();
      for (const inc of include) {
        const segs = inc.split('/');
        for (let i = 1; i < segs.length; i++) ancestors.add(segs.slice(0, i).join('/'));
      }
      /** 要保留的目录（相对路径全集）：勾选项 + 其祖先链 */
      const keep = new Set([...include, ...ancestors]);
      /** 需要物化的目录：根（''）+ 祖先链（浅→深，先物化父链） */
      const materialize = ['', ...[...ancestors].sort(byDepth)];
      for (const dir of materialize) {
        if (r.code !== 0) break;
        r = await runCo(['update', '--set-depth', 'immediates', ...svnNet(), dir ? path.join(target, dir) : target]);
      }
      for (const inc of [...include].sort(byDepth)) {
        if (r.code !== 0) break;
        r = await runCo(['update', '--set-depth', 'infinity', ...svnNet(), path.join(target, inc)]);
      }
      // 拼接远程 URL 用去尾斜杠的 base（targetUrl 未规范化过，双斜杠 URL 可能被 svn 拒）
      const baseUrl = targetUrl.replace(/\/+$/, '');
      for (const dir of materialize) {
        if (r.code !== 0) break;
        const dirUrl = dir ? `${baseUrl}/${dir}` : baseUrl;
        // svn list 输出里目录带尾斜杠；列不到就跳过（不致命——该层权限/瞬时网络问题不该毁整次检出）
        const ls = await run(bin, [...svnNet(), 'list', dirUrl], { ...runOpts, timeoutMs: 60_000 });
        if (ls.code !== 0) continue;
        const drops = ls.stdout
          .split('\n')
          .map((s) => s.trim())
          .filter((s) => s.endsWith('/'))
          .map((s) => s.slice(0, -1))
          .filter((name) => !keep.has(dir ? `${dir}/${name}` : name))
          .map((name) => path.join(target, dir, name));
        if (drops.length > 0) r = await run(bin, ['update', '-q', '--set-depth', 'exclude', ...svnNet(), ...drops], runOpts);
      }
    }
  } catch (e) {
    cleanup();
    return { ok: false, message: (e as Error).message, files: coFiles, fileTotal: coTotal, warnings: coWarnings };
  } finally {
    // 检出段结束（成功/失败/取消）：停扫盘、撤进度登记
    clearInterval(scanTimer);
    progressDone(target);
  }
  // aborted（用户取消/断开）与 timedOut（到 10 分钟上限）都要判——只判一个会把另一种当普通失败
  if (r.aborted || r.timedOut) {
    cleanup();
    return {
      ok: false,
      // 已取消获取 / 获取超时（超过 {sec} 秒），已停止
      message: r.timedOut ? t('srv.cloneTimeout', { sec: 600 }) : t('srv.cloneCancelled'),
      // 部分结果也带回：详情窗能看到"取消/超时前检到哪了"
      files: coFiles,
      fileTotal: coTotal,
      warnings: coWarnings,
    };
  }
  if (r.code === 0) {
    // 已检出 SVN 工作副本 {path}
    return {
      ok: true,
      message: t('srv.svnCheckedOut', { path: target }),
      repoDir: target,
      // 检出结果详情（任务详情窗列清单/警告用；files 超 2000 条截断，fileTotal 是全量数）
      files: coFiles,
      fileTotal: coTotal,
      warnings: coWarnings,
    };
  }
  // externals 处理失败（E205011）**不算整体失败**：主内容已完整检出、只是外部引用没拉下来——
  // 工作副本已建立（.svn 在）就按成功返回（✓ + 详情黄框警告）。否则用户看到"工作副本明明可用
  // 却打红✗"，还连带丢掉"收录最近项目 / 降落动画"（都只在成功路径走）——用户实报
  if (/E205011/.test(r.stderr) && fs.existsSync(path.join(target, '.svn'))) {
    return {
      ok: true,
      message: t('srv.svnCheckedOutExternals', { path: target }),
      repoDir: target,
      files: coFiles,
      fileTotal: coTotal,
      warnings: coWarnings,
    };
  }
  cleanup();
  const auth = SVN_AUTH_FAIL.test(r.stdout + r.stderr);
  // 失败 message 取**最后一条 E 行**（svn 的总结行；先 W 警告后 E 错误的场景第一行不是根因），
  // 没有 E 行退回第一行；截 300。完整多行 stderr 由 warnings 带回（详情窗统一展示，避免重复）
  const failLines = r.stderr.split('\n').map((s) => s.trim()).filter(Boolean);
  const failLine = [...failLines].reverse().find((l) => /svn: E/.test(l)) ?? failLines[0] ?? r.stdout.trim();
  return {
    ok: false,
    message: failLine.slice(0, 300) || 'svn checkout failed',
    // 失败/认证失败也带回部分结果（详情窗可见检到哪、有什么警告）
    files: coFiles,
    fileTotal: coTotal,
    warnings: coWarnings,
    // authError 时带 user = 本次实际使用的账号（空串 = 匿名）：前端拼「当前账号[X]没有获取该仓库权限」
    ...(auth ? { authError: true, user: cred?.username ?? '' } : {}),
  };
}
