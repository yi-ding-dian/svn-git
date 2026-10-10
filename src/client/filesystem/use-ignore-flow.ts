/** 忽略流程（加入忽略 / 取消忽略）：从 FsView 抽出（原 fileSystem/index.tsx:110-122 + 903-941）。
 *  只搬状态与提交逻辑，三个弹窗的 JSX 仍留在视图里（引用本 hook 返回的状态）。
 *  视图刷新通过回调交给调用方（树模式刷根节点 / 列表模式刷当前目录；过滤视图另有自己的 tick）。
 */
import { useRef, useState } from 'react';
import { t } from '../../shared/i18n/index.js';
import { get, post } from '../shared/api.js';

export interface IgnoreAsk {
  code: string;
  rel: string;
  name: string;
}
export interface UnignoreAsk {
  rel: string;
  name: string;
  isDir: boolean;
}
export type IgnoreWhere = 'gitignore' | 'global' | 'exclude';

/** svn 忽略预案（后端 ignorePlan）：规则最终写到哪个目录、内容是什么 */
export interface IgnorePlanView {
  /** 规则写进哪个目录（相对仓库根，'' = 仓库根） */
  target: string;
  /** 实际会写入的规则内容（弹窗预填它，而不是条目名） */
  rule: string;
  /** svn 表达不了子路径而退化成「忽略整段」（如忽略 dist/bundle.js → 忽略整个 dist） */
  degraded: boolean;
}

export function useIgnoreFlow(opts: {
  onToast: (m: string) => void;
  /** 忽略状态变化后刷新当前目录（? ↔ I 会让条目出现/消失） */
  reloadDir: () => void;
  /** 过滤视图重拉（"仅新文件"等筛选依赖状态码） */
  reloadFilter: () => void;
  /** 仓库类型：svn 的规则落点要问后端（规则不能带路径，可能退化成忽略整段） */
  repoType: 'svn' | 'git';
}) {
  /** 忽略规则设置弹窗（目录级：查看/删除/新增规则） */
  const [ignoreModal, setIgnoreModal] = useState<{ dir: string } | null>(null);
  /** 加入忽略的确认弹窗（单文件/目录） */
  const [ignoreAsk, setIgnoreAsk] = useState<IgnoreAsk | null>(null);
  const [ignorePattern, setIgnorePattern] = useState('');
  /** svn 忽略预案：null = 不适用/取失败（按条目名写入），'loading' = 计算中，对象 = 就绪 */
  const [ignorePlan, setIgnorePlan] = useState<'loading' | IgnorePlanView | null>(null);
  /** 忽略规则写到哪儿（仅 git：仓库 .gitignore / 全局 / 仓库本地 exclude） */
  const [ignoreTarget, setIgnoreTarget] = useState<IgnoreWhere>('gitignore');
  /** 取消忽略的确认弹窗 */
  const [unignoreAsk, setUnignoreAsk] = useState<UnignoreAsk | null>(null);

  const optsRef = useRef(opts);
  optsRef.current = opts;

  /** 关掉「加入忽略」弹窗（预案一并清掉，免得下次打开残留上一次的落点） */
  const closeIgnore = () => {
    setIgnoreAsk(null);
    setIgnorePlan(null);
  };

  /**
   * 打开「加入忽略」弹窗（预填当前文件名作为规则）。
   * svn 先向后端要「预案」：规则不能带路径，目标在未版本化目录里时会退化成忽略整段
   * （如右键 dist/bundle.js → 实际写 dist）。问清楚再预填，用户点确认前就知道会写入什么，
   * 不再出现「填了 A 却写入 B、点完才从 toast 得知」。
   */
  const ignoreFile = (e: IgnoreAsk) => {
    setIgnorePattern(e.name);
    setIgnoreAsk(e);
    setIgnorePlan(null);
    if (optsRef.current.repoType !== 'svn') return;
    setIgnorePlan('loading');
    get
      .ignorePlan(e.rel)
      .then((p) => {
        setIgnorePlan(p);
        // 预填真实会写入的规则（退化时是那一层目录名）；用户已经手动改过输入框就不动他的
        setIgnorePattern((cur) => (cur === e.name ? p.rule : cur));
      })
      .catch(() => setIgnorePlan(null)); // 取不到预案：回落到条目名，不阻塞操作
  };

  /** 提交忽略：git 写 .gitignore / svn 设 svn:ignore */
  const doIgnore = () => {
    if (!ignoreAsk) return;
    const pattern = ignorePattern.trim();
    if (!pattern) return;
    post
      .ignore(ignoreAsk.rel, pattern, ignoreTarget)
      .then((r) => {
        optsRef.current.onToast(r.message);
        if (r.ok) {
          optsRef.current.reloadDir();
          optsRef.current.reloadFilter(); // ? 变 I 后应从"仅新文件"列表消失
        }
      })
      // 忽略失败: {msg}
      .catch((err: Error) => optsRef.current.onToast(t('fs.ignore.failed', { msg: err.message })));
    closeIgnore();
  };

  /** 取消忽略：确认后调接口，该项变回未版本化(?)（具体删除的规则由接口返回，toast 展示） */
  const doUnignore = () => {
    if (!unignoreAsk) return;
    post
      .unignore(unignoreAsk.rel)
      .then((r) => {
        optsRef.current.onToast(r.message);
        if (r.ok) {
          optsRef.current.reloadDir();
          optsRef.current.reloadFilter(); // I 变回 ? 后应出现在"仅新文件"里
        }
      })
      // 取消忽略失败: {msg}
      .catch((err: Error) => optsRef.current.onToast(t('fs.ignore.unignoreFailed', { msg: err.message })));
    setUnignoreAsk(null);
  };

  return {
    ignoreModal,
    setIgnoreModal,
    ignoreAsk,
    ignorePattern,
    setIgnorePattern,
    ignorePlan,
    ignoreTarget,
    setIgnoreTarget,
    unignoreAsk,
    setUnignoreAsk,
    ignoreFile,
    closeIgnore,
    doIgnore,
    doUnignore,
  };
}
