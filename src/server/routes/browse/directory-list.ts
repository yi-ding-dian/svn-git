/** 目录列表端点：未版本化文件、过滤树、工作副本目录浏览。
 *  只读：把磁盘目录与版本库状态合并后返回给前端。 */
import fs from 'node:fs';
import path from 'node:path';
import { makeGitIgnoreChecker } from '../../../vcs/ignore.js';
import { compareName } from '../../../shared/types.js';
import { run } from '../../../vcs/exec.js';
import { inRepoRoot, sendJson, getStatusCached, vcsOf, MSG_OUT_OF_SCOPE, type Ctx } from '../util.js';
import { t } from '../../../shared/i18n/index.js';

/** 忽略检测（svn status --no-ignore）的输出上限：超过就不解析。
 *  它只用来把被忽略的条目标成 I，而超大工作副本上这个扫描有 5MB+、解析要秒级——收益不值。
 *  实测参考：正常仓库几十 KB；某 35 万文件的工作副本 5.6MB / 4.3 万行。 */
const MAX_IGNORE_SCAN_BYTES = 1024 * 1024;

/** 修改时间格式化: "2026/8/23 11:17"（不同于 toLocaleString.slice 会留下尾冒号） */
function fmtMtime(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export async function handle(ctx: Ctx): Promise<boolean> {
  const { res, url } = ctx;
  const p = url.pathname;

  if (p === '/api/new-files') {
    // 目录及所有子目录中的未版本化文件（'?' 条目；目录条目递归展开内部文件）。
    // 用于筛选"仅新文件"时平铺列出全部新文件，双击跳转定位
    const { repo } = vcsOf();
    const dir = url.searchParams.get('dir') || '';
    const prefix = dir ? dir + '/' : '';
    const items = (await getStatusCached(repo, false)) as { path: string; code: string; isDir: boolean }[];
    const files: { path: string }[] = [];
    const seen = new Set<string>();
    const walkDir = (relDir: string) => {
      let names: string[];
      try {
        names = fs.readdirSync(path.join(repo.root, relDir));
      } catch {
        return;
      }
      for (const n of names) {
        if (n === '.svn' || n === '.git') continue;
        const base = relDir.replace(/\/+$/, ''); // 防御性去尾斜杠（如 "?? dir/"）
        const rel = base ? `${base}/${n}` : n;
        if (seen.has(rel)) continue;
        const abs = path.join(repo.root, rel);
        let st: fs.Stats;
        try {
          st = fs.statSync(abs);
        } catch {
          continue;
        }
        seen.add(rel);
        if (st.isDirectory()) walkDir(rel);
        else files.push({ path: rel });
      }
    };
    for (const it of items) {
      if (it.code !== '?' || !it.path.startsWith(prefix) || seen.has(it.path)) continue;
      seen.add(it.path);
      if (it.isDir) walkDir(it.path);
      else files.push({ path: it.path });
    }
    files.sort((a, b) => compareName(a.path, b.path));
    sendJson(res, 200, { files });
    return true;
  }

  if (p === '/api/filtered-tree') {
    // 过滤后的树：目录及子目录中，状态码匹配的条目按目录层级构建树（'?' 目录展开内部全部文件）。
    // 供"仅修改/仅新文件/仅删除"过滤在树视图展示
    const { repo } = vcsOf();
    const dir = url.searchParams.get('dir') || '';
    const codes = new Set((url.searchParams.get('codes') || '').split(',').filter(Boolean));
    const prefix = dir ? dir + '/' : '';
    const items = (await getStatusCached(repo, false)) as { path: string; code: string; isDir: boolean }[];
    interface TNode {
      name: string;
      path: string;
      isDir: boolean;
      code: string;
      /** 文件大小（目录 0）与修改时间（目录空）——供悬浮卡片展示 */
      size?: number;
      mtime?: string;
      children: TNode[];
    }
    const root: TNode[] = [];
    const map = new Map<string, TNode>();
    const ensureDir = (rel: string): TNode => {
      let n = map.get(rel);
      if (!n) {
        n = { name: rel.split('/').pop() || rel, path: rel, isDir: true, code: '', children: [] };
        map.set(rel, n);
        const i = rel.lastIndexOf('/');
        if (i < 0) root.push(n);
        else ensureDir(rel.slice(0, i)).children.push(n);
      }
      return n;
    };
    const pushFile = (rel: string, code: string) => {
      const i = rel.lastIndexOf('/');
      const parent = i < 0 ? null : ensureDir(rel.slice(0, i));
      const arr = parent ? parent.children : root;
      if (!map.has(rel)) {
        const n: TNode = { name: rel.split('/').pop() || rel, path: rel, isDir: false, code, children: [] };
        // 大小/修改时间: 供过滤视图的悬浮卡片展示（与 /api/fs 一致）
        try {
          const st = fs.statSync(path.join(repo.root, rel));
          n.size = st.size;
          n.mtime = fmtMtime(st.mtimeMs);
        } catch {
          /* ignore */
        }
        map.set(rel, n);
        arr.push(n);
      }
    };
    // 忽略判定（与 /api/fs 同一套：直接问 git）
    const gitIgnore = makeGitIgnoreChecker(repo.root);
    // '?' 目录：递归展开内部全部文件（未版本化目录内的所有内容都是新文件）
    const walkUnversionedDir = async (relDir: string) => {
      let names: string[];
      try {
        names = fs.readdirSync(path.join(repo.root, relDir));
      } catch {
        return;
      }
      for (const n of names) {
        if (n === '.svn' || n === '.git') continue;
        // 被忽略（如 dist/、node_modules/）→ 不视为新文件，跳过
        if (await gitIgnore.isIgnored(relDir, n)) continue;
        const base = relDir.replace(/\/+$/, '');
        const rel = base ? `${base}/${n}` : n;
        const abs = path.join(repo.root, rel);
        let st: fs.Stats;
        try {
          st = fs.statSync(abs);
        } catch {
          continue;
        }
        if (st.isDirectory()) {
          // 递归子目录：未版本化目录内的子目录同为未版本化，'?'
          const sub = ensureDir(rel);
          sub.code = '?';
          await walkUnversionedDir(rel);
        } else pushFile(rel, '?');
      }
    };
    for (const it of items) {
      if (!it.path.startsWith(prefix) || !codes.has(it.code)) continue;
      if (it.code === '?' && it.isDir) {
        // 未版本化目录（如 git status 的 "?? dir/" 聚合条目）：目录自身显示 '?'，展开内部全部文件
        const d = ensureDir(it.path);
        d.code = '?';
        await walkUnversionedDir(it.path);
      } else if (it.isDir) {
        // 目录自身有状态码（svn 目录 M/A/D 等）：容器节点用其状态码，而非一律显示无状态
        ensureDir(it.path).code = it.code;
      } else {
        pushFile(it.path, it.code);
      }
    }
    // 排序：目录在前，名称排序
    const sortTree = (nodes: TNode[]) => {
      nodes.sort((a, b) => Number(b.isDir) - Number(a.isDir) || compareName(a.name, b.name));
      for (const n of nodes) sortTree(n.children);
    };
    sortTree(root);
    sendJson(res, 200, { tree: root });
    return true;
  }

  if (p === '/api/fs') {
    // 工作副本文件夹浏览：磁盘目录 + 状态匹配
    const { vcs, repo } = vcsOf();
    const rel = url.searchParams.get('dir') ?? '';
    const force = url.searchParams.get('force') === '1';
    const abs = path.join(repo.root, rel);
    if (!inRepoRoot(repo.root, abs)) {
      sendJson(res, 403, { error: MSG_OUT_OF_SCOPE() });
      return true;
    }
    const items = (await getStatusCached(repo, force, rel)) as { path: string; code: string; isDir: boolean; treeConflicted?: boolean; origPath?: string }[];
    const entries: { name: string; isDir: boolean; size: number; mtime: string; code: string; origPath?: string; count?: number; codes?: string[]; unversionedCount?: number; miss?: boolean; treeConflicted?: boolean; innerTreeConflict?: boolean }[] = [];
    // 目录多状态徽标显示顺序：修改 / 添加 / 删除 / 冲突 / 替换 / 缺失 / 更新 / 类型变更
    const CODES_ORDER = ['M', 'A', 'D', 'C', 'R', '!', 'U', '~'];
    let names: string[];
    try {
      names = fs.readdirSync(abs);
    } catch (err) {
      // 无法读取目录: {msg}
      sendJson(res, 500, { error: t('srv.readDirFailed', { msg: (err as Error).message }) });
      return true;
    }
    // 目录/文件分离：提前到这里——下面的忽略合批预取需要子目录清单，
    // 且必须赶在"祖先链忽略判定"之前完成，否则那里又会逐级各自 spawn 一次 git。
    const prefix = rel ? rel + '/' : '';
    const dirs: string[] = [];
    const files: string[] = [];
    for (const n of names) {
      const p = path.join(abs, n);
      let st: fs.Stats;
      try {
        st = fs.statSync(p);
      } catch {
        continue;
      }
      (st.isDirectory() ? dirs : files).push(n);
    }
    dirs.sort(compareName);
    files.sort(compareName);
    // 目录本身或其任一祖先未版本化 → 内部全部未版本化
    // （svn status 对嵌套未版本化目录可能只标记最外层，深层需沿祖先链判断）
    let unversionedAncestor = false;
    {
      const parts = rel.split('/');
      let acc = '';
      for (const p of parts) {
        acc = acc ? `${acc}/${p}` : p;
        const anc = items.find((i) => i.path === acc);
        if (anc && anc.code === '?') {
          unversionedAncestor = true;
          break;
        }
      }
    }
    const dirSelf = unversionedAncestor || items.find((i) => i.path === rel && i.code === '?');
    // 祖先目录删除调度（svn delete 目录 → 整树调度删除，status 只列目录行不递归列出内部）：
    // 内部所有条目统一显示 D（随目录从版本库移除），避免外层 D 内层 √ 的误导
    let deletedAncestor = false;
    {
      const parts = rel.split('/');
      let acc = '';
      for (const p of parts) {
        acc = acc ? `${acc}/${p}` : p;
        const anc = items.find((i) => i.path === acc);
        if (anc && anc.code === 'D') {
          deletedAncestor = true;
          break;
        }
      }
    }

    // 忽略规则检测：status 无条目的磁盘文件/目录，若被忽略则标记 'I'
    // （git：直接问 git —— check-ignore 权威判定，子目录 .gitignore/带路径规则/否定规则全归它算；
    //   svn：status --no-ignore 权威判定）
    const gitIgnore = makeGitIgnoreChecker(repo.root);
    // git 忽略判定合批：把「本目录 + 祖先链 + 全部子目录」的忽略判定合并成一次 `git check-ignore`
    // （见 ignore.ts 的 prefetch）。不合批时每个子目录各 spawn 一个 git 进程，Windows 上每次 ~150ms，
    // 根目录十几项就是 2s+——这是"进文件夹要等一会儿"的主因。svn 的忽略走下方 status --no-ignore 集合。
    if (repo.type === 'git') {
      const targets = ['']; // 祖先链（含仓库根）：isIgnoredEntry 逐级判定用
      if (rel) {
        let acc = '';
        for (const part of rel.split('/')) {
          acc = acc ? `${acc}/${part}` : part;
          targets.push(acc);
        }
      }
      for (const d of dirs) targets.push(prefix + d);
      await gitIgnore.prefetch(targets);
    }
    // svn 忽略族：`svn status --no-ignore` 单次全量取 ignored 路径集合（规则来源一律权威：
    // svn:ignore 属性 / 客户端 global-ignores / 服务器端——注意 svn status --xml 默认不含
    // ignored 条目，必须用 plain 文本解析；被忽略目录整体标 I，其内部条目由祖先链判定）
    let svnIgnored: Set<string> | null = null;
    const getSvnIgnored = async (): Promise<Set<string>> => {
      if (!svnIgnored) {
        svnIgnored = new Set();
        // 超大工作副本：这个全量命令本身就要 0.8s 扫全库（输出 5MB+），而收益只是把被忽略的
        // 条目标成 I——连跑都不值。被忽略的条目会显示为未版本化 ?，提交/还原照常。
        if (vcs.isHugeWc?.()) return svnIgnored;
        try {
          const r = await run('svn', ['status', '--no-ignore'], { cwd: repo.root, timeoutMs: 120_000 });
          if (r.code === 0 && r.stdout.length <= MAX_IGNORE_SCAN_BYTES) {
            for (const line of r.stdout.split('\n')) {
              // 首列 I = ignored；! 列（missing）非忽略，排除；路径可能与列粘连（非 8 列对齐的版本），用正则取尾段
              if (line.startsWith('I')) {
                const m = line.match(/^I\s+(\S.*)$/);
                if (m) svnIgnored.add(m[1]!.trim());
              }
            }
          }
        } catch {
          /* 收集失败：不误标 I */
        }
      }
      return svnIgnored;
    };
    /** 当前仓库忽略判定：svn 用 status 集合（权威）；git 用 git check-ignore（同样权威） */
    const isIgnoredEntry = async (dirRel: string, name: string): Promise<boolean> => {
      if (repo.type === 'svn') {
        return (await getSvnIgnored()).has((dirRel === '' || dirRel === '.' ? '' : dirRel + '/') + name);
      }
      return gitIgnore.isIgnored(dirRel, name);
    };
    // 祖先链上有被忽略目录（如 .gitignore 的 node_modules/）→ 内部所有内容都算忽略（I）
    // （被忽略目录不在 status 条目里，需逐级用忽略规则匹配祖先目录名）
    let ignoredAncestor = false;
    {
      const parts = rel.split('/');
      let acc = '';
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i]!;
        acc = acc ? `${acc}/${part}` : part;
        const parentOf = path.dirname(acc);
        if (await isIgnoredEntry(parentOf === '.' ? '' : parentOf, part)) {
          ignoredAncestor = true;
          break;
        }
      }
    }
    for (const d of dirs) {
      const relDir = prefix + d;
      let code = dirSelf ? '?' : '';
      // 祖先删除调度（含自身）→ 目录随删，优先于规则/无状态判定
      if (deletedAncestor && !code) code = 'D';
      let count: number | undefined;
      let codes: string[] | undefined;
      let unversionedCount = 0;
      // 目录自身在 status 中的条目（如 svn/git 的 '?' 未版本化目录）优先采用
      const self = items.find((i) => i.path === relDir);
      if (self && self.code !== 'none') code = self.code;
      // 无条目且非未版本化：祖先被忽略（如 node_modules 内）→ 直接 I；否则按忽略规则判断
      if (!code && !self) {
        if (ignoredAncestor) code = 'I';
        else {
          const parentOf = path.dirname(relDir) === '.' ? '' : path.dirname(relDir);
          if (await isIgnoredEntry(parentOf, d)) code = 'I';
          // git：目录名未被规则命中，但目录内全部条目都被忽略 → 目录整体视作"已忽略"（.claude 场景）
          else if (repo.type === 'git' && (await gitIgnore.allIgnored(relDir))) code = 'I';
          // git 不跟踪目录：**空目录根本不会出现在 status 里**，走到这儿 code 还是空 → 渲染成"干净 ✓"，
          // 可它其实完全不在版本库里（用户实报"新建的文件夹是打√的"）。
          // 磁盘上有、status 无、又没被忽略 → 就是未版本化的空目录，标 '?'。
          // （SVN 会正常报告 `? 空目录`，不需要这一手；空**文件** git 也会照常报 ??，同理不需要）
          else if (repo.type === 'git') {
            try {
              if (fs.readdirSync(path.join(repo.root, relDir)).length === 0) code = '?';
            } catch {
              /* 读不到：不标，维持原样 */
            }
          }
        }
      }
      const sub = items.filter((i) => i.path.startsWith(relDir + '/'));
      if (sub.length > 0) {
        for (const s of sub) {
          const rk = { C: 10, '!': 9, D: 8, M: 7, A: 6, R: 5, '~': 4, U: 3, '?': 2 }[s.code] ?? 0;
          // 子项全部删除调度（D）时不把目录自身升级为 D：目录自身仍版本化（可右键「从版本库移除」），
          // D 只进角标集合；目录自身 D 调度（self D）仍走 D 分支（撤销删除）
          if (s.code === 'D' && !self) continue;
          // 子项未版本化(?)不升级目录为 ?——目录本体已版本化（无 self）时，子 ? 交给 unversionedCount
          // 角标提示；只有目录自身就是 ?（未添加/未跟踪）才显示 ? 菜单。
          // **git 也必须这样**：git status 对"已跟踪目录里混了未跟踪文件"只报子项 ??、不报目录，
          // 一旦让子 ? 升级，scripts/ 这种目录会被当成整个未版本化 —— 右键菜单退化成"添加/忽略/删除"，
          // 连「查看历史」都没有（用户实报："scripts 显示 √，但右键没有查看历史"）。
          // 未跟踪目录不受影响：git 会给出 `?? dir/` 聚合条目（self.code === '?'），照样是 ? 菜单
          if (s.code === '?' && !(self && self.code === '?')) continue;
          if (rk > ({ C: 10, '!': 9, D: 8, M: 7, A: 6, R: 5, '~': 4, U: 3, '?': 2 }[code] ?? 0)) code = s.code;
        }
        // 变更数只统计已版本化条目（未版本化 '?' 未纳入版本控制，不计数）
        // 外部引用 'X' 同样不计：它装的是另一个仓库路径的内容，不是本目录的变更。
        // 它在 status 里**恒常**存在，徽标那边排除了、这里之前没排除 ——
        // 于是父目录就成了自相矛盾的「✓ + 数字 1」（用户实报"引用产生的数字还在"）
        count = sub.filter((s) => s.code !== '?' && s.code !== 'X').length;
        // 内部未版本化数量（'?' 不在徽标显示，但筛选"仅新文件"时需要提示新文件在哪）
        unversionedCount = sub.filter((s) => s.code === '?').length;
        // 目录操作集合：同时显示 M/A/D 等全部操作标识；排除未版本化 '?' 与无变更 ' '；
        // 外部引用 'X' 不进父目录集合（只显示在引用目录自身，避免 src/trunk 等全带标识）
        const opCodes = [...new Set(sub.map((s) => s.code).filter((c) => c && c !== '?' && c !== ' ' && c !== 'none' && c !== 'X'))];
        codes = opCodes.length ? opCodes : undefined; // 空数组别留着：[] 是 truthy，!codes 之类的兜底会失效
      }
      // 目录自身调度（svn D/A 目录本体，如"已删除"）并入角标集合——位于子项块之外：
      // svn delete 目录后 status 只输出目录自身行（子项不单列），sub 为空时也要能显示 D。
      // **'?' 不在这里并入**：它是"这个目录不在版本库里"而非"一次操作"，无条件并进来会让
      // `git rm --cached -r dir` 之后的目录同时挂着 ? 和 D 两个徽标、自相矛盾（用户实报）；
      // 纯未跟踪目录由下面那行 `code === '?' && !codes?.length` 的兜底负责，照样显示 ?。
      if (self && self.code && self.code !== ' ' && self.code !== 'none' && self.code !== 'X' && self.code !== '?' && !codes?.includes(self.code)) {
        codes = [...(codes ?? []), self.code];
      }
      if (codes) codes.sort((a, b) => CODES_ORDER.indexOf(a) - CODES_ORDER.indexOf(b));
      // 目录自身被忽略(I)：子级无操作时徽标也应显示 I（避免被误显示为干净的 √）
      if (code === 'I' && !codes?.length) codes = ['I'];
      // 删除调度（目录自身或祖先）同样兜底——避免 DirBadge 无徽标时显示 √
      if (code === 'D' && !codes?.length) codes = ['D'];
      // 目录自身未版本化（整个目录不在版本库）：徽标显示 '?'（与文件一致，避免误显干净的 √）
      if (code === '?' && !codes?.length) codes = ['?'];
      // 目录自身是外部引用（svn:externals 拉取的内容）：自身显示链环标识（父目录不显示）
      if (code === 'X' && !codes?.includes('X')) codes = codes ? [...codes, 'X'] : ['X'];
      // 树冲突（本地已添加 vs 服务器同路径已删除/移动）：status 的 item 是 added，
      // 状态列上看不出冲突，界面显示成普通的 A（用户实报"标着 A 点进去却不对"）→ 单独带出去给角标用。
      // 分两种，渲染时语义不同：
      //   treeConflicted    —— 本目录自身就是冲突项（self 条目带 tree-conflicted）
      //   innerTreeConflict —— 目录**内部**有冲突（不管多深，含直接子项）
      // 内部这条**不排除直接子项**：角标本来就是"内部状态聚合"（子项有 M 父目录就显示 M），
      // 冲突同理——否则站在 src 层看 VW-PlatForm_Solution 只是个普通 A，完全看不出里面有问题（用户实报）
      // 只在全量扫描（非超大工作副本）时有数据：浅扫描的 items 只有直接子项，sub 恒为空
      const selfConflict = self?.treeConflicted === true;
      const innerConflict = sub.some((s) => s.treeConflicted);
      // 目录在磁盘上存在就总是显示（svn/git status 对干净目录无条目，不 push 会丢失目录）
      entries.push({
        name: d,
        isDir: true,
        size: 0,
        mtime: '',
        code,
        count,
        codes,
        unversionedCount: unversionedCount || undefined,
        treeConflicted: selfConflict || undefined,
        innerTreeConflict: innerConflict || undefined,
      });
    }
    for (const f of files) {
      const p = path.join(abs, f);
      let st: fs.Stats;
      try {
        st = fs.statSync(p);
      } catch {
        continue;
      }
      const relFile = prefix + f;
      const it = items.find((i) => i.path === relFile);
      // **文件自己的状态优先于"目录未版本化"**：`git rm --cached -r dir` 之后，
      // 目录本身是 ?（文件还在磁盘、已脱离版本库），但里面的文件在 index 里**有独立的 D 记录**
      // （等提交的删除）。原来写成 `dirSelf ? '?' : it?.code`，把 D 盖成了 ?，
      // 用户看到"从版本库移除后文件显示未版本化"——语义完全不对（用户实报）。
      // 普通未跟踪目录不受影响：那种情况下 git 折叠成一行 `?? dir/`，文件没有独立条目 → it 为空 → 仍走 dirSelf。
      let code = it?.code ?? (dirSelf ? '?' : '');
      // 祖先删除调度（含当前目录自身 D）→ 文件随目录移除，显示 D
      if (deletedAncestor && !code) code = 'D';
      // 无条目且非未版本化：祖先被忽略（如 node_modules 内）→ 直接 I；否则按忽略规则判断
      if (!code && !it) {
        if (ignoredAncestor) code = 'I';
        else {
          const parentOf = path.dirname(relFile) === '.' ? '' : path.dirname(relFile);
          if (await isIgnoredEntry(parentOf, f)) code = 'I';
        }
      }
      entries.push({
        name: f,
        isDir: false,
        size: st.size,
        mtime: fmtMtime(st.mtimeMs),
        code,
        // 重命名带出来源（列表 tooltip 用；提交时后端自己按路径补全，前端不参与）
        origPath: it?.origPath || undefined,
        // 文件同样可能带树冲突（本地改/加 vs 服务器删除）——角标与目录共用一套渲染
        treeConflicted: it?.treeConflicted || undefined,
      });
    }
    // 合并 status 中磁盘已删除的条目：磁盘不存在但版本库有记录 → 显示缺失/删除标识（虚拟行）
    // code '!'（svn 缺失 / git " D" 磁盘删除）与 'D' 都是磁盘没有、版本库还在：
    // '!' 渲染为虚化缺失条目（miss 标记，悬浮"已在磁盘上缺失"、右键可还原）；
    // D（用户主动删除调度）与 R（重命名旧路径）保持原有删除标识，不标 miss（不是"意外缺失"）
    // git 的 R（重命名）旧路径同样磁盘不存在：一并合并（现状保留）
    for (const it of items) {
      if (it.path === rel || !it.path.startsWith(prefix)) continue;
      const name = it.path.slice(prefix.length);
      if (!name || name.includes('/')) continue; // 只处理当前目录直接子项
      if (it.code !== 'D' && it.code !== 'R' && it.code !== '!') continue;
      if (fs.existsSync(path.join(abs, name))) continue; // 磁盘存在已由 dirs/files 处理
      // 目录缺失（svn kind=dir 的 '!'）：磁盘已不在，仍显示目录条目（进入拦截在渲染侧）
      entries.push({
        name,
        isDir: it.isDir,
        size: 0,
        mtime: '',
        code: it.code,
        miss: it.code === '!',
        // 磁盘已不在但仍是树冲突（实报的 DXJFingerHelper/LibDbHelper：本地目录被删 + 服务器也要删）：
        // 这类不显示成 A 而显示成虚化的 !，同样要能看出"这里是冲突，得先定夺"
        treeConflicted: it.treeConflicted || undefined,
      });
    }
    // SVN：自己锁定的文件列表（显示锁图标）
    let selfLocked: string[] = [];
    if (repo.type === 'svn') {
      try {
        selfLocked = (await vcs.selfLockedFiles?.()) ?? [];
      } catch {
        /* ignore */
      }
    }
    // 工作副本异常：SVN 把**当前目录自身**标成 '!'。这种状态下其下条目会被误判为未版本化（满屏 ?），
    // 用户一头雾水。三种成因修法不同，所以分开告诉前端：
    //   wcLocked     —— 被锁定：上次 SVN 操作没正常结束（或别的进程正占着），先停其他 SVN 程序再 cleanup
    //   wcIncomplete —— 工作副本不完整：上次操作中途失败，cleanup 即可修复（item=incomplete，被映射成了 '!'）
    //   wcBroken     —— 真·缺失：磁盘上确实没有，需 update/重新检出
    const normPath = (p: string) => (p === '.' ? '' : p.replace(/^\.\//, ''));
    const selfEntry = items.find((i) => normPath(i.path) === rel) as
      | { code?: string; locked?: boolean; incomplete?: boolean }
      | undefined;
    const wcIncomplete = selfEntry?.incomplete === true;
    const wcLocked = selfEntry?.locked === true;
    const wcBroken = selfEntry?.code === '!' && !wcIncomplete;
    // 树冲突计数（零成本：status 已经带出来了）。>0 时前端再去 /api/wc-conflicts 问服务器
    const treeConflicts = (items as { treeConflicted?: boolean }[]).filter((i) => i.treeConflicted).length;
    sendJson(res, 200, { dir: rel, abs, root: repo.root, entries, selfLocked, wcBroken, wcLocked, wcIncomplete, treeConflicts });
    return true;
  }

  return false;
}
