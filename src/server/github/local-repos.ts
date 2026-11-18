/** 最近项目的本地副本匹配：给「我的 GitHub 仓库」列表标出"本地已有"。
 *  只读最近项目（≤20 条），不扫全盘。 */
import { run } from '../../vcs/exec.js';
import { parseGithub } from '../../shared/github.js';
import { loadHistory } from '../recent/history-store.js';

/** 本地已有的仓库：最近项目（≤20 条）各问一次 origin → `owner/repo`（小写）→ 本地路径。
 *  并行问（每条一个独立 git 进程，串行会明显拖慢弹窗）；目录已删 / 不是 git 都算"没有"，静默跳过。
 *  同一仓库有多个本地副本时取**最近打开的那个**（按 lastOpened 排序后取首个命中——不依赖 history 文件本身的顺序）。
 *  为什么用 `git remote get-url` 而不是直接读 .git/config：config 有 worktree / includeIf / 引号值等花样，
 *  交给 git 自己解析最稳（实测 200 个仓库也就毫秒级，这里最多 20 个）。 */
export async function localRepoPaths(): Promise<Map<string, string>> {
  const items = [...loadHistory()].sort((a, b) => (b.lastOpened ?? 0) - (a.lastOpened ?? 0));
  const urls = await Promise.all(
    items.map((h) =>
      run('git', ['-C', h.path, 'remote', 'get-url', 'origin'], { timeoutMs: 5_000 }).then((r) => (r.code === 0 ? r.stdout.trim() : '')),
    ),
  );
  const out = new Map<string, string>();
  items.forEach((h, i) => {
    const github = parseGithub(urls[i] ?? '');
    if (!github) return;
    const key = `${github.owner}/${github.repo}`.toLowerCase();
    if (!out.has(key)) out.set(key, h.path);
  });
  return out;
}
