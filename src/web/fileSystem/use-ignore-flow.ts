/** 忽略流程（加入忽略 / 取消忽略）：从 FsView 抽出（原 fileSystem/index.tsx:110-122 + 903-941）。
 *  只搬状态与提交逻辑，三个弹窗的 JSX 仍留在视图里（引用本 hook 返回的状态）。
 *  视图刷新通过回调交给调用方（树模式刷根节点 / 列表模式刷当前目录；过滤视图另有自己的 tick）。
 */
import { useRef, useState } from 'react';
import { post } from '../api.js';

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

export function useIgnoreFlow(opts: {
  onToast: (m: string) => void;
  /** 忽略状态变化后刷新当前目录（? ↔ I 会让条目出现/消失） */
  reloadDir: () => void;
  /** 过滤视图重拉（"仅新文件"等筛选依赖状态码） */
  reloadFilter: () => void;
}) {
  /** 忽略规则设置弹窗（目录级：查看/删除/新增规则） */
  const [ignoreModal, setIgnoreModal] = useState<{ dir: string } | null>(null);
  /** 加入忽略的确认弹窗（单文件/目录） */
  const [ignoreAsk, setIgnoreAsk] = useState<IgnoreAsk | null>(null);
  const [ignorePattern, setIgnorePattern] = useState('');
  /** 忽略规则写到哪儿（仅 git：仓库 .gitignore / 全局 / 仓库本地 exclude） */
  const [ignoreTarget, setIgnoreTarget] = useState<IgnoreWhere>('gitignore');
  /** 取消忽略的确认弹窗 */
  const [unignoreAsk, setUnignoreAsk] = useState<UnignoreAsk | null>(null);

  const optsRef = useRef(opts);
  optsRef.current = opts;

  /** 打开「加入忽略」弹窗（预填当前文件名作为规则） */
  const ignoreFile = (e: IgnoreAsk) => {
    setIgnorePattern(e.name);
    setIgnoreAsk(e);
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
      .catch((err: Error) => optsRef.current.onToast(`忽略失败: ${err.message}`));
    setIgnoreAsk(null);
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
      .catch((err: Error) => optsRef.current.onToast(`取消忽略失败: ${err.message}`));
    setUnignoreAsk(null);
  };

  return {
    ignoreModal,
    setIgnoreModal,
    ignoreAsk,
    setIgnoreAsk,
    ignorePattern,
    setIgnorePattern,
    ignoreTarget,
    setIgnoreTarget,
    unignoreAsk,
    setUnignoreAsk,
    ignoreFile,
    doIgnore,
    doUnignore,
  };
}
