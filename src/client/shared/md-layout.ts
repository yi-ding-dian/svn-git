/** md 预览正文布局（全屏与非全屏共用同一个偏好）：
 *  - left（默认）：靠左铺满预览区/窗口
 *  - center：与原来的全屏阅读列一致（1280px 上限、左右留白居中）
 *  只作用于 md 渲染预览；查看原文、编辑态、diff 不受影响。选择持久化在 localStorage。 */

export type MdLayout = 'center' | 'left';

const LS_KEY = 'svngit-md-layout';

export function loadMdLayout(): MdLayout {
  try {
    // 默认靠左（用户定稿）：只有明确选过「居中」才居中
    return localStorage.getItem(LS_KEY) === 'center' ? 'center' : 'left';
  } catch {
    return 'left';
  }
}

export function saveMdLayout(v: MdLayout): void {
  try {
    localStorage.setItem(LS_KEY, v);
  } catch {
    /* 隐私模式等：本次会话内仍生效 */
  }
}

const GUTTER_KEY = 'svngit-md-gutter';

/** 全屏浏览 + 靠左时，右侧留白比例（百分数；0 = 满宽）。默认 1/3。
 *  只在全屏提供：非全屏预览区较窄，留白会让正文太挤。 */
export type MdGutter = 0 | 20 | 25 | 33;

const GUTTERS: MdGutter[] = [0, 20, 25, 33];

export function loadMdGutter(): MdGutter {
  try {
    const raw = localStorage.getItem(GUTTER_KEY);
    if (raw === null) return 33; // 从没设置过：默认 1/3
    // 旧版只有开关：'1' = 默认 1/3，'0' = 满宽
    if (raw === '1') return 33;
    const n = Number(raw);
    return GUTTERS.includes(n as MdGutter) ? (n as MdGutter) : 33;
  } catch {
    return 33;
  }
}

export function saveMdGutter(v: MdGutter): void {
  try {
    localStorage.setItem(GUTTER_KEY, String(v));
  } catch {
    /* 同上 */
  }
}
