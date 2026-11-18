/** 状态码语义中心：git porcelain / svn status --xml / 目录聚合共用同一套统一码。
 *  只放纯数据与映射，不依赖 server / 其它 vcs 模块——两边（vcs 与 server/routes）都来引用这里。 */

/** git 未合并（冲突）状态：porcelain v1 的**两列组合**，共 7 种。
 *  注意不能按单列映射 —— `AA`（双方新增）按列拆开是 A+A，会被当成"新增"，
 *  于是 add/add、delete/delete 这类冲突在文件列表里没有 C 标、也不会进「解决冲突」列表
 *  （用户实报：add/add 冲突文件根本没出现在解决器里）。 */
export const GIT_UNMERGED = new Set(['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU']);

/** git porcelain 状态码（单列） -> 统一语义码 */
export function mapGitCode(x: string): string {
  switch (x) {
    case 'M':
    case 'T':
      return 'M';
    case 'A':
      return 'A';
    case 'D':
      return 'D';
    case '?':
      return '?';
    case 'U':
      return 'C';
    case 'R':
      return 'R';
    case 'C':
      return 'A';
    case '!':
      return '!';
    case 'I':
      return 'I';
    default:
      return ' ';
  }
}

/** svn status --xml 的 item 单词 -> 统一状态码 */
export const SVN_ITEM_MAP: Record<string, string> = {
  modified: 'M',
  added: 'A',
  deleted: 'D',
  unversioned: '?',
  missing: '!',
  conflicted: 'C',
  replaced: 'R',
  external: 'X',
  ignored: 'I',
  incomplete: '!',
  obstructed: '~',
  merged: 'M',
};

/** 目录多状态徽标显示顺序：修改 / 添加 / 删除 / 冲突 / 替换 / 缺失 / 更新 / 类型变更 */
export const CODES_ORDER = ['M', 'A', 'D', 'C', 'R', '!', 'U', '~'];
/** 目录聚合时取"最高"状态码的优先级（未版本化 ? / 外部 X 不参与升级） */
export const CODE_RANK: Record<string, number> = { C: 10, '!': 9, D: 8, M: 7, A: 6, R: 5, '~': 4, U: 3 };
