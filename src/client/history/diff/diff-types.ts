/** 差异视图的目标与版本行标签类型（入口 index.ts 统一导出）。 */

export interface DiffTarget {
  path?: string;
  a?: string;
  b?: string;
}

/** 覆盖版本号行文案（历史提交弹窗用人类可读文案）；不传则用 file-versions 返回的原始版本号 */
export type DiffLabels = { left?: string; right?: string };
