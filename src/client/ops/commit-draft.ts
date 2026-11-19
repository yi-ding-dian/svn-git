/** 提交注释草稿（按项目根隔离）：写一半关掉/取消弹窗不丢，提交成功才由调用方清除。
 *  key 带项目根——多项目/团队共用的工作副本之间不串草稿。 */
const KEY = (root: string) => `svngit-commit-draft:${root}`;

export function loadCommitDraft(root: string): string {
  try {
    return localStorage.getItem(KEY(root)) ?? '';
  } catch {
    return '';
  }
}

export function saveCommitDraft(root: string, text: string): void {
  try {
    // 清空输入框 = 用户主动放弃（或提交成功后父级清空），草稿一并删掉
    if (text.trim()) localStorage.setItem(KEY(root), text);
    else localStorage.removeItem(KEY(root));
  } catch {
    /* 隐私模式等：草稿功能静默失效 */
  }
}

export function clearCommitDraft(root: string): void {
  try {
    localStorage.removeItem(KEY(root));
  } catch {
    /* 同上 */
  }
}
