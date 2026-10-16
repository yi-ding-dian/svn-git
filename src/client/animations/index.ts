/** 动画域（animations）出口：全客户端动画/特效的唯一入口。
 *  新动画按职责独立成文件（trash-fly / add-stamp / …），统一从这里导出；
 *  调用方只 import 本文件，不深入各模块路径。 */
export { launchMagicFlight } from './magic-flight.js';
export type { FlightTarget } from './magic-flight.js';
export { flashBreadcrumbs } from './motion.js';
export { flyRowsToTrash } from './trash-fly.js';
export { stampAddedRows } from './add-stamp.js';
export { sweepRevertedRows } from './revert-sweep.js';
export { clearCommittedRows } from './commit-clear.js';
export { settleUpdatedRows } from './fresh-arrive.js';
export { shakeEl } from './shake.js';
