/** 英文语言包：各域包在此汇总。
 *
 *  **类型是 `Record<I18nKey, string>`：漏翻任何一条都编译不过**，这是约 1700 条文案的兜底。
 *  新增 key 必须同步补 `zh/` 侧同名域文件。
 */
import type { I18nKey } from '../zh/index.js';
import { common } from './common.js';
import { conflict } from './conflict.js';
import { fs } from './fs.js';
import { hist } from './hist.js';
import { look } from './look.js';
import { main } from './main.js';
import { ops } from './ops.js';
import { plat } from './plat.js';
import { repo } from './repo.js';
import { shell } from './shell.js';
import { srv } from './srv.js';
import { term } from './term.js';
import { ui } from './ui.js';
import { vcs } from './vcs.js';

export const en: Record<I18nKey, string> = {
  ...common,
  ...look,
  ...ui,
  ...fs,
  ...ops,
  ...repo,
  ...shell,
  ...hist,
  ...conflict,
  ...term,
  ...srv,
  ...vcs,
  ...plat,
  ...main,
};
