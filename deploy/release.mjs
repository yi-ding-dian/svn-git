#!/usr/bin/env node
/** 一键发版：检测 → 问答 → 归档 CHANGELOG → 升版本 → push → 盯 CI
 *
 *  **为什么是脚本，不是应用里的菜单按钮**：发版是"开发者对这个项目"的操作，
 *  不是"用户对任意仓库"的操作。写在脚本里能进 git、能被 review、CI 里也能复用，
 *  也不用给产品 UI 加一个只对自身源码有意义的菜单项。
 *  （若日后仍想在应用里加入口：GUI 只负责收集参数，然后调本脚本 —— 流程不要写两份，
 *   本项目已经因为"入口路径改了一处忘了另一处"踩过一次坑，见 run.bat 那次修复。）
 *
 *  **为什么文件名是 ASCII**（release.mjs 而不是 发布.mjs）：双击入口 release.bat 里
 *  `chcp 65001` 之后，cmd 按 UTF-8 解析后续行 —— 中文文件名在 bat 里没法可靠表达。
 *  脚本名 ASCII、bat 里只出现 ASCII，中文输出才能正常显示。
 *
 *  用法：
 *    node deploy/release.mjs                     # 交互式
 *    node deploy/release.mjs --patch --yes       # 非交互（给 GUI / CI 用）
 *    node deploy/release.mjs --minor --no-push   # 只提交 + 打 tag，不推
 *
 *  选项：
 *    --patch | --minor | --major   直接指定升哪一位，跳过询问
 *    --yes                         跳过所有确认（需配合上面三者之一）
 *    --no-push                     提交 + 打 tag，但不 push、不盯 CI
 *    --no-watch                    正常 push，但不轮询 CI 状态
 *    --branch <名字>               允许在非 main 分支发版（默认拒绝）
 */

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/** 项目根（本脚本在 deploy/ 下） */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/** Windows 上 npm 是 npm.cmd；execFileSync 不走 shell，必须给出全名 */
const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const optVal = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};

const LEVEL = ['patch', 'minor', 'major'].find((l) => flag(`--${l}`)) ?? null;
const YES = flag('--yes');
const NO_PUSH = flag('--no-push');
const NO_WATCH = flag('--no-watch');
const ALLOW_BRANCH = optVal('--branch') ?? 'main';

// ---------------------------------------------------------------- 基础工具

/** Windows：Node 18.20 / 20.12 起（CVE-2024-27980 的修复）禁止不带 shell 直接 spawn
 *  .cmd / .bat —— 而 npm 在 Windows 上就是 npm.cmd，硬 spawn 会抛 EINVAL。
 *  所以 Windows 一律走 shell，参数自己按命令行规则加引号（消息里有空格和中文）。 */
const WIN = process.platform === 'win32';
const quoteWin = (s) => (/[\s"&|<>^()]/.test(s) ? `"${String(s).replace(/"/g, '""')}"` : String(s));

/** 跑一条命令并把 stdout 拿回来（stderr 一并捕获，失败时展示） */
function sh(cmd, args, { allowFail = false } = {}) {
  const opts = { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] };
  try {
    return WIN
      ? execFileSync([cmd, ...args.map(quoteWin)].join(' '), { ...opts, shell: true }).trim()
      : execFileSync(cmd, args, opts).trim();
  } catch (e) {
    if (allowFail) return null;
    const detail = (e.stderr || e.stdout || e.message || '').toString().trim();
    throw new Error(`执行失败：${cmd} ${args.join(' ')}\n${detail}`);
  }
}
const git = (args, opt) => sh('git', args, opt);

const OK = '✓';
const NO = '✗';
const WARN = '!';

function die(msg, hint) {
  console.error(`\n${NO} ${msg}`);
  if (hint) console.error(`  ${hint}`);
  process.exit(1);
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
/** stdin 提前关闭（管道喂答案、被重定向）时，readline 的挂起 question 永远不会 resolve
 *  —— 事件循环空转 → 进程静默退出、什么都没做却退出码 0。这里改成明确报错退出。 */
let finished = false;
rl.on('close', () => {
  if (!finished) {
    console.error(`\n${NO} 标准输入已关闭，问题没答完，已取消（什么都没改）`);
    console.error('  交互式请直接在终端里跑；非交互用 --patch --yes');
    process.exit(1);
  }
});
async function ask(question, def = '') {
  // --yes = 不问任何问题（给 GUI / CI 调用的形态）：直接用默认值
  if (YES) {
    console.log(`${question}${def ? `（--yes，取默认 ${def}）` : ''}`);
    return def;
  }
  const suffix = def ? `（默认 ${def}）` : '';
  const a = (await rl.question(`${question}${suffix}: `)).trim();
  return a || def;
}
async function confirm(question, def = false) {
  if (YES) return true;
  const a = (await rl.question(`${question} [${def ? 'Y/n' : 'y/N'}]: `)).trim().toLowerCase();
  if (!a) return def;
  return a === 'y' || a === 'yes';
}

// ---------------------------------------------------------------- CHANGELOG

/** 定位 [Unreleased] 段：返回 { lines, start, end, body }（找不到 / 段是空的 → null） */
function findUnreleased() {
  const p = path.join(ROOT, 'CHANGELOG.md');
  if (!fs.existsSync(p)) return null;
  const lines = fs.readFileSync(p, 'utf8').split(/\r?\n/);
  const start = lines.findIndex((l) => /^##\s*\[Unreleased\]/i.test(l));
  if (start < 0) return null;

  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s/.test(lines[i])) {
      end = i;
      break;
    }
  }
  const body = lines.slice(start + 1, end).join('\n').trim();
  return body ? { lines, start, end, body } : null;
}

/** 把 [Unreleased] 段归档成 [x.y.z] - 日期，顶部留出新的空 [Unreleased]。
 *  返回归档的正文；返回 null = 没内容可归档。 */
function archiveChangelog(version) {
  const found = findUnreleased();
  if (!found) return null;
  const { lines, start, end, body } = found;
  const date = new Date().toISOString().slice(0, 10);
  const out = [...lines.slice(0, start), '## [Unreleased]', '', `## [${version}] - ${date}`, '', body, '', ...lines.slice(end)];
  fs.writeFileSync(path.join(ROOT, 'CHANGELOG.md'), out.join('\n'));
  return body;
}

// ---------------------------------------------------------------- GitHub CI

/** 从 origin 里解析出 owner/repo（非 GitHub remote 返回 null，CI 相关步骤整个跳过） */
function githubRepo() {
  const url = git(['remote', 'get-url', 'origin'], { allowFail: true });
  if (!url) return null;
  const m = /github\.com[:/]([^/]+)\/(.+?)(?:\.git)?$/.exec(url);
  return m ? { owner: m[1], repo: m[2], slug: `${m[1]}/${m[2]}` } : null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 轮询 Actions 直到那个 tag 的构建结束（Ctrl+C 可随时退出，退出前给出页面链接） */
async function watchCi(gh, tag) {
  const runsUrl = `https://github.com/${gh.slug}/actions`;
  console.log(`\n盯 CI（Ctrl+C 可退出，不影响构建）：${runsUrl}\n`);

  let last = '';
  for (let i = 0; i < 120; i++) {
    await sleep(i === 0 ? 5_000 : 15_000);
    let run = null;
    try {
      const res = await fetch(`https://api.github.com/repos/${gh.slug}/actions/runs?per_page=30`, {
        headers: { 'User-Agent': 'svn-git-release', Accept: 'application/vnd.github+json' },
      });
      if (!res.ok) {
        console.log(`\n${WARN} 查不到 CI 状态（HTTP ${res.status}）—— 去这里看：${runsUrl}`);
        return;
      }
      const data = await res.json();
      // tag 触发的 run，head_branch 就是 tag 名
      run = (data.workflow_runs ?? []).find((r) => r.head_branch === tag);
    } catch {
      /* 网络抖动：继续等 */
    }
    if (!run) {
      if (last !== 'pending') {
        console.log('… 还没看到构建排队（正常，几秒内出现）');
        last = 'pending';
      }
      continue;
    }
    const line = `${run.status}${run.conclusion ? ` / ${run.conclusion}` : ''}`;
    if (line !== last) {
      console.log(`  ${run.status === 'completed' ? (run.conclusion === 'success' ? OK : NO) : '…'} ${line}  ${run.html_url}`);
      last = line;
    }
    if (run.status === 'completed') {
      if (run.conclusion === 'success') {
        const arts = await fetch(`https://api.github.com/repos/${gh.slug}/actions/runs/${run.id}/artifacts`, {
          headers: { 'User-Agent': 'svn-git-release', Accept: 'application/vnd.github+json' },
        })
          .then((r) => (r.ok ? r.json() : { artifacts: [] }))
          .catch(() => ({ artifacts: [] }));
        console.log(`\n${OK} 构建成功，产物：`);
        for (const a of arts.artifacts ?? []) {
          console.log(`   ${a.name}  ${(a.size_in_bytes / 1024 / 1024).toFixed(1)}MB`);
        }
        console.log(`   下载：${run.html_url}`);
      } else {
        console.log(`\n${NO} 构建 ${run.conclusion}，去看日志：${run.html_url}`);
      }
      return;
    }
  }
  console.log(`\n${WARN} 等太久了，不盯了 —— 自己看：${runsUrl}`);
}

// ---------------------------------------------------------------- 主流程

async function main() {
  console.log('=== 发版 ===\n');

  // --- 检测 1：git 仓库
  if (git(['rev-parse', '--is-inside-work-tree'], { allowFail: true }) !== 'true') {
    die('当前目录不是 git 仓库');
  }

  // --- 检测 2：工作区干净（只看已跟踪文件 —— 未跟踪文件不影响 npm version，
  //     实测确认过；不要在这里拦未跟踪文件，否则临时目录会把发版堵死）
  const dirty = git(['status', '--porcelain', '--untracked-files=no']);
  if (dirty) {
    console.error(`${NO} 有未提交的改动，先处理掉再发版：\n`);
    console.error(
      dirty
        .split('\n')
        .map((l) => `   ${l}`)
        .join('\n'),
    );
    die('', '（发版前工作区必须是干净的，否则版本号提交会混进别的改动）');
  }
  console.log(`${OK} 工作区干净`);

  // --- 检测 3：分支
  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']);
  if (branch !== ALLOW_BRANCH) {
    console.log(`${WARN} 当前在 ${branch} 分支（发版通常在 ${ALLOW_BRANCH}）`);
    if (!(await confirm(`确定要在 ${branch} 上发版吗？`))) die('已取消');
  } else {
    console.log(`${OK} 分支 ${branch}`);
  }

  // --- 检测 4：本地有没有未推送的提交（发版会一并推上去，先说清楚）
  const ahead = git(['rev-list', '--count', `origin/${branch}..HEAD`], { allowFail: true });
  if (ahead && ahead !== '0') {
    console.log(`${WARN} 有 ${ahead} 个提交还没推送，会随本次发版一起推上去`);
  }

  // --- 版本号
  const cur = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
  let level = LEVEL;
  if (!level) {
    const [a, b, c] = cur.split('.').map(Number);
    console.log(`\n当前版本 ${cur}，升哪一位？`);
    console.log(`   1) patch  → ${a}.${b}.${c + 1}   修 bug`);
    console.log(`   2) minor  → ${a}.${b + 1}.0   加功能（向下兼容）`);
    console.log(`   3) major  → ${a + 1}.0.0   破坏性变更`);
    const ans = await ask('选 1/2/3', '1');
    level = ans === '2' ? 'minor' : ans === '3' ? 'major' : 'patch';
  }
  const [a, b, c] = cur.split('.').map(Number);
  const next = level === 'major' ? `${a + 1}.0.0` : level === 'minor' ? `${a}.${b + 1}.0` : `${a}.${b}.${c + 1}`;
  const tag = `v${next}`;

  // --- 检测 5：这个 tag 是不是已经有了（本地或远端）
  if (git(['tag', '-l', tag])) die(`本地已有 tag ${tag}`, '先删掉它，或换个版本号');
  if (git(['ls-remote', '--tags', 'origin', tag], { allowFail: true })) {
    die(`远端已有 tag ${tag}`, 'CI 会因此再跑一遍、产物也可能对不上；换个版本号');
  }
  console.log(`${OK} 版本 ${cur} → ${next}（tag ${tag}）`);

  // --- 发布说明（用于版本提交信息 + tag 说明）
  //     默认取 CHANGELOG 里第一条变更（剥掉 markdown 标记）—— 省得每次手打，
  //     也顺手提醒"这条写的就是这次要发的东西"
  const firstBullet = findUnreleased()
    ?.body.split('\n')
    .find((l) => /^\s*[-*]\s+/.test(l));
  const defaultNote = firstBullet
    ? firstBullet.trim().replace(/^[-*]\s+/, '').replace(/\*\*/g, '').slice(0, 60)
    : `${tag} 发布`;
  const note = await ask('\n这次发布了什么（一句话，进 commit 和 tag 信息）', defaultNote);
  const message = `${tag}：${note}`;

  // --- 预览
  console.log('\n将要执行：');
  console.log(`  1. CHANGELOG.md：[Unreleased] 归档成 [${next}] - ${new Date().toISOString().slice(0, 10)}`);
  console.log(`  2. git commit -m "CHANGELOG：归档 ${tag}"`);
  console.log(`  3. npm version ${level} -m "${message}"   → 提交 + 打 tag ${tag}`);
  console.log(NO_PUSH ? '  4. （--no-push，不推送）' : `  4. git push --follow-tags   → 触发 CI 出包`);
  if (!(await confirm('\n开始吗？', true))) die('已取消');

  // --- 1. 归档 CHANGELOG
  const body = archiveChangelog(next);
  if (body) {
    git(['add', 'CHANGELOG.md']);
    git(['commit', '-m', `CHANGELOG：归档 ${tag}`]);
    console.log(`${OK} CHANGELOG 已归档`);
  } else {
    console.log(`${WARN} CHANGELOG 的 [Unreleased] 段是空的，没有内容可归档`);
    if (!YES && !(await confirm('没有变更记录，仍然继续吗？', false))) die('已取消');
  }

  // --- 2. 升版本 + 打 tag
  //     npm version 会自己提交 package.json / package-lock.json 并打 tag；
  //     它只在"已跟踪文件干净"时才肯继续，前面已确认过
  const out = sh(NPM, ['version', level, '-m', message]);
  console.log(`${OK} ${out.replace(/^v/, '版本 → v')}（已提交并打 tag）`);

  if (NO_PUSH) {
    console.log(`\n${OK} 完成（未推送）。要发出去时：git push --follow-tags`);
    return;
  }

  // --- 3. 推
  git(['push', '--follow-tags']);
  console.log(`${OK} 已推送 main + ${tag}`);

  // --- 4. 盯 CI
  const gh = githubRepo();
  if (!gh) {
    console.log(`${WARN} remote 不是 GitHub，CI 状态自己看`);
    return;
  }
  if (NO_WATCH) {
    console.log(`\n${OK} 完成。CI 在这里跑：https://github.com/${gh.slug}/actions`);
    return;
  }
  await watchCi(gh, tag);
  console.log(`\n${OK} 全部完成`);
}

main()
  .catch((e) => {
    console.error(`\n${NO} ${e.message}`);
    console.error('  发版中断。已完成的步骤不会自动回退 —— 先看 git log / git tag，再决定是继续还是回退。');
    process.exit(1);
  })
  .finally(() => {
    finished = true;
    rl.close();
  });
