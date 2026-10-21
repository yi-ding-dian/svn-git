/** 练习仓库生成入口：目录规划 → 按类型生成 → 失败清理（不依赖 HTTP） */
import { run } from '../vcs/exec.js';
import { t } from '../shared/i18n/index.js';
import { generateGitPractice } from './git.js';
import { generateSvnPractice } from './svn.js';
import { cleanupPracticeRoot, planPracticeRoot } from './plan.js';
import type { PracticeProbe, PracticeRequest, PracticeResult } from './types.js';

export async function generatePracticeRepo(req: PracticeRequest, signal?: AbortSignal): Promise<PracticeResult> {
  const scenarios = {
    remote: Boolean(req.scenarios?.remote),
    conflict: Boolean(req.scenarios?.conflict),
  };

  let plan: ReturnType<typeof planPracticeRoot>;
  try {
    plan = planPracticeRoot(req.parentDir, req.type);
  } catch (e) {
    return { ok: false, type: req.type, message: (e as Error).message || t('srv.practiceFailed') };
  }

  try {
    if (req.type === 'git') await generateGitPractice(plan.root, scenarios, signal);
    else await generateSvnPractice(plan.root, scenarios, signal);
    return {
      ok: true,
      type: req.type,
      root: plan.root,
      workDir: plan.workDir,
      scenarios,
      message: t('srv.practiceCreated', { dir: plan.root }),
    };
  } catch (e) {
    // 中途失败：删掉本次占位的 root，不留半成品
    cleanupPracticeRoot(plan.root, plan.practiceBase);
    return { ok: false, type: req.type, message: (e as Error).message || t('srv.practiceFailed') };
  }
}

/** 探测 git / svn / svnadmin 是否可用（前端据此禁用不可用的类型） */
export async function probePractice(): Promise<PracticeProbe> {
  const has = async (cmd: string): Promise<boolean> => {
    try {
      return (await run(cmd, ['--version'], { timeoutMs: 8_000 })).code === 0;
    } catch {
      return false;
    }
  };
  const [git, svn, svnadmin] = await Promise.all([has('git'), has('svn'), has('svnadmin')]);
  return { git, svn, svnadmin };
}
