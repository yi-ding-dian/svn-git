/** SVN 练习仓库生成：标准布局版本库（trunk/branches/tags）+ trunk 工作副本
 *  i18n-ignore-file：本文件的中文是**写进练习仓库的内容**（README/源码/提交信息），不是界面文案 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { run } from '../vcs/exec.js';
import { t } from '../shared/i18n/index.js';
import type { PracticeScenarios } from './types.js';

const APP_V1 = `// 练习用入口文件：trunk 与 feature-a 都会改这段启动配置，
// 用来演示「合并冲突」。
const mode = 'dev';

function boot() {
  console.log(\`app started in \${mode} mode\`);
}

boot();
`;

const APP_TRUNK_CONFLICT = APP_V1.replace("const mode = 'dev';", "const mode = 'production';");
const APP_FEATURE_CONFLICT = APP_V1.replace("const mode = 'dev';", "const mode = 'feature';");

const LOGIN = `// 登录模块
function login(user) {
  return \`welcome, \${user}\`;
}

module.exports = { login };
`;

const README = `# svn-git 练习仓库（SVN）

标准布局示例版本库，工作副本在 \`work/\`，指向 \`trunk\`。

- \`trunk\`：主干
- \`branches/feature-a\`：功能分支
- \`tags/v1.0\`：发布标签
`;

async function svn(args: string[], cwd: string, signal?: AbortSignal): Promise<void> {
  const r = await run('svn', args, { cwd, timeoutMs: 60_000, signal });
  if (r.aborted) throw new Error(t('srv.practiceCancelled'));
  if (r.code !== 0) {
    throw new Error(t('srv.practiceStepFailed', { step: `svn ${args[0] ?? ''}`, msg: (r.stderr || r.stdout).trim() }));
  }
}

function write(dir: string, rel: string, content: string): void {
  const abs = path.join(dir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

/** 生成 SVN 练习仓库。root 已被 planPracticeRoot 创建；失败由调用方清理。
 *  projectLayout=true：版本库内用 projects/demo-project/{trunk,branches,tags} 多项目布局
 *  （项目根≠版本库根，可练习项目迁移）；默认是版本库根即项目根的标准布局。 */
export async function generateSvnPractice(
  root: string,
  scenarios: PracticeScenarios,
  signal?: AbortSignal,
  projectLayout?: boolean,
): Promise<void> {
  const repo = path.join(root, 'repo');
  const work = path.join(root, 'work');

  // 1) 版本库 + 标准布局；URL 必须走 pathToFileURL（Windows 反斜杠会被 svn 判成非法 URL）
  const r = await run('svnadmin', ['create', repo], { cwd: root, timeoutMs: 60_000, signal });
  if (r.aborted) throw new Error(t('srv.practiceCancelled'));
  if (r.code !== 0) {
    throw new Error(t('srv.practiceStepFailed', { step: 'svnadmin create', msg: (r.stderr || r.stdout).trim() }));
  }
  const url = pathToFileURL(repo).href;
  // 多项目布局：项目根在 projects/demo-project（版本库根下多一层）
  const base = projectLayout ? `${url}/projects/demo-project` : url;
  await svn(
    ['mkdir', '--parents', '-q', `${base}/trunk`, `${base}/branches`, `${base}/tags`, '-m', projectLayout ? '初始化多项目布局' : '初始化标准布局'],
    root,
    signal,
  );

  // 2) 检出 trunk 并做初始提交
  await svn(['checkout', '-q', `${base}/trunk`, work], root, signal);
  write(
    work,
    'README.md',
    projectLayout
      ? README.replace('标准布局示例版本库，工作副本在 `work/`，指向 `trunk`。', '多项目布局示例版本库（项目在 `projects/demo-project/`），工作副本在 `work/`，指向该项目的主干。')
      : README,
  );
  write(work, 'src/app.js', APP_V1);
  await svn(['add', '-q', 'README.md', 'src'], work, signal);
  await svn(['commit', '-qm', '初始化练习项目'], work, signal);

  // 3) 功能分支：先复制（分支点=trunk 初始提交），再在临时工作副本里提交
  await svn(['copy', '-q', `${base}/trunk`, `${base}/branches/feature-a`, '-m', '创建功能分支'], root, signal);
  const featWc = path.join(root, 'feature-work');
  await svn(['checkout', '-q', `${base}/branches/feature-a`, featWc], root, signal);
  if (scenarios.conflict) {
    // 与下面 trunk 的第二次提交改同一行 → 合并时冲突（分支点必须在 trunk 修改之前）
    write(featWc, 'src/app.js', APP_FEATURE_CONFLICT);
    await svn(['commit', '-qm', 'feature: 切换启动模式'], featWc, signal);
  } else {
    write(featWc, 'src/login.js', LOGIN);
    await svn(['add', '-q', 'src/login.js'], featWc, signal);
    await svn(['commit', '-qm', 'feature: 添加登录模块'], featWc, signal);
  }
  fs.rmSync(featWc, { recursive: true, force: true });

  // 4) trunk 第二次提交（在分支点之后 → 冲突场景下与 feature 改同一行）
  if (scenarios.conflict) write(work, 'src/app.js', APP_TRUNK_CONFLICT);
  else write(work, 'README.md', `${README}\n## 主干更新\n\n- 第二次提交（与功能分支不冲突）\n`);
  await svn(['commit', '-qm', 'trunk: 主干第二次提交'], work, signal);

  // 5) 发布标签
  await svn(['copy', '-q', `${base}/trunk`, `${base}/tags/v1.0`, '-m', '发布 v1.0'], root, signal);

  // 6) 工作副本更新到最新，保持干净（生成后的练习从"已同步"开始）
  await svn(['update', '-q'], work, signal);
}
