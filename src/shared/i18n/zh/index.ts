/** 中文语言包（**基准包**）：各域包在此汇总。
 *
 *  - `en/` 侧以 `Record<I18nKey, string>` 约束，故**漏翻任何一条都编译不过**（`npm run build` 直接报），
 *    这是约 1700 条文案不靠人眼核对的兜底。
 *  - 新增文案：找到对应域的文件加进去；域文件不存在就新建并在下方汇总。
 *  - **key 的类型由本文件推导**（`I18nKey`），故各域包必须 `as const`，否则 key 会退化成 `string`。
 *  - 按域拆分的好处：域之间互不干扰，可以并行搬运（每个域只碰自己那一对文件）。
 */
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

export const zh = {
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
} as const;

/** 全部合法 key。`t()` 只收这个联合 —— 写错 key 编译期即报错。 */
export type I18nKey = keyof typeof zh;
