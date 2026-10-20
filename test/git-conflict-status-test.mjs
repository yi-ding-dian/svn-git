/** git 冲突状态识别单测：porcelain 两列组合 → 统一语义码。
 *
 *  为什么单独钉死：`git status --porcelain` 的未合并状态是**两列组合**（UU/AA/DU/AU/UD/UA/DD），
 *  旧实现按单列映射，AA（双方新增）拆成 A+A 就成了"新增"，DU（我方删除）拆成 D+U 就成了"删除"，
 *  于是 add/add、modify/delete 这类冲突在文件列表里没有 C 标，也不会出现在「解决冲突」里。
 *  同时确认普通状态（M / 工作区删除 / 未跟踪）没被误判成冲突。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { run } from '../dist/vcs/exec.js';
import { GitVcs } from '../dist/vcs/git.js';
import { detectRepo } from '../dist/vcs/detect.js';

let fail = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${detail ? ' | ' + detail : ''}`);
  if (!cond) fail++;
};

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'svngit-conflict-status-'));
const g = (args) => run('git', args, { cwd: dir });

try {
  await g(['init', '-q']);
  await g(['config', 'user.email', 'test@svngit.local']);
  await g(['config', 'user.name', 'svngit-test']);
  fs.writeFileSync(path.join(dir, 'uu.txt'), 'a\nb\nc\n');
  fs.writeFileSync(path.join(dir, 'del.txt'), 'x\ny\n');
  fs.writeFileSync(path.join(dir, 'plain.txt'), 'p\n');
  fs.writeFileSync(path.join(dir, 'gone.txt'), 'g\n');
  await g(['add', '.']);
  await g(['commit', '-qm', 'base']);
  const baseBranch = (await g(['symbolic-ref', '--short', 'HEAD'])).stdout.trim();

  // 对方分支：改 uu.txt、改 del.txt、新增 aa.txt
  await g(['checkout', '-qb', 'feat']);
  fs.writeFileSync(path.join(dir, 'uu.txt'), 'a\nB-feat\nc\n');
  fs.writeFileSync(path.join(dir, 'del.txt'), 'x\nY-feat\n');
  fs.writeFileSync(path.join(dir, 'aa.txt'), 'feat-add\n');
  await g(['add', '.']);
  await g(['commit', '-qm', 'feat changes']);

  // 我方：改同一行、删 del.txt、以不同内容新增 aa.txt
  await g(['checkout', '-q', baseBranch]);
  fs.writeFileSync(path.join(dir, 'uu.txt'), 'a\nB-main\nc\n');
  fs.writeFileSync(path.join(dir, 'aa.txt'), 'main-add\n');
  await g(['add', '.']);
  await g(['rm', '-q', 'del.txt']);
  await g(['commit', '-qm', 'main changes']);

  // 与合并无关的普通状态，合并后应原样保留
  fs.writeFileSync(path.join(dir, 'plain.txt'), 'p-modified\n'); // M
  fs.rmSync(path.join(dir, 'gone.txt')); // 工作区删除 -> !
  fs.writeFileSync(path.join(dir, 'untracked.txt'), 'u\n'); // ?

  await g(['merge', 'feat']); // 有冲突：返回非 0，忽略

  const repo = detectRepo(dir);
  const st = await new GitVcs(repo).status();
  const codeOf = (p) => st.find((x) => x.path === p)?.code;
  const porcelainOf = (p) => st.find((x) => x.path === p)?.porcelain;

  check('UU（内容冲突）识别为 C', codeOf('uu.txt') === 'C', `porcelain=${porcelainOf('uu.txt')}`);
  check('DU（我方删除/对方修改）识别为 C', codeOf('del.txt') === 'C', `porcelain=${porcelainOf('del.txt')}`);
  check('AA（双方新增）识别为 C', codeOf('aa.txt') === 'C', `porcelain=${porcelainOf('aa.txt')}`);

  check('普通修改仍是 M', codeOf('plain.txt') === 'M', `code=${codeOf('plain.txt')}`);
  check('工作区删除仍是 !', codeOf('gone.txt') === '!', `code=${codeOf('gone.txt')}`);
  check('未跟踪仍是 ?', codeOf('untracked.txt') === '?', `code=${codeOf('untracked.txt')}`);

  await g(['merge', '--abort']);
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log(fail === 0 ? '\n✅ git-conflict-status 全部通过' : `\n❌ ${fail} 项失败`);
process.exit(fail ? 1 : 0);
