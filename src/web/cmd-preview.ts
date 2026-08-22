/** 操作命令预览：悬浮操作项时显示"该操作将执行的命令"（教学/透明层）。
 * 命令为语义格式（省略 -c core.quotepath 等内部标志,保留操作类型与真实参数）；
 * 占位符 %key% 由 vars 替换,未提供保持原样。 */

export type CmdVars = Record<string, string>;

export function cmdOf(tpl: string, vars: CmdVars = {}): string {
  return tpl.replace(/%(\w+)%/g, (m, k) => vars[k] ?? m);
}

/** 命令模板表：key → 命令模板 */
export const CMDS: Record<string, string> = {
  // ---------------- Git ----------------
  g_view_history: 'git log -- %path%',
  g_diff: 'git diff HEAD -- %path%',
  g_diff_versions: 'git diff %a% %b% -- %path%',
  g_add: 'git add %paths%',
  g_commit: 'git commit -m "%msg%"',
  g_update: 'git pull',
  g_push: 'git push',
  g_revert: 'git checkout -- %paths%',
  g_delete: 'git rm -r %paths%',
  g_remove_keep: 'git rm --cached -r %paths%',
  g_branch_list: 'git branch -a',
  g_branch_create: 'git branch %name%',
  g_branch_switch: 'git checkout %name%',
  g_branch_merge: 'git merge %name%',
  g_branch_delete: 'git branch -d %name%',
  g_tag_create: 'git tag -a %name% -m "%msg%"',
  g_tag_delete: 'git tag -d %name%',
  g_stash_push: 'git stash push -u -m "%msg%"',
  g_stash_pop: 'git stash pop stash@{%index%}',
  g_stash_drop: 'git stash drop stash@{%index%}',
  g_reword: 'git rebase -i（重写提交注释）',
  g_reset_soft: 'git reset --soft HEAD~',
  g_amend: 'git commit --amend',
  g_clean: 'git clean -f',
  g_init: 'git init %dir%',
  g_clone: 'git clone %url% %dir%',
  s_create: 'svnadmin create %dir% + svn mkdir trunk/branches/tags + svn checkout（检出 trunk 为工作副本）',
  g_ignore_add: '写入 .gitignore：%pattern%',
  g_resolve_ours: 'git checkout --ours %path%',
  g_resolve_theirs: 'git checkout --theirs %path%',
  g_resolve_manual: 'git add %path%（标记已解决后提交）',
  g_set_remote: 'git remote set-url origin %url%',
  // ---------------- SVN ----------------
  s_view_history: 'svn log --xml -l 200 %path%',
  s_diff: 'svn diff %path%',
  s_add: 'svn add --parents %paths%',
  s_commit: 'svn commit -m "%msg%"',
  s_update: 'svn update %path%',
  s_revert: 'svn revert %paths%',
  s_delete: 'svn delete %paths%',
  s_remove_keep: 'svn delete --keep-local %paths%',
  s_branch_create: 'svn copy ^/trunk ^/branches/%name%',
  s_branch_switch: 'svn switch %branch%',
  s_branch_merge: 'svn merge ^/branches/%name%',
  s_branch_delete: 'svn delete ^/branches/%name%',
  s_tag_create: 'svn copy ^/trunk ^/tags/%name%',
  s_tag_delete: 'svn delete ^/tags/%name%',
  s_cleanup: 'svn cleanup',
  s_lock: 'svn lock %path%',
  s_unlock: 'svn unlock %path%',
  s_resolve_ours: 'svn resolve --accept mine-full %path%',
  s_resolve_theirs: 'svn resolve --accept theirs-full %path%',
  s_resolve_manual: 'svn resolve --accept working %path%',

  s_ignore_add: 'svn propset svn:ignore "%pattern%" %path%',
};

/** 按仓库类型前缀取模板（git→g_*, svn→s_*）；未知返回 undefined */
export function cmdKey(repoType: 'git' | 'svn' | null, base: string): string | undefined {
  if (!repoType) return undefined;
  const k = (repoType === 'git' ? 'g_' : 's_') + base;
  return CMDS[k] ? k : undefined;
}

/** 便捷：由类型+base+变量生成命令文本 */
export function cmdOfRepo(repoType: 'git' | 'svn' | null, base: string, vars: CmdVars = {}): string | undefined {
  const k = cmdKey(repoType, base);
  return k ? cmdOf(CMDS[k]!, vars) : undefined;
}
