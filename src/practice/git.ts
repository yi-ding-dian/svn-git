/** Git 练习仓库生成：本地 bare 远端 + 工作副本，按场景预置分支/落后/领先/分叉/冲突
 *  i18n-ignore-file：本文件的中文是**写进练习仓库的内容**（README/源码/提交信息），不是界面文案 */
import fs from 'node:fs';
import path from 'node:path';
import { run } from '../vcs/exec.js';
import { t } from '../shared/i18n/index.js';
import type { PracticeScenarios } from './types.js';

const APP_V1 = `// 练习用入口文件：main 与 feature/login 都会改这段启动配置，
// 用来演示「合并冲突」。
const mode = 'dev';

function boot() {
  console.log(\`app started in \${mode} mode\`);
}

boot();
`;

const APP_MAIN_CONFLICT = APP_V1.replace("const mode = 'dev';", "const mode = 'production';");
const APP_FEATURE_CONFLICT = APP_V1.replace("const mode = 'dev';", "const mode = 'feature';");
const APP_MAIN_NORMAL = `${APP_V1}\n// main 上的第二次修改（与功能分支不冲突）。\n`;

const LOGIN_V1 = `// 登录模块
function login(user) {
  return \`welcome, \${user}\`;
}

module.exports = { login };
`;

const LOGIN_V2 = `// 登录模块
function login(user) {
  return \`welcome, \${user}\`;
}

function logout() {
  return 'bye';
}

module.exports = { login, logout };
`;

const README = `# svn-git 练习仓库

这是一个用于练习分支、合并、远程同步的本地示例仓库。

- origin 指向同目录下的 \`remote.git\`（本地 bare 仓库，不需要网络）
- **不要移动整个练习仓库目录**：移动后 origin 的本地路径会失效
- 每个分支都有自己的用途，随便改、随便提交，坏了删掉重生成即可
`;

const CHANGELOG_V1 = `# 更新记录

## 未发布

- hotfix: 第一次修复（已推送）
`;
const CHANGELOG_V2 = `${CHANGELOG_V1}- hotfix: 第二次修复（尚未推送）
`;

async function git(args: string[], cwd: string, signal?: AbortSignal): Promise<void> {
  const r = await run('git', args, { cwd, timeoutMs: 60_000, signal });
  if (r.aborted) throw new Error(t('srv.practiceCancelled'));
  if (r.code !== 0) {
    throw new Error(t('srv.practiceStepFailed', { step: `git ${args[0] ?? ''}`, msg: (r.stderr || r.stdout).trim() }));
  }
}

function write(dir: string, rel: string, content: string): void {
  const abs = path.join(dir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

async function configure(dir: string, signal?: AbortSignal): Promise<void> {
  await git(['config', 'user.name', 'svn-git practice'], dir, signal);
  await git(['config', 'user.email', 'practice@example.com'], dir, signal);
  // 练习仓库内容固定用 LF，避免 Windows 的 autocrlf 改变内容后与远端/分支基线不一致
  await git(['config', 'core.autocrlf', 'false'], dir, signal);
}

async function commitAll(dir: string, msg: string, signal?: AbortSignal): Promise<void> {
  await git(['add', '-A'], dir, signal);
  await git(['commit', '-qm', msg], dir, signal);
}

/** 生成 Git 练习仓库。root 已被 planPracticeRoot 创建；失败由调用方清理。 */
export async function generateGitPractice(root: string, scenarios: PracticeScenarios, signal?: AbortSignal): Promise<void> {
  const remote = path.join(root, 'remote.git');
  const work = path.join(root, 'work');

  // 1) 本地 bare 远端 + 工作副本（显式指定 main，避免不同 git 版本的默认分支名差异）
  await git(['init', '--bare', '-q', remote], root, signal);
  await git(['symbolic-ref', 'HEAD', 'refs/heads/main'], remote, signal);
  await git(['clone', '-q', remote, work], root, signal);
  // clone 空仓库时本地未出生分支名受 init.defaultBranch 影响（本机 git 2.20 默认 master），
  // 统一切成 main，保证后面 push -u origin main 有效
  await git(['symbolic-ref', 'HEAD', 'refs/heads/main'], work, signal);
  await configure(work, signal);

  // 2) 主干初始提交
  write(work, 'README.md', README);
  write(work, 'src/app.js', APP_V1);
  await commitAll(work, '初始化练习项目', signal);
  await git(['push', '-q', '-u', 'origin', 'main'], work, signal);

  // 3) 功能分支：两次提交，已推送
  await git(['checkout', '-q', '-b', 'feature/login'], work, signal);
  write(work, 'src/login.js', LOGIN_V1);
  await commitAll(work, 'feature: 添加登录模块', signal);
  if (scenarios.conflict) {
    // 与 main 的第二次提交改同一行 → 合并时冲突
    write(work, 'src/app.js', APP_FEATURE_CONFLICT);
    await commitAll(work, 'feature: 切换启动模式', signal);
  } else {
    write(work, 'src/login.js', LOGIN_V2);
    await commitAll(work, 'feature: 补充退出登录', signal);
  }
  await git(['push', '-q', '-u', 'origin', 'feature/login'], work, signal);

  // 4) 主干第二次提交（已推送）
  await git(['checkout', '-q', 'main'], work, signal);
  if (scenarios.conflict) write(work, 'src/app.js', APP_MAIN_CONFLICT);
  else write(work, 'src/app.js', APP_MAIN_NORMAL);
  await commitAll(work, 'main: 调整启动配置', signal);
  await git(['push', '-q', 'origin', 'main'], work, signal);

  // 5) hotfix：先推一次建立上游，再本地提交一次 → 徽标 ↑1
  await git(['checkout', '-q', '-b', 'hotfix'], work, signal);
  write(work, 'CHANGELOG.md', CHANGELOG_V1);
  await commitAll(work, 'hotfix: 第一次修复', signal);
  await git(['push', '-q', '-u', 'origin', 'hotfix'], work, signal);
  write(work, 'CHANGELOG.md', CHANGELOG_V2);
  await commitAll(work, 'hotfix: 第二次修复（未推送）', signal);
  await git(['checkout', '-q', 'main'], work, signal);

  // 6) 远程同步场景：远端 main 前进（↓1）+ 分叉分支（↑1 ↓1）
  if (scenarios.remote) {
    const tmp = path.join(root, 'tmp-remote');
    await git(['clone', '-q', remote, tmp], root, signal);
    await configure(tmp, signal);
    // 远端 main 前进 1：work 未 fetch → 打开后显示 ↓1
    write(tmp, 'src/remote-update.js', '// 模拟同事在远端对 main 的提交\n');
    await commitAll(tmp, '远端：同事更新 main', signal);
    await git(['push', '-q', 'origin', 'main'], tmp, signal);

    // 分叉：work 本地领先 1，远端再领先 1
    await git(['checkout', '-q', '-b', 'diverged'], work, signal);
    write(work, 'DIVERGED.txt', '本地提交：还没推送\n');
    await commitAll(work, 'diverged: 本地改动', signal);
    await git(['push', '-q', '-u', 'origin', 'diverged'], work, signal);
    write(work, 'DIVERGED.txt', '本地提交：还没推送\n本地第二个提交\n');
    await commitAll(work, 'diverged: 本地第二个提交（未推送）', signal);
    await git(['checkout', '-q', 'main'], work, signal);

    // 远端在同一分支上再提交 1 个（work 未 fetch）
    await git(['fetch', '-q', 'origin'], tmp, signal);
    await git(['checkout', '-q', '-b', 'diverged', 'origin/diverged'], tmp, signal);
    write(tmp, 'DIVERGED-REMOTE.txt', '远端提交：同事的改动\n');
    await commitAll(tmp, 'diverged: 远端改动', signal);
    await git(['push', '-q', 'origin', 'diverged'], tmp, signal);

    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
