/** 文件夹视图右键菜单构建（fs 拆分批次 1）：空菜单/多选菜单/行菜单 三项 builder，
 * 事件状态（选中/锁定/定位）由 index.tsx 处理，本模块只管「items 数组生成」。 */
import React from 'react';
import { get, post } from '../api.js';
import { cmdOfRepo } from '../cmd-preview.js';
import { IconDownload, IconUpload, IconHistory, IconCopy, IconFolder, IconPlus, IconRevert, IconClean, IconDiff, IconFile, IconIgnore, IconEyeOff, IconExternal, IconLock, IconUnlock, IconStar } from '../ui/icons.js';
import type { CtxMenuItem } from '../ui/context-menu.js';
import { multiRevertName, removableFromRepo, renameableCode, renameItem, joinPaths, revertName, type Mode, type VisibleRow } from './utils.js';

/** 「打开方式」程序图标：/api/icon 按 .desktop Icon 名查系统图标,缺失/失败回退通用文件图标 */
function AppIcon({ icon }: { icon: string }) {
  const [err, setErr] = React.useState(false);
  if (!icon || err) return <IconFile />;
  return (
    <img
      src={`/api/icon?k=${encodeURIComponent(icon)}`}
      alt=""
      width={16}
      height={16}
      style={{ objectFit: 'contain' }}
      onError={() => setErr(true)}
    />
  );
}

/** 菜单需要的组件侧服务（index.tsx 组装传入；菜单项动作绕过 UI 状态直接回组件回调） */
export interface MenuServices {
  repoType: 'svn' | 'git';
  dir: string;
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
  onToast: (m: string) => void;
  openInFm: (dir: string) => void;
  removeFav: (rel: string) => void;
  addFavDir: (rel: string) => void;
  /** openWith 异步取到程序列表后替换菜单第 owIdx 项的子菜单 */
  menuPatchItems: (owIdx: number, subs: CtxMenuItem[]) => void;
}

/** 空白区右键菜单 */
export function buildBlankItems(s: MenuServices): CtxMenuItem[] {
  const items: CtxMenuItem[] = [
    { icon: <IconDownload />, label: s.repoType === 'git' ? '更新仓库' : '更新当前目录', cmd: cmdOfRepo(s.repoType, 'update', { path: s.dir }), action: () => s.onUpdateDir(s.dir) },
    { icon: <IconUpload />, label: '提交修改的文件…', cmd: cmdOfRepo(s.repoType, 'commit', { msg: '…' }), action: () => s.onCommitSelect(s.dir, s.dir) },
    { icon: <IconHistory />, label: '查看历史记录', cmd: cmdOfRepo(s.repoType, 'view_history', { path: s.dir || '.' }), action: () => s.onLog(s.dir) },
    {
      icon: <IconCopy />,
      label: '复制当前路径',
      action: () => {
        const abs = s.root ? `${s.root}${s.dir ? `/${s.dir}` : ''}` : s.dir;
        void navigator.clipboard?.writeText(abs).then(() => s.onToast('当前路径已复制'));
      },
    },
    { icon: <IconFolder />, label: '打开文件管理器', action: () => s.openInFm(s.dir) },
  ];
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
      label: `${tcAllAdd ? '接受服务器的删除' : '还原'}（解决树冲突）（${tTc.length} 项）`,
      title: tcAllAdd
        ? '服务器上这些路径已删除或移动。接受后本地文件会一并删除（与服务器保持一致，本地未提交的改动不可恢复），之后即可正常提交'
        : '服务器上这些路径已删除或移动。放弃本地改动＝回到版本库内容（svn revert -R，本地改动不可恢复），随后更新即可同步服务器的删除',
      cmd: cmdOfRepo(s.repoType, 'revert', { paths: joinPaths(tTc.map((x) => x.rel)) }),
      action: () => s.onAction('revert', tTc.map((x) => x.rel)),
    });
    items.push({ sep: true });
  }
  if (tNew.length) {
    items.push({ icon: <IconPlus />, label: `添加到版本库（${tNew.length} 项）`, cmd: cmdOfRepo(s.repoType, 'add', { paths: joinPaths(tNew.map((x) => x.rel)) }), action: () => s.onAction('add', tNew.map((x) => x.rel)) });
  }
  if (tMiss.length) {
    // 缺失条目（磁盘已删）：与单选菜单对称——全部还原 或 从版本库删除（有意删除补录到版本库）
    items.push({
      icon: <IconRevert />,
      label: `还原（${tMiss.length} 项）`,
      title: `${tMiss.length} 项已在磁盘上缺失，全部还原从版本库恢复（${s.repoType === 'svn' ? 'svn revert' : 'git checkout'}）`,
      cmd: cmdOfRepo(s.repoType, 'revert', { paths: joinPaths(tMiss.map((x) => x.rel)) }),
      action: () => s.onAction('revert', tMiss.map((x) => x.rel)),
    });
    items.push({
      icon: <IconClean />,
      label: `从版本库删除（${tMiss.length} 项）`,
      title: `${tMiss.length} 项已在磁盘上缺失；从版本库移除记录（提交后生效，提交前可「还原」取消）`,
      cmd: cmdOfRepo(s.repoType, 'remove_keep', { paths: joinPaths(tMiss.map((x) => x.rel)) }),
      action: () => s.onAction('delete', tMiss.map((x) => x.rel), true),
    });
  }
  if (tMod.length) {
    items.push({
      icon: <IconUpload />,
      label: `提交修改（${tMod.length} 项${tTc.length ? `，已排除 ${tTc.length} 项树冲突` : ''}）…`,
      title: tTc.length ? `已排除选中的 ${tTc.length} 项树冲突——它们提交会被服务器拒绝，先用上方「放弃本地添加」处理` : undefined,
      cmd: cmdOfRepo(s.repoType, 'commit', { msg: '…' }),
      action: () => s.onAction('commit', tMod.map((x) => x.rel)),
    });
    const rv = multiRevertName(tMod.map((x) => x.code), tMod.length);
    items.push({ icon: <IconRevert />, label: rv.label, title: rv.title, cmd: cmdOfRepo(s.repoType, 'revert', { paths: joinPaths(tMod.map((x) => x.rel)) }), action: () => s.onAction('revert', tMod.map((x) => x.rel)) });
  }
  if (tVer.length) {
    items.push({ icon: <IconClean />, label: `从版本库移除（${tVer.length} 项）`, cmd: cmdOfRepo(s.repoType, 'remove_keep', { paths: joinPaths(tVer.map((x) => x.rel)) }), action: () => s.onAction('delete', tVer.map((x) => x.rel), true) });
  }
  if (tFsDel.length) {
    items.push({
      icon: <IconClean />,
      label: `删除磁盘文件（${tFsDel.length} 项）`,
      danger: true,
      title: `从磁盘永久删除 ${tFsDel.length} 项（不在版本库中的文件），不可恢复，不影响版本库`,
      action: () => s.onAction('fs-delete', tFsDel.map((x) => x.rel)),
    });
  }
  if (tNew.length || tMiss.length || tMod.length || tVer.length || tFsDel.length) items.push({ sep: true });
  items.push({
    icon: <IconCopy />,
    label: `复制完整路径（${tArr.length} 项）`,
    action: () => {
      const abs = s.root ? tArr.map((x) => `${s.root}/${x.rel}`).join('\n') : tArr.map((x) => x.rel).join('\n');
      void navigator.clipboard?.writeText(abs).then(() => s.onToast(`已复制 ${tArr.length} 个完整路径`));
    },
  });
  return items;
}

/** 单选行右键菜单（ev 传入以便"查看历史"使用点击坐标提示无记录） */
export function buildRowItems(t: { isDir: boolean; code: string; rel: string; name: string; treeConflicted?: boolean; codes?: string[] }, ev: React.MouseEvent, s: MenuServices): CtxMenuItem[] {
  const items: CtxMenuItem[] = [];
  // 树冲突项走**精简菜单**：常规项对它们要么危险要么无效——
  //   提交此目录修改：含树冲突的路径提交必被服务器拒绝（死路）
  //   更新此目录：实测无效（冲突标记原样保留、磁盘文件也不动，什么都解决不了）
  //   从版本库移除：与"接受服务器的删除"语义重复，且对"已添加"项不适用
  //   重命名 / 忽略设置 / 加入常用文件夹：冲突状态下没有实际意义
  // 所以下面那一大块常规分支整个跳过（改成 else if 链），只留解决入口 + 查看历史，
  // 再落到尾部的公共工具项（打开方式 / 复制完整路径 / 复制文件名）。
  if (t.treeConflicted && s.repoType === 'svn') {
    // 本地是 added（含磁盘已缺失的 '!' —— 那类在 SVN 记录里同样是 added 调度）→ 接受的是"服务器的删除"。
    // 目录的 code 会被子项状态聚合改写（gRPC_src 自身 A、因子项有 M 而显示成 M），
    // 所以要看 codes 集合里有没有 A，不能只看 code。
    const localAdd = t.code === '!' || t.codes?.includes('A') === true;
    items.push({
      icon: <IconRevert />,
      label: localAdd ? '接受服务器的删除（解决树冲突）' : '还原（解决树冲突）',
      title: localAdd
        ? // **树冲突的"已添加"和普通"已添加"行为不同**（实测复现过）：普通 added 目录 revert 只是取消登记、
          // 文件留在磁盘；树冲突项还要把服务器那个"删除"落下来，**本地文件会一并被删**（与服务器保持一致）。
          // 标签叫"接受服务器的删除"而不是"放弃本地添加"——后者字面暗示文件还在，会误导
          '服务器上该路径已删除或移动。接受后本地文件会一并删除（与服务器保持一致，本地未提交的改动不可恢复），之后即可正常提交'
        : '服务器上该路径已删除或移动。放弃本地修改＝文件回到版本库内容（svn revert -R，本地改动不可恢复），随后更新即可同步服务器的删除',
      cmd: cmdOfRepo(s.repoType, 'revert', { paths: t.rel }),
      action: () => s.onAction('revert', [t.rel]),
    });
    items.push({ sep: true });
    // 查看历史：判断"服务器删得对不对"最直接的依据（谁删的、为什么删）
    items.push({ icon: <IconHistory />, label: '查看历史', cmd: cmdOfRepo(s.repoType, 'view_history', { path: t.rel }), action: () => s.viewHistory(t.rel, ev) });
    items.push({ sep: true });
  } else if (t.code === '!') {
  // 缺失条目（'!' = 磁盘已删除但版本库还在）：磁盘无文件——只提供还原/历史/复制路径等有效操作；
  // 查看内容/差异/提交/从版本库移除/打开方式对缺失文件无意义（还原复用现有 revert：svn revert / git checkout HEAD）
    items.push({
      icon: <IconRevert />,
      label: '还原',
      title: `${t.isDir ? '目录' : '文件'}已在磁盘上缺失，还原从版本库恢复（${s.repoType === 'svn' ? 'svn revert' : 'git checkout'}）`,
      cmd: cmdOfRepo(s.repoType, 'revert', { paths: t.rel }),
      action: () => s.onAction('revert', [t.rel]),
    });
    // 自己有意删除（没走"从版本库移除"）：把删除补录到版本库（提交后生效；提交前可「还原」改主意）
    items.push({
      icon: <IconClean />,
      label: '从版本库删除',
      title: `${t.isDir ? '目录' : '文件'}已在磁盘上缺失；从版本库移除记录（提交后生效，提交前可「还原」取消）`,
      cmd: cmdOfRepo(s.repoType, 'remove_keep', { paths: t.rel }),
      action: () => s.onAction('delete', [t.rel], true),
    });
    items.push({ icon: <IconHistory />, label: '查看历史', cmd: cmdOfRepo(s.repoType, 'view_history', { path: t.rel }), action: () => s.viewHistory(t.rel, ev) });
    items.push({ sep: true });
    items.push({
      icon: <IconCopy />,
      label: '复制完整路径',
      action: () => {
        const abs = s.root ? `${s.root}/${t.rel}` : t.rel;
        void navigator.clipboard?.writeText(abs).then(() => s.onToast('完整路径已复制'));
      },
    });
    items.push({
      icon: <IconFile />,
      label: '复制文件名',
      action: () => {
        void navigator.clipboard?.writeText(t.name).then(() => s.onToast('文件名已复制'));
      },
    });
    return items;
  } else if (t.isDir) {
    if (t.code === 'I') {
      // 忽略目录：无版本操作（更新/提交/还原/历史均无意义），仅忽略设置/取消忽略/删除(git 可磁盘删)
      items.push({ icon: <IconIgnore />, label: '忽略设置…', action: () => s.setIgnoreModal({ dir: t.rel }) });
      items.push({ icon: <IconEyeOff />, label: '取消忽略', action: () => s.setUnignoreAsk({ rel: t.rel, name: t.name, isDir: true }) });
      items.push(renameItem(t.code, s.repoType, t.rel, true, s.onAction));
      if (s.repoType === 'git') {
        items.push({ sep: true });
        items.push({ icon: <IconClean />, label: '删除磁盘文件', danger: true, title: '从磁盘永久删除该目录，不可恢复（不影响版本库）', action: () => s.onAction('fs-delete', [t.rel]) });
      }
    } else if (t.code !== '?') {
      // 版本化目录：更新/提交/还原/历史/忽略设置/删除（无 diff）
      items.push({ icon: <IconDownload />, label: s.repoType === 'git' ? '更新仓库' : '更新此目录', cmd: cmdOfRepo(s.repoType, 'update', { path: t.rel }), action: () => s.onUpdateDir(t.rel) });
      if (t.code) {
        items.push({ icon: <IconUpload />, label: '提交此目录修改…', cmd: cmdOfRepo(s.repoType, 'commit', { msg: '…' }), action: () => s.onCommitSelect(t.rel, t.rel) });
        items.push({ sep: true });
        items.push({ icon: <IconRevert />, label: `${revertName(t.code, '目录').label}`, title: revertName(t.code, '').title || undefined, cmd: cmdOfRepo(s.repoType, 'revert', { paths: t.rel }), action: () => s.onAction('revert', [t.rel]) });
      }
      items.push({ sep: true });
      if (t.code !== 'A') items.push({ icon: <IconHistory />, label: '查看历史', cmd: cmdOfRepo(s.repoType, 'view_history', { path: t.rel }), action: () => s.viewHistory(t.rel, ev) });
      if (renameableCode(t.code)) items.push(renameItem(t.code, s.repoType, t.rel, true, s.onAction));
      items.push({ icon: <IconIgnore />, label: '忽略设置…', cmd: cmdOfRepo(s.repoType, 'ignore_add', { path: t.rel, pattern: '…' }), action: () => s.setIgnoreModal({ dir: t.rel }) });
      // 常用文件夹（仅 svn：git 加载快无需预加载）：自身已加入显示移除；父目录已加入则不再显示；其余显示加入
      if (s.repoType === 'svn') {
        if (s.favs.some((f) => f.path === t.rel)) {
          items.push({ icon: <IconStar />, label: '已加入常用文件夹（点击移除）', action: () => s.removeFav(t.rel) });
        } else if (!s.favs.some((f) => t.rel.startsWith(f.path + '/'))) {
          items.push({ icon: <IconStar />, label: '加入常用文件夹', action: () => s.addFavDir(t.rel) });
        }
      }
      // 有版本库内容且非调度中（非 '!' 缺失；A 添加/D 删除调度不显示——各自有"取消添加/撤销删除"）
      if (removableFromRepo(t.code)) {
        items.push({ sep: true });
        items.push({ icon: <IconClean />, label: '从版本库移除', cmd: cmdOfRepo(s.repoType, 'remove_keep', { paths: t.rel }), action: () => s.onAction('delete', [t.rel], true) });
      }
    } else {
      // 未版本化目录：只能添加/忽略/磁盘删除（无历史/无 diff/无忽略设置——不在版本管理里）
      items.push({ icon: <IconPlus />, label: '添加到版本库', cmd: cmdOfRepo(s.repoType, 'add', { paths: t.rel }), action: () => s.onAction('add', [t.rel]) });
      items.push({
        icon: <IconIgnore />,
        label: '加入忽略…',
        cmd: cmdOfRepo(s.repoType, 'ignore_add', { path: t.rel, pattern: '…' }),
        // svn 的忽略是 svn:ignore 属性（设在目录上、提交后随仓库分发），没有 git 那三档去向；
        // 摆出来等于把 git 的机制硬塞给 svn（用户实报"svn 有这个功能吗"）——svn 直接进确认弹窗
        submenu: s.repoType === 'git' ? [
          { icon: <IconIgnore />, label: '.gitignore', cmd: cmdOfRepo(s.repoType, 'ignore_add', { pattern: t.name }), title: '写入仓库 .gitignore——随仓库分发，其他用户拉取后同样被忽略（适合项目通用内容）', action: () => { s.setIgnoreTarget('gitignore'); s.ignoreFile(t); } },
          { icon: <IconIgnore />, label: '~/.gitignore_global', cmd: cmdOfRepo(s.repoType, 'ignore_add_global', { pattern: t.name }), title: '写入全局忽略——仅本机生效、所有仓库统一，绝不随仓库分发（适合 record.md 等私人文件）', action: () => { s.setIgnoreTarget('global'); s.ignoreFile(t); } },
          { icon: <IconIgnore />, label: '.git/info/exclude', cmd: cmdOfRepo(s.repoType, 'ignore_add_exclude', { pattern: t.name }), title: '写入仓库本地 exclude——仅本机、仅本仓库，绝不随仓库分发（适合本地测试数据）', action: () => { s.setIgnoreTarget('exclude'); s.ignoreFile(t); } },
        ] : undefined,
        action: s.repoType === 'git' ? undefined : () => s.ignoreFile(t),
      });
      items.push(renameItem(t.code, s.repoType, t.rel, true, s.onAction));
      items.push({ icon: <IconClean />, label: '删除磁盘文件', danger: true, title: '从磁盘永久删除该目录，不可恢复（不影响版本库）', action: () => s.onAction('fs-delete', [t.rel]) });
      // 常用文件夹（仅 svn：git 加载快无需预加载）
      if (s.repoType === 'svn') {
        if (s.favs.some((f) => f.path === t.rel)) {
          items.push({ icon: <IconStar />, label: '已加入常用文件夹（点击移除）', action: () => s.removeFav(t.rel) });
        } else if (!s.favs.some((f) => t.rel.startsWith(f.path + '/'))) {
          items.push({ icon: <IconStar />, label: '加入常用文件夹', action: () => s.addFavDir(t.rel) });
        }
      }
    }
  } else {
    // 文件
    if (t.code === 'I') {
      items.push({ icon: <IconEyeOff />, label: '取消忽略', action: () => s.setUnignoreAsk({ rel: t.rel, name: t.name, isDir: false }) });
      items.push(renameItem(t.code, s.repoType, t.rel, false, s.onAction));
      if (s.repoType === 'git') {
        items.push({ sep: true });
        items.push({ icon: <IconClean />, label: '删除磁盘文件', danger: true, title: '从磁盘永久删除该文件，不可恢复（不影响版本库）', action: () => s.onAction('fs-delete', [t.rel]) });
      }
      items.push({ sep: true });
      items.push({ icon: <IconFile />, label: '查看内容', action: () => void s.openFile(t.name, t.code, t.rel) });
    } else {
      if (t.code && t.code !== '?') items.push({ icon: <IconDiff />, label: '查看差异', cmd: cmdOfRepo(s.repoType, 'diff', { path: t.rel }), action: () => s.onDiff(t.rel) });
      if (t.code === '?') {
        items.push({ icon: <IconPlus />, label: '添加到版本库', cmd: cmdOfRepo(s.repoType, 'add', { paths: t.rel }), action: () => s.onAction('add', [t.rel]) });
        items.push({
          icon: <IconIgnore />,
          label: '加入忽略…',
          cmd: cmdOfRepo(s.repoType, 'ignore_add', { path: t.rel, pattern: '…' }),
          // svn 只有 svn:ignore 一种写法（同未版本化目录分支，见上）
          submenu: s.repoType === 'git' ? [
            { icon: <IconIgnore />, label: '.gitignore', cmd: cmdOfRepo(s.repoType, 'ignore_add', { pattern: t.name }), title: '写入仓库 .gitignore——随仓库分发，其他用户拉取后同样被忽略（适合项目通用内容）', action: () => { s.setIgnoreTarget('gitignore'); s.ignoreFile(t); } },
            { icon: <IconIgnore />, label: '~/.gitignore_global', cmd: cmdOfRepo(s.repoType, 'ignore_add_global', { pattern: t.name }), title: '写入全局忽略——仅本机生效、所有仓库统一，绝不随仓库分发（适合 record.md 等私人文件）', action: () => { s.setIgnoreTarget('global'); s.ignoreFile(t); } },
            { icon: <IconIgnore />, label: '.git/info/exclude', cmd: cmdOfRepo(s.repoType, 'ignore_add_exclude', { pattern: t.name }), title: '写入仓库本地 exclude——仅本机、仅本仓库，绝不随仓库分发（适合本地测试数据）', action: () => { s.setIgnoreTarget('exclude'); s.ignoreFile(t); } },
          ] : undefined,
          action: s.repoType === 'git' ? undefined : () => s.ignoreFile(t),
        });
        items.push({ icon: <IconClean />, label: '删除磁盘文件', danger: true, title: '从磁盘永久删除该文件，不可恢复（不影响版本库）', action: () => s.onAction('fs-delete', [t.rel]) });
      } else {
        const modified = t.code === 'M' || t.code === 'A' || t.code === 'D' || t.code === 'R' || t.code === 'C';
        if (modified) {
          items.push({ sep: true });
          items.push({ icon: <IconUpload />, label: '提交此文件', cmd: cmdOfRepo(s.repoType, 'commit', { msg: '…' }), action: () => s.onAction('commit', [t.rel]) });
          items.push({ icon: <IconRevert />, label: revertName(t.code).label, title: revertName(t.code).title || undefined, cmd: cmdOfRepo(s.repoType, 'revert', { paths: t.rel }), action: () => s.onAction('revert', [t.rel]) });
        }
        // 有版本库内容且非调度中（非 '!' 缺失；A 添加/D 删除调度不显示——各自有"取消添加/撤销删除"）
        if (removableFromRepo(t.code)) {
          items.push({ sep: true });
          items.push({ icon: <IconClean />, label: '从版本库移除', cmd: cmdOfRepo(s.repoType, 'remove_keep', { paths: t.rel }), action: () => s.onAction('delete', [t.rel], true) });
        }
      }
      items.push({ sep: true });
      // M/C（已修改/冲突）文件的「查看内容」与「查看差异」同路（openFile 对有状态文件直接进 diff），不重复显示
      if (t.code !== 'M' && t.code !== 'C') items.push({ icon: <IconFile />, label: '查看内容', action: () => void s.openFile(t.name, t.code, t.rel) });
      // 未版本化(?) 与已添加(A,尚未提交过) 的文件没有历史记录 → 不显示"查看历史"
      if (t.code !== '?' && t.code !== 'A') items.push({ icon: <IconHistory />, label: '查看历史', cmd: cmdOfRepo(s.repoType, 'view_history', { path: t.rel }), action: () => s.viewHistory(t.rel, ev) });
      if (renameableCode(t.code)) items.push(renameItem(t.code, s.repoType, t.rel, false, s.onAction));
      if (s.repoType === 'svn' && t.code !== '?' && t.code !== 'A') {
        items.push({ sep: true });
        items.push({ icon: <IconLock />, label: '锁定', action: () => s.svnLock(t.rel, 'lock') });
        items.push({ icon: <IconUnlock />, label: '解锁', action: () => s.svnLock(t.rel, 'unlock') });
      }
      // md 文件：可注入文件说明（自定义模块索引）
      if (t.name.toLowerCase().endsWith('.md')) {
        items.push({ sep: true });
        items.push({
          icon: <IconFile />,
          label: '注入文件说明…',
          title: '解析此 md 的「路径 ← 描述」树图/表格，在文件名旁显示说明；仅作用于当前浏览目录及子树，重新注入可更新',
          action: () => s.setModuleIndexModal({ md: t.rel }),
        });
      }
    }
  }
  items.push({ sep: true });
  // 打开方式：所有文件都提供（办公文档/图片/文本/代码……二进制按扩展映射表匹配，文本类型回退 text/plain）
  {
    const ext = t.name.split('.').pop()!.toLowerCase();
    // 先 push 占位项，程序列表异步取回后按 owIdx 回填它的 submenu。
    // 不能省这一步：组件端要校验 items[owIdx].label === '打开方式…' 才回填，没有占位项就整个静默丢弃
    // （历史上抽出 fileSystem/ 时漏掉过，导致菜单里根本没有这一项）
    items.push({
      icon: <IconExternal />,
      label: '打开方式…',
      submenu: [{ label: '正在检测系统程序…', action: () => {} }],
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
                .openWith(t.rel, a.exec)
                .then((x) => s.onToast(x.message ?? '已打开'))
                .catch((er: Error) => s.onToast(`打开失败: ${er.message}`));
            },
          })),
          ...(r.chooseOpen
            ? [
                {
                  label: '选择其他应用…',
                  icon: <IconExternal />,
                  action: () => {
                    void post
                      .openWith(t.rel, r.chooseOpen!)
                      .then((x) => s.onToast(x.message ?? '已打开'))
                      .catch((er: Error) => s.onToast(`打开失败: ${er.message}`));
                  },
                },
              ]
            : []),
        ];
        // 菜单可能已被关闭（用户快速点走）：由组件端安全补丁
        s.menuPatchItems(owIdx, subs.length ? subs : [{ label: '无', action: () => {} }]);
      })
      .catch(() => {
        // 取程序列表失败（接口异常/超时）：别让它永远停在「正在检测系统程序…」
        s.menuPatchItems(owIdx, [{ label: '无', action: () => {} }]);
      });
  }
  items.push({
    icon: <IconCopy />,
    label: '复制完整路径',
    action: () => {
      const abs = s.root ? `${s.root}/${t.rel}` : t.rel;
      void navigator.clipboard?.writeText(abs).then(() => s.onToast('完整路径已复制'));
    },
  });
  items.push({
    icon: <IconFile />,
    label: '复制文件名',
    action: () => {
      void navigator.clipboard?.writeText(t.name).then(() => s.onToast('文件名已复制'));
    },
  });
  return items;
}
