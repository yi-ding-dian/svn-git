/** 提交注释清理：提交前去掉正文末尾的空白行与空列表项。
 *  编辑时自动续行会留下一个空的 `- `（用户写完最后一条没有继续输入），
 *  它不该被提交进去（否则历史/确认弹窗里会多出一个孤立的圆点）。
 *  只处理**尾部**：正文中间的段落、空行、空列表项原样保留。 */
export function cleanCommitMessage(full: string): string {
  const lines = full.replace(/\r\n/g, '\n').split('\n');
  const head = (lines.shift() ?? '').trimEnd();
  const dropTailBlank = () => {
    while (lines.length && !lines[lines.length - 1]!.trim()) lines.pop();
  };
  dropTailBlank();
  // 空的列表项（只有 - / * / 1. 标记）
  while (lines.length && /^\s*(?:[-*]|\d+\.)\s*$/.test(lines[lines.length - 1]!)) lines.pop();
  dropTailBlank();
  const body = lines.join('\n').replace(/^\n+/, '');
  return body ? `${head}\n\n${body}` : head;
}
