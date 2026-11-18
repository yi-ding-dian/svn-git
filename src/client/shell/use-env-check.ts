/** 环境检测（svn / git 是否安装）：从 app.tsx 原样抽出。
 *
 *  - 首次挂载检测一次；「环境检测」弹窗每次打开再检测一次（用户可能刚在别处装完）
 *  - 缺失标志按当前仓库类型收窄：未打开仓库时任一缺失都提示，打开仓库只提示该类型需要的引擎
 */
import { useEffect, useState } from 'react';
import { get } from '../shared/api.js';

export interface EnvInfo {
  svn: { installed: boolean; version: string };
  git: { installed: boolean; version: string };
}

export function useEnvCheck(opts: { modalType?: string | null; repoType?: string | null }) {
  const { modalType, repoType } = opts;
  const [env, setEnv] = useState<EnvInfo | null>(null);

  useEffect(() => {
    // 环境检测：缺失 svn/git 时顶部横幅提示安装
    get
      .envCheck()
      .then((r) => setEnv(r))
      .catch(() => {});
  }, []);

  // 「环境检测」弹窗每次打开都重新检测一次（⋯ 菜单入口）：
  // 确保看到的是最新状态（用户可能刚在别处装完 svn/git）
  useEffect(() => {
    if (modalType !== 'env') return;
    get
      .envCheck()
      .then((r) => setEnv(r))
      .catch(() => {});
  }, [modalType]);

  // 环境缺失:只提示「当前仓库类型需要」的引擎;未打开仓库时任一缺失都提示
  // (用户可能只用 Git 或只用 SVN,不强制两者都装)
  const needSvn = !repoType || repoType === 'svn';
  const needGit = !repoType || repoType === 'git';
  const missingSvn = !!(env && needSvn && !env.svn.installed);
  const missingGit = !!(env && needGit && !env.git.installed);
  const envMissing = missingSvn || missingGit;

  return { env, missingSvn, missingGit, envMissing };
}
