/** 文件系统视图纯工具：状态判断/菜单项组装/排序过滤/树扁平化（fs 拆分批次 1，原 fileSystem/index.tsx 模块级 helper） */
import React from 'react';
import { codeRank } from '../api.js';
import { IconRename } from '../icons.js';
import { cmdOfRepo } from '../cmd-preview.js';
import type { CtxMenuItem } from '../context-menu.js';

export type Filter = 'changed' | 'new' | 'deleted';
export type Mode = 'list' | 'tree' | 'browse';

/** 还原菜单按状态语义化命名：A=取消添加 / D=恢复删除 / M·C·R=还原（extra 为后缀，如"目录"） */
export function revertName(code: string, extra = ''): { label: string; title: string } {
  if (code === 'A') return { label: `取消添加${extra}`, title: '取消添加到版本库的调度，文件保留磁盘（变回未版本化 ?）' };
  if (code === 'D') return { label: `撤销删除${extra}`, title: '撤销删除，文件恢复到版本库内容（本地文件找回）' };
  if (code === 'M' || code === 'C') return { label: `还原${extra}`, title: '放弃本地修改，回到版本库版本（改动不可恢复）' };
  return { label: `还原${extra}`, title: '' };
}

/** 多选还原动态命名：全部 A → 取消添加（N 项）；全部 D → 恢复删除（N 项）；混合/其余 → 还原（N 项）+ 分类说明 */
export function multiRevertName(codes: string[], n: number): { label: string; title: string } {
  if (codes.every((c) => c === 'A')) return { label: `取消添加（${n} 项）`, title: '取消添加到版本库的调度，文件保留磁盘（变回未版本化 ?）' };
  if (codes.every((c) => c === 'D')) return { label: `撤销删除（${n} 项）`, title: '撤销删除，文件恢复到版本库内容（本地文件找回）' };
  return { label: `还原（${n} 项）`, title: '对勾选项执行还原（A=取消添加 / D=恢复删除 / M=放弃本地修改）' };
}

/** 磁盘存在且可改名（renameItem 内部按状态分流：?/I 走磁盘改名，其余走 svn/git move）：
 *  干净 / M / A / C / ? / I（D 已删调度、R/~/U 调度中或磁盘不在 → 均不可改名） */
export function renameableCode(code: string): boolean {
  return !code || code === 'M' || code === 'A' || code === 'C' || code === '?' || code === 'I';
}

/** 有版本库内容（可从版本库移除，非添加/删除调度中）：干净 / M / C（A 添加调度用"还原=取消添加"，D 删除调度不再移除） */
export function removableFromRepo(code: string): boolean {
  return !code || code === 'M' || code === 'C';
}

/** 重命名菜单项：不在版本库（?/I）→ 磁盘改名（无命令预览）；版本化 → svn/git move（占位预览，新名弹窗输入） */
export function renameItem(code: string, repoType: 'svn' | 'git', rel: string, isDir: boolean, onAction: (op: 'move' | 'fs-move', paths: string[]) => void): CtxMenuItem {
  const fsOnly = code === '?' || code === 'I';
  return {
    icon: <IconRename />,
    label: '重命名',
    title: fsOnly ? '从磁盘直接改名，不影响版本库' : `重命名此${isDir ? '文件夹' : '文件'}（本地改名，提交后生效）`,
    // 命令预览只显示文件名（完整路径在弹窗确认按钮上）
    cmd: fsOnly ? undefined : cmdOfRepo(repoType, 'move', { from: rel.split('/').pop() ?? '', to: '…' }),
    action: () => onAction(fsOnly ? 'fs-move' : 'move', [rel]),
  };
}

/** 命令预览: 多路径缩写（前 3 个 + …） */
export const joinPaths = (arr: string[]) => arr.slice(0, 3).join(' ') + (arr.length > 3 ? ' …' : '');

/** fs 列表排序优先级：与旧版本地 CODE_RANK 严格一致（X 外部引用视为无状态，不与干净条目区分优先级） */
export const fsSortRank = (c: string): number => (c === 'X' ? 0 : codeRank(c));

/** 过滤（多选）：changed=仅修改，new=仅新文件；同时选 = 并集；空 = 全部 */
export function filterEntries<T extends { code: string }>(list: T[], filters: Set<Filter>): T[] {
  if (filters.size === 0) return list;
  const wantChanged = filters.has('changed');
  const wantNew = filters.has('new');
  const wantDeleted = filters.has('deleted');
  // 修改状态精确枚举：排除 ?(未版本化)、I(被忽略)、X(外部引用) 与无状态
  const MODIFIED = new Set(['M', 'A', 'D', 'R', 'C', '!', '~', 'U']);
  return list.filter((e) => {
    const isChanged = MODIFIED.has(e.code);
    const isNew = e.code === '?';
    const isDeleted = e.code === 'D';
    return (wantChanged && isChanged) || (wantNew && isNew) || (wantDeleted && isDeleted);
  });
}

/** 树模式扁平化可见行 */
export interface VisibleRow {
  rel: string;
  name: string;
  code: string;
  isDir: boolean;
  size: number;
  mtime: string;
  count?: number;
  codes?: string[];
  depth: number;
  open: boolean;
  locked?: boolean;
  /** 磁盘上已缺失（svn '!' / git " D"）：虚化渲染 + 右键还原 */
  miss?: boolean;
}
