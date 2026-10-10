/** 文件夹视图右键菜单构建（fs 拆分批次 1）：空菜单/多选菜单/行菜单 三项 builder，
 * 事件状态（选中/锁定/定位）由 index.tsx 处理，本模块只管「items 数组生成」。 */
import React from 'react';
import { t } from '../../shared/i18n/index.js';
import { get, post } from '../shared/api.js';
import { cmdOfRepo } from '../shared/cmd-preview.js';
import { IconDownload, IconUpload, IconHistory, IconCopy, IconCut, IconPaste, IconFolder, IconPlus, IconRevert, IconClean, IconDiff, IconFile, IconIgnore, IconEyeOff, IconExternal, IconLock, IconUnlock, IconStar } from '../ui/icons.js';
import type { CtxMenuItem } from '../ui/context-menu.js';
import { AppIcon } from '../ui/ui.js';
import type { Clip, ClipItem } from './use-file-transfer.js';
import { multiRevertName, removableFromRepo, renameableCode, renameItem, joinPaths, revertName, type Mode } from './utils.js';

/** 菜单需要的组件侧服务（index.tsx 组装传入；菜单项动作绕过 UI 状态直接回组件回调） */
export interface MenuServices {
  repoType: 'svn' | 'git';
  dir: string;
  /** 当前视图模式：树模式不提供新建（就地生成的条目没处安放，树视图本来也是看全貌用的） */
  mode: Mode;
  /** 在当前目录就地新建一个条目（kind 决定文件还是文件夹），名字就地编辑 */
  startCreate: (kind: 'dir' | 'file') => void;
  /** 就地重命名（只给未版本化条目用：纯磁盘改名，不值得弹窗） */
  startRename: (rel: string) => void;
  root?: string;
  favs: { path: string }[];
  setIgnoreTarget: (t: 'gitignore' | 'global' | 'exclude') => void;
  ignoreFile: (t: { code: string; rel: string; name: string }) => void;
  setIgnoreModal: (v: { dir: string }) => void;
  setUnignoreAsk: (v: { rel: string; name: string; isDir: boolean }) => void;
  setModuleIndexModal: (v: { md: string }) => void;
  viewHistory: (rel: string, ev: React.MouseEvent) => void;
  openFile: (name: string, code: string, rel: string) => unknown;
  svnLock: (rel: string, action: 'lock' | 'unlock') => void;
  onAction: (op: 'add' | 'revert' | 'delete' | 'commit' | 'fs-delete' | 'move' | 'fs-move', paths: string[], keep?: boolean) => void;
  onDiff: (p: string) => void;
  onLog: (p: string) => void;
  onUpdateDir: (dir: string) => void;
  onCommitSelect: (dir: string, label: string) => void;
  onToast: (m: string, err?: boolean) => void;
  openInFm: (dir: string) => void;
  removeFav: (rel: string) => void;
  addFavDir: (rel: string) => void;
  /** openWith 异步取到程序列表后替换菜单第 owIdx 项的子菜单 */
  menuPatchItems: (owIdx: number, subs: CtxMenuItem[]) => void;
  /** 文件剪贴板（复制/剪切/粘贴）：null = 空 */
  clip: Clip | null;
  /** 放进剪贴板（不立刻动磁盘，粘贴时才执行） */
  copyItems: (items: ClipItem[]) => void;
  cutItems: (items: ClipItem[]) => void;
  /** 粘贴到指定目录（缺省 = 当前浏览目录） */
  pasteInto: (destDir?: string) => void;
}

/** 剪贴板菜单项：复制 / 剪切（行菜单与多选菜单共用同一份文案与图标） */
function clipItems(tArr: { rel: string; name: string; isDir: boolean; code: string }[], s: MenuServices): CtxMenuItem[] {
  const items: ClipItem[] = tArr.map((x) => ({ rel: x.rel, name: x.name, isDir: x.isDir, code: x.code }));
  // （{n} 项）
  const n = items.length > 1 ? t('fs.countItems', { n: items.length }) : '';
  return [
    // 复制{n} / 放进剪贴板，到目标目录按 Ctrl+V 粘贴（可粘多次）
    { icon: <IconCopy />, label: t('fs.menu.copyN', { n }), title: t('fs.menu.copyTitle'), action: () => s.copyItems(items) },
    {
      icon: <IconCut />,
      // 剪切{n}
      label: t('fs.menu.cutN', { n }),
      // 放进剪贴板，粘贴后从原位置移走（版本化条目走 svn move / git mv，保留文件历史）
      title: t('fs.menu.cutTitle'),
      action: () => s.cutItems(items),
    },
  ];
}

/** 剪贴板非空时的「粘贴」项（空白区用缺省落点=当前目录，目录行传 destDir）；剪贴板为空返回 [] */
function pasteItem(s: MenuServices, destDir?: string): CtxMenuItem[] {
  const c = s.clip;
  if (!c) return [];
  const names = c.items.map((i) => i.name);
  //  等 {n} 项
  const shown = names.slice(0, 3).join(t('common.listSep')) + (names.length > 3 ? t('fs.menu.andN', { n: names.length }) : '');
  return [{
    icon: <IconPaste />,
    // 移动到这里（{n} 项） / 粘贴到这里（{n} 项）
    label: c.mode === 'cut' ? t('fs.menu.moveHere', { n: names.length }) : t('fs.menu.pasteHere', { n: names.length }),
    // 移动：{list} / 复制：{list}
    title: c.mode === 'cut' ? t('fs.menu.moveToList', { list: shown }) : t('fs.menu.copyToList', { list: shown }),
    action: () => s.pasteInto(destDir),
  }];
}

/** 空白区右键菜单 */
export function buildBlankItems(s: MenuServices): CtxMenuItem[] {
  const items: CtxMenuItem[] = [
    // 粘贴置顶：剪贴板里有东西时它就是用户最可能要做的事（顺带让"剪贴板非空"这件事可见）
    ...pasteItem(s),
    // 更新仓库 / 更新当前目录
    { icon: <IconDownload />, label: s.repoType === 'git' ? t('fs.act.updateRepo') : t('fs.act.updateDir'), cmd: cmdOfRepo(s.repoType, 'update', { path: s.dir }), action: () => s.onUpdateDir(s.dir) },
    // 提交修改的文件…
    { icon: <IconUpload />, label: t('fs.act.commitModified'), cmd: cmdOfRepo(s.repoType, 'commit', { msg: '…' }), action: () => s.onCommitSelect(s.dir, s.dir) },
    // 查看历史记录
    { icon: <IconHistory />, label: t('fs.act.viewHistoryLong'), cmd: cmdOfRepo(s.repoType, 'view_history', { path: s.dir || '.' }), action: () => s.onLog(s.dir) },
    {
      icon: <IconCopy />,
      // 复制当前路径
      label: t('fs.act.copyCurPath'),
      action: () => {
        const abs = s.root ? `${s.root}${s.dir ? `/${s.dir}` : ''}` : s.dir;
        // 当前路径已复制
        void navigator.clipboard?.writeText(abs).then(() => s.onToast(t('fs.menu.curPathCopied')));
      },
    },
    // 打开文件管理器
    { icon: <IconFolder />, label: t('fs.act.openFileManager'), action: () => s.openInFm(s.dir) },
  ];
  // 新建：树模式不给（就地生成的条目在树里没处安放）
  if (s.mode !== 'tree') {
    items.push({ sep: true });
    items.push({
      icon: <IconFolder />,
      // 新建文件夹…
      label: t('fs.act.newFolder'),
      // 在当前目录新建一个文件夹，名字就地输入（回车或点空白处确认，Esc 取消）
      title: t('fs.act.newFolderTitle'),
      action: () => s.startCreate('dir'),
    });
    items.push({
      icon: <IconFile />,
      // 新建文件…
      label: t('fs.act.newFile'),
      // 在当前目录新建一个空文件，名字就地输入（回车或点空白处确认，Esc 取消）
      title: t('fs.act.newFileTitle'),
      action: () => s.startCreate('file'),
    });
  }
  return items;
}

/** 多选菜单（tArr 由 index 按当前视图展开选中集合后传入） */
export function buildMultiItems(
  tArr: { rel: string; isDir: boolean; code: string; name: string; treeConflicted?: boolean; codes?: string[] }[],
  s: MenuServices,
): CtxMenuItem[] {
  const items: CtxMenuItem[] = [];
  // 树冲突项单独拎出来：它们**提交必被拒**，得先二选一（与单选菜单的置顶项同一套处理）。
  // 从 tMod 里剔除，否则"提交修改"会把它们带上——那是条点了只会报错的路。
  const tTc = s.repoType === 'svn' ? tArr.filter((x) => x.treeConflicted) : [];
  const tNew = tArr.filter((x) => x.code === '?');
  const tMod = tArr.filter((x) => ['M', 'A', 'D', 'R', 'C'].includes(x.code) && !x.treeConflicted);
  const tMiss = tArr.filter((x) => x.code === '!' && !x.treeConflicted);
  const tI = tArr.filter((x) => x.code === 'I');
  const tVer = tArr.filter((x) => removableFromRepo(x.code) && !x.treeConflicted);
  const tFsDel = s.repoType === 'git' ? [...tNew, ...tI] : tNew;
  // 全是"本地已添加"（含磁盘已缺失的 '!'，那类在 SVN 记录里同样是 added 调度）才说"放弃本地添加"
  const tcAllAdd = tTc.length > 0 && tTc.every((x) => x.code === '!' || x.codes?.includes('A') === true);
  if (tTc.length) {
    items.push({
      icon: <IconRevert />,
      // 接受服务器的删除（解决树冲突）（{n} 项） / 还原（解决树冲突）（{n} 项）
      label: tcAllAdd ? t('fs.tcFix.acceptN', { n: tTc.length }) : t('fs.tcFix.revertN', { n: tTc.length }),
      title: tcAllAdd
        // 服务器上这些路径已删除或移动。接受后本地文件会一并删除（与服务器保持一致，本地未提交的改动不可恢复），之后即可正常提交
        ? t('fs.tcFix.acceptTitle')
        // 服务器上这些路径已删除或移动。放弃本地改动＝回到版本库内容（svn revert -R，本地改动不可恢复），随后更新即可同步服务器的删除
        : t('fs.tcFix.revertTitle'),
      cmd: cmdOfRepo(s.repoType, 'revert', { paths: joinPaths(tTc.map((x) => x.rel)) }),
      action: () => s.onAction('revert', tTc.map((x) => x.rel)),
    });
    items.push({ sep: true });
  }
  if (tNew.length) {
    // 添加到版本库（{n} 项）
    items.push({ icon: <IconPlus />, label: t('fs.menu.addN', { n: tNew.length }), cmd: cmdOfRepo(s.repoType, 'add', { paths: joinPaths(tNew.map((x) => x.rel)) }), action: () => s.onAction('add', tNew.map((x) => x.rel)) });
  }
  if (tMiss.length) {
    // 缺失条目（磁盘已删）：与单选菜单对称——全部还原 或 从版本库删除（有意删除补录到版本库）
    items.push({
      icon: <IconRevert />,
      // 还原（{n} 项）
      label: t('fs.revert.revertN', { n: tMiss.length }),
      // {n} 项已在磁盘上缺失，全部还原从版本库恢复（{cmd}）
      title: t('fs.menu.restoreMissingNTitle', { n: tMiss.length, cmd: s.repoType === 'svn' ? 'svn revert' : 'git checkout' }),
      cmd: cmdOfRepo(s.repoType, 'revert', { paths: joinPaths(tMiss.map((x) => x.rel)) }),
      action: () => s.onAction('revert', tMiss.map((x) => x.rel)),
    });
    items.push({
      icon: <IconClean />,
      // 从版本库删除（{n} 项）
      label: t('fs.menu.deleteFromRepoN', { n: tMiss.length }),
      // {n} 项已在磁盘上缺失；从版本库移除记录（提交后生效，提交前可「还原」取消）
      title: t('fs.menu.removeRecordNTitle', { n: tMiss.length }),
      cmd: cmdOfRepo(s.repoType, 'remove_keep', { paths: joinPaths(tMiss.map((x) => x.rel)) }),
      action: () => s.onAction('delete', tMiss.map((x) => x.rel), true),
    });
  }
  if (tMod.length) {
    items.push({
      icon: <IconUpload />,
      // 提交修改（{n} 项，已排除 {tc} 项树冲突）… / 提交修改（{n} 项）…
      label: tTc.length ? t('fs.menu.commitNTc', { n: tMod.length, tc: tTc.length }) : t('fs.menu.commitN', { n: tMod.length }),
      // 已排除选中的 {tc} 项树冲突——它们提交会被服务器拒绝，先用上方「放弃本地添加」处理
      title: tTc.length ? t('fs.menu.excludedTcTitle', { tc: tTc.length }) : undefined,
      cmd: cmdOfRepo(s.repoType, 'commit', { msg: '…' }),
      action: () => s.onAction('commit', tMod.map((x) => x.rel)),
    });
    const rv = multiRevertName(tMod.map((x) => x.code), tMod.length);
    items.push({ icon: <IconRevert />, label: rv.label, title: rv.title, cmd: cmdOfRepo(s.repoType, 'revert', { paths: joinPaths(tMod.map((x) => x.rel)) }), action: () => s.onAction('revert', tMod.map((x) => x.rel)) });
  }
  if (tVer.length) {
    // 从版本库移除（{n} 项）
    items.push({ icon: <IconClean />, label: t('fs.menu.removeFromRepoN', { n: tVer.length }), cmd: cmdOfRepo(s.repoType, 'remove_keep', { paths: joinPaths(tVer.map((x) => x.rel)) }), action: () => s.onAction('delete', tVer.map((x) => x.rel), true) });
  }
  if (tFsDel.length) {
    items.push({
      icon: <IconClean />,
      // 删除磁盘文件（{n} 项）
      label: t('fs.menu.deleteDiskN', { n: tFsDel.length }),
      danger: true,
      // 从磁盘永久删除 {n} 项（不在版本库中的文件），不可恢复，不影响版本库
      title: t('fs.menu.deleteDiskNTitle', { n: tFsDel.length }),
      action: () => s.onAction('fs-delete', tFsDel.map((x) => x.rel)),
    });
  }
  if (tNew.length || tMiss.length || tMod.length || tVer.length || tFsDel.length) items.push({ sep: true });
  items.push(...clipItems(tArr, s));
  items.push({
    icon: <IconCopy />,
    // 复制完整路径（{n} 项）
    label: t('fs.menu.copyPathN', { n: tArr.length }),
    action: () => {
      const abs = s.root ? tArr.map((x) => `${s.root}/${x.rel}`).join('\n') : tArr.map((x) => x.rel).join('\n');
      // 已复制 {n} 个完整路径
      void navigator.clipboard?.writeText(abs).then(() => s.onToast(t('fs.menu.pathsCopied', { n: tArr.length })));
    },
  });
  return items;
}

/** 单选行右键菜单（ev 传入以便"查看历史"使用点击坐标提示无记录） */
export function buildRowItems(row: { isDir: boolean; code: string; rel: string; name: string; treeConflicted?: boolean; codes?: string[] }, ev: React.MouseEvent, s: MenuServices): CtxMenuItem[] {
  const items: CtxMenuItem[] = [];
  // 树冲突项走**精简菜单**：常规项对它们要么危险要么无效——
  //   提交此目录修改：含树冲突的路径提交必被服务器拒绝（死路）
  //   更新此目录：实测无效（冲突标记原样保留、磁盘文件也不动，什么都解决不了）
  //   从版本库移除：与"接受服务器的删除"语义重复，且对"已添加"项不适用
  //   重命名 / 忽略设置 / 加入常用文件夹：冲突状态下没有实际意义
  // 所以下面那一大块常规分支整个跳过（改成 else if 链），只留解决入口 + 查看历史，
  // 再落到尾部的公共工具项（打开方式 / 复制完整路径 / 复制文件名）。
  if (row.treeConflicted && s.repoType === 'svn') {
    // 本地是 added（含磁盘已缺失的 '!' —— 那类在 SVN 记录里同样是 added 调度）→ 接受的是"服务器的删除"。
    // 目录的 code 会被子项状态聚合改写（gRPC_src 自身 A、因子项有 M 而显示成 M），
    // 所以要看 codes 集合里有没有 A，不能只看 code。
    const localAdd = row.code === '!' || row.codes?.includes('A') === true;
    items.push({
      icon: <IconRevert />,
      // 接受服务器的删除（解决树冲突） / 还原（解决树冲突）
      label: localAdd ? t('fs.tcFix.accept') : t('fs.tcFix.revert'),
      title: localAdd
        ? // **树冲突的"已添加"和普通"已添加"行为不同**（实测复现过）：普通 added 目录 revert 只是取消登记、
          // 文件留在磁盘；树冲突项还要把服务器那个"删除"落下来，**本地文件会一并被删**（与服务器保持一致）。
          // 标签叫"接受服务器的删除"而不是"放弃本地添加"——后者字面暗示文件还在，会误导
          // 服务器上该路径已删除或移动。接受后本地文件会一并删除（与服务器保持一致，本地未提交的改动不可恢复），之后即可正常提交
          t('fs.tcFix.acceptTitleOne')
        // 服务器上该路径已删除或移动。放弃本地修改＝文件回到版本库内容（svn revert -R，本地改动不可恢复），随后更新即可同步服务器的删除
        : t('fs.tcFix.revertTitleOne'),
      cmd: cmdOfRepo(s.repoType, 'revert', { paths: row.rel }),
      action: () => s.onAction('revert', [row.rel]),
    });
    items.push({ sep: true });
    // 查看历史：判断"服务器删得对不对"最直接的依据（谁删的、为什么删）
    // 查看历史
    items.push({ icon: <IconHistory />, label: t('fs.act.viewHistory'), cmd: cmdOfRepo(s.repoType, 'view_history', { path: row.rel }), action: () => s.viewHistory(row.rel, ev) });
    items.push({ sep: true });
  } else if (row.code === '!') {
  // 缺失条目（'!' = 磁盘已删除但版本库还在）：磁盘无文件——只提供还原/历史/复制路径等有效操作；
  // 查看内容/差异/提交/从版本库移除/打开方式对缺失文件无意义（还原复用现有 revert：svn revert / git checkout HEAD）
    items.push({
      icon: <IconRevert />,
      // 还原
      label: t('fs.revert.revert'),
      // {kind}已在磁盘上缺失，还原从版本库恢复（{cmd}） / 目录 / 文件
      title: t('fs.menu.restoreMissingKindTitle', { kind: row.isDir ? t('fs.kind.dir') : t('fs.kind.file'), cmd: s.repoType === 'svn' ? 'svn revert' : 'git checkout' }),
      cmd: cmdOfRepo(s.repoType, 'revert', { paths: row.rel }),
      action: () => s.onAction('revert', [row.rel]),
    });
    // 自己有意删除（没走"从版本库移除"）：把删除补录到版本库（提交后生效；提交前可「还原」改主意）
    items.push({
      icon: <IconClean />,
      // 从版本库删除
      label: t('fs.act.deleteFromRepo'),
      // {kind}已在磁盘上缺失；从版本库移除记录（提交后生效，提交前可「还原」取消） / 目录 / 文件
      title: t('fs.menu.removeRecordOneTitle', { kind: row.isDir ? t('fs.kind.dir') : t('fs.kind.file') }),
      cmd: cmdOfRepo(s.repoType, 'remove_keep', { paths: row.rel }),
      action: () => s.onAction('delete', [row.rel], true),
    });
    // 查看历史
    items.push({ icon: <IconHistory />, label: t('fs.act.viewHistory'), cmd: cmdOfRepo(s.repoType, 'view_history', { path: row.rel }), action: () => s.viewHistory(row.rel, ev) });
    items.push({ sep: true });
    items.push({
      icon: <IconCopy />,
      // 复制完整路径
      label: t('fs.act.copyPath'),
      action: () => {
        const abs = s.root ? `${s.root}/${row.rel}` : row.rel;
        // 完整路径已复制
        void navigator.clipboard?.writeText(abs).then(() => s.onToast(t('fs.menu.pathCopied')));
      },
    });
    items.push({
      icon: <IconFile />,
      // 复制文件名
      label: t('fs.act.copyName'),
      action: () => {
        // 文件名已复制
        void navigator.clipboard?.writeText(row.name).then(() => s.onToast(t('fs.menu.nameCopied')));
      },
    });
    return items;
  } else if (row.isDir) {
    if (row.code === 'I') {
      // 忽略目录：无版本操作（更新/提交/还原/历史均无意义），仅忽略设置/取消忽略/删除(git 可磁盘删)
      // 忽略设置…
      items.push({ icon: <IconIgnore />, label: t('fs.act.ignoreSettings'), action: () => s.setIgnoreModal({ dir: row.rel }) });
      // 取消忽略
      items.push({ icon: <IconEyeOff />, label: t('fs.act.unignore'), action: () => s.setUnignoreAsk({ rel: row.rel, name: row.name, isDir: true }) });
      items.push(renameItem(row.code, s.repoType, row.rel, true, s.onAction, s.startRename));
      if (s.repoType === 'git') {
        items.push({ sep: true });
        // 删除磁盘文件 / 从磁盘永久删除该目录，不可恢复（不影响版本库）
        items.push({ icon: <IconClean />, label: t('fs.act.deleteDisk'), danger: true, title: t('fs.menu.deleteDirDiskTitle'), action: () => s.onAction('fs-delete', [row.rel]) });
      }
    } else if (row.code !== '?') {
      // 版本化目录：更新/提交/还原/历史/忽略设置/删除（无 diff）
      // 更新仓库 / 更新此目录
      items.push({ icon: <IconDownload />, label: s.repoType === 'git' ? t('fs.act.updateRepo') : t('fs.act.updateThisDir'), cmd: cmdOfRepo(s.repoType, 'update', { path: row.rel }), action: () => s.onUpdateDir(row.rel) });
      if (row.code) {
        // 提交此目录修改…
        items.push({ icon: <IconUpload />, label: t('fs.act.commitThisDir'), cmd: cmdOfRepo(s.repoType, 'commit', { msg: '…' }), action: () => s.onCommitSelect(row.rel, row.rel) });
        items.push({ sep: true });
        items.push({ icon: <IconRevert />, label: revertName(row.code, true).label, title: revertName(row.code).title || undefined, cmd: cmdOfRepo(s.repoType, 'revert', { paths: row.rel }), action: () => s.onAction('revert', [row.rel]) });
      }
      items.push({ sep: true });
      // 查看历史
      if (row.code !== 'A') items.push({ icon: <IconHistory />, label: t('fs.act.viewHistory'), cmd: cmdOfRepo(s.repoType, 'view_history', { path: row.rel }), action: () => s.viewHistory(row.rel, ev) });
      if (renameableCode(row.code)) items.push(renameItem(row.code, s.repoType, row.rel, true, s.onAction, s.startRename));
      // 忽略设置…
      items.push({ icon: <IconIgnore />, label: t('fs.act.ignoreSettings'), cmd: cmdOfRepo(s.repoType, 'ignore_add', { path: row.rel, pattern: '…' }), action: () => s.setIgnoreModal({ dir: row.rel }) });
      // 常用文件夹（仅 svn：git 加载快无需预加载）：自身已加入显示移除；父目录已加入则不再显示；其余显示加入
      if (s.repoType === 'svn') {
        if (s.favs.some((f) => f.path === row.rel)) {
          // 已加入常用文件夹（点击移除）
          items.push({ icon: <IconStar />, label: t('fs.act.favAdded'), action: () => s.removeFav(row.rel) });
        } else if (!s.favs.some((f) => row.rel.startsWith(f.path + '/'))) {
          // 加入常用文件夹
          items.push({ icon: <IconStar />, label: t('fs.act.favAdd'), action: () => s.addFavDir(row.rel) });
        }
      }
      // 有版本库内容且非调度中（非 '!' 缺失；A 添加/D 删除调度不显示——各自有"取消添加/撤销删除"）
      if (removableFromRepo(row.code)) {
        items.push({ sep: true });
        // 从版本库移除
        items.push({ icon: <IconClean />, label: t('fs.act.removeFromRepo'), cmd: cmdOfRepo(s.repoType, 'remove_keep', { paths: row.rel }), action: () => s.onAction('delete', [row.rel], true) });
      }
    } else {
      // 未版本化目录：只能添加/忽略/磁盘删除（无历史/无 diff/无忽略设置——不在版本管理里）
      // 添加到版本库
      items.push({ icon: <IconPlus />, label: t('fs.act.addToRepo'), cmd: cmdOfRepo(s.repoType, 'add', { paths: row.rel }), action: () => s.onAction('add', [row.rel]) });
      items.push({
        icon: <IconIgnore />,
        // 加入忽略…
        label: t('fs.act.addIgnore'),
        cmd: cmdOfRepo(s.repoType, 'ignore_add', { path: row.rel, pattern: '…' }),
        // svn 的忽略是 svn:ignore 属性（设在目录上、提交后随仓库分发），没有 git 那三档去向；
        // 摆出来等于把 git 的机制硬塞给 svn（用户实报"svn 有这个功能吗"）——svn 直接进确认弹窗
        submenu: s.repoType === 'git' ? [
          // 写入仓库 .gitignore——随仓库分发，其他用户拉取后同样被忽略（适合项目通用内容）
          { icon: <IconIgnore />, label: '.gitignore', cmd: cmdOfRepo(s.repoType, 'ignore_add', { pattern: row.name }), title: t('fs.menu.ignoreGitignoreTitle'), action: () => { s.setIgnoreTarget('gitignore'); s.ignoreFile(row); } },
          // 写入全局忽略——仅本机生效、所有仓库统一，绝不随仓库分发（适合 record.md 等私人文件）
          { icon: <IconIgnore />, label: '~/.gitignore_global', cmd: cmdOfRepo(s.repoType, 'ignore_add_global', { pattern: row.name }), title: t('fs.menu.ignoreGlobalTitle'), action: () => { s.setIgnoreTarget('global'); s.ignoreFile(row); } },
          // 写入仓库本地 exclude——仅本机、仅本仓库，绝不随仓库分发（适合本地测试数据）
          { icon: <IconIgnore />, label: '.git/info/exclude', cmd: cmdOfRepo(s.repoType, 'ignore_add_exclude', { pattern: row.name }), title: t('fs.menu.ignoreExcludeTitle'), action: () => { s.setIgnoreTarget('exclude'); s.ignoreFile(row); } },
        ] : undefined,
        action: s.repoType === 'git' ? undefined : () => s.ignoreFile(row),
      });
      items.push(renameItem(row.code, s.repoType, row.rel, true, s.onAction, s.startRename));
      // 删除磁盘文件 / 从磁盘永久删除该目录，不可恢复（不影响版本库）
      items.push({ icon: <IconClean />, label: t('fs.act.deleteDisk'), danger: true, title: t('fs.menu.deleteDirDiskTitle'), action: () => s.onAction('fs-delete', [row.rel]) });
      // 常用文件夹（仅 svn：git 加载快无需预加载）
      if (s.repoType === 'svn') {
        if (s.favs.some((f) => f.path === row.rel)) {
          // 已加入常用文件夹（点击移除）
          items.push({ icon: <IconStar />, label: t('fs.act.favAdded'), action: () => s.removeFav(row.rel) });
        } else if (!s.favs.some((f) => row.rel.startsWith(f.path + '/'))) {
          // 加入常用文件夹
          items.push({ icon: <IconStar />, label: t('fs.act.favAdd'), action: () => s.addFavDir(row.rel) });
        }
      }
    }
  } else {
    // 文件
    if (row.code === 'I') {
      // 取消忽略
      items.push({ icon: <IconEyeOff />, label: t('fs.act.unignore'), action: () => s.setUnignoreAsk({ rel: row.rel, name: row.name, isDir: false }) });
      items.push(renameItem(row.code, s.repoType, row.rel, false, s.onAction, s.startRename));
      if (s.repoType === 'git') {
        items.push({ sep: true });
        // 删除磁盘文件 / 从磁盘永久删除该文件，不可恢复（不影响版本库）
        items.push({ icon: <IconClean />, label: t('fs.act.deleteDisk'), danger: true, title: t('fs.menu.deleteFileDiskTitle'), action: () => s.onAction('fs-delete', [row.rel]) });
      }
      items.push({ sep: true });
      // 查看内容
      items.push({ icon: <IconFile />, label: t('fs.act.viewContent'), action: () => void s.openFile(row.name, row.code, row.rel) });
    } else {
      // 查看差异
      if (row.code && row.code !== '?') items.push({ icon: <IconDiff />, label: t('fs.act.viewDiff'), cmd: cmdOfRepo(s.repoType, 'diff', { path: row.rel }), action: () => s.onDiff(row.rel) });
      if (row.code === '?') {
        // 添加到版本库
        items.push({ icon: <IconPlus />, label: t('fs.act.addToRepo'), cmd: cmdOfRepo(s.repoType, 'add', { paths: row.rel }), action: () => s.onAction('add', [row.rel]) });
        items.push({
          icon: <IconIgnore />,
          // 加入忽略…
          label: t('fs.act.addIgnore'),
          cmd: cmdOfRepo(s.repoType, 'ignore_add', { path: row.rel, pattern: '…' }),
          // svn 只有 svn:ignore 一种写法（同未版本化目录分支，见上）
          submenu: s.repoType === 'git' ? [
            // 写入仓库 .gitignore——随仓库分发，其他用户拉取后同样被忽略（适合项目通用内容）
            { icon: <IconIgnore />, label: '.gitignore', cmd: cmdOfRepo(s.repoType, 'ignore_add', { pattern: row.name }), title: t('fs.menu.ignoreGitignoreTitle'), action: () => { s.setIgnoreTarget('gitignore'); s.ignoreFile(row); } },
            // 写入全局忽略——仅本机生效、所有仓库统一，绝不随仓库分发（适合 record.md 等私人文件）
            { icon: <IconIgnore />, label: '~/.gitignore_global', cmd: cmdOfRepo(s.repoType, 'ignore_add_global', { pattern: row.name }), title: t('fs.menu.ignoreGlobalTitle'), action: () => { s.setIgnoreTarget('global'); s.ignoreFile(row); } },
            // 写入仓库本地 exclude——仅本机、仅本仓库，绝不随仓库分发（适合本地测试数据）
            { icon: <IconIgnore />, label: '.git/info/exclude', cmd: cmdOfRepo(s.repoType, 'ignore_add_exclude', { pattern: row.name }), title: t('fs.menu.ignoreExcludeTitle'), action: () => { s.setIgnoreTarget('exclude'); s.ignoreFile(row); } },
          ] : undefined,
          action: s.repoType === 'git' ? undefined : () => s.ignoreFile(row),
        });
        // 删除磁盘文件 / 从磁盘永久删除该文件，不可恢复（不影响版本库）
        items.push({ icon: <IconClean />, label: t('fs.act.deleteDisk'), danger: true, title: t('fs.menu.deleteFileDiskTitle'), action: () => s.onAction('fs-delete', [row.rel]) });
      } else {
        const modified = row.code === 'M' || row.code === 'A' || row.code === 'D' || row.code === 'R' || row.code === 'C';
        if (modified) {
          items.push({ sep: true });
          // 提交此文件
          items.push({ icon: <IconUpload />, label: t('fs.act.commitThisFile'), cmd: cmdOfRepo(s.repoType, 'commit', { msg: '…' }), action: () => s.onAction('commit', [row.rel]) });
          items.push({ icon: <IconRevert />, label: revertName(row.code).label, title: revertName(row.code).title || undefined, cmd: cmdOfRepo(s.repoType, 'revert', { paths: row.rel }), action: () => s.onAction('revert', [row.rel]) });
        }
        // 有版本库内容且非调度中（非 '!' 缺失；A 添加/D 删除调度不显示——各自有"取消添加/撤销删除"）
        if (removableFromRepo(row.code)) {
          items.push({ sep: true });
          // 从版本库移除
          items.push({ icon: <IconClean />, label: t('fs.act.removeFromRepo'), cmd: cmdOfRepo(s.repoType, 'remove_keep', { paths: row.rel }), action: () => s.onAction('delete', [row.rel], true) });
        }
      }
      items.push({ sep: true });
      // M/C（已修改/冲突）文件的「查看内容」与「查看差异」同路（openFile 对有状态文件直接进 diff），不重复显示
      // 查看内容
      if (row.code !== 'M' && row.code !== 'C') items.push({ icon: <IconFile />, label: t('fs.act.viewContent'), action: () => void s.openFile(row.name, row.code, row.rel) });
      // 未版本化(?) 与已添加(A,尚未提交过) 的文件没有历史记录 → 不显示"查看历史"
      // 查看历史
      if (row.code !== '?' && row.code !== 'A') items.push({ icon: <IconHistory />, label: t('fs.act.viewHistory'), cmd: cmdOfRepo(s.repoType, 'view_history', { path: row.rel }), action: () => s.viewHistory(row.rel, ev) });
      if (renameableCode(row.code)) items.push(renameItem(row.code, s.repoType, row.rel, false, s.onAction, s.startRename));
      if (s.repoType === 'svn' && row.code !== '?' && row.code !== 'A') {
        items.push({ sep: true });
        // 锁定
        items.push({ icon: <IconLock />, label: t('fs.act.lock'), action: () => s.svnLock(row.rel, 'lock') });
        // 解锁
        items.push({ icon: <IconUnlock />, label: t('fs.act.unlock'), action: () => s.svnLock(row.rel, 'unlock') });
      }
      // md 文件：可注入文件说明（自定义模块索引）
      if (row.name.toLowerCase().endsWith('.md')) {
        items.push({ sep: true });
        items.push({
          icon: <IconFile />,
          // 注入文件说明…
          label: t('fs.act.injectDesc'),
          // 解析此 md 的「路径 ← 描述」树图/表格，在文件名旁显示说明；仅作用于当前浏览目录及子树，重新注入可更新
          title: t('fs.menu.injectDescTitle'),
          action: () => s.setModuleIndexModal({ md: row.rel }),
        });
      }
    }
  }
  // 打开方式：只对**磁盘上真实存在的文件**提供 ——
  //   目录没有"用某个程序打开"这回事（该走「打开文件管理器」）；
  //   缺失条目（'!'）磁盘上根本没文件，打开必然失败
  if (!row.isDir && row.code !== '!') {
    items.push({ sep: true });
    const ext = row.name.split('.').pop()!.toLowerCase();
    // 先 push 占位项，程序列表异步取回后按 owIdx 回填它的 submenu。
    // 不能省这一步：组件端要校验 items[owIdx].label === '打开方式…' 才回填，没有占位项就整个静默丢弃
    // （历史上抽出 fileSystem/ 时漏掉过，导致菜单里根本没有这一项）
    items.push({
      icon: <IconExternal />,
      // 打开方式…
      label: t('fs.act.openWith'),
      // 正在检测系统程序…
      submenu: [{ label: t('fs.menu.detectingApps'), action: () => {} }],
    });
    const owIdx = items.length - 1;
    void get
      .appsFor(ext)
      .then((r) => {
        const subs: CtxMenuItem[] = [
          ...(r.apps ?? []).slice(0, 5).map((a) => ({
            label: a.name,
            icon: <AppIcon icon={a.icon} />,
            action: () => {
              void post
                .openWith(row.rel, a.exec)
                // 已打开
                .then((x) => s.onToast(x.message ?? t('fs.menu.opened'), !x.ok))
                // 打开失败: {msg}
                .catch((er: Error) => s.onToast(t('fs.menu.openFailed', { msg: er.message }), true));
            },
          })),
          ...(r.chooseOpen
            ? [
                {
                  // 选择其他应用…
                  label: t('fs.menu.chooseApp'),
                  icon: <IconExternal />,
                  action: () => {
                    void post
                      .openWith(row.rel, r.chooseOpen!)
                      // 已打开
                      .then((x) => s.onToast(x.message ?? t('fs.menu.opened'), !x.ok))
                      // 打开失败: {msg}
                      .catch((er: Error) => s.onToast(t('fs.menu.openFailed', { msg: er.message }), true));
                  },
                },
              ]
            : []),
        ];
        // 菜单可能已被关闭（用户快速点走）：由组件端安全补丁
        // 无
        s.menuPatchItems(owIdx, subs.length ? subs : [{ label: t('fs.menu.none'), action: () => {} }]);
      })
      .catch(() => {
        // 取程序列表失败（接口异常/超时）：别让它永远停在「正在检测系统程序…」
        // 无
        s.menuPatchItems(owIdx, [{ label: t('fs.menu.none'), action: () => {} }]);
      });
  }
  // 剪贴板搬运（所有条目都有，含树冲突/缺失行——复制走的是磁盘路径，与版本库状态无关）；
  // 目录额外能当粘贴落点。放在尾部分组，与「复制完整路径」这类路径工具在一起
  items.push({ sep: true });
  items.push(...clipItems([row], s));
  if (row.isDir) items.push(...pasteItem(s, row.rel));
  items.push({
    icon: <IconCopy />,
    // 复制完整路径
    label: t('fs.act.copyPath'),
    action: () => {
      const abs = s.root ? `${s.root}/${row.rel}` : row.rel;
      // 完整路径已复制
      void navigator.clipboard?.writeText(abs).then(() => s.onToast(t('fs.menu.pathCopied')));
    },
  });
  items.push({
    icon: <IconFile />,
    // 复制文件名
    label: t('fs.act.copyName'),
    action: () => {
      // 文件名已复制
      void navigator.clipboard?.writeText(row.name).then(() => s.onToast(t('fs.menu.nameCopied')));
    },
  });
  return items;
}
