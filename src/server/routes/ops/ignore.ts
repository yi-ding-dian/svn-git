/** 忽略规则端点：读取 / 添加 / 删除 / 取消忽略 / 预案与来源。
 *
 *  git 三档（仓库 .gitignore / 全局 excludesFile / .git/info/exclude）与 svn:ignore 的差异、
 *  以及规则文件的按原编码读写，都收在本模块内。 */
import fs from 'node:fs';
import path from 'node:path';
import { run } from '../../../vcs/exec.js';
import { sendJson, readBody, vcsOf, inRepoRoot, invalidateStatusCache, runVcs, MSG_PATH_OUT_OF_BOUNDS } from '../util.js';
import { getSvnIgnoreMap, isIgnoredByRules, gitGlobalExcludesFile, ensureGitGlobalExcludesFile, gitExcludePath, invalidateSvnIgnoreMap } from '../../../vcs/ignore.js';
import type { Ctx } from '../util.js';
import { t } from '../../../shared/i18n/index.js';
import { detectTextEncoding, decodeText, encodeText, type TextEncoding } from '../../../shared/text.js';

/** git 忽略三处去向（展示名与写入目标）——仓库 .gitignore / 全局 excludesFile / .git/info/exclude。
 *  值写成**函数**：语言可切换，模块顶层求值会把展示名固化成首次加载时的语言。 */
const GIT_IGNORE_WHERE = {
  // 仓库 .gitignore
  gitignore: () => t('srv.gitIgnoreWhere.gitignore'),
  // 全局忽略（~/.gitignore_global）
  global: () => t('srv.gitIgnoreWhere.global'),
  exclude: () => '.git/info/exclude', // 路径名（非展示文案），不翻
} as const;
type GitIgnoreTarget = keyof typeof GIT_IGNORE_WHERE;

/** 三个忽略文件清单（global 未配置时 GET/删除不含；写入 global 时先确保配置）
 * 全局文件查询/确保逻辑共用 vcs/ignore.ts（渲染侧 /api/fs 同样从该处读取三来源） */
async function gitIgnoreFiles(repoRoot: string, forWriteGlobal = false): Promise<{ where: GitIgnoreTarget; file: string }[]> {
  const global = forWriteGlobal ? await ensureGitGlobalExcludesFile() : await gitGlobalExcludesFile();
  const out: { where: GitIgnoreTarget; file: string }[] = [
    { where: 'gitignore', file: path.join(repoRoot, '.gitignore') },
  ];
  if (global) out.push({ where: 'global', file: path.resolve(global) });
  out.push({ where: 'exclude', file: await gitExcludePath(repoRoot) });
  return out;
}
/** 追加忽略规则到文件（去重：已含同 pattern 行返回 false；末尾补一行）。
 * 同文件已有其取反行 !pattern（规则被「取消忽略」废止）时：清掉 pattern/取反两行、重写干净 pattern——
 * 保证"加入忽略"必然生效（否则重复 忽略→取消→忽略 会卡在"规则已存在"而 git 实际未忽略）。
 * pattern 以 ! 开头（取消忽略的否定行）不做取反清理，仅行去重（避免!!!叠加）。 */
/* 忽略规则文件的读与写都按**原编码**走：这几处是"整读 → 过滤 → 整写"，
   若文件是 GBK（老项目的中文注释很常见），按 UTF-8 读会把已有行解成替换符、写回就固化了。
   极小概率的"GBK 表示不了所写内容"宁可抛错让请求失败，也不静默转码。 */
function readIgnoreLines(file: string): { lines: string[]; enc: TextEncoding } {
  const buf = fs.readFileSync(file);
  const enc = detectTextEncoding(buf);
  return { lines: decodeText(buf, enc).split('\n'), enc };
}
function writeIgnoreLines(file: string, lines: string[], enc: TextEncoding): void {
  fs.writeFileSync(file, encodeText(lines.join('\n') + '\n', enc));
}

function appendIgnoreLine(file: string, pattern: string): boolean {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const { lines, enc } = fs.existsSync(file) ? readIgnoreLines(file) : { lines: [] as string[], enc: 'utf-8' as TextEncoding };
  if (!pattern.startsWith('!') && lines.some((l) => l.trim() === '!' + pattern)) {
    writeIgnoreLines(file, [...lines.filter((l) => { const t = l.trim(); return t !== pattern && t !== '!' + pattern; }), pattern], enc);
    return true;
  }
  if (lines.some((l) => l.trim() === pattern)) return false;
  writeIgnoreLines(file, [...lines.filter((l) => l.trim()), pattern], enc);
  return true;
}

/** 清除文件中的取反行（!pattern）：任一档的取反正则按优先级（… > .gitignore > exclude > global）都能覆盖目标档，
 * 加入忽略=用户意图"文件必被忽略"，写入前清全部档位取反，避免跨档覆盖导致看似写入实则未忽略 */
function removeNegationLine(file: string, pattern: string): void {
  if (pattern.startsWith('!') || !fs.existsSync(file)) return;
  const { lines, enc } = readIgnoreLines(file);
  if (lines.some((l) => l.trim() === '!' + pattern)) {
    writeIgnoreLines(file, lines.filter((l) => { const t = l.trim(); return t && t !== '!' + pattern; }), enc);
  }
}

export async function handle(ctx: Ctx): Promise<boolean> {
  const { req, res, url } = ctx;
  const p = url.pathname;

  if (p === '/api/ignore-plan' && req.method === 'GET') {
    // 忽略预案（仅 svn 需要）：规则最终写到哪个目录、内容建议是什么。
    // 弹窗打开时就展示给用户，避免「填了 A 却写入 B」（svn:ignore 只能按名字作用于某目录的直接子项）
    const { repo, vcs } = vcsOf();
    if (repo.type !== 'svn' || !vcs.ignorePlan) {
      // 仅 SVN 需要忽略预案
      sendJson(res, 400, { error: t('srv.svnIgnorePlanOnly') });
      return true;
    }
    const pathRel = url.searchParams.get('path') ?? '';
    if (!inRepoRoot(repo.root, path.resolve(repo.root, pathRel))) {
      sendJson(res, 400, { error: MSG_PATH_OUT_OF_BOUNDS() });
      return true;
    }
    sendJson(res, 200, await vcs.ignorePlan(pathRel));
    return true;
  }

  if (p === '/api/ignore-source' && req.method === 'GET') {
    // 「谁忽略了我」：本目录自己没有规则、却被上层规则忽略时，指出规则挂在哪一层、内容是什么。
    // 专治「忽略设置」看着空空的困惑——svn:ignore 不继承，被上层忽略的目录自己是没有任何规则的。
    const { repo } = vcsOf();
    const pathRel = url.searchParams.get('path') ?? '';
    if (repo.type !== 'svn') {
      sendJson(res, 200, { source: null }); // git 有否定规则/分档，来源由 check-ignore -v 单独给
      return true;
    }
    if (!inRepoRoot(repo.root, path.resolve(repo.root, pathRel))) {
      sendJson(res, 400, { error: MSG_PATH_OUT_OF_BOUNDS() });
      return true;
    }
    const parts = pathRel.replace(/^\.\//, '').replace(/\/+$/, '').split('/').filter((s) => s && s !== '.');
    const map = await getSvnIgnoreMap(repo.root);
    let source: { dir: string; rule: string } | null = null;
    let acc = '';
    for (const part of parts) {
      acc = acc ? `${acc}/${part}` : part;
      const parentOf = path.dirname(acc);
      const dir = parentOf === '.' ? '.' : parentOf;
      const rule = (map.get(dir) ?? []).find((r) => isIgnoredByRules([r], part));
      if (rule) {
        source = { dir, rule };
        break;
      }
    }
    sendJson(res, 200, { source });
    return true;
  }

  if (p === '/api/ignore' && req.method === 'GET') {
    // 读取忽略规则（svn: svn:ignore 属性 / git: .gitignore）
    const { repo } = vcsOf();
    const pathRel = url.searchParams.get('path') ?? '';
    let rules: string[] = [];
    if (repo.type === 'svn') {
      if (!inRepoRoot(repo.root, path.resolve(repo.root, pathRel))) {
        sendJson(res, 400, { error: MSG_PATH_OUT_OF_BOUNDS() });
        return true;
      }
      const r = await run('svn', ['propget', 'svn:ignore', pathRel || '.'], { cwd: repo.root, timeoutMs: 30_000 });
      if (r.code === 0 && r.stdout.trim()) rules = r.stdout.split('\n').map((s) => s.trim()).filter(Boolean);
      sendJson(res, 200, { rules });
      return true;
    } else {
      // git：三档规则合并（仓库 .gitignore / 全局 excludesFile / .git/info/exclude），sources 标注来源
      const files = await gitIgnoreFiles(repo.root);
      const rules: string[] = [];
      const sources: { pattern: string; where: string }[] = [];
      for (const { where, file } of files) {
        if (!fs.existsSync(file)) continue;
        for (const l of fs.readFileSync(file, 'utf8').split('\n')) {
          const t = l.trim();
          if (!t || t.startsWith('#') || t.startsWith('!')) continue; // 注释与否定行不列
          rules.push(t);
          sources.push({ pattern: t, where: GIT_IGNORE_WHERE[where]() });
        }
      }
      sendJson(res, 200, { rules, sources });
      return true;
    }
  }

  if (p === '/api/ignore-remove' && req.method === 'POST') {
    // 删除单条忽略规则
    const { repo } = vcsOf();
    const body = await readBody(req);
    const pathRel = String(body.path ?? '');
    const pattern = String(body.pattern ?? '');
    if (repo.type === 'svn') {
      // 路径越界校验：pathRel 用于 svn propget/propset，传 ../ 可作用于仓库外路径
      if (!inRepoRoot(repo.root, path.resolve(repo.root, pathRel))) {
        sendJson(res, 400, { error: MSG_PATH_OUT_OF_BOUNDS() });
        return true;
      }
      // propget → 过滤 → propset 回写
      const getRes = await run('svn', ['propget', 'svn:ignore', pathRel || '.'], { cwd: repo.root, timeoutMs: 30_000 });
      const remaining = getRes.stdout
        .split('\n')
        .map((s) => s.trim())
        .filter((s) => s && s !== pattern);
      const setRes = await run('svn', ['propset', 'svn:ignore', remaining.join('\n'), pathRel || '.'], { cwd: repo.root, timeoutMs: 30_000 });
      if (setRes.code !== 0) {
        // 删除失败
        sendJson(res, 200, { ok: false, message: setRes.stderr.trim() || t('srv.removeRuleFailed') });
        return true;
      }
      invalidateSvnIgnoreMap(repo.root); // 规则快照缓存失效（否则 60 秒内读到旧规则集）
    } else {
      // git：三档任一文件删除该行（where 未知/global 未配置时自然跳过）
      const files = await gitIgnoreFiles(repo.root);
      let removedAt = '';
      for (const { where, file } of files) {
        if (!fs.existsSync(file)) continue;
        const { lines, enc } = readIgnoreLines(file);
        const left = lines.filter((l) => l.trim() !== pattern);
        if (left.length !== lines.length) {
          writeIgnoreLines(file, left.filter((l) => l.trim()), enc);
          removedAt = GIT_IGNORE_WHERE[where]();
          break;
        }
      }
      invalidateStatusCache(repo.root);
      // 已删除规则: {pattern}（{where}） / 未找到规则: {pattern}
      sendJson(res, 200, { ok: true, message: removedAt ? t('srv.ruleRemovedAt', { pattern, where: removedAt }) : t('srv.ruleNotFound', { pattern }) });
      return true;
    }
    invalidateStatusCache(repo.root);
    // 已删除规则: {pattern}
    sendJson(res, 200, { ok: true, message: t('srv.ruleRemoved', { pattern }) });
    return true;
  }

  if (p === '/api/unignore' && req.method === 'POST') {
    // 取消忽略：git 追加否定规则 !<路径>（覆盖前面的排除）；svn 删除承载该路径的匹配规则
    const { repo } = vcsOf();
    const body = await readBody(req);
    const rel = String(body.path ?? '').replace(/^\/+/, '');
    if (!rel) {
      // 缺少路径
      sendJson(res, 400, { error: t('srv.missingPath') });
      return true;
    }
    const parts = rel.split('/').filter(Boolean);
    if (repo.type === 'git') {
      // git：check-ignore -v 定位命中来源（.gitignore / 全局 excludesFile / .git/info/exclude），
      // 否定规则追加到**同档文件**——跨档优先级 exclude > global > .gitignore，写错档会不生效
      const probe = await run('git', ['check-ignore', '-v', '--', rel], { cwd: repo.root, timeoutMs: 15_000 });
      const srcLine = probe.code === 0 && probe.stdout.trim() ? probe.stdout.split('\n')[0] : '';
      // source 输出为相对仓库根的路径（如 .git/info/exclude）——必须相对 repo.root 解析：
      // 用 process.cwd() 解析会错位到启动目录（打开子项目仓库时写入错误位置，曾污染父仓库）
      const srcFile = srcLine ? path.resolve(repo.root, srcLine.split(':')[0] ?? '') : null;
      if (srcLine && srcFile) {
        // 命中：在来源档追加 !<路径>（目录带 / 与反序列化交给 git 判定：直接追加路径本身）
        let isDir = false;
        try {
          isDir = fs.statSync(path.join(repo.root, rel)).isDirectory();
        } catch {
          isDir = false;
        }
        appendIgnoreLine(srcFile, isDir ? `!${rel}/` : `!${rel}`);
        invalidateStatusCache(repo.root);
        const where = srcFile === path.join(repo.root, '.gitignore')
          ? GIT_IGNORE_WHERE.gitignore()
          : String(srcFile).includes('info') && String(srcFile).includes('exclude')
            ? GIT_IGNORE_WHERE.exclude()
            : GIT_IGNORE_WHERE.global();
        // 已取消忽略: {path}（追加否定到 {where}）
        sendJson(res, 200, { ok: true, message: t('srv.unignoredAppended', { path: rel, where }) });
        return true;
      }
      // 未找到忽略 {path} 的规则（该文件当前未被任何档忽略）
      sendJson(res, 200, { ok: false, message: t('srv.unignoreRuleNotFound', { path: rel }) });
      return true;
    }
    // svn：逐级（根→自身）找承载匹配规则的目录，删除该条规则（svn:ignore 不支持否定语法）
    let found: { dir: string; rule: string } | null = null;
    let acc2 = '';
    for (const part of parts) {
      acc2 = acc2 ? `${acc2}/${part}` : part;
      const parentOf = path.dirname(acc2);
      const dir = parentOf === '.' ? '.' : parentOf;
      const rules = (await getSvnIgnoreMap(repo.root)).get(dir) ?? [];
      if (rules.length) {
        const rule = rules.find((r) => isIgnoredByRules([r], part));
        if (rule) {
          found = { dir, rule };
          break;
        }
      }
    }
    if (!found) {
      // 未找到忽略 {path} 的规则（可能来自全局 ignore，请手动处理）
      sendJson(res, 200, { ok: false, message: t('srv.unignoreRuleNotFoundGlobal', { path: rel }) });
      return true;
    }
    const getRes = await run('svn', ['propget', 'svn:ignore', found.dir], { cwd: repo.root, timeoutMs: 30_000 });
    const remaining = getRes.stdout
      .split('\n')
      .map((s) => s.trim())
      .filter((s) => s && s !== found!.rule);
    const setRes = await run('svn', ['propset', 'svn:ignore', remaining.join('\n'), found.dir], { cwd: repo.root, timeoutMs: 30_000 });
    if (setRes.code !== 0) {
      // 取消忽略失败
      sendJson(res, 200, { ok: false, message: setRes.stderr.trim() || t('srv.unignoreFailed') });
      return true;
    }
    invalidateSvnIgnoreMap(repo.root); // 同上：本条自己就依赖过缓存找规则，改完必须失效
    invalidateStatusCache(repo.root);
    // 已取消忽略: 删除 {dir} 的规则「{rule}」，同目录匹配该规则的文件将变为未版本化 / 根目录
    sendJson(res, 200, { ok: true, message: t('srv.unignoredSvn', { dir: found.dir === '.' ? t('srv.rootDir') : found.dir, rule: found.rule }) });
    return true;
  }

  if (p === '/api/ignore' && req.method === 'POST') {
    const { repo, vcs } = vcsOf();
    const body = await readBody(req);
    const pathRel = String(body.path ?? '');
    const pattern = String(body.pattern ?? '').trim();
    if (!pattern) {
      // 请填写忽略规则
      sendJson(res, 400, { error: t('srv.ignoreRuleRequired') });
      return true;
    }
    // svn 分支的 propSetIgnore 作用于 pathRel 目录,须在仓库根内
    if (repo.type === 'svn' && !inRepoRoot(repo.root, path.resolve(repo.root, pathRel))) {
      sendJson(res, 400, { error: MSG_PATH_OUT_OF_BOUNDS() });
      return true;
    }
    // 忽略后 ? → I，状态码变化，缓存失效由 runVcs 统一
    if (repo.type === 'git') {
      // git：三向写入（.gitignore / 全局 excludesFile / .git/info/exclude）；target 缺省 .gitignore
      const target = String(body.target ?? 'gitignore') as GitIgnoreTarget;
      if (target !== 'gitignore' && target !== 'global' && target !== 'exclude') {
        // 未知忽略去向
        sendJson(res, 400, { error: t('srv.unknownIgnoreTarget') });
        return true;
      }
      const files = await gitIgnoreFiles(repo.root, target === 'global'); // global 写入时先确保配置
      const hit = files.find((f) => f.where === target);
      if (!hit) {
        // 全局忽略未配置，请先点击「加入忽略 → 全局」重新尝试（将自动配置 core.excludesFile）
        sendJson(res, 400, { error: t('srv.globalIgnoreUnconfigured') });
        return true;
      }
      // 清除所有档位的取反行（!pattern）后写入：保证 git 当前判定确实忽略（跨档取反会覆盖目标档）
      for (const f of files) removeNegationLine(f.file, pattern);
      if (appendIgnoreLine(hit.file, pattern)) {
        invalidateStatusCache(repo.root);
        // 已加入忽略: {pattern}（{where}）
        sendJson(res, 200, { ok: true, message: t('srv.ignoreAdded', { pattern, where: GIT_IGNORE_WHERE[target]() }) });
      } else {
        // 正规则已存在：由于取反行已清，忽略已生效——提示"已恢复"而非"未写入"
        invalidateStatusCache(repo.root);
        // 规则已存在,已恢复忽略生效: {pattern}（{where}）
        sendJson(res, 200, { ok: true, message: t('srv.ignoreRestored', { pattern, where: GIT_IGNORE_WHERE[target]() }) });
      }
      return true;
    }
    return runVcs(ctx, () => vcs.propSetIgnore?.(pathRel, pattern));
  }

  return false;
}
